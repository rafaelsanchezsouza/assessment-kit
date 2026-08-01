// @gaf/capture-web — guided capture SDK (React). Protocol-driven HUD +
// client-side quality checks + resumable upload queue against @gaf/core's
// HTTP API. Domain-agnostic by construction: all content arrives as data.
export { ApiError, GafApiClient } from './api/client.ts';
export type {
  AssessmentEvidenceItem,
  BlobUploadResult,
  GafApiClientOptions,
  ProgressEvidence,
  ReviewSubmission,
} from './api/client.ts';
export {
  analysisImageData,
  blurriness,
  checkImageQuality,
  laplacianSharpness,
} from './quality/blur.ts';
export type { ImageDataLike, QualityFailure, QualityResult } from './quality/blur.ts';
export { UploadQueue } from './uploadQueue.ts';
export type { QueueStorage, UploadQueueOptions, UploadTask } from './uploadQueue.ts';
export { useAssessment } from './hooks/useAssessment.ts';
export type {
  ActiveStep,
  CaptureEventHandler,
  CaptureEventName,
  CapturePhase,
  ImageCaptureResult,
  UseAssessmentOptions,
  UseAssessmentResult,
} from './hooks/useAssessment.ts';
export { GuidedCapture } from './components/GuidedCapture.tsx';
export type { GuidedCaptureProps } from './components/GuidedCapture.tsx';
export { StructuredInputStep } from './components/StructuredInputStep.tsx';
export type { StructuredInputStepProps } from './components/StructuredInputStep.tsx';
export { isAnswered, missingRequiredKeys } from './components/structuredAnswers.ts';
export type { JsonSchemaObject, JsonSchemaProperty } from './components/structuredAnswers.ts';
export { en, ptBR } from './i18n.ts';
export type { CaptureStrings } from './i18n.ts';
