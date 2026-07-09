import type { Protocol, ProtocolRepository } from '@gaf/types';
import type { Pool } from 'pg';

export class PostgresProtocolRepository implements ProtocolRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async save(protocol: Protocol): Promise<void> {
    await this.pool.query(
      `INSERT INTO protocols (id, version, subject_type, definition)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id, version) DO NOTHING`,
      [protocol.id, protocol.version, protocol.subjectType, protocol],
    );
  }

  async get(id: string, version: string): Promise<Protocol | null> {
    const { rows } = await this.pool.query(
      'SELECT definition FROM protocols WHERE id = $1 AND version = $2',
      [id, version],
    );
    return rows[0] ? (rows[0].definition as Protocol) : null;
  }

  async listVersions(id: string): Promise<string[]> {
    const { rows } = await this.pool.query(
      'SELECT version FROM protocols WHERE id = $1 ORDER BY version',
      [id],
    );
    return rows.map((r) => r.version as string);
  }
}
