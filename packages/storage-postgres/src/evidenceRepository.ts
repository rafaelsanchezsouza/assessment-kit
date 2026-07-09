import type {
  AssessmentEvidence,
  Evidence,
  EvidenceOrigin,
  EvidenceRepository,
} from '@gaf/types';
import type { Pool } from 'pg';

export class PostgresEvidenceRepository implements EvidenceRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async create(evidence: Evidence): Promise<void> {
    await this.pool.query(
      `INSERT INTO evidence (id, subject_id, type, payload_ref, metadata, document_date)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        evidence.id,
        evidence.subjectId,
        evidence.type,
        evidence.payloadRef,
        evidence.metadata,
        evidence.documentDate ?? null,
      ],
    );
  }

  async get(id: string): Promise<Evidence | null> {
    const { rows } = await this.pool.query('SELECT * FROM evidence WHERE id = $1', [id]);
    return rows[0] ? toEvidence(rows[0]) : null;
  }

  async findBySubject(subjectId: string): Promise<Evidence[]> {
    const { rows } = await this.pool.query('SELECT * FROM evidence WHERE subject_id = $1', [
      subjectId,
    ]);
    return rows.map(toEvidence);
  }

  async linkToAssessment(link: AssessmentEvidence): Promise<void> {
    await this.pool.query(
      `INSERT INTO assessment_evidence (assessment_id, evidence_id, step_id, origin)
       VALUES ($1, $2, $3, $4)`,
      [link.assessmentId, link.evidenceId, link.stepId, link.origin],
    );
  }

  async findByAssessment(assessmentId: string): Promise<AssessmentEvidence[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM assessment_evidence WHERE assessment_id = $1',
      [assessmentId],
    );
    return rows.map(
      (row): AssessmentEvidence => ({
        assessmentId: row.assessment_id,
        evidenceId: row.evidence_id,
        stepId: row.step_id,
        origin: row.origin as EvidenceOrigin,
      }),
    );
  }
}

interface EvidenceRow {
  id: string;
  subject_id: string;
  type: Evidence['type'];
  payload_ref: string;
  metadata: Evidence['metadata'];
  document_date: string | null;
}

function toEvidence(row: EvidenceRow): Evidence {
  return {
    id: row.id,
    subjectId: row.subject_id,
    type: row.type,
    payloadRef: row.payload_ref,
    metadata: row.metadata,
    documentDate: row.document_date ?? undefined,
  };
}
