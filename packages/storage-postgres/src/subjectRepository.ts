import type { Subject, SubjectRepository } from '@assessment-kit/types';
import type { Pool } from 'pg';

export class PostgresSubjectRepository implements SubjectRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async create(subject: Subject): Promise<void> {
    await this.pool.query(
      `INSERT INTO subjects (id, type, owner_id, attributes) VALUES ($1, $2, $3, $4)`,
      [subject.id, subject.type, subject.ownerId, subject.attributes],
    );
  }

  async get(id: string): Promise<Subject | null> {
    const { rows } = await this.pool.query('SELECT * FROM subjects WHERE id = $1', [id]);
    return rows[0] ? toSubject(rows[0]) : null;
  }

  async findByOwner(ownerId: string): Promise<Subject[]> {
    const { rows } = await this.pool.query('SELECT * FROM subjects WHERE owner_id = $1', [
      ownerId,
    ]);
    return rows.map(toSubject);
  }
}

interface SubjectRow {
  id: string;
  type: string;
  owner_id: string;
  attributes: Record<string, unknown>;
}

function toSubject(row: SubjectRow): Subject {
  return { id: row.id, type: row.type, ownerId: row.owner_id, attributes: row.attributes };
}
