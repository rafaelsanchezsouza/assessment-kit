import type { EvidenceRequest, EvidenceRequestRepository } from '@gaf/types';
import type { Pool } from 'pg';

export class PostgresEvidenceRequestRepository implements EvidenceRequestRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async create(request: EvidenceRequest): Promise<void> {
    await this.pool.query(
      `INSERT INTO evidence_requests
         (id, assessment_id, kind, reason, step_spec, requested_by_id, status,
          inadequate_evidence_refs)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        request.id,
        request.assessmentId,
        request.kind,
        request.reason,
        request.stepSpec,
        request.requestedBy.analyzerId,
        request.status,
        request.inadequateEvidenceRefs ?? [],
      ],
    );
  }

  async findByAssessment(assessmentId: string): Promise<EvidenceRequest[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM evidence_requests WHERE assessment_id = $1',
      [assessmentId],
    );
    return rows.map(toEvidenceRequest);
  }

  async updateStatus(id: string, status: EvidenceRequest['status']): Promise<void> {
    await this.pool.query('UPDATE evidence_requests SET status = $2 WHERE id = $1', [id, status]);
  }
}

interface EvidenceRequestRow {
  id: string;
  assessment_id: string;
  kind: EvidenceRequest['kind'];
  reason: string;
  step_spec: EvidenceRequest['stepSpec'];
  requested_by_id: string;
  status: EvidenceRequest['status'];
  inadequate_evidence_refs: string[] | null;
}

function toEvidenceRequest(row: EvidenceRequestRow): EvidenceRequest {
  return {
    id: row.id,
    assessmentId: row.assessment_id,
    kind: row.kind,
    reason: row.reason,
    stepSpec: row.step_spec,
    requestedBy: { analyzerId: row.requested_by_id },
    status: row.status,
    // the column defaults to '{}' — an empty list means "nothing was rejected",
    // which the contract expresses as absence, not as an empty array
    ...(row.inadequate_evidence_refs?.length
      ? { inadequateEvidenceRefs: row.inadequate_evidence_refs }
      : {}),
  };
}
