# MonkJs Deep Dive — Findings

Source: github.com/monkvision/monkjs (shallow clone, master). Lerna/Yarn monorepo, TypeScript, BSD-3-Clause-Clear.

## Q1. Package split strategy

Their monorepo has ~12 packages in 4 tiers:

| Tier | Packages | Lesson |
|---|---|---|
| Foundation | `types` (all shared TS types), `common` (state, hooks, i18n, theme, utils) | A dedicated `types` package everything depends on keeps contracts explicit |
| Abstract adapters | `analytics`, `monitoring` (interfaces only) + `posthog`, `sentry` (impls) | **Ports & adapters at package level** — the pattern to copy for our Analyzer plugins: `@framework/analyzer` (interface) + separate impl packages |
| Capability | `camera-web` (raw camera preview/take-picture), `sights` (capture guidance data), `network` (API client) | Camera is separate from *inspection* logic — reusable |
| Product flows | `inspection-capture-web`, `inspection-review`, `common-ui-web` | Opinionated single-page components built on the tiers below |

Plus `apps/demo-app` — their boilerplate, exactly the "reference app" role we planned.

**Verdict: imitate the tiering**, including abstract+impl adapter pairs. **Avoid**: no native package actually exists in the current repo despite "React Native" branding — web-first (PWA) won; plan for that honestly.

## Q2. "Sights" vs our ProtocolStep

A sight = one JSON record + one SVG overlay, per vehicle model (e.g. `vwtroc.json` has 54 sights):

```json
{ "id": "vwtroc-0U14gFyk",
  "camera": { "focal_length": 26, "location_xyz": [...], "rotation_xyz_deg": [79,0,-75] },
  "category": "exterior", "label": "front-lateral-right",
  "overlay": "vwtroc-0U14gFyk.svg", "mirror_sight": "vwtroc-zjAIjUgU",
  "tasks": ["damage_detection"], "positioning": { "position": 79, "height": "mid" },
  "referencePicture": "https://..." }
```

Key observations:
1. **Pure data + JSON Schema validation + a `validate` build step.** Exactly our "protocols are data" invariant, production-proven. They even keep a `research/` folder where sights are authored, then compiled into the lib.
2. **`tasks` field links a capture step to the analyzers it feeds.** We lack this: a ProtocolStep should be able to declare `feeds_analyzers[]` so orchestration knows which analyzers to trigger per evidence, instead of running everything on everything.
3. **`referencePicture` — an example photo shown to the user.** Trivial, huge UX value. Add `example_ref` to ProtocolStep.
4. **SVG overlays as the guidance mechanism** — alignment silhouettes on the camera HUD. Simple, effective; adopt.
5. **What they DON'T have that we do:** no branching, no conditionality, no questionnaire steps, no versioning visible in the sight record, no refinement loop. A sight set is a flat checklist. Our Protocol is a superset — validated, not over-engineered.

**Verdict:** sights validate our design; steal `tasks`-style analyzer routing, reference pictures, SVG overlays, and the schema-validated authoring pipeline.

## Q3. Client-side quality validation

Split model:
- **Client-side: minimal.** A hand-rolled Laplacian convolution (`laplaceScores.ts`) over the center 80% crop of the green channel — used to pick the sharpest frame from video, cheap enough to run on-device. Plus non-image guards: an `OrientationEnforcer` component (forces landscape) and adaptive camera config.
- **Server-side: rich.** A ~27-value `ComplianceIssue` enum returned per image by the API: `BLURRINESS, OVEREXPOSURE, UNDEREXPOSURE, LENS_FLARE, TOO_ZOOMED, WRONG_ANGLE, VEHICLE_NOT_FULLY_IN_FRAME, REFLECTIONS, WETNESS, DIRTINESS...`. The client displays issues and prompts retake; the intelligence lives behind the API (their proprietary side).

**Verdict: copy the split.** Client does cheap physics (blur, orientation, resolution); server/analyzers do semantic compliance. Two consequences for us: (a) compliance checking is just **another analyzer kind** (`compliance`) in our model — it emits retake-flavored EvidenceRequests, meaning our refinement loop already subsumes their retake flow; (b) keep the client-side check pluggable per capture_spec so verticals can add checks (e.g. face-detection for skincare) without framework changes.

## Q4. Client/API state sync

- Client state = normalized entity store (`MonkState`: flat arrays of inspections, images, damages, parts, tasks...) in React Context + reducer.
- Mutations via explicit **past-tense actions** (`CREATED_ONE_IMAGE`, `UPDATED_MANY_TASKS`, `GOT_ONE_INSPECTION`) — API responses are mapped to actions that patch the store. Effectively a small Redux without the dependency.
- **Upload queue** (`useQueue` + `useUploadQueue`): retry policy distinguishes transient failures (timeout, 5xx → retry, MAX_RETRY_COUNT) from permanent (4xx → surface to user). Built for flaky mobile networks.
- `PreventExit` guard against losing an in-progress capture.

**Verdict:** the normalized store + event-ish actions is sane and maps well to our async/human-analyzer world (server pushes `FINDING_ADDED`, `EVIDENCE_REQUESTED` events; client reduces them). The upload queue is table stakes for field capture in Brazil — budget for it early. **Avoid:** their state lives only in memory; abandoning mid-capture loses everything except uploaded images. We should persist capture progress locally (assessment is resumable).

## Extra findings

- **Video capture mode** exists (walkaround video, best-frame extraction via Laplacian). Interesting future capture_type; ignore for v1.
- **i18n baked into every package** (en/fr/de/nl). For PT-BR-first with English OSS docs, adopt per-package translation files from day one — retrofitting i18n is misery.
- **License caution:** BSD-3-Clause-Clear code, but sights *data* (SVGs, reference photos) is their content. Copy patterns, not assets.
- Their domain chain stops at Findings-equivalents (damages/parts + pricing). No conditions, no solutions, no feedback loop — confirms our layer above is the novel part.

## Action list for our framework

1. Adopt tiered package layout incl. abstract/impl adapter pairs for analyzers.
2. Add to ProtocolStep: `feeds_analyzers[]`, `example_ref`, SVG `overlay_ref`.
3. Model compliance as an analyzer kind; retakes ride the EvidenceRequest loop.
4. Client: normalized entity store + past-tense action events; resumable (persisted) capture; retrying upload queue.
5. Schema-validated protocol authoring pipeline (`research → validate → build`).
6. i18n per package from the start.
