import type { Pool } from 'pg';
import { PostgresAssessmentRepository } from './assessmentRepository.js';
import { PostgresConditionRepository } from './conditionRepository.js';
import { PostgresEvidenceRepository } from './evidenceRepository.js';
import { PostgresEvidenceRequestRepository } from './evidenceRequestRepository.js';
import { PostgresFindingRepository } from './findingRepository.js';
import { PostgresOutcomeRecordRepository } from './outcomeRecordRepository.js';
import { PostgresProtocolRepository } from './protocolRepository.js';
import { PostgresRecommendationRepository } from './recommendationRepository.js';
import { PostgresSubjectRepository } from './subjectRepository.js';

export { getPool } from './pool.js';
export { FsBlobStore } from './fsBlobStore.js';
export { PostgresSubjectRepository } from './subjectRepository.js';
export { PostgresProtocolRepository } from './protocolRepository.js';
export { PostgresAssessmentRepository } from './assessmentRepository.js';
export { PostgresEvidenceRepository } from './evidenceRepository.js';
export { PostgresFindingRepository } from './findingRepository.js';
export { PostgresEvidenceRequestRepository } from './evidenceRequestRepository.js';
export { PostgresConditionRepository } from './conditionRepository.js';
export { PostgresRecommendationRepository } from './recommendationRepository.js';
export { PostgresOutcomeRecordRepository } from './outcomeRecordRepository.js';

/** Convenience factory: all Postgres repositories wired to one shared pool. */
export function createPostgresStorage(pool: Pool) {
  return {
    subjects: new PostgresSubjectRepository(pool),
    protocols: new PostgresProtocolRepository(pool),
    assessments: new PostgresAssessmentRepository(pool),
    evidence: new PostgresEvidenceRepository(pool),
    findings: new PostgresFindingRepository(pool),
    evidenceRequests: new PostgresEvidenceRequestRepository(pool),
    conditions: new PostgresConditionRepository(pool),
    recommendations: new PostgresRecommendationRepository(pool),
    outcomeRecords: new PostgresOutcomeRecordRepository(pool),
  };
}
