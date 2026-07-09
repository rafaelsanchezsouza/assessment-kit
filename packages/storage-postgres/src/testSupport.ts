import type { TestContext } from 'node:test';
import type { Pool } from 'pg';
import { getPool } from './pool.ts';

/**
 * Returns a connected pool, or calls t.skip() and returns null if no reachable
 * Postgres is configured — lets DB-backed tests run for real locally
 * (docker-compose + migrate) without forcing every contributor to have Postgres.
 */
export async function getTestPoolOrSkip(t: TestContext): Promise<Pool | null> {
  const pool = getPool();
  try {
    await pool.query('SELECT 1');
    return pool;
  } catch {
    t.skip('no reachable Postgres (DATABASE_URL) — see packages/storage-postgres/docker-compose.yml');
    return null;
  }
}
