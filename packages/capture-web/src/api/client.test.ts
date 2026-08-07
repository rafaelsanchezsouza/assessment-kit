import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError, AssessmentApiClient } from './client.ts';

function fetchReturning(status: number, body: unknown, capture?: (url: string, init?: RequestInit) => void) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    capture?.(String(input), init);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

test('json helpers hit the right URL with the right method/body', async () => {
  let seen: { url: string; init?: RequestInit } | null = null;
  const client = new AssessmentApiClient({
    baseUrl: 'http://api.example/', // trailing slash must not double up
    fetchImpl: fetchReturning(200, { id: 'p1' }, (url, init) => (seen = { url, init })),
  });
  await client.getProtocol('demo protocol', '0.1.0');
  assert.equal(seen!.url, 'http://api.example/protocols/demo%20protocol/0.1.0');

  await client.patchProgress('a1', { stepId: 's', status: 'done' });
  assert.equal(seen!.url, 'http://api.example/assessments/a1/progress');
  assert.equal(seen!.init?.method, 'PATCH');
  assert.equal(JSON.parse(String(seen!.init?.body)).stepId, 's');
});

test('non-2xx throws ApiError with status and server message', async () => {
  const client = new AssessmentApiClient({
    baseUrl: 'http://x',
    fetchImpl: fetchReturning(404, { error: 'no assessment a9' }),
  });
  await assert.rejects(
    () => client.getAssessment('a9'),
    (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.status, 404);
      assert.equal(err.message, 'no assessment a9');
      return true;
    },
  );
});

test('blobUrl accepts both raw keys and blob:// payloadRefs', () => {
  const client = new AssessmentApiClient({ baseUrl: 'http://x', fetchImpl: fetchReturning(200, {}) });
  assert.equal(client.blobUrl('evidence/a1/k1'), 'http://x/blobs/evidence/a1/k1');
  assert.equal(client.blobUrl('blob://evidence/a1/k1'), 'http://x/blobs/evidence/a1/k1');
});
