import { randomUUID } from 'node:crypto';
import type {
  AnalyzerOutput,
  Assessment,
  AssessmentRepository,
  BlobStore,
  Evidence,
  EvidenceOrigin,
  EvidenceRepository,
  EvidenceRequestRepository,
  FindingRepository,
  ProtocolRepository,
  SubjectRepository,
} from '@gaf/types';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { canTransition } from '../stateMachine.ts';
import { Orchestrator } from '../orchestrator.ts';
import { findPendingRequestsForStep, resolveRequestsForStep } from '../evidenceRequests.ts';

/**
 * The `/reviews` endpoint needs to resolve a pending human-analyzer promise,
 * but that's HumanAnalyzer-specific behavior, not part of the generic
 * Analyzer contract in @gaf/types. Declaring the shape here (rather than
 * importing @gaf/analyzer-human) keeps @gaf/core analyzer-agnostic — the
 * composition root (apps/reference) passes a concrete instance that
 * structurally satisfies it.
 */
export interface ReviewSubmitter {
  submitReview(assessmentId: string, output: AnalyzerOutput): boolean;
}

/**
 * What a route is about to touch, in framework-neutral terms. The framework
 * knows subjects/assessments/blobs but has no concept of who owns them — that's
 * vertical (domain) knowledge. An `Authorizer` supplied by the composition root
 * gets the request (so it can read whatever identity its own auth middleware
 * attached) plus the resource, and decides. This is the ports-and-adapters seam
 * for access control: the engine enforces *that* a decision is made; the vertical
 * supplies *the* decision. See ADR-006 (repos enforce visibility, packages enforce
 * layering) and docs/domain-model.md §7 (consent/authorization open questions).
 */
export type AuthzResource =
  | { kind: 'subject'; action: 'read'; subjectId: string }
  | { kind: 'subject'; action: 'create' }
  | { kind: 'assessment'; action: 'read' | 'write'; assessmentId: string }
  | { kind: 'assessment'; action: 'create'; subjectId: string }
  | { kind: 'assessment-list'; action: 'read'; state: Assessment['state'] }
  | { kind: 'blob'; action: 'read'; key: string };

export type Authorizer = (req: Request, resource: AuthzResource) => boolean | Promise<boolean>;

export interface AppDeps {
  subjects: SubjectRepository;
  protocols: ProtocolRepository;
  assessments: AssessmentRepository;
  evidence: EvidenceRepository;
  findings: FindingRepository;
  evidenceRequests: EvidenceRequestRepository;
  orchestrator: Orchestrator;
  reviewSubmitter: ReviewSubmitter;
  blobs: BlobStore;
  /**
   * Access-control decision hook. Omitted → allow-all, which is correct ONLY for
   * a single-tenant/dev composition root (apps/reference, tests). Any deployment
   * serving more than one owner's data MUST supply one, or every authenticated
   * caller can reach every other caller's subjects, assessments and blobs.
   */
  authorize?: Authorizer;
}

const ASSESSMENT_STATES = new Set([
  'draft',
  'capturing',
  'analyzing',
  'awaiting_evidence',
  'review',
  'completed',
  'abandoned',
]);

function canBeState(value: string): value is Assessment['state'] {
  return ASSESSMENT_STATES.has(value);
}

// Express 4 does not catch rejections from async handlers — without this
// wrapper a failing repository call becomes an unhandled rejection and kills
// the whole process on modern Node.
function wrap(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(express.json());

  const authorize: Authorizer = deps.authorize ?? (() => true);

  // Returns true if the caller may proceed; otherwise writes 403 and returns
  // false so the handler can `if (!(await allow(...))) return;`. The default
  // authorizer allows everything, so composition roots that don't opt in keep
  // their current behavior (including existing 404 semantics downstream).
  async function allow(req: Request, res: Response, resource: AuthzResource): Promise<boolean> {
    if (await authorize(req, resource)) return true;
    res.status(403).json({ error: 'forbidden' });
    return false;
  }

  async function getAssessmentOr404(req: Request, res: Response): Promise<Assessment | null> {
    const assessment = await deps.assessments.get(req.params.id);
    if (!assessment) {
      res.status(404).json({ error: `no assessment ${req.params.id}` });
      return null;
    }
    return assessment;
  }

  app.post('/subjects', wrap(async (req, res) => {
    if (!(await allow(req, res, { kind: 'subject', action: 'create' }))) return;
    const { type, ownerId, attributes } = req.body;
    if (!type || !ownerId) {
      res.status(400).json({ error: 'type and ownerId are required' });
      return;
    }
    const subject = { id: randomUUID(), type, ownerId, attributes: attributes ?? {} };
    await deps.subjects.create(subject);
    res.status(201).json(subject);
  }));

  app.get('/subjects/:id', wrap(async (req, res) => {
    if (!(await allow(req, res, { kind: 'subject', action: 'read', subjectId: req.params.id }))) return;
    const subject = await deps.subjects.get(req.params.id);
    if (!subject) {
      res.status(404).json({ error: `no subject ${req.params.id}` });
      return;
    }
    res.json(subject);
  }));

  app.get('/subjects/:id/assessments', wrap(async (req, res) => {
    if (!(await allow(req, res, { kind: 'subject', action: 'read', subjectId: req.params.id }))) return;
    res.json(await deps.assessments.findBySubject(req.params.id));
  }));

  // The subject's evidence library ("uploads panel"): everything ever captured
  // for this subject, across all assessments and branches.
  app.get('/subjects/:id/evidence', wrap(async (req, res) => {
    if (!(await allow(req, res, { kind: 'subject', action: 'read', subjectId: req.params.id }))) return;
    if (!(await deps.subjects.get(req.params.id))) {
      res.status(404).json({ error: `no subject ${req.params.id}` });
      return;
    }
    res.json(await deps.evidence.findBySubject(req.params.id));
  }));

  app.get('/protocols/:id/:version', wrap(async (req, res) => {
    const protocol = await deps.protocols.get(req.params.id, req.params.version);
    if (!protocol) {
      res.status(404).json({ error: `no protocol ${req.params.id}@${req.params.version}` });
      return;
    }
    res.json(protocol);
  }));

  app.post('/assessments', wrap(async (req, res) => {
    const { subjectId, protocolId, protocolVersion, priorAssessmentId, branchOf } = req.body;
    if (!subjectId || !protocolId || !protocolVersion) {
      res.status(400).json({ error: 'subjectId, protocolId and protocolVersion are required' });
      return;
    }
    if (!(await allow(req, res, { kind: 'assessment', action: 'create', subjectId }))) return;
    if (!(await deps.subjects.get(subjectId))) {
      res.status(404).json({ error: `no subject ${subjectId}` });
      return;
    }
    if (!(await deps.protocols.get(protocolId, protocolVersion))) {
      res.status(404).json({ error: `no protocol ${protocolId}@${protocolVersion}` });
      return;
    }
    if (branchOf) {
      const parent = await deps.assessments.get(branchOf);
      if (!parent) {
        res.status(404).json({ error: `no parent assessment ${branchOf}` });
        return;
      }
      if (parent.subjectId !== subjectId) {
        res.status(400).json({ error: 'branch must share the parent assessment subject' });
        return;
      }
    }
    const assessment: Assessment = {
      id: randomUUID(),
      subjectId,
      protocolId,
      protocolVersion,
      state: 'draft',
      refinementRound: 0,
      priorAssessmentId,
      branchOf,
      progress: {},
    };
    await deps.assessments.create(assessment);
    res.status(201).json(assessment);
  }));

  app.get('/assessments/:id/branches', wrap(async (req, res) => {
    if (!(await allow(req, res, { kind: 'assessment', action: 'read', assessmentId: req.params.id }))) return;
    if (!(await getAssessmentOr404(req, res))) return;
    res.json(await deps.assessments.findBranches(req.params.id));
  }));

  // Attach EXISTING evidence to an assessment (uploads-panel attach / branch
  // merge): creates a link, never copies bytes — evidence belongs to the
  // Subject. origin defaults to library_reuse.
  app.post('/assessments/:id/evidence-links', wrap(async (req, res) => {
    if (!(await allow(req, res, { kind: 'assessment', action: 'write', assessmentId: req.params.id }))) return;
    const assessment = await getAssessmentOr404(req, res);
    if (!assessment) return;
    const { evidenceId, stepId, origin } = req.body as {
      evidenceId: string;
      stepId: string;
      origin?: EvidenceOrigin;
    };
    if (!evidenceId || !stepId) {
      res.status(400).json({ error: 'evidenceId and stepId are required' });
      return;
    }
    const evidence = await deps.evidence.get(evidenceId);
    if (!evidence) {
      res.status(404).json({ error: `no evidence ${evidenceId}` });
      return;
    }
    if (evidence.subjectId !== assessment.subjectId) {
      res.status(400).json({ error: 'evidence belongs to a different subject' });
      return;
    }
    const existing = await deps.evidence.findByAssessment(assessment.id);
    if (existing.some((l) => l.evidenceId === evidenceId && l.stepId === stepId)) {
      res.status(409).json({ error: 'evidence already linked to this assessment step' });
      return;
    }
    // Attaching something already in the subject's library is a legitimate way
    // to answer a request — the caller's explicit `origin` still wins, since it
    // knows why it is attaching.
    const answersRequests =
      (await findPendingRequestsForStep(deps.evidenceRequests, assessment.id, stepId)).length > 0;

    const link = {
      assessmentId: assessment.id,
      evidenceId,
      stepId,
      origin: origin ?? ((answersRequests ? 'evidence_request' : 'library_reuse') as EvidenceOrigin),
    };
    await deps.evidence.linkToAssessment(link);
    await resolveRequestsForStep(deps.evidenceRequests, {
      assessmentId: assessment.id,
      stepId,
      outcome: 'done',
    });
    res.status(201).json(link);
  }));

  // Work-queue listing for analyzer/review UIs, e.g. GET /assessments?state=review
  app.get('/assessments', wrap(async (req, res) => {
    const state = req.query.state;
    if (typeof state !== 'string' || !canBeState(state)) {
      res.status(400).json({ error: 'a valid ?state= filter is required' });
      return;
    }
    if (!(await allow(req, res, { kind: 'assessment-list', action: 'read', state }))) return;
    res.json(await deps.assessments.findByState(state));
  }));

  app.get('/assessments/:id', wrap(async (req, res) => {
    if (!(await allow(req, res, { kind: 'assessment', action: 'read', assessmentId: req.params.id }))) return;
    const assessment = await getAssessmentOr404(req, res);
    if (assessment) res.json(assessment);
  }));

  // Evidence attached to an assessment, with its link metadata (stepId, origin) —
  // what a reviewer needs to see everything the user captured.
  app.get('/assessments/:id/evidence', wrap(async (req, res) => {
    if (!(await allow(req, res, { kind: 'assessment', action: 'read', assessmentId: req.params.id }))) return;
    const assessment = await getAssessmentOr404(req, res);
    if (!assessment) return;
    const links = await deps.evidence.findByAssessment(assessment.id);
    const items = await Promise.all(
      links.map(async (link) => ({ link, evidence: await deps.evidence.get(link.evidenceId) })),
    );
    res.json(items.filter((i) => i.evidence !== null));
  }));

  app.post('/assessments/:id/start', wrap(async (req, res) => {
    if (!(await allow(req, res, { kind: 'assessment', action: 'write', assessmentId: req.params.id }))) return;
    const assessment = await getAssessmentOr404(req, res);
    if (!assessment) return;
    if (!canTransition(assessment.state, 'capturing')) {
      res.status(409).json({ error: `cannot start from state ${assessment.state}` });
      return;
    }
    assessment.state = 'capturing';
    await deps.assessments.update(assessment);
    res.json(assessment);
  }));

  app.patch('/assessments/:id/progress', wrap(async (req, res) => {
    if (!(await allow(req, res, { kind: 'assessment', action: 'write', assessmentId: req.params.id }))) return;
    const assessment = await getAssessmentOr404(req, res);
    if (!assessment) return;

    const { stepId, status, evidence } = req.body as {
      stepId: string;
      status: 'done' | 'skipped';
      evidence?: Omit<Evidence, 'id' | 'subjectId'>;
    };
    if (!stepId || !status) {
      res.status(400).json({ error: 'stepId and status are required' });
      return;
    }

    // Answering an analyzer's request is provenance worth keeping: the link
    // records `evidence_request` rather than `protocol_step` when this step
    // exists because an analyzer asked for it (domain-model.md §3).
    const answersRequests =
      (await findPendingRequestsForStep(deps.evidenceRequests, assessment.id, stepId)).length > 0;

    if (evidence) {
      const evidenceRow: Evidence = { id: randomUUID(), subjectId: assessment.subjectId, ...evidence };
      await deps.evidence.create(evidenceRow);
      await deps.evidence.linkToAssessment({
        assessmentId: assessment.id,
        evidenceId: evidenceRow.id,
        stepId,
        origin: answersRequests ? 'evidence_request' : 'protocol_step',
      });
    }

    assessment.progress = { ...assessment.progress, [stepId]: status };
    await deps.assessments.update(assessment);

    // Both outcomes resolve: a skip is an answer ("I'm not doing that"), and the
    // capturer must never be shown a request they have already acted on.
    await resolveRequestsForStep(deps.evidenceRequests, {
      assessmentId: assessment.id,
      stepId,
      outcome: status,
    });

    res.json(assessment);
  }));

  // Raw-body route: binary evidence payloads (photos, documents). The client
  // uploads the blob first, then references the returned payloadRef in the
  // evidence it attaches via PATCH .../progress. contentType is not persisted
  // by the BlobStore port — clients record it in evidence.metadata.
  app.post(
    '/assessments/:id/evidence-blob',
    express.raw({ type: '*/*', limit: '25mb' }),
    wrap(async (req, res) => {
      if (!(await allow(req, res, { kind: 'assessment', action: 'write', assessmentId: req.params.id }))) return;
      const assessment = await getAssessmentOr404(req, res);
      if (!assessment) return;
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        res.status(400).json({ error: 'request body must be a non-empty binary payload' });
        return;
      }
      const key = `evidence/${assessment.id}/${randomUUID()}`;
      await deps.blobs.put(key, req.body, req.headers['content-type'] ?? 'application/octet-stream');
      res.status(201).json({ blobKey: key, payloadRef: `blob://${key}` });
    }),
  );

  app.get('/blobs/*', wrap(async (req, res) => {
    const key = (req.params as Record<string, string>)[0];
    if (!(await allow(req, res, { kind: 'blob', action: 'read', key }))) return;
    const data = await deps.blobs.get(key);
    if (!data) {
      res.status(404).json({ error: `no blob ${key}` });
      return;
    }
    res.type('application/octet-stream').send(data);
  }));

  app.post('/assessments/:id/submit', wrap(async (req, res) => {
    if (!(await allow(req, res, { kind: 'assessment', action: 'write', assessmentId: req.params.id }))) return;
    const assessment = await getAssessmentOr404(req, res);
    if (!assessment) return;

    const isResubmission = assessment.state === 'awaiting_evidence';
    if (!canTransition(assessment.state, 'analyzing')) {
      res.status(409).json({ error: `cannot submit from state ${assessment.state}` });
      return;
    }

    const protocol = await deps.protocols.get(assessment.protocolId, assessment.protocolVersion);
    if (!protocol) {
      res.status(500).json({ error: `protocol ${assessment.protocolId}@${assessment.protocolVersion} missing` });
      return;
    }

    if (isResubmission) assessment.refinementRound += 1;
    assessment.state = 'analyzing';
    await deps.assessments.update(assessment);

    const evidenceLinks = await deps.evidence.findByAssessment(assessment.id);
    const evidence = (
      await Promise.all(evidenceLinks.map((link) => deps.evidence.get(link.evidenceId)))
    ).filter((e): e is Evidence => e !== null);

    // Fire-and-forget: human analyzers resolve asynchronously (ADR-005) — the
    // assessment sits in `review` until then, this request doesn't block on it.
    deps.orchestrator
      .runAndPersist(assessment, protocol, evidence, evidenceLinks)
      .catch((err) => console.error(`orchestrator run failed for ${assessment.id}:`, err));

    res.status(202).json(assessment);
  }));

  app.post('/reviews/:assessmentId', wrap(async (req, res) => {
    const assessmentId = req.params.assessmentId;
    if (!(await allow(req, res, { kind: 'assessment', action: 'write', assessmentId }))) return;
    const assessment = await deps.assessments.get(assessmentId);
    if (!assessment) {
      res.status(404).json({ error: `no assessment ${assessmentId}` });
      return;
    }

    const { findings = [], evidenceRequests = [] } = req.body as {
      findings?: Array<Omit<AnalyzerOutput['findings'][number], 'id' | 'assessmentId' | 'subjectId'>>;
      evidenceRequests?: Array<Omit<AnalyzerOutput['evidenceRequests'][number], 'id' | 'assessmentId'>>;
    };

    // A re-request points at the evidence that failed to answer it. Those ids
    // must belong to this assessment — a ref to someone else's evidence would
    // be a dangling judgment nothing can render or learn from.
    const rejected = evidenceRequests.flatMap((r) => r.inadequateEvidenceRefs ?? []);
    if (rejected.length > 0) {
      const linked = new Set(
        (await deps.evidence.findByAssessment(assessmentId)).map((l) => l.evidenceId),
      );
      const stray = rejected.filter((id) => !linked.has(id));
      if (stray.length > 0) {
        res.status(400).json({
          error: `inadequateEvidenceRefs not attached to this assessment: ${stray.join(', ')}`,
        });
        return;
      }
    }

    const output: AnalyzerOutput = {
      findings: findings.map((f) => ({
        id: randomUUID(),
        assessmentId,
        subjectId: assessment.subjectId,
        ...f,
      })),
      evidenceRequests: evidenceRequests.map((r) => ({ id: randomUUID(), assessmentId, ...r })),
    };

    const resolved = deps.reviewSubmitter.submitReview(assessmentId, output);
    if (!resolved) {
      res.status(409).json({ error: `no pending review for assessment ${assessmentId}` });
      return;
    }
    res.status(202).json({ accepted: true });
  }));

  app.get('/assessments/:id/findings', wrap(async (req, res) => {
    if (!(await allow(req, res, { kind: 'assessment', action: 'read', assessmentId: req.params.id }))) return;
    if (!(await getAssessmentOr404(req, res))) return;
    res.json(await deps.findings.findByAssessment(req.params.id));
  }));

  app.get('/assessments/:id/evidence-requests', wrap(async (req, res) => {
    if (!(await allow(req, res, { kind: 'assessment', action: 'read', assessmentId: req.params.id }))) return;
    if (!(await getAssessmentOr404(req, res))) return;
    res.json(await deps.evidenceRequests.findByAssessment(req.params.id));
  }));

  // Express identifies error middleware by its 4-argument arity.
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('request failed:', err);
    res.status(500).json({ error: 'internal error' });
  });

  return app;
}
