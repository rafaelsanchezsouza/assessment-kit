import type { OutcomeRecord, OutcomeRecordRepository } from '@gaf/types';
import type { Pool } from 'pg';

export class PostgresOutcomeRecordRepository implements OutcomeRecordRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async create(record: OutcomeRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO outcome_records
         (id, condition_id, solution_id, baseline_assessment_id, followup_assessment_id,
          delta_finding_ids, outcome)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        record.id,
        record.conditionId,
        record.solutionId,
        record.baselineAssessmentId,
        record.followupAssessmentId,
        record.deltaFindingIds,
        record.outcome,
      ],
    );
  }

  async findByCondition(conditionId: string): Promise<OutcomeRecord[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM outcome_records WHERE condition_id = $1',
      [conditionId],
    );
    return rows.map(
      (row): OutcomeRecord => ({
        id: row.id,
        conditionId: row.condition_id,
        solutionId: row.solution_id,
        baselineAssessmentId: row.baseline_assessment_id,
        followupAssessmentId: row.followup_assessment_id,
        deltaFindingIds: row.delta_finding_ids,
        outcome: row.outcome,
      }),
    );
  }
}
