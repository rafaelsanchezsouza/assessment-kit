import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError, GafApiClient } from './api/client.ts';
import { UploadQueue, type QueueStorage } from './uploadQueue.ts';

class FakeStorage implements QueueStorage {
  store = new Map<string, string>();
  getItem(key: string) {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
}

/** fetch stub: scripted responses per URL-suffix match, records calls. */
function fakeFetch(script: (url: string, init?: RequestInit) => { status: number; body: unknown }) {
  const calls: Array<{ url: string; method: string }> = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? 'GET' });
    const { status, body } = script(url, init);
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { impl, calls };
}

const photoB64 = Buffer.from('fake-jpeg-bytes').toString('base64');

function makeTask(overrides: Partial<Parameters<UploadQueue['enqueue']>[0]> = {}) {
  return {
    id: 't1',
    assessmentId: 'a1',
    stepId: 'wide-shot',
    status: 'done' as const,
    blobBase64: photoB64,
    contentType: 'image/jpeg',
    evidence: {
      type: 'image' as const,
      metadata: { capturedAt: '2026-07-09T12:00:00Z' },
    },
    ...overrides,
  };
}

test('happy path: uploads blob then patches progress, queue drains, state persisted', async () => {
  const storage = new FakeStorage();
  const { impl, calls } = fakeFetch((url) => {
    if (url.endsWith('/evidence-blob')) {
      return { status: 201, body: { blobKey: 'evidence/a1/b1', payloadRef: 'blob://evidence/a1/b1' } };
    }
    return { status: 200, body: { id: 'a1', progress: { 'wide-shot': 'done' } } };
  });
  const client = new GafApiClient({ baseUrl: 'http://x', fetchImpl: impl });
  const done: string[] = [];
  const queue = new UploadQueue({ client, storage, onTaskDone: (t) => done.push(t.id) });

  queue.enqueue(makeTask());
  await queue.process();

  assert.deepEqual(done, ['t1']);
  assert.equal(queue.pending.length, 0);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].url.endsWith('/assessments/a1/evidence-blob'));
  assert.equal(calls[1].method, 'PATCH');
  assert.equal(storage.getItem('gaf-upload-queue'), '[]');
});

test('transient 5xx retries with backoff and eventually succeeds', async () => {
  let failures = 2;
  const { impl } = fakeFetch((url) => {
    if (url.endsWith('/evidence-blob') && failures > 0) {
      failures--;
      return { status: 503, body: { error: 'unavailable' } };
    }
    if (url.endsWith('/evidence-blob')) {
      return { status: 201, body: { blobKey: 'k', payloadRef: 'blob://k' } };
    }
    return { status: 200, body: {} };
  });
  const client = new GafApiClient({ baseUrl: 'http://x', fetchImpl: impl });
  const failed: boolean[] = [];
  const queue = new UploadQueue({
    client,
    storage: new FakeStorage(),
    retryDelaysMs: [1, 1, 1],
    onTaskFailed: (_t, _e, permanent) => failed.push(permanent),
  });

  queue.enqueue(makeTask());
  await queue.process();

  assert.deepEqual(failed, [false, false], 'two transient failures reported, neither permanent');
  assert.equal(queue.pending.length, 0);
});

test('4xx is permanent: task dropped, reported once, no retry', async () => {
  const { impl, calls } = fakeFetch((url) => {
    if (url.endsWith('/evidence-blob')) return { status: 400, body: { error: 'bad payload' } };
    return { status: 200, body: {} };
  });
  const client = new GafApiClient({ baseUrl: 'http://x', fetchImpl: impl });
  const failures: Array<{ permanent: boolean; error: unknown }> = [];
  const queue = new UploadQueue({
    client,
    storage: new FakeStorage(),
    retryDelaysMs: [1],
    onTaskFailed: (_t, error, permanent) => failures.push({ permanent, error }),
  });

  queue.enqueue(makeTask());
  await queue.process();

  assert.equal(failures.length, 1);
  assert.equal(failures[0].permanent, true);
  assert.ok(failures[0].error instanceof ApiError);
  assert.equal(queue.pending.length, 0);
  assert.equal(calls.length, 1, 'no retries on 4xx');
});

test('a new queue restores persisted tasks and resumes them (refresh survival)', async () => {
  const storage = new FakeStorage();
  const failing = fakeFetch(() => ({ status: 503, body: {} }));
  const client1 = new GafApiClient({ baseUrl: 'http://x', fetchImpl: failing.impl });
  const queue1 = new UploadQueue({ client: client1, storage, retryDelaysMs: [1], maxAttempts: 2 });
  queue1.enqueue(makeTask());
  // don't process — simulate the tab dying with the task still queued
  assert.ok(storage.getItem('gaf-upload-queue')!.includes('"t1"'));

  const ok = fakeFetch((url) => {
    if (url.endsWith('/evidence-blob')) return { status: 201, body: { blobKey: 'k', payloadRef: 'blob://k' } };
    return { status: 200, body: {} };
  });
  const client2 = new GafApiClient({ baseUrl: 'http://x', fetchImpl: ok.impl });
  const queue2 = new UploadQueue({ client: client2, storage });
  assert.equal(queue2.pending.length, 1, 'task restored from storage');
  await queue2.process();
  assert.equal(queue2.pending.length, 0);
  assert.equal(storage.getItem('gaf-upload-queue'), '[]');
});

test('blob upload is not repeated when the progress PATCH is what fails', async () => {
  let patchFailures = 1;
  const { impl, calls } = fakeFetch((url, init) => {
    if (url.endsWith('/evidence-blob')) {
      return { status: 201, body: { blobKey: 'k', payloadRef: 'blob://k' } };
    }
    if (init?.method === 'PATCH' && patchFailures > 0) {
      patchFailures--;
      return { status: 503, body: {} };
    }
    return { status: 200, body: {} };
  });
  const client = new GafApiClient({ baseUrl: 'http://x', fetchImpl: impl });
  const queue = new UploadQueue({ client, storage: new FakeStorage(), retryDelaysMs: [1] });

  queue.enqueue(makeTask());
  await queue.process();

  const blobCalls = calls.filter((c) => c.url.endsWith('/evidence-blob'));
  assert.equal(blobCalls.length, 1, 'blob uploaded exactly once despite PATCH retry');
  assert.equal(queue.pending.length, 0);
});
