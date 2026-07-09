import type {
  Analyzer,
  AnalyzerInput,
  Assessment,
  AssessmentEvidence,
  AssessmentRepository,
  AssessmentState,
  Evidence,
  EvidenceRequestRepository,
  FindingRepository,
  Protocol,
} from '@gaf/types';
import { canTransition } from './stateMachine.ts';

export interface OrchestratorDeps {
  findingRepository: FindingRepository;
  evidenceRequestRepository: EvidenceRequestRepository;
  assessmentRepository: AssessmentRepository;
}

/**
 * Routes evidence to analyzers by role (ProtocolStep.feedsAnalyzers), runs
 * them async-first (human analyzers resolve out-of-band), persists their
 * output, and drives the assessment through analyzing -> review? ->
 * awaiting_evidence | completed per docs/domain-model.md §4.
 */
export class Orchestrator {
  private analyzers: Analyzer[] = [];
  private readonly deps: OrchestratorDeps;

  constructor(deps: OrchestratorDeps) {
    this.deps = deps;
  }

  register(analyzer: Analyzer): void {
    this.analyzers.push(analyzer);
  }

  /**
   * Intended to be started (not awaited) from the `analyzing` state — human
   * analyzers resolve asynchronously, so the assessment sits in `review` in
   * the meantime rather than blocking the caller.
   */
  async runAndPersist(
    assessment: Assessment,
    protocol: Protocol,
    evidence: Evidence[],
    evidenceLinks: AssessmentEvidence[],
    priorAssessment?: AnalyzerInput['priorAssessment'],
  ): Promise<void> {
    const feedsAnalyzersByStep = new Map(protocol.steps.map((s) => [s.id, s.feedsAnalyzers]));
    const requestedRoles = new Set(
      evidenceLinks.flatMap((link) => feedsAnalyzersByStep.get(link.stepId) ?? []),
    );

    const applicable = this.analyzers.filter(
      (a) =>
        a.registration.roles.includes('*') ||
        a.registration.roles.some((role) => requestedRoles.has(role)),
    );

    const wentThroughReview = applicable.some((a) => a.registration.kind === 'human');
    if (wentThroughReview) {
      await this.applyTransition(assessment, 'review');
    }

    const input: AnalyzerInput = { assessment, evidence, priorAssessment };
    const outputs = await Promise.all(applicable.map((a) => a.analyze(input)));

    for (const output of outputs) {
      for (const finding of output.findings) {
        await this.deps.findingRepository.create(finding);
      }
      for (const request of output.evidenceRequests) {
        await this.deps.evidenceRequestRepository.create(request);
      }
    }

    const hasPendingRequests = outputs.some((o) => o.evidenceRequests.length > 0);
    const canRefine = assessment.refinementRound < protocol.refinementPolicy.maxRefinementRounds;
    const nextState: AssessmentState =
      hasPendingRequests && canRefine ? 'awaiting_evidence' : 'completed';

    // review -> awaiting_evidence isn't a direct edge (see stateMachine.ts) — the
    // domain diagram loops back through `analyzing` first. review -> completed
    // IS direct, so only awaiting_evidence needs the extra hop.
    if (wentThroughReview && nextState === 'awaiting_evidence') {
      await this.applyTransition(assessment, 'analyzing');
    }
    await this.applyTransition(assessment, nextState);
  }

  private async applyTransition(assessment: Assessment, to: AssessmentState): Promise<void> {
    if (!canTransition(assessment.state, to)) {
      throw new Error(`illegal transition: ${assessment.state} -> ${to}`);
    }
    assessment.state = to;
    await this.deps.assessmentRepository.update(assessment);
  }
}
