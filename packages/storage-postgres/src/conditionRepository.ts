import type { Condition, ConditionRepository } from '@assessment-kit/types';
import type { Pool } from 'pg';

export class PostgresConditionRepository implements ConditionRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async create(condition: Condition): Promise<void> {
    await this.pool.query(
      `INSERT INTO conditions
         (id, assessment_id, statement_code, statement_params, statement_text,
          finding_refs, severity, confidence, derived_by_id, derived_by_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        condition.id,
        condition.assessmentId,
        condition.statement.code,
        condition.statement.params ?? {},
        condition.statement.text,
        condition.findingRefs,
        condition.severity ?? null,
        condition.confidence,
        condition.derivedBy.id,
        condition.derivedBy.version,
      ],
    );
  }

  async findByAssessment(assessmentId: string): Promise<Condition[]> {
    const { rows } = await this.pool.query('SELECT * FROM conditions WHERE assessment_id = $1', [
      assessmentId,
    ]);
    return rows.map(toCondition);
  }
}

interface ConditionRow {
  id: string;
  assessment_id: string;
  statement_code: string;
  statement_params: Record<string, unknown>;
  statement_text: string;
  finding_refs: string[];
  severity: number | null;
  confidence: number;
  derived_by_id: string;
  derived_by_version: string;
}

function toCondition(row: ConditionRow): Condition {
  return {
    id: row.id,
    assessmentId: row.assessment_id,
    statement: { code: row.statement_code, params: row.statement_params, text: row.statement_text },
    findingRefs: row.finding_refs,
    severity: row.severity ?? undefined,
    confidence: row.confidence,
    derivedBy: { id: row.derived_by_id, version: row.derived_by_version },
  };
}
