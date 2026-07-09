import type { Finding, FindingRepository } from '@gaf/types';
import type { Pool } from 'pg';

export class PostgresFindingRepository implements FindingRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async create(finding: Finding): Promise<void> {
    await this.pool.query(
      `INSERT INTO findings
         (id, assessment_id, subject_id, statement_code, statement_params, statement_text,
          evidence_refs, confidence, effective_date, produced_by_id, produced_by_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        finding.id,
        finding.assessmentId,
        finding.subjectId,
        finding.statement.code,
        finding.statement.params ?? {},
        finding.statement.text,
        finding.evidenceRefs,
        finding.confidence,
        finding.effectiveDate,
        finding.producedBy.analyzerId,
        finding.producedBy.version,
      ],
    );
  }

  async findByAssessment(assessmentId: string): Promise<Finding[]> {
    const { rows } = await this.pool.query('SELECT * FROM findings WHERE assessment_id = $1', [
      assessmentId,
    ]);
    return rows.map(toFinding);
  }

  async findBySubjectAndCode(subjectId: string, code: string): Promise<Finding[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM findings WHERE subject_id = $1 AND statement_code = $2
       ORDER BY effective_date`,
      [subjectId, code],
    );
    return rows.map(toFinding);
  }
}

interface FindingRow {
  id: string;
  assessment_id: string;
  subject_id: string;
  statement_code: string;
  statement_params: Record<string, unknown>;
  statement_text: string;
  evidence_refs: string[];
  confidence: number;
  effective_date: string;
  produced_by_id: string;
  produced_by_version: string;
}

function toFinding(row: FindingRow): Finding {
  return {
    id: row.id,
    assessmentId: row.assessment_id,
    subjectId: row.subject_id,
    statement: { code: row.statement_code, params: row.statement_params, text: row.statement_text },
    evidenceRefs: row.evidence_refs,
    confidence: row.confidence,
    effectiveDate: row.effective_date,
    producedBy: { analyzerId: row.produced_by_id, version: row.produced_by_version },
  };
}
