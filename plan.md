# @gaf/capture-web — the React capture SDK (next task)

> Replaces the previous plan (storage ports + Postgres adapter), which is
> **fully delivered and verified** — see "Status of the previous plan" below.

## Context

Build-order item 3 and CLAUDE.md's "immediate next task": `@gaf/capture-web`
is the last empty-stub layer between "backend works" and a clickable POC. The
backend it talks to is real: `apps/reference` wires `@gaf/core`'s HTTP API +
`@gaf/storage-postgres` + `HumanAnalyzer` on port 3002, end-to-end tested
against Postgres. The UX to port is proven in `apps/prototype/nbs-v2.html`
(guided HUD, composed shooting script, Laplacian blur check) — but the
prototype is throwaway AND domain-flavored; this package is the product-grade,
**domain-agnostic** React SDK.

## 0. Layering rules (the governing constraint of this task)

This repo builds the **agnostic framework**; Nativa is merely its **first
domain implementation** and lives in a separate layer (ultimately the private
vertical repo). Per `docs/architecture.mermaid` the layers are: framework
packages → knowledge layer (protocols/catalogs as data) → thin vertical apps.
Concretely for everything in this plan:

- **`packages/*` are framework code.** Domain-neutral vocabulary only
  (Assessment, Protocol, Solution, Evidence). No `nativa`/`nbs`/`paraíba`/
  domain identifiers, no domain strings, no domain assumptions ("photo of a
  backyard") anywhere in package source. If a feature needs domain knowledge,
  that knowledge must arrive as **data** (Protocol/Catalog YAML, props,
  config) — never as code.
- **All rendered content comes from protocol data.** Step titles, guidance
  text, overlays (`overlayRef`), example images (`exampleRef`), validation
  thresholds (`validationRules`), structured-input schemas (`captureSpec`) —
  capture-web interprets these; it never supplies them. The SDK's own i18n
  covers only framework chrome ("Retake", "Skip", "Next", "Uploading…", error
  messages). Localizing domain text (guidance, titles) is the protocol
  author's job — protocol-level i18n is a schema gap, parked in the backlog
  below, and must not be papered over with strings inside the SDK.
- **Dependency direction:** `apps → packages`, never the reverse.
  `@gaf/capture-web` depends only on `@gaf/types` (plus React as a peer).
  It must not import `@gaf/core` (it talks to it over HTTP) and must not know
  which storage or analyzer sits behind the API.
- **Composition roots are the only place layers meet.** The demo host app in
  this repo composes SDK + the neutral demo protocol. The Nativa capture app
  will be a *different, equally thin* composition in the private repo,
  consuming the identical SDK + private protocols/catalogs. Nothing in this
  repo should need to change for that to work — that's the acceptance test of
  agnosticism.
- **Enforcement, not intention:** add a cheap layering lint to CI — fail if
  `grep -riE 'nativa|nbs|paraiba|paraíba' packages/` matches (demo data under
  `catalog/` and `apps/prototype/` is exempt; they're the illustrative
  knowledge layer and the UX lab).

## 1. Backend gaps capture-web exposes (fix in @gaf/core first, small)

The API was curl-tested with metadata-only evidence; a real photo frontend
needs two additions (both domain-neutral by construction):

- **`GET /protocols/:id/:version`** — capture-web must fetch the protocol to
  render steps. Today protocols are only loaded server-side; there is no read
  endpoint. Add to `packages/core/src/http/app.ts` (deps already include
  `ProtocolRepository`).
- **Binary upload path.** `PATCH /assessments/:id/progress` accepts evidence
  as JSON metadata, but nothing exposes `BlobStore` over HTTP — photos have
  nowhere to go. Add `BlobStore` to `AppDeps` and a
  `POST /assessments/:id/evidence-blob` (raw body or multipart) that puts the
  blob under a sanitized key and returns the `blobKey` the progress PATCH then
  references. Wire `FsBlobStore` in `apps/reference/src/main.ts`.

## 2. Package `packages/capture-web` (framework layer)

React 18 **peer** dependency (SDK, not app — the host vertical app owns
React), build stays `tsc` like siblings; `react`/`@types/react` as devDeps
for tests. Everything below is protocol-driven; nothing is domain-specific.

- `src/api/client.ts` — thin typed client for the core HTTP API (subjects,
  assessments create/start/progress/submit, protocol fetch, blob upload,
  evidence-requests poll). Fetch-based, injectable base URL, no framework deps.
- `src/quality/blur.ts` — port the prototype's Laplacian-variance blur check
  (pure function on ImageData); resolution/orientation checks. Thresholds come
  exclusively from `step.validationRules` — no built-in domain defaults. Pure
  = unit-testable in node with synthetic ImageData.
- `src/uploadQueue.ts` — resumable queue: enqueue captured evidence, retry
  transient failures (timeout/5xx, exponential backoff), persist queue state
  to `localStorage`/IndexedDB so a refresh doesn't lose captures (offline
  buffer; server stays source of truth per decision 10).
- `src/components/GuidedCapture.tsx` — the HUD, a pure protocol interpreter:
  renders whatever steps the fetched protocol declares — title/guidance from
  step data, overlay SVG from `overlayRef`, example from `exampleRef`, capture
  via `<input type="file" capture>` first (getUserMedia HUD can iterate
  later), inline quality feedback with retake prompt, skip for `optional`
  steps, progress indicator. Styling via unstyled defaults + className/slot
  hooks so vertical apps skin it without forking.
- `src/components/StructuredInputStep.tsx` — minimal renderer for
  `captureType: structured_input` driven by `captureSpec.jsonSchema` (enum →
  select, boolean → toggle, string/number → input). Schema-driven only;
  `@gaf/forms-web` remains the future home for full form rendering.
- `src/hooks/useAssessment.ts` — state hook driving the flow: load protocol →
  start → step-by-step capture → submit → poll `evidence-requests`
  (refinement loop: requested retakes/additions rendered as extra steps,
  always skippable) → completed.
- `src/i18n.ts` — framework-chrome strings only, EN default + PT-BR complete
  (convention 12), overridable by the host app.
- Tests (`node --test`): blur/quality functions, upload-queue retry/persist
  logic (fake fetch + fake storage), API client against the same in-memory
  app used by `packages/core/src/http/app.test.ts` if practical.

## 3. Demo host app (reference layer, stays domain-neutral)

Capture-web is a library; to click it we need a host. Add a minimal Vite React
app `apps/capture-demo` (dev-only, not deployed) mounting `GuidedCapture`
against `apps/reference` on :3002 with the **neutral demo protocol**
(`backyard-quick-check`) — deliberately NOT the NBS catalog, so the demo
proves the SDK works without domain knowledge. This is the "clickable POC"
milestone: capture photos → human review via `POST /reviews/:assessmentId`
(curl or a crude page) → findings visible.

The **Nativa capture app is explicitly not part of this task**: it is the
first domain-implementation layer, composed later (private repo) from this
same SDK + private protocols. If building it requires touching `packages/*`,
that's a layering bug to fix in the framework, not a patch to inline.

## 4. Repo hygiene (blocking item found during evaluation)

**The repo is not a git repository.** `.github/workflows/ci.yml` is correct
but has never executed — "wired into CI" is aspirational until `git init`,
first commit, and a GitHub remote exist. Do this before/alongside the
capture-web work so the Postgres-service CI (plus the new layering lint from
§0) actually guards changes. (Also the moment for the GAF→real-name rename
check-in, decision 14, before anything is published.)

## Verification

1. Postgres compose up + migrate + `apps/reference` running (as documented in
   CLAUDE.md).
2. `pnpm build && pnpm test` — new capture-web tests pass; core tests cover
   the two new endpoints.
3. Manual: open `apps/capture-demo`, complete the demo protocol with real
   photos (one deliberately blurred → client rejects it), submit, answer the
   review via curl, watch the assessment reach `completed` and findings render.
4. Kill the tab mid-capture, reopen — queue/buffer resumes (refresh-level
   resumability; cross-device draft-sync remains out of scope, per CLAUDE.md).
5. **Layering check:** the grep lint passes on `packages/`; swapping the demo
   protocol YAML for any other valid protocol changes the entire capture flow
   with zero code edits (run once with a second toy protocol to prove it).

---

## Status of the previous plan (storage) — DONE, verified 2026-07-09

Everything in the previous plan.md exists and passes: storage ports in
`@gaf/types`, `packages/storage-postgres` (10 repositories + FsBlobStore with
path-traversal guard + plain-SQL migrate + docker-compose), tests that skip
cleanly without a DB (`pnpm test` → 17 tasks green, 6 pg tests skipped when
no `DATABASE_URL`), CI file with Postgres service container, and beyond the
plan: Orchestrator persistence, the full HTTP API, and `apps/reference` as a
real composition root. `pnpm protocols:validate` passes for both the demo
protocol and `catalog/nbs-paraiba.yaml`.

Live e2e re-run 2026-07-09 (Postgres compose + reference app + curl through
capture → submit → review → completed) surfaced and fixed one real bug: async
Express handlers had no rejection handling, so any failing request (e.g.
malformed evidence body) crashed the whole server process. Fixed in
`packages/core/src/http/app.ts` (`wrap()` + error middleware) with a
regression test. Remaining known softness: request bodies aren't validated
before hitting the repositories — a malformed body is a 500 (safe, but 400
with a useful message would serve capture-web better). Worth folding into the
capture-web round.

## Requirements reconciliation — handover-validacao-arquitetura.md vs this repo

The Nativa handover describes the **first domain implementation**, i.e. a
different layer. Per decision 8 (fulfillment is an event boundary) and §0
above, most of it must NOT be built in this repo. Mapping:

**Already covered by the framework (Nativa consumes as data/API):**
- §4.2 roteiros de diagnóstico parametrizados por produto → solution-first
  catalogs (`Solution.requires`, composed shooting script) — schema, validator
  and prototype all exist. "Produto" in the handover = `Solution` here.
- §4.2 iterações fornecedor→comerciante as structured events (not chat) →
  exactly the `EvidenceRequest` refinement loop, persisted, bounded by
  protocol policy.
- §5 Q3 (declarative diagnostic config) → answered: YAML + JSON Schema, working.
- §5 Q6 (state machine engine vs code) → precedent answered for the
  assessment half: plain domain code (`stateMachine.ts`), no engine needed at
  MVP scale; recommend the same for the demanda machine in the vertical repo.

**Domain layer — belongs in the private Nativa repo, never here:**
- §2/§3 Demanda/Proposta/Contrato/Avaliação + demanda state machine (all
  post-`FulfillmentRequestedEvent`), §4.1 marketplace browsing/ordering
  (Medusa/Sharetribe evaluation), §4.3 chat (Rocket.Chat/Matrix), §4.4
  gamificação/reputação, §4.5 pagamentos/escrow, §5 Q1/Q2/Q5. Also the real
  NBS protocols/catalog with citations (knowledge layer) and the Nativa
  capture app itself (§3 above).

**Genuine framework gaps the handover surfaces (backlog, designed
domain-neutrally, not in this plan):**
- §4.2 **telemetria obrigatória**: evidence lives in the framework, so
  evidence-access events are a framework seam — a generic append-only
  `evidence_events` table (who viewed/clicked which evidence, when) + emit
  hook; the *interpretation* of those events (supplier-relevance learning) is
  vertical. Cheap now that storage exists; schedule right after capture-web.
- §4.2 pré-preenchimento from imóvel: `Subject.attributes` exists, but the
  protocol schema has no attribute→step-prefill mapping yet (generic mapping
  in the schema; the attribute vocabulary itself stays vertical).
- **Protocol-level i18n** (localized step titles/guidance in protocol YAML) —
  surfaced by §0: the SDK must not carry domain strings, so protocols need a
  place for their own translations.
- The **fulfillment event bus** (build-order item 5) is the seam every
  post-diagnostic Nativa feature attaches to — its priority rises now that
  the vertical's demand flow is being designed against it.
