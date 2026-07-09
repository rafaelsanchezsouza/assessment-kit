import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PostgresAssessmentRepository } from './assessmentRepository.ts';
import { PostgresSubjectRepository } from './subjectRepository.ts';
import { getTestPoolOrSkip } from './testSupport.ts';

test('create/get/update/findBySubject round-trip', async (t) => {
  const pool = await getTestPoolOrSkip(t);
  if (!pool) return;

  const subjects = new PostgresSubjectRepository(pool);
  const assessments = new PostgresAssessmentRepository(pool);

  const subjectId = randomUUID();
  await subjects.create({ id: subjectId, type: 'storefront', ownerId: randomUUID(), attributes: {} });

  const assessmentId = randomUUID();
  await assessments.create({
    id: assessmentId,
    subjectId,
    protocolId: 'backyard-quick-check',
    protocolVersion: '0.1.0',
    state: 'draft',
    refinementRound: 0,
    progress: {},
  });

  const fetched = await assessments.get(assessmentId);
  assert.equal(fetched?.state, 'draft');

  await assessments.update({
    ...fetched!,
    state: 'capturing',
    progress: { 'wide-shot': 'done' },
  });

  const updated = await assessments.get(assessmentId);
  assert.equal(updated?.state, 'capturing');
  assert.deepEqual(updated?.progress, { 'wide-shot': 'done' });

  const bySubject = await assessments.findBySubject(subjectId);
  assert.equal(bySubject.length, 1);
  assert.equal(bySubject[0]?.id, assessmentId);
});
