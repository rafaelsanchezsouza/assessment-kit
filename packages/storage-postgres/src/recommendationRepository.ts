import type { Recommendation, RecommendationRepository, RecommendationStatus } from '@assessment-kit/types';
import type { Pool } from 'pg';

export class PostgresRecommendationRepository implements RecommendationRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async create(recommendation: Recommendation): Promise<void> {
    await this.pool.query(
      `INSERT INTO recommendations
         (id, assessment_id, condition_ids, solution_id, rationale, confidence, priority,
          recommended_by_id, recommended_by_version, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        recommendation.id,
        recommendation.assessmentId,
        recommendation.conditionIds,
        recommendation.solutionId,
        recommendation.rationale,
        recommendation.confidence,
        recommendation.priority ?? null,
        recommendation.recommendedBy.id,
        recommendation.recommendedBy.version,
        recommendation.status,
      ],
    );
  }

  async findByAssessment(assessmentId: string): Promise<Recommendation[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM recommendations WHERE assessment_id = $1',
      [assessmentId],
    );
    return rows.map(toRecommendation);
  }

  async updateStatus(id: string, status: RecommendationStatus): Promise<void> {
    await this.pool.query('UPDATE recommendations SET status = $2 WHERE id = $1', [id, status]);
  }
}

interface RecommendationRow {
  id: string;
  assessment_id: string;
  condition_ids: string[];
  solution_id: string;
  rationale: string;
  confidence: number;
  priority: number | null;
  recommended_by_id: string;
  recommended_by_version: string;
  status: RecommendationStatus;
}

function toRecommendation(row: RecommendationRow): Recommendation {
  return {
    id: row.id,
    assessmentId: row.assessment_id,
    conditionIds: row.condition_ids,
    solutionId: row.solution_id,
    rationale: row.rationale,
    confidence: row.confidence,
    priority: row.priority ?? undefined,
    recommendedBy: { id: row.recommended_by_id, version: row.recommended_by_version },
    status: row.status,
  };
}
