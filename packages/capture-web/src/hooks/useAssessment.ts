import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Assessment, EvidenceRequest, Finding, Protocol, ProtocolStep } from '@gaf/types';
import type { GafApiClient } from '../api/client.ts';
import { UploadQueue } from '../uploadQueue.ts';

export type CapturePhase =
  | 'loading'
  | 'capturing'
  | 'waiting' // submitted, polling for the analyzer's verdict
  | 'completed'
  | 'error';

/** A step to render: from the protocol, or dynamically from an EvidenceRequest. */
export interface ActiveStep {
  step: ProtocolStep;
  origin: 'protocol_step' | 'evidence_request';
  /** Analyst's reason, when origin is evidence_request. */
  reason?: string;
}

export interface ImageCaptureResult {
  blobBase64: string;
  contentType: string;
  sharpness: number;
  width: number;
  height: number;
}

export interface UseAssessmentOptions {
  client: GafApiClient;
  protocolId: string;
  protocolVersion: string;
  /** Existing subject to assess; otherwise `newSubject` is created on start. */
  subjectId?: string;
  newSubject?: { type: string; ownerId: string; attributes?: Record<string, unknown> };
  pollIntervalMs?: number;
}

export interface UseAssessmentResult {
  phase: CapturePhase;
  error: string | null;
  protocol: Protocol | null;
  assessment: Assessment | null;
  steps: ActiveStep[];
  currentIndex: number;
  currentStep: ActiveStep | null;
  findings: Finding[];
  uploadsPending: number;
  completeImageStep: (capture: ImageCaptureResult) => void;
  completeStructuredStep: (answers: Record<string, unknown>) => void;
  skipStep: () => void;
}

/**
 * Drives the assessment flow against @gaf/core's HTTP API: create/start →
 * step-by-step capture (uploads ride the resumable queue) → submit → poll →
 * either `completed` (findings available) or `awaiting_evidence` (analyst's
 * EvidenceRequests appear as additional steps — always skippable) → resubmit.
 * Entirely protocol-driven; no domain assumptions.
 */
export function useAssessment(options: UseAssessmentOptions): UseAssessmentResult {
  const { client, protocolId, protocolVersion, subjectId, newSubject } = options;
  const pollIntervalMs = options.pollIntervalMs ?? 1500;

  const [phase, setPhase] = useState<CapturePhase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [protocol, setProtocol] = useState<Protocol | null>(null);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [steps, setSteps] = useState<ActiveStep[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [uploadsPending, setUploadsPending] = useState(0);

  const assessmentRef = useRef<Assessment | null>(null);
  const seenRequestIds = useRef<Set<string>>(new Set());

  const queue = useMemo(
    () =>
      new UploadQueue({
        client,
        onTaskDone: () => setUploadsPending((n) => Math.max(0, n - 1)),
        onTaskFailed: (_task, _err, permanent) => {
          if (permanent) {
            setUploadsPending((n) => Math.max(0, n - 1));
            setError('upload failed permanently');
          }
        },
      }),
    [client],
  );

  const fail = useCallback((err: unknown) => {
    setError(err instanceof Error ? err.message : String(err));
    setPhase('error');
  }, []);

  // Boot: fetch protocol, create subject if needed, create + start assessment.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const proto = await client.getProtocol(protocolId, protocolVersion);
      let sid = subjectId;
      if (!sid) {
        if (!newSubject) throw new Error('useAssessment needs subjectId or newSubject');
        sid = (await client.createSubject(newSubject)).id;
      }
      const created = await client.createAssessment({ subjectId: sid, protocolId, protocolVersion });
      const started = await client.startAssessment(created.id);
      if (cancelled) return;
      setProtocol(proto);
      assessmentRef.current = started;
      setAssessment(started);
      setSteps(proto.steps.map((step) => ({ step, origin: 'protocol_step' as const })));
      setCurrentIndex(0);
      setPhase('capturing');
    })().catch((err) => {
      if (!cancelled) fail(err);
    });
    return () => {
      cancelled = true;
    };
  }, [client, protocolId, protocolVersion, subjectId, newSubject, fail]);

  const submit = useCallback(async () => {
    const current = assessmentRef.current;
    if (!current) return;
    setPhase('waiting');
    // captures must be on the server before analyzers run
    await queue.process();
    const submitted = await client.submitAssessment(current.id);
    assessmentRef.current = submitted;
    setAssessment(submitted);
  }, [client, queue]);

  const advance = useCallback(() => {
    setCurrentIndex((i) => {
      const next = i + 1;
      if (next >= steps.length) {
        void submit().catch(fail);
      }
      return next;
    });
  }, [steps.length, submit, fail]);

  // Poll while waiting for the analyzer.
  useEffect(() => {
    if (phase !== 'waiting') return;
    const timer = setInterval(async () => {
      const current = assessmentRef.current;
      if (!current) return;
      try {
        const fresh = await client.getAssessment(current.id);
        assessmentRef.current = fresh;
        setAssessment(fresh);
        if (fresh.state === 'completed') {
          clearInterval(timer);
          setFindings(await client.getFindings(fresh.id));
          setPhase('completed');
        } else if (fresh.state === 'awaiting_evidence') {
          clearInterval(timer);
          const requests = await client.getEvidenceRequests(fresh.id);
          const fresh_ = requests.filter(
            (r: EvidenceRequest) => r.status === 'pending' && !seenRequestIds.current.has(r.id),
          );
          fresh_.forEach((r) => seenRequestIds.current.add(r.id));
          if (fresh_.length === 0) {
            // nothing actionable — resubmit to let the budget-exhaustion path complete
            await submit();
            return;
          }
          setSteps((prev) => [
            ...prev,
            ...fresh_.map((r) => ({ step: r.stepSpec, origin: 'evidence_request' as const, reason: r.reason })),
          ]);
          setPhase('capturing');
        }
      } catch (err) {
        clearInterval(timer);
        fail(err);
      }
    }, pollIntervalMs);
    return () => clearInterval(timer);
  }, [phase, client, pollIntervalMs, submit, fail]);

  const currentStep = currentIndex < steps.length ? steps[currentIndex] : null;

  const completeImageStep = useCallback(
    (capture: ImageCaptureResult) => {
      const current = assessmentRef.current;
      if (!current || !currentStep) return;
      setUploadsPending((n) => n + 1);
      queue.enqueue({
        id: crypto.randomUUID(),
        assessmentId: current.id,
        stepId: currentStep.step.id,
        status: 'done',
        blobBase64: capture.blobBase64,
        contentType: capture.contentType,
        evidence: {
          type: currentStep.step.captureType,
          metadata: {
            capturedAt: new Date().toISOString(),
            contentType: capture.contentType,
            sharpness: capture.sharpness,
            width: capture.width,
            height: capture.height,
          },
        },
      });
      advance();
    },
    [queue, currentStep, advance],
  );

  const completeStructuredStep = useCallback(
    (answers: Record<string, unknown>) => {
      const current = assessmentRef.current;
      if (!current || !currentStep) return;
      setUploadsPending((n) => n + 1);
      queue.enqueue({
        id: crypto.randomUUID(),
        assessmentId: current.id,
        stepId: currentStep.step.id,
        status: 'done',
        evidence: {
          type: 'structured_input',
          // per the Evidence contract, structured payloads live inline in payloadRef
          payloadRef: JSON.stringify(answers),
          metadata: { capturedAt: new Date().toISOString() },
        },
      });
      advance();
    },
    [queue, currentStep, advance],
  );

  const skipStep = useCallback(() => {
    const current = assessmentRef.current;
    if (!current || !currentStep) return;
    queue.enqueue({
      id: crypto.randomUUID(),
      assessmentId: current.id,
      stepId: currentStep.step.id,
      status: 'skipped',
    });
    advance();
  }, [queue, currentStep, advance]);

  return {
    phase,
    error,
    protocol,
    assessment,
    steps,
    currentIndex,
    currentStep,
    findings,
    uploadsPending,
    completeImageStep,
    completeStructuredStep,
    skipStep,
  };
}
