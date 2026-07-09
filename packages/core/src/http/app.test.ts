import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HumanAnalyzer } from '@gaf/analyzer-human';
import type { Protocol } from '@gaf/types';
import supertest from 'supertest';
import { Orchestrator } from '../orchestrator.ts';
import {
  InMemoryAssessmentRepository,
  InMemoryEvidenceRepository,
  InMemoryEvidenceRequestRepository,
  InMemoryFindingRepository,
  InMemoryProtocolRepository,
  InMemorySubjectRepository,
} from '../testSupport/inMemoryRepos.ts';
import { createApp } from './app.ts';

const protocol: Protocol = {
  id: 'demo-protocol',
  version: '0.1.0',
  subjectType: 'backyard',
  steps: [
    {
      id: 'wide-shot',
      title: 'Wide shot',
      guidance: 'Stand back and shoot the whole yard',
      captureType: 'image',
      captureSpec: {},
      feedsAnalyzers: ['general-review'],
    },
  ],
  refinementPolicy: { maxRefinementRounds: 1, skippable: true },
};

async function buildTestApp() {
  const subjects = new InMemorySubjectRepository();
  const protocols = new InMemoryProtocolRepository();
  const assessments = new InMemoryAssessmentRepository();
  const evidence = new InMemoryEvidenceRepository();
  const findings = new InMemoryFindingRepository();
  const evidenceRequests = new InMemoryEvidenceRequestRepository();
  await protocols.save(protocol);

  const humanAnalyzer = new HumanAnalyzer();
  const orchestrator = new Orchestrator({
    findingRepository: findings,
    evidenceRequestRepository: evidenceRequests,
    assessmentRepository: assessments,
  });
  orchestrator.register(humanAnalyzer);

  const app = createApp({
    subjects,
    protocols,
    assessments,
    evidence,
    findings,
    evidenceRequests,
    orchestrator,
    reviewSubmitter: humanAnalyzer,
  });

  return { app, assessments, findings };
}

async function waitForState(
  app: import('express').Express,
  assessmentId: string,
  expected: string,
  timeoutMs = 1000,
): Promise<string> {
  const start = Date.now();
  let state = '';
  while (Date.now() - start < timeoutMs) {
    const res = await supertest(app).get(`/assessments/${assessmentId}`);
    state = res.body.state;
    if (state === expected) return state;
    await new Promise((r) => setTimeout(r, 5));
  }
  return state;
}

async function driveToReview(app: import('express').Express) {
  const subjectRes = await supertest(app)
    .post('/subjects')
    .send({ type: 'backyard', ownerId: 'user-1' });
  assert.equal(subjectRes.status, 201);
  const subjectId = subjectRes.body.id;

  const assessmentRes = await supertest(app)
    .post('/assessments')
    .send({ subjectId, protocolId: protocol.id, protocolVersion: protocol.version });
  assert.equal(assessmentRes.status, 201);
  assert.equal(assessmentRes.body.state, 'draft');
  const assessmentId = assessmentRes.body.id;

  const startRes = await supertest(app).post(`/assessments/${assessmentId}/start`);
  assert.equal(startRes.body.state, 'capturing');

  const progressRes = await supertest(app)
    .patch(`/assessments/${assessmentId}/progress`)
    .send({
      stepId: 'wide-shot',
      status: 'done',
      evidence: { type: 'image', payloadRef: 'blob://wide.jpg', metadata: { capturedAt: '2026-01-01T00:00:00Z' } },
    });
  assert.equal(progressRes.status, 200);

  const submitRes = await supertest(app).post(`/assessments/${assessmentId}/submit`);
  assert.equal(submitRes.status, 202);
  // synchronous mutation inside runAndPersist happens before the fire-and-forget
  // call returns control to the handler — see orchestrator.ts's applyTransition.
  assert.equal(submitRes.body.state, 'review');

  return assessmentId;
}

test('capture -> analyze -> human review -> completed, findings persisted', async () => {
  const { app } = await buildTestApp();
  const assessmentId = await driveToReview(app);

  const reviewRes = await supertest(app)
    .post(`/reviews/${assessmentId}`)
    .send({
      findings: [
        {
          statement: { code: 'no-issues', text: 'Yard looks fine' },
          evidenceRefs: [],
          confidence: 0.9,
          effectiveDate: '2026-01-01',
          producedBy: { analyzerId: 'human-review', version: '0.1.0' },
        },
      ],
      evidenceRequests: [],
    });
  assert.equal(reviewRes.status, 202);

  const finalState = await waitForState(app, assessmentId, 'completed');
  assert.equal(finalState, 'completed');

  const findingsRes = await supertest(app).get(`/assessments/${assessmentId}/findings`);
  assert.equal(findingsRes.body.length, 1);
  assert.equal(findingsRes.body[0].statement.code, 'no-issues');
});

test('evidence request -> awaiting_evidence -> resubmit bumps refinementRound -> completed once budget exhausted', async () => {
  const { app } = await buildTestApp();
  const assessmentId = await driveToReview(app);

  await supertest(app)
    .post(`/reviews/${assessmentId}`)
    .send({
      findings: [],
      evidenceRequests: [
        {
          kind: 'additional',
          reason: 'possible moisture, need a close-up',
          stepSpec: {
            id: 'closeup',
            title: 'Close-up',
            guidance: 'Get closer',
            captureType: 'image',
            captureSpec: {},
            feedsAnalyzers: ['general-review'],
          },
          requestedBy: { analyzerId: 'human-review' },
          status: 'pending',
        },
      ],
    });

  const awaitingState = await waitForState(app, assessmentId, 'awaiting_evidence');
  assert.equal(awaitingState, 'awaiting_evidence');

  const resubmitRes = await supertest(app).post(`/assessments/${assessmentId}/submit`);
  assert.equal(resubmitRes.status, 202);
  assert.equal(resubmitRes.body.refinementRound, 1);
  assert.equal(resubmitRes.body.state, 'review');

  await supertest(app).post(`/reviews/${assessmentId}`).send({ findings: [], evidenceRequests: [] });

  // maxRefinementRounds is 1 and refinementRound is now 1 — budget exhausted,
  // must land on `completed` even with no findings/evidenceRequests either way.
  const finalState = await waitForState(app, assessmentId, 'completed');
  assert.equal(finalState, 'completed');
});

test('a rejecting repository yields a 500 response, not a process crash', async () => {
  const { app } = await buildTestApp();
  const subjectRes = await supertest(app)
    .post('/subjects')
    .send({ type: 'backyard', ownerId: 'user-1' });
  const assessmentRes = await supertest(app)
    .post('/assessments')
    .send({ subjectId: subjectRes.body.id, protocolId: protocol.id, protocolVersion: protocol.version });
  const assessmentId = assessmentRes.body.id;
  await supertest(app).post(`/assessments/${assessmentId}/start`);

  const originalUpdate = InMemoryAssessmentRepository.prototype.update;
  InMemoryAssessmentRepository.prototype.update = async () => {
    throw new Error('simulated storage failure');
  };
  try {
    const res = await supertest(app)
      .patch(`/assessments/${assessmentId}/progress`)
      .send({ stepId: 'wide-shot', status: 'done' });
    assert.equal(res.status, 500);
    assert.deepEqual(res.body, { error: 'internal error' });
  } finally {
    InMemoryAssessmentRepository.prototype.update = originalUpdate;
  }

  // the app must still be serving requests afterwards
  const alive = await supertest(app).get(`/assessments/${assessmentId}`);
  assert.equal(alive.status, 200);
});
