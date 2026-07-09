import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { FsBlobStore } from './fsBlobStore.ts';

let baseDir: string;
let store: FsBlobStore;

before(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'gaf-blobstore-'));
  store = new FsBlobStore(baseDir);
});

after(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

test('put/get/exists/delete round-trip', async () => {
  const data = Buffer.from('hello evidence');
  await store.put('photos/a.jpg', data, 'image/jpeg');

  assert.equal(await store.exists('photos/a.jpg'), true);
  assert.deepEqual(await store.get('photos/a.jpg'), data);

  await store.delete('photos/a.jpg');
  assert.equal(await store.exists('photos/a.jpg'), false);
  assert.equal(await store.get('photos/a.jpg'), null);
});

test('get on a missing key returns null', async () => {
  assert.equal(await store.get('does/not/exist.jpg'), null);
});

test('rejects keys that escape the base directory', async () => {
  await assert.rejects(() => store.put('../escape.txt', Buffer.from('x'), 'text/plain'));
  await assert.rejects(() => store.put('/etc/passwd', Buffer.from('x'), 'text/plain'));
});
