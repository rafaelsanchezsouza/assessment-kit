import type { Evidence } from '@gaf/types';
import { ApiError, type GafApiClient } from './api/client.ts';

/**
 * Resumable evidence upload queue. The server is the source of truth for
 * assessment drafts (decision 10); this queue is the client's offline buffer:
 * captures survive a page refresh, transient failures (network, timeout, 5xx)
 * retry with exponential backoff, permanent failures (4xx) are surfaced and
 * dropped. Queue state persists through a pluggable `QueueStorage`
 * (localStorage by default — note its ~5MB budget; hosts with heavy photo
 * volume should plug an IndexedDB-backed implementation).
 */

export interface QueueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface UploadTask {
  id: string;
  assessmentId: string;
  stepId: string;
  status: 'done' | 'skipped';
  /** Binary payload as base64 (photos/documents); absent for structured input or skips. */
  blobBase64?: string;
  contentType?: string;
  /** Evidence row to attach via PATCH .../progress; payloadRef filled in after blob upload. */
  evidence?: Omit<Evidence, 'id' | 'subjectId' | 'payloadRef'> & { payloadRef?: string };
  attempts: number;
}

export interface UploadQueueOptions {
  client: GafApiClient;
  storage?: QueueStorage;
  storageKey?: string;
  maxAttempts?: number;
  /** Backoff schedule in ms, injectable for tests. attempt n waits delays[min(n, len-1)]. */
  retryDelaysMs?: number[];
  onTaskDone?: (task: UploadTask) => void;
  onTaskFailed?: (task: UploadTask, error: unknown, permanent: boolean) => void;
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

export class UploadQueue {
  private readonly client: GafApiClient;
  private readonly storage: QueueStorage | null;
  private readonly storageKey: string;
  private readonly maxAttempts: number;
  private readonly retryDelaysMs: number[];
  private readonly onTaskDone?: (task: UploadTask) => void;
  private readonly onTaskFailed?: (task: UploadTask, error: unknown, permanent: boolean) => void;

  private tasks: UploadTask[] = [];
  private draining: Promise<void> | null = null;

  constructor(options: UploadQueueOptions) {
    this.client = options.client;
    this.storage = options.storage ?? (typeof localStorage === 'undefined' ? null : localStorage);
    this.storageKey = options.storageKey ?? 'gaf-upload-queue';
    this.maxAttempts = options.maxAttempts ?? 5;
    this.retryDelaysMs = options.retryDelaysMs ?? [500, 1000, 2000, 5000, 10000];
    this.onTaskDone = options.onTaskDone;
    this.onTaskFailed = options.onTaskFailed;
    this.restore();
  }

  get pending(): readonly UploadTask[] {
    return this.tasks;
  }

  enqueue(task: Omit<UploadTask, 'attempts'>): void {
    this.tasks.push({ ...task, attempts: 0 });
    this.persist();
    void this.process();
  }

  /**
   * Drain the queue; resolves when it is empty. If a drain is already in
   * flight (enqueue auto-starts one), joins it instead of returning early —
   * callers awaiting process() must be able to trust "uploads are done".
   */
  process(): Promise<void> {
    if (!this.draining) {
      this.draining = this.drain().finally(() => {
        this.draining = null;
      });
    }
    return this.draining;
  }

  private async drain(): Promise<void> {
    while (this.tasks.length > 0) {
      const task = this.tasks[0];
      try {
        await this.run(task);
        this.tasks.shift();
        this.persist();
        this.onTaskDone?.(task);
      } catch (err) {
        const permanent =
          (err instanceof ApiError && err.status >= 400 && err.status < 500) ||
          task.attempts + 1 >= this.maxAttempts;
        task.attempts += 1;
        this.persist();
        if (permanent) {
          this.tasks.shift();
          this.persist();
          this.onTaskFailed?.(task, err, true);
        } else {
          this.onTaskFailed?.(task, err, false);
          const delay = this.retryDelaysMs[Math.min(task.attempts - 1, this.retryDelaysMs.length - 1)];
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
  }

  private async run(task: UploadTask): Promise<void> {
    let payloadRef = task.evidence?.payloadRef;
    if (task.blobBase64 && !payloadRef) {
      const upload = await this.client.uploadEvidenceBlob(
        task.assessmentId,
        base64ToBytes(task.blobBase64),
        task.contentType ?? 'application/octet-stream',
      );
      payloadRef = upload.payloadRef;
      // record so a retry of the progress PATCH doesn't re-upload the blob
      if (task.evidence) task.evidence.payloadRef = payloadRef;
      task.blobBase64 = undefined;
      this.persist();
    }
    await this.client.patchProgress(task.assessmentId, {
      stepId: task.stepId,
      status: task.status,
      evidence: task.evidence ? { ...task.evidence, payloadRef: payloadRef ?? task.evidence.payloadRef ?? '' } : undefined,
    });
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(this.storageKey, JSON.stringify(this.tasks));
    } catch {
      // storage full or unavailable — the queue still works in-memory
    }
  }

  private restore(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(this.storageKey);
      if (raw) this.tasks = JSON.parse(raw) as UploadTask[];
    } catch {
      this.tasks = [];
    }
  }
}
