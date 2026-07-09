// Guided capture SDK (React). Planned exports:
//   <GuidedCapture protocol={...} onEvidence={...} /> — HUD + SVG overlay + step progression
//   Client-side quality checks (laplacian blur, orientation, resolution) per step.validationRules
//   Resumable upload queue: retry transient failures (timeout/5xx), persist progress
//   locally (offline buffer) and sync draft state to the server (source of truth).
export {};
