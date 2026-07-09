import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PostgresSubjectRepository } from './subjectRepository.ts';
import { getTestPoolOrSkip } from './testSupport.ts';

test('create/get/findByOwner round-trip', async (t) => {
  const pool = await getTestPoolOrSkip(t);
  if (!pool) return;

  const repo = new PostgresSubjectRepository(pool);
  const id = randomUUID();
  const ownerId = randomUUID();

  await repo.create({ id, type: 'storefront', ownerId, attributes: { region: 'litoral' } });

  const fetched = await repo.get(id);
  assert.deepEqual(fetched, { id, type: 'storefront', ownerId, attributes: { region: 'litoral' } });

  const byOwner = await repo.findByOwner(ownerId);
  assert.equal(byOwner.length, 1);
  assert.equal(byOwner[0]?.id, id);

  assert.equal(await repo.get(randomUUID()), null);
});
