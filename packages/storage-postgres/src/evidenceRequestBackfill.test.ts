import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PostgresAssessmentRepository } from './assessmentRepository.ts';
import { PostgresEvidenceRepository } from './evidenceRepository.ts';
import { PostgresEvidenceRequestRepository } from './evidenceRequestRepository.ts';
import { PostgresSubjectRepository } from './subjectRepository.ts';
import { getTestPoolOrSkip } from './testSupport.ts';

const migration = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../schema/003_evidence_request_resolution.sql',
);

function requestOn(assessmentId: string, stepId: string) {
  return {
    id: randomUUID(),
    assessmentId,
    kind: 'additional' as const,
    reason: 'need a closer look',
    stepSpec: {
      id: stepId,
      title: 'Close-up',
      guidance: 'Get closer',
      captureType: 'image' as const,
      captureSpec: {},
      feedsAnalyzers: ['general-review'],
    },
    requestedBy: { analyzerId: 'analyst-1' },
    status: 'pending' as const,
  };
}

test('migration 003 backfills requests that were answered before the rule existed', async (t) => {
  const pool = await getTestPoolOrSkip(t);
  if (!pool) return;

  const subjects = new PostgresSubjectRepository(pool);
  const assessments = new PostgresAssessmentRepository(pool);
  const evidence = new PostgresEvidenceRepository(pool);
  const requests = new PostgresEvidenceRequestRepository(pool);

  const subjectId = randomUUID();
  await subjects.create({ id: subjectId, type: 'storefront', ownerId: randomUUID(), attributes: {} });
  const assessmentId = randomUUID();
  await assessments.create({
    id: assessmentId,
    subjectId,
    protocolId: 'backyard-quick-check',
    protocolVersion: '0.1.0',
    state: 'awaiting_evidence',
    refinementRound: 0,
    progress: {},
  });

  // The stuck state this migration exists to clean up: both requests pending,
  // but only one of them has an answer on its step.
  const answered = requestOn(assessmentId, 'answered-step');
  const unanswered = requestOn(assessmentId, 'unanswered-step');
  await requests.create(answered);
  await requests.create(unanswered);

  const evidenceId = randomUUID();
  await evidence.create({
    id: evidenceId,
    subjectId,
    type: 'image',
    payloadRef: 'blob://answer.jpg',
    metadata: { capturedAt: '2026-01-01T00:00:00Z' },
  });
  await evidence.linkToAssessment({
    assessmentId,
    evidenceId,
    stepId: 'answered-step',
    origin: 'protocol_step',
  });

  await pool.query(readFileSync(migration, 'utf8'));

  const after = await requests.findByAssessment(assessmentId);
  assert.equal(
    after.find((r) => r.id === answered.id)?.status,
    'fulfilled',
    'a request with evidence on its step must be resolved',
  );
  assert.equal(
    after.find((r) => r.id === unanswered.id)?.status,
    'pending',
    'a request nobody answered must stay open',
  );
});
