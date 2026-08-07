import { useRef, useState } from 'react';
import type { Finding } from '@assessment-kit/types';
import type { AssessmentApiClient } from '../api/client.ts';
import { analysisImageData, checkImageQuality, type QualityResult } from '../quality/blur.ts';
import { en, type CaptureStrings } from '../i18n.ts';
import {
  useAssessment,
  type ActiveStep,
  type CaptureEventHandler,
  type UseAssessmentOptions,
} from '../hooks/useAssessment.ts';
import { StructuredInputStep } from './StructuredInputStep.tsx';

/**
 * The guided-capture HUD: a pure protocol interpreter. Everything rendered —
 * titles, guidance, overlays, examples, thresholds, form schemas — comes from
 * the protocol the server serves; this component supplies only chrome.
 * Unstyled beyond structural layout; hosts skin it via the ak-* class names.
 */

export interface GuidedCaptureProps extends Omit<UseAssessmentOptions, 'pollIntervalMs'> {
  client: AssessmentApiClient;
  strings?: CaptureStrings;
  pollIntervalMs?: number;
  onCompleted?: (findings: Finding[]) => void;
  /** Fires when autoSubmit=false and every step is captured (uploads drained). */
  onCaptured?: () => void;
  className?: string;
}

export function GuidedCapture(props: GuidedCaptureProps) {
  const strings = props.strings ?? en;
  const flow = useAssessment(props);
  const completedFired = useRef(false);
  const capturedFired = useRef(false);

  if (flow.phase === 'completed' && !completedFired.current) {
    completedFired.current = true;
    props.onCompleted?.(flow.findings);
  }
  if (flow.phase === 'captured' && !capturedFired.current) {
    capturedFired.current = true;
    props.onCaptured?.();
  }

  return (
    <div className={props.className ?? 'ak-guided-capture'}>
      {flow.phase === 'loading' && <p className="ak-status">…</p>}

      {flow.phase === 'error' && <p className="ak-error">{flow.error}</p>}

      {flow.phase === 'captured' && <p className="ak-status">✓</p>}

      {flow.phase === 'waiting' && (
        <p className="ak-status">
          {flow.uploadsPending > 0 ? strings.uploading : strings.waitingForAnalysis}
        </p>
      )}

      {flow.phase === 'capturing' && flow.currentStep && (
        <StepView
          key={`${flow.currentStep.step.id}-${flow.currentIndex}`}
          active={flow.currentStep}
          index={flow.currentIndex}
          total={flow.steps.length}
          strings={strings}
          client={props.client}
          onImage={flow.completeImageStep}
          onStructured={flow.completeStructuredStep}
          onSkip={flow.skipStep}
          onEvent={props.onEvent}
        />
      )}

      {flow.phase === 'completed' && (
        <div className="ak-completed">
          <h2>{strings.completed}</h2>
          <ul className="ak-findings">
            {flow.findings.map((f) => (
              <li key={f.id}>{f.statement.text}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

interface StepViewProps {
  active: ActiveStep;
  index: number;
  total: number;
  strings: CaptureStrings;
  client: AssessmentApiClient;
  onImage: (capture: {
    blobBase64: string;
    contentType: string;
    sharpness: number;
    width: number;
    height: number;
  }) => void;
  onStructured: (answers: Record<string, unknown>) => void;
  onSkip: () => void;
  onEvent?: CaptureEventHandler;
}

function StepView({ active, index, total, strings, onImage, onStructured, onSkip, onEvent }: StepViewProps) {
  const { step, origin, reason } = active;
  const skippable = step.optional || origin === 'evidence_request';

  return (
    <div className="ak-step">
      <p className="ak-step-progress">{strings.stepProgress(index + 1, total)}</p>
      {origin === 'evidence_request' && (
        <p className="ak-evidence-request-reason">
          {strings.analystRequestedMore} <b>{reason}</b>
        </p>
      )}
      <h2 className="ak-step-title">
        {step.title}
        {step.optional ? <small> ({strings.optionalStep})</small> : null}
      </h2>
      <p className="ak-step-guidance">{step.guidance}</p>

      {step.captureType === 'structured_input' ? (
        <StructuredInputStep step={step} strings={strings} onSubmit={onStructured} onSkip={skippable ? onSkip : undefined} />
      ) : (
        <ImageStep step={active} strings={strings} onAccept={onImage} onSkip={skippable ? onSkip : undefined} onEvent={onEvent} />
      )}
    </div>
  );
}

interface PendingCapture {
  previewUrl: string;
  blobBase64: string;
  contentType: string;
  quality: QualityResult;
  width: number;
  height: number;
}

function ImageStep({
  step: active,
  strings,
  onAccept,
  onSkip,
  onEvent,
}: {
  step: ActiveStep;
  strings: CaptureStrings;
  onAccept: StepViewProps['onImage'];
  onSkip?: () => void;
  onEvent?: CaptureEventHandler;
}) {
  const { step } = active;
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingCapture | null>(null);

  async function handleFile(file: File) {
    const previewUrl = URL.createObjectURL(file);
    const img = new Image();
    await new Promise<void>((resolveLoad, rejectLoad) => {
      img.onload = () => resolveLoad();
      img.onerror = () => rejectLoad(new Error('could not decode image'));
      img.src = previewUrl;
    });
    const quality = checkImageQuality(
      analysisImageData(img),
      step.validationRules,
      img.naturalWidth,
      img.naturalHeight,
    );
    if (quality.failures.length > 0) {
      onEvent?.('capture_quality_rejected', {
        stepId: step.id,
        rules: quality.failures.map((f) => f.rule),
        sharpness: quality.sharpness,
      });
    }
    const buf = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < buf.length; i += chunk) {
      binary += String.fromCharCode(...buf.subarray(i, i + chunk));
    }
    setPending({
      previewUrl,
      blobBase64: btoa(binary),
      contentType: file.type || 'application/octet-stream',
      quality,
      width: img.naturalWidth,
      height: img.naturalHeight,
    });
  }

  const qualityWarnings =
    pending?.quality.failures.map((f) =>
      f.rule === 'minResolution' ? strings.resolutionTooLow : strings.photoLooksBlurry,
    ) ?? [];

  return (
    <div className="ak-image-step">
      {step.exampleRef ? (
        <p className="ak-example">
          <small>{step.exampleRef}</small>
        </p>
      ) : null}
      <div className="ak-frame" style={{ position: 'relative' }}>
        {pending ? <img src={pending.previewUrl} alt={step.title} style={{ maxWidth: '100%' }} /> : null}
        {step.overlayRef && !pending ? <span className="ak-overlay-ref" data-overlay={step.overlayRef} /> : null}
      </div>

      {[...new Set(qualityWarnings)].map((w) => (
        <p key={w} className="ak-quality-warning">
          ⚠️ {w}
        </p>
      ))}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = '';
        }}
      />

      <div className="ak-actions" style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
        {!pending ? (
          <button type="button" onClick={() => inputRef.current?.click()}>
            {strings.takePhoto}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() =>
                onAccept({
                  blobBase64: pending.blobBase64,
                  contentType: pending.contentType,
                  sharpness: pending.quality.sharpness,
                  width: pending.width,
                  height: pending.height,
                })
              }
            >
              {strings.accept}
            </button>
            <button type="button" onClick={() => inputRef.current?.click()}>
              {strings.retake}
            </button>
          </>
        )}
        {onSkip ? (
          <button type="button" onClick={onSkip}>
            {strings.skip}
          </button>
        ) : null}
      </div>
    </div>
  );
}
