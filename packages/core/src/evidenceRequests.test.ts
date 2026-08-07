import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EvidenceRequest } from '@gaf/types';
import { findPendingRequestsForStep, resolveRequestsForStep } from './evidenceRequests.ts';
import { InMemoryEvidenceRequestRepository } from './testSupport/inMemoryRepos.ts';

function request(overrides: Partial<EvidenceRequest> & { id: string }): EvidenceRequest {
  return {
    assessmentId: 'a1',
    kind: 'additional',
    reason: 'need a closer look',
    stepSpec: {
      id: 'close-up',
      title: 'Close-up',
      guidance: 'Get closer',
      captureType: 'image',
      captureSpec: {},
      feedsAnalyzers: ['general-review'],
      optional: true,
    },
    requestedBy: { analyzerId: 'analyst-1' },
    status: 'pending',
    ...overrides,
  };
}

async function repoWith(...requests: EvidenceRequest[]): Promise<InMemoryEvidenceRequestRepository> {
  const repo = new InMemoryEvidenceRequestRepository();
  for (const r of requests) await repo.create(r);
  return repo;
}

test('evidence at the requested step fulfils the request', async () => {
  const repo = await repoWith(request({ id: 'r1' }));

  const resolved = await resolveRequestsForStep(repo, {
    assessmentId: 'a1',
    stepId: 'close-up',
    outcome: 'done',
  });

  assert.deepEqual(resolved, ['r1']);
  const [row] = await repo.findByAssessment('a1');
  assert.equal(row.status, 'fulfilled');
});

test('a skip resolves the request too — the capturer acted on it', async () => {
  const repo = await repoWith(request({ id: 'r1' }));

  await resolveRequestsForStep(repo, {
    assessmentId: 'a1',
    stepId: 'close-up',
    outcome: 'skipped',
  });

  const [row] = await repo.findByAssessment('a1');
  assert.equal(row.status, 'skipped');
});

test('every pending request on the step resolves, not just the oldest', async () => {
  const repo = await repoWith(
    request({ id: 'r1', requestedBy: { analyzerId: 'analyst-1' } }),
    request({ id: 'r2', requestedBy: { analyzerId: 'analyst-2' } }),
  );

  const resolved = await resolveRequestsForStep(repo, {
    assessmentId: 'a1',
    stepId: 'close-up',
    outcome: 'done',
  });

  assert.deepEqual(resolved.sort(), ['r1', 'r2']);
  const rows = await repo.findByAssessment('a1');
  assert.deepEqual(
    rows.map((r) => r.status),
    ['fulfilled', 'fulfilled'],
  );
});

test('requests on other steps are untouched', async () => {
  const repo = await repoWith(
    request({ id: 'r1' }),
    request({ id: 'r2', stepSpec: { ...request({ id: 'x' }).stepSpec, id: 'other-step' } }),
  );

  await resolveRequestsForStep(repo, {
    assessmentId: 'a1',
    stepId: 'close-up',
    outcome: 'done',
  });

  const rows = await repo.findByAssessment('a1');
  assert.equal(rows.find((r) => r.id === 'r1')?.status, 'fulfilled');
  assert.equal(rows.find((r) => r.id === 'r2')?.status, 'pending');
});

test('resolution is idempotent — a resolved request is never rewritten', async () => {
  const repo = await repoWith(request({ id: 'r1', status: 'skipped' }));

  const resolved = await resolveRequestsForStep(repo, {
    assessmentId: 'a1',
    stepId: 'close-up',
    outcome: 'done',
  });

  assert.deepEqual(resolved, []);
  const [row] = await repo.findByAssessment('a1');
  assert.equal(row.status, 'skipped', 'a skipped request must not become fulfilled');
});

test('findPendingRequestsForStep drives the evidence_request link origin', async () => {
  const repo = await repoWith(request({ id: 'r1' }));

  assert.equal((await findPendingRequestsForStep(repo, 'a1', 'close-up')).length, 1);
  assert.equal((await findPendingRequestsForStep(repo, 'a1', 'wide-shot')).length, 0);

  await resolveRequestsForStep(repo, { assessmentId: 'a1', stepId: 'close-up', outcome: 'done' });
  assert.equal(
    (await findPendingRequestsForStep(repo, 'a1', 'close-up')).length,
    0,
    'an answered request no longer counts as pending',
  );
});
