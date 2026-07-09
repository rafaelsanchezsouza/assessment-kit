import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PostgresAssessmentRepository } from './assessmentRepository.ts';
import { PostgresFindingRepository } from './findingRepository.ts';
import { PostgresSubjectRepository } from './subjectRepository.ts';
import { getTestPoolOrSkip } from './testSupport.ts';

test('findBySubjectAndCode finds findings across separate assessments (longitudinal query)', async (t) => {
  const pool = await getTestPoolOrSkip(t);
  if (!pool) return;

  const subjects = new PostgresSubjectRepository(pool);
  const assessments = new PostgresAssessmentRepository(pool);
  const findings = new PostgresFindingRepository(pool);

  const subjectId = randomUUID();
  await subjects.create({ id: subjectId, type: 'storefront', ownerId: randomUUID(), attributes: {} });

  const [assessmentA, assessmentB] = [randomUUID(), randomUUID()];
  for (const assessmentId of [assessmentA, assessmentB]) {
    await assessments.create({
      id: assessmentId,
      subjectId,
      protocolId: 'backyard-quick-check',
      protocolVersion: '0.1.0',
      state: 'completed',
      refinementRound: 0,
      progress: {},
    });
  }

  const code = 'moisture-detected';
  const otherSubjectId = randomUUID();
  await subjects.create({ id: otherSubjectId, type: 'storefront', ownerId: randomUUID(), attributes: {} });
  const otherAssessmentId = randomUUID();
  await assessments.create({
    id: otherAssessmentId,
    subjectId: otherSubjectId,
    protocolId: 'backyard-quick-check',
    protocolVersion: '0.1.0',
    state: 'completed',
    refinementRound: 0,
    progress: {},
  });

  await findings.create({
    id: randomUUID(),
    assessmentId: assessmentA,
    subjectId,
    statement: { code, text: 'Moisture detected near the foundation' },
    evidenceRefs: [],
    confidence: 0.8,
    effectiveDate: '2026-01-01',
    producedBy: { analyzerId: 'human-review', version: '0.1.0' },
  });
  await findings.create({
    id: randomUUID(),
    assessmentId: assessmentB,
    subjectId,
    statement: { code, text: 'Moisture still present, worse' },
    evidenceRefs: [],
    confidence: 0.9,
    effectiveDate: '2026-06-01',
    producedBy: { analyzerId: 'human-review', version: '0.1.0' },
  });
  // Different subject, same code — must NOT show up in subjectId's results.
  await findings.create({
    id: randomUUID(),
    assessmentId: otherAssessmentId,
    subjectId: otherSubjectId,
    statement: { code, text: 'Unrelated subject' },
    evidenceRefs: [],
    confidence: 0.5,
    effectiveDate: '2026-03-01',
    producedBy: { analyzerId: 'human-review', version: '0.1.0' },
  });

  const timeline = await findings.findBySubjectAndCode(subjectId, code);
  assert.equal(timeline.length, 2);
  assert.deepEqual(
    timeline.map((f) => f.effectiveDate.slice(0, 10)),
    ['2026-01-01', '2026-06-01'],
  );
  assert.ok(timeline.every((f) => f.subjectId === subjectId));

  const perAssessment = await findings.findByAssessment(assessmentA);
  assert.equal(perAssessment.length, 1);
  assert.equal(perAssessment[0]?.statement.text, 'Moisture detected near the foundation');
});
