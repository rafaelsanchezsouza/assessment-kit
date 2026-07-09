import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { BlobStore } from '@gaf/types';

/**
 * Local filesystem reference BlobStore (ADR-002). Keys are caller-supplied
 * evidence identifiers, so they're resolved against baseDir and verified to
 * stay inside it before any filesystem access — closes path traversal via
 * `../` segments or absolute-path keys.
 */
export class FsBlobStore implements BlobStore {
  private readonly baseDir: string;

  constructor(baseDir = './blobs') {
    this.baseDir = resolve(baseDir);
  }

  async put(key: string, data: Buffer, _contentType: string): Promise<void> {
    const path = this.resolveKey(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.resolveKey(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolveKey(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    return (await this.get(key)) !== null;
  }

  private resolveKey(key: string): string {
    const resolved = resolve(this.baseDir, key);
    if (resolved !== this.baseDir && !resolved.startsWith(this.baseDir + sep)) {
      throw new Error(`invalid blob key (escapes base directory): "${key}"`);
    }
    return resolved;
  }
}
