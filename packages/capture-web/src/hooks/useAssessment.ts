import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Assessment, EvidenceRequest, Finding, Protocol, ProtocolStep } from '@gaf/types';
import type { GafApiClient } from '../api/client.ts';
import { randomId } from '../randomId.ts';
import { UploadQueue } from '../uploadQueue.ts';

/**
 * Optional observability seam. The SDK emits domain-neutral capture-funnel
 * events; the host forwards them wherever it likes (a product-analytics tool,
 * a log, nowhere). The framework never knows what's on the other end — no
 * analytics vendor is referenced here by construction. Event names are stable
 * and generic (`capture_*`); props carry only protocol/step identifiers and
 * quality metrics, never captured payloads.
 */
export type CaptureEventHandler = (
  event: CaptureEventName,
  props?: Record<string, unknown>,
) => void;

export type CaptureEventName =
  | 'capture_started'
  | 'capture_step_viewed'
  | 'capture_step_completed'
  | 'capture_step_skipped'
  | 'capture_quality_rejected'
  | 'capture_evidence_requested'
  | 'capture_submitted'
  | 'capture_captured'
  | 'capture_completed'
  | 'capture_error';

export type CapturePhase =
  | 'loading'
  | 'capturing'
  | 'waiting' // submitted, polling for the analyzer's verdict
  | 'captured' // all steps done, autoSubmit=false: the host owns what happens next
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
  protocolId?: string;
  protocolVersion?: string;
  /** Existing subject to assess; otherwise `newSubject` is created on start. */
  subjectId?: string;
  newSubject?: { type: string; ownerId: string; attributes?: Record<string, unknown> };
  /** Resume an EXISTING assessment (created elsewhere) instead of creating one. */
  assessmentId?: string;
  /**
   * When false, finishing the last step parks the flow in phase 'captured'
   * without submitting for analysis — the host owns completion (e.g. flows
   * where capture feeds a workflow other than the analyzer loop). Default true.
   */
  autoSubmit?: boolean;
  pollIntervalMs?: number;
  /** Optional observability seam; see {@link CaptureEventHandler}. */
  onEvent?: CaptureEventHandler;
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
  const { client, protocolId, protocolVersion, subjectId, newSubject, assessmentId } = options;
  const autoSubmit = options.autoSubmit ?? true;
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

  // Keep the handler in a ref so emitting never re-runs effects or rebuilds
  // callbacks; `emit` is stable for the component's lifetime.
  const onEventRef = useRef(options.onEvent);
  onEventRef.current = options.onEvent;
  const emit = useCallback<CaptureEventHandler>((event, props) => {
    onEventRef.current?.(event, props);
  }, []);

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

  const fail = useCallback(
    (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setPhase('error');
      emit('capture_error', { message });
    },
    [emit],
  );

  // Boot: resume an existing assessment, or fetch protocol + create + start one.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let started;
      let proto;
      if (assessmentId) {
        started = await client.getAssessment(assessmentId);
        proto = await client.getProtocol(started.protocolId, started.protocolVersion);
        if (started.state === 'draft') started = await client.startAssessment(started.id);
      } else {
        if (!protocolId || !protocolVersion) {
          throw new Error('useAssessment needs assessmentId or protocolId+protocolVersion');
        }
        proto = await client.getProtocol(protocolId, protocolVersion);
        let sid = subjectId;
        if (!sid) {
          if (!newSubject) throw new Error('useAssessment needs subjectId or newSubject');
          sid = (await client.createSubject(newSubject)).id;
        }
        const created = await client.createAssessment({ subjectId: sid, protocolId, protocolVersion });
        started = await client.startAssessment(created.id);
      }
      if (cancelled) return;
      const initialSteps = proto.steps
        .filter((step) => started.progress[step.id] === undefined)
        .map((step) => ({ step, origin: 'protocol_step' as const }));
      setProtocol(proto);
      assessmentRef.current = started;
      setAssessment(started);
      setSteps(initialSteps);
      setCurrentIndex(0);
      setPhase('capturing');
      emit('capture_started', {
        protocolId: proto.id,
        protocolVersion: proto.version,
        stepCount: initialSteps.length,
        resumed: Boolean(assessmentId),
      });
    })().catch((err) => {
      if (!cancelled) fail(err);
    });
    return () => {
      cancelled = true;
    };
  }, [client, protocolId, protocolVersion, subjectId, newSubject, assessmentId, fail, emit]);

  const submit = useCallback(async () => {
    const current = assessmentRef.current;
    if (!current) return;
    setPhase('waiting');
    emit('capture_submitted');
    // captures must be on the server before analyzers run
    await queue.process();
    const submitted = await client.submitAssessment(current.id);
    assessmentRef.current = submitted;
    setAssessment(submitted);
  }, [client, queue, emit]);

  const advance = useCallback(() => {
    setCurrentIndex((i) => {
      const next = i + 1;
      if (next >= steps.length) {
        if (autoSubmit) {
          void submit().catch(fail);
        } else {
          // host owns completion; make sure queued uploads land first
          void queue
            .process()
            .then(() => {
              setPhase('captured');
              emit('capture_captured');
            })
            .catch(fail);
        }
      }
      return next;
    });
  }, [steps.length, submit, fail, autoSubmit, queue, emit]);

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
          const found = await client.getFindings(fresh.id);
          setFindings(found);
          setPhase('completed');
          emit('capture_completed', { findingCount: found.length });
        } else if (fresh.state === 'awaiting_evidence') {
          clearInterval(timer);
          const requests = await client.getEvidenceRequests(fresh.id);
          // `status` is the real filter: the server resolves a request as soon as
          // evidence (or a skip) arrives at its step. seenRequestIds is only a
          // same-session guard against a poll adding the same step twice before
          // that write lands — it used to be the whole mechanism, back when
          // status never moved off `pending` and a reload resurrected answered
          // requests.
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
          emit('capture_evidence_requested', { count: fresh_.length });
        }
      } catch (err) {
        clearInterval(timer);
        fail(err);
      }
    }, pollIntervalMs);
    return () => clearInterval(timer);
  }, [phase, client, pollIntervalMs, submit, fail, emit]);

  const currentStep = currentIndex < steps.length ? steps[currentIndex] : null;

  // Fire `capture_step_viewed` once per step becoming current (id+index keyed).
  const viewedKey = currentStep ? `${currentStep.step.id}:${currentIndex}` : null;
  useEffect(() => {
    if (phase !== 'capturing' || !currentStep) return;
    emit('capture_step_viewed', {
      stepId: currentStep.step.id,
      captureType: currentStep.step.captureType,
      origin: currentStep.origin,
      index: currentIndex,
      total: steps.length,
    });
    // currentStep/steps read fresh via viewedKey; intentionally not deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewedKey, phase, emit]);

  const completeImageStep = useCallback(
    (capture: ImageCaptureResult) => {
      const current = assessmentRef.current;
      if (!current || !currentStep) return;
      setUploadsPending((n) => n + 1);
      queue.enqueue({
        id: randomId(),
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
      emit('capture_step_completed', {
        stepId: currentStep.step.id,
        captureType: currentStep.step.captureType,
        sharpness: capture.sharpness,
      });
      advance();
    },
    [queue, currentStep, advance, emit],
  );

  const completeStructuredStep = useCallback(
    (answers: Record<string, unknown>) => {
      const current = assessmentRef.current;
      if (!current || !currentStep) return;
      setUploadsPending((n) => n + 1);
      queue.enqueue({
        id: randomId(),
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
      emit('capture_step_completed', {
        stepId: currentStep.step.id,
        captureType: 'structured_input',
      });
      advance();
    },
    [queue, currentStep, advance, emit],
  );

  const skipStep = useCallback(() => {
    const current = assessmentRef.current;
    if (!current || !currentStep) return;
    queue.enqueue({
      id: randomId(),
      assessmentId: current.id,
      stepId: currentStep.step.id,
      status: 'skipped',
    });
    emit('capture_step_skipped', {
      stepId: currentStep.step.id,
      captureType: currentStep.step.captureType,
      origin: currentStep.origin,
    });
    advance();
  }, [queue, currentStep, advance, emit]);

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
