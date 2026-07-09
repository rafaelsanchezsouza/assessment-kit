import type {
  Assessment,
  Evidence,
  EvidenceRequest,
  Finding,
  Protocol,
  Subject,
} from '@gaf/types';

/** Non-2xx response from the GAF HTTP API. `status` distinguishes permanent
 * client errors (4xx — don't retry) from transient server errors (5xx). */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `API request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export interface GafApiClientOptions {
  baseUrl: string;
  /** Injectable for tests and non-browser hosts; defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
}

export interface BlobUploadResult {
  blobKey: string;
  payloadRef: string;
}

export type ProgressEvidence = Omit<Evidence, 'id' | 'subjectId'>;

/**
 * Thin typed client for @gaf/core's HTTP API. Deliberately dumb: no caching,
 * no retries (the upload queue owns retry policy), no domain assumptions.
 */
export class GafApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GafApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  getProtocol(id: string, version: string): Promise<Protocol> {
    return this.json('GET', `/protocols/${encodeURIComponent(id)}/${encodeURIComponent(version)}`);
  }

  createSubject(input: { type: string; ownerId: string; attributes?: Record<string, unknown> }): Promise<Subject> {
    return this.json('POST', '/subjects', input);
  }

  getSubject(id: string): Promise<Subject> {
    return this.json('GET', `/subjects/${encodeURIComponent(id)}`);
  }

  createAssessment(input: {
    subjectId: string;
    protocolId: string;
    protocolVersion: string;
    priorAssessmentId?: string;
  }): Promise<Assessment> {
    return this.json('POST', '/assessments', input);
  }

  getAssessment(id: string): Promise<Assessment> {
    return this.json('GET', `/assessments/${encodeURIComponent(id)}`);
  }

  startAssessment(id: string): Promise<Assessment> {
    return this.json('POST', `/assessments/${encodeURIComponent(id)}/start`);
  }

  patchProgress(
    id: string,
    input: { stepId: string; status: 'done' | 'skipped'; evidence?: ProgressEvidence },
  ): Promise<Assessment> {
    return this.json('PATCH', `/assessments/${encodeURIComponent(id)}/progress`, input);
  }

  submitAssessment(id: string): Promise<Assessment> {
    return this.json('POST', `/assessments/${encodeURIComponent(id)}/submit`);
  }

  getFindings(assessmentId: string): Promise<Finding[]> {
    return this.json('GET', `/assessments/${encodeURIComponent(assessmentId)}/findings`);
  }

  getEvidenceRequests(assessmentId: string): Promise<EvidenceRequest[]> {
    return this.json('GET', `/assessments/${encodeURIComponent(assessmentId)}/evidence-requests`);
  }

  async uploadEvidenceBlob(
    assessmentId: string,
    data: Blob | ArrayBuffer | Uint8Array,
    contentType: string,
  ): Promise<BlobUploadResult> {
    const res = await this.fetchImpl(
      `${this.baseUrl}/assessments/${encodeURIComponent(assessmentId)}/evidence-blob`,
      { method: 'POST', headers: { 'content-type': contentType }, body: data as BodyInit },
    );
    return this.parse(res);
  }

  blobUrl(blobKeyOrPayloadRef: string): string {
    const key = blobKeyOrPayloadRef.replace(/^blob:\/\//, '');
    return `${this.baseUrl}/blobs/${key}`;
  }

  private async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return this.parse(res);
  }

  private async parse<T>(res: Response): Promise<T> {
    const text = await res.text();
    let parsed: unknown = undefined;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = text;
    }
    if (!res.ok) {
      const message =
        typeof parsed === 'object' && parsed !== null && 'error' in parsed
          ? String((parsed as { error: unknown }).error)
          : undefined;
      throw new ApiError(res.status, parsed, message);
    }
    return parsed as T;
  }
}
