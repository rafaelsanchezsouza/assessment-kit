import { Pool, types } from 'pg';

// @gaf/types models dates as ISO strings (Finding.effectiveDate, Evidence.documentDate).
// pg's default parser turns DATE columns (OID 1082) into JS Date objects at UTC
// midnight, which would silently break that contract — keep them as raw strings.
types.setTypeParser(1082, (value) => value);

let pool: Pool | undefined;

/** Shared pg.Pool built from DATABASE_URL, matching the local docker-compose default. */
export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL ?? 'postgres://gaf:gaf@localhost:5433/gaf',
    });
  }
  return pool;
}
