/**
 * @gaf/types — shared contracts for the Guided Assessment Framework.
 * This file is the TypeScript translation of docs/domain-model.md.
 * Every other package depends on this one; it has zero dependencies itself.
 */

// ─── Subject ────────────────────────────────────────────────────────────────

export interface Subject {
  id: string;
  /** Vertical-defined, e.g. "storefront" | "face" */
  type: string;
  ownerId: string;
  /** Free-form, schema owned by the vertical */
  attributes: Record<string, unknown>;
}

// ─── Protocol (versioned, data not code) ────────────────────────────────────

export type CaptureType = 'image' | 'structured_input' | 'document';

export interface Protocol {
  id: string;
  /** Immutable once published; edits create a new version */
  version: string;
  subjectType: string;
  steps: ProtocolStep[];
  refinementPolicy: {
    maxRefinementRounds: number;
    skippable: true; // by invariant, always skippable
  };
}

export interface ProtocolStep {
  id: string;
  title: string;
  guidance: string;
  captureType: CaptureType;
  /** Overlay/angle for images; JSON-schema form for structured; formats for documents */
  captureSpec: Record<string, unknown>;
  /** SVG silhouette shown on the camera HUD (images only) */
  overlayRef?: string;
  /** Example capture shown to the user ("it should look like this") */
  exampleRef?: string;
  /** Analyzer ROLES (not concrete ids) this evidence feeds */
  feedsAnalyzers: string[];
  /** Client-side physics checks: blur, orientation, resolution, required fields */
  validationRules?: Record<string, unknown>;
  optional?: boolean;
  /** Branching: expression over prior structured answers */
  condition?: string;
}

// ─── Evidence (owned by Subject, referenced by Assessments) ─────────────────

export interface Evidence {
  id: string;
  subjectId: string;
  type: CaptureType;
  /** Blob URI (image/document) or inline JSON (structured) */
  payloadRef: string;
  metadata: {
    capturedAt: string; // ISO
    device?: string;
    geolocation?: { lat: number; lng: number };
    [k: string]: unknown;
  };
  /** Date the content refers to, when distinct from capture (2019 lab report uploaded today) */
  documentDate?: string;
}

export type EvidenceOrigin = 'protocol_step' | 'evidence_request' | 'library_reuse';

export interface AssessmentEvidence {
  assessmentId: string;
  evidenceId: string;
  /** May reference a dynamic step from an EvidenceRequest */
  stepId: string;
  origin: EvidenceOrigin;
}

// ─── Assessment & state machine ─────────────────────────────────────────────

export type AssessmentState =
  | 'draft'
  | 'capturing'
  | 'analyzing'
  | 'awaiting_evidence'
  | 'review'
  | 'completed'
  | 'abandoned';

export interface Assessment {
  id: string;
  subjectId: string;
  protocolId: string;
  /** MANDATORY — comparisons silently break without it */
  protocolVersion: string;
  state: AssessmentState;
  refinementRound: number;
  /** Set for re-assessments; activates comparison analyzers */
  priorAssessmentId?: string;
  /**
   * Set for branch assessments: refinements scoped to one analyzer/reviewer
   * on top of a parent assessment (e.g. per-reviewer revision rounds whose
   * evidence must not leak to other reviewers). Branch evidence joins the
   * parent by linking it there (`AssessmentEvidence.origin: library_reuse`) —
   * evidence itself always belongs to the Subject. Distinct from
   * `priorAssessmentId`, which relates assessments *over time*.
   */
  branchOf?: string;
  /** Solutions applied since the prior assessment */
  appliedSolutionIds?: string[];
  /** Server-side draft sync: per-step completion, authoritative on the server */
  progress: Record<string /* stepId */, 'pending' | 'done' | 'skipped'>;
}

// ─── Analyzer plugin contract (human and AI share it) ───────────────────────

export type AnalyzerKind =
  | 'cv_model'
  | 'llm'
  | 'human'
  | 'rule'
  | 'extraction'
  | 'compliance'
  | 'comparison';

export interface AnalyzerRegistration {
  id: string;
  version: string;
  kind: AnalyzerKind;
  /** Roles this analyzer fulfils — matched against ProtocolStep.feedsAnalyzers */
  roles: string[];
  consumes: CaptureType[];
  /** Human analyzers resolve in hours/days — orchestration is async-first */
  async: boolean;
}

export interface AnalyzerInput {
  assessment: Assessment;
  evidence: Evidence[];
  /** For comparison analyzers */
  priorAssessment?: { assessment: Assessment; findings: Finding[] };
}

export interface AnalyzerOutput {
  findings: Finding[];
  evidenceRequests: EvidenceRequest[];
}

export interface Analyzer {
  registration: AnalyzerRegistration;
  analyze(input: AnalyzerInput): Promise<AnalyzerOutput>;
}

// ─── Findings, EvidenceRequests, Conditions ─────────────────────────────────

export interface CodedStatement {
  /** Machine-readable, vertical-owned taxonomy (may be LOINC/SNOMED/custom) */
  code: string;
  params?: Record<string, unknown>;
  /** Human-readable rendering */
  text: string;
}

export interface Finding {
  id: string;
  assessmentId: string;
  subjectId: string; // denormalized: findings are queryable per subject (longitudinal)
  statement: CodedStatement;
  evidenceRefs: string[];
  /** First-class: drives refinement */
  confidence: number; // 0..1
  /** When the observation is true of the subject — trends MUST use this, never assessment date */
  effectiveDate: string;
  producedBy: { analyzerId: string; version: string };
}

export type EvidenceRequestKind = 'retake' | 'additional';

export interface EvidenceRequest {
  id: string;
  assessmentId: string;
  /** retake = replaces bad evidence, inline UX; additional = refinement loop, optional */
  kind: EvidenceRequestKind;
  /** Shown to the user ("possible moisture in the left corner — take a close-up") */
  reason: string;
  /** Same shape as ProtocolStep — reuses all capture machinery */
  stepSpec: ProtocolStep;
  requestedBy: { analyzerId: string };
  status: 'pending' | 'fulfilled' | 'skipped';
}

export interface Condition {
  id: string;
  assessmentId: string;
  statement: CodedStatement;
  findingRefs: string[];
  severity?: number;
  confidence: number;
  derivedBy: { id: string; version: string };
}

// ─── Solutions & Recommendations ────────────────────────────────────────────

export type FulfillmentType = 'product' | 'service' | 'self_action' | 'plan';

export interface Solution {
  id: string;
  title: string;
  description: string;
  fulfillmentType: FulfillmentType;
  conditionsAddressed: string[]; // condition codes
  /** SKU / matching criteria / instructions / child solution ids (plan: modeled, deferred) */
  fulfillmentPayload: Record<string, unknown>;
}

export type RecommendationStatus = 'proposed' | 'accepted' | 'declined' | 'fulfilled';

export interface Recommendation {
  id: string;
  assessmentId: string;
  conditionIds: string[];
  solutionId: string;
  rationale: string;
  confidence: number;
  priority?: number;
  /** Provenance is moat data */
  recommendedBy: { id: string; version: string };
  status: RecommendationStatus;
}

// ─── Feedback loop ──────────────────────────────────────────────────────────

export interface OutcomeRecord {
  id: string;
  conditionId: string;
  solutionId: string;
  baselineAssessmentId: string;
  followupAssessmentId: string;
  deltaFindingIds: string[];
  outcome: 'improved' | 'unchanged' | 'worsened' | 'unknown';
}

// ─── Fulfillment boundary (the framework STOPS here) ────────────────────────

export interface FulfillmentRequestedEvent {
  type: 'fulfillment.requested';
  recommendationId: string;
  solution: Solution;
  subjectId: string;
  userId: string;
}

// ─── Storage ports (Repository + BlobStore) ─────────────────────────────────
// One interface per aggregate, not a generic Repository<T> — each aggregate has
// distinct real query needs (see docs/domain-model.md), e.g. Finding's
// longitudinal cross-assessment lookup. Solution stays file-based (catalog
// YAML) — no SolutionRepository; Recommendation just references solutionId.

export interface SubjectRepository {
  create(subject: Subject): Promise<void>;
  get(id: string): Promise<Subject | null>;
  findByOwner(ownerId: string): Promise<Subject[]>;
}

export interface ProtocolRepository {
  /** Upsert by (id, version) — protocols are immutable once published. */
  save(protocol: Protocol): Promise<void>;
  get(id: string, version: string): Promise<Protocol | null>;
  listVersions(id: string): Promise<string[]>;
}

export interface AssessmentRepository {
  create(assessment: Assessment): Promise<void>;
  get(id: string): Promise<Assessment | null>;
  /** Persists state/progress/refinementRound changes. */
  update(assessment: Assessment): Promise<void>;
  findBySubject(subjectId: string): Promise<Assessment[]>;
  /** Work queues: e.g. review UIs listing everything awaiting a human analyzer. */
  findByState(state: AssessmentState): Promise<Assessment[]>;
  /** All branch assessments created on top of a parent (see Assessment.branchOf). */
  findBranches(parentAssessmentId: string): Promise<Assessment[]>;
}

export interface EvidenceRepository {
  create(evidence: Evidence): Promise<void>;
  get(id: string): Promise<Evidence | null>;
  findBySubject(subjectId: string): Promise<Evidence[]>;
  linkToAssessment(link: AssessmentEvidence): Promise<void>;
  findByAssessment(assessmentId: string): Promise<AssessmentEvidence[]>;
}

export interface FindingRepository {
  create(finding: Finding): Promise<void>;
  findByAssessment(assessmentId: string): Promise<Finding[]>;
  /** Longitudinal query across all of a subject's assessments (domain-model.md §2). */
  findBySubjectAndCode(subjectId: string, code: string): Promise<Finding[]>;
}

export interface EvidenceRequestRepository {
  create(request: EvidenceRequest): Promise<void>;
  findByAssessment(assessmentId: string): Promise<EvidenceRequest[]>;
  updateStatus(id: string, status: EvidenceRequest['status']): Promise<void>;
}

export interface ConditionRepository {
  create(condition: Condition): Promise<void>;
  findByAssessment(assessmentId: string): Promise<Condition[]>;
}

export interface RecommendationRepository {
  create(recommendation: Recommendation): Promise<void>;
  findByAssessment(assessmentId: string): Promise<Recommendation[]>;
  updateStatus(id: string, status: RecommendationStatus): Promise<void>;
}

export interface OutcomeRecordRepository {
  create(record: OutcomeRecord): Promise<void>;
  findByCondition(conditionId: string): Promise<OutcomeRecord[]>;
}

export interface BlobStore {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
