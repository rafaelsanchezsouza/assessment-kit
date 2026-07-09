import type { Assessment, AssessmentRepository, AssessmentState } from '@gaf/types';
import type { Pool } from 'pg';

export class PostgresAssessmentRepository implements AssessmentRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async create(assessment: Assessment): Promise<void> {
    await this.pool.query(
      `INSERT INTO assessments
         (id, subject_id, protocol_id, protocol_version, state, refinement_round,
          prior_assessment_id, applied_solution_ids, progress)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        assessment.id,
        assessment.subjectId,
        assessment.protocolId,
        assessment.protocolVersion,
        assessment.state,
        assessment.refinementRound,
        assessment.priorAssessmentId ?? null,
        assessment.appliedSolutionIds ?? null,
        assessment.progress,
      ],
    );
  }

  async get(id: string): Promise<Assessment | null> {
    const { rows } = await this.pool.query('SELECT * FROM assessments WHERE id = $1', [id]);
    return rows[0] ? toAssessment(rows[0]) : null;
  }

  async update(assessment: Assessment): Promise<void> {
    await this.pool.query(
      `UPDATE assessments
       SET state = $2, refinement_round = $3, applied_solution_ids = $4, progress = $5
       WHERE id = $1`,
      [
        assessment.id,
        assessment.state,
        assessment.refinementRound,
        assessment.appliedSolutionIds ?? null,
        assessment.progress,
      ],
    );
  }

  async findBySubject(subjectId: string): Promise<Assessment[]> {
    const { rows } = await this.pool.query('SELECT * FROM assessments WHERE subject_id = $1', [
      subjectId,
    ]);
    return rows.map(toAssessment);
  }

  async findByState(state: AssessmentState): Promise<Assessment[]> {
    const { rows } = await this.pool.query('SELECT * FROM assessments WHERE state = $1', [state]);
    return rows.map(toAssessment);
  }
}

interface AssessmentRow {
  id: string;
  subject_id: string;
  protocol_id: string;
  protocol_version: string;
  state: AssessmentState;
  refinement_round: number;
  prior_assessment_id: string | null;
  applied_solution_ids: string[] | null;
  progress: Assessment['progress'];
}

function toAssessment(row: AssessmentRow): Assessment {
  return {
    id: row.id,
    subjectId: row.subject_id,
    protocolId: row.protocol_id,
    protocolVersion: row.protocol_version,
    state: row.state,
    refinementRound: row.refinement_round,
    priorAssessmentId: row.prior_assessment_id ?? undefined,
    appliedSolutionIds: row.applied_solution_ids ?? undefined,
    progress: row.progress,
  };
}
