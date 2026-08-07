# EvidenceRequest resolution + the re-request signal — DONE 2026-08-05 (dev + prod)

> **Status: both slices built, verified, and live in dev and prod.**
>
> *Prod (2026-08-05).* Migration `framework_003_evidence_request_resolution` via
> MCP, then `deploy.sh all`. The backfill did exactly what it was built for: the
> **only** `evidence_request` in prod was the stuck one, and it is now
> `fulfilled`. `check` green, deployed bundle == local build. No functional flow
> was driven in prod on purpose — that would mean creating fake subjects and
> demands in real data; the assurance is that the server bundle is *identical*
> across environments and that bundle was exercised 10/10 and 6/6 in dev.
>
> *Slice 1 (the fix).* `pnpm verify` green, 12 new framework tests, domain
> `check.sh` 61/61 (was 54), migration `003` applied to the dev Supabase via MCP,
> and 10/10 assertions driving the real dev API with genuine Supabase logins —
> request goes `pending → fulfilled`, link records `origin=evidence_request`, and
> the uploads-panel path (which bypasses the framework's HTTP layer) resolves too.
> Verified again by the founder in the browser: answered requests resolved, the
> unanswered one stayed open. The five UI gaps that test exposed are filed as
> `FB-13`…`FB-18` in the domain backlog — none is a regression.
>
> *Slice 2 (the signal).* `inadequateEvidenceRefs` on the contract, the Postgres
> mapping (empty column ⇄ absent field), `POST /reviews` refusing stray refs with
> a 400, the domain's ask-route promoting a request to `kind: 'retake'` when refs
> are present with its own validation (it writes straight to storage), and the
> reviewer UI: an "isso não responde" toggle on each evidence item in both
> galleries, feeding a re-ask that says how many items it condemns. Domain
> `check.sh` 65/65, and 6/6 against dev — a plain ask stays `additional` with no
> refs, a re-ask becomes `retake` and its refs survive the round-trip, and refs
> from outside the demanda are refused.
>
> **Prod deliberately untouched**: it holds exactly one `evidence_request` and it
> is the stuck one, so the migration there will clear precisely the card that was
> reported. Prod needs migration `003` **and** a server+app deploy.

> Fixes the reported defect ("a request never leaves `pending`", filed as BUG-01
> in the domain backlog) and, in the same pass, records the one thing a
> re-request teaches: that the first answer was not good enough. Model settled in
> a design session on 2026-08-05; every line below traces to a decision recorded
> in "The model" — no open questions remain before coding.

## The model (decided, do not relitigate)

1. **Optimistic resolution.** A request is presumed satisfied once answered. The
   requester's only recourse is to **ask again**; there is no "reject" verb and
   no fourth status. `status` stays `pending | fulfilled | skipped`.
2. **`status` records what the capturer did**, never the analyzer's opinion of
   the answer's quality. (`skipped` is already a capturer action — an analyzer
   would never skip its own request. That asymmetry is what settles the reading.)
3. **Quality judgment rides `kind: 'retake'`,** which has always meant "the
   capture was inadequate". A re-request is a *new* request of that kind,
   pointing at the evidence that failed it.

Consequences accepted knowingly: a request answered badly still shows as
`fulfilled` (the recourse is a re-request), and two analyzers asking about the
same step are both resolved by one answer (leaving one pending would resurrect
the ghost card, which is indistinguishable from the bug).

## Resolution rule

> Evidence linked to a request's assessment at `stepId === request.stepSpec.id`
> resolves it. `status: 'done'` → `fulfilled`; `status: 'skipped'` → `skipped`.
> Applies to **every** `pending` request matching that assessment+step. Never
> rewrites a request that already left `pending` (idempotent).

A **skip is a resolution** — requests are always skippable (`domain-model.md` §4;
`GuidedCapture.tsx:109` forces it for `origin === 'evidence_request'`), and the
card must disappear either way: the capturer must never be shown a request they
have already acted on.

## Why the rule cannot live in the storage adapter

Considered and rejected — *not* on ADR grounds (the rule carries no domain
vocabulary and would pass the layering lint; `@assessment-kit/core` is full of framework
business rules and that is where they belong):

- **A skip writes nothing.** `skipStep` sends `PATCH /progress` with
  `status: 'skipped'` and no payload, so no link is created. A hook inside
  `linkToAssessment` cannot see half the rule.
- **A port has many implementations.** Postgres plus the in-memory fakes the
  whole `@assessment-kit/core` suite runs against; the rule would be written twice and
  drift, and every future adapter would inherit the obligation.
- **Bulk relinking.** Hosts that merge one assessment's links into another would
  resolve requests as an invisible side effect.

## Framework changes

**1. `packages/types/src/index.ts`** — one additive optional field:

```ts
export interface EvidenceRequest {
  // ...existing fields, status unchanged...
  /** Evidence that failed to answer this request — set when an analyzer
   *  re-asks (kind: 'retake'). The learning signal: a human judged these
   *  inadequate *for this question*. Never a global verdict on the evidence. */
  inadequateEvidenceRefs?: string[];
}
```

Named `inadequate…Refs`, not `rejected…`, because it describes the evidence's
relation to *this one request*. Mirrors `Finding.evidenceRefs` — the existing
precedent for "an interpretation pointing at evidence".

**2. `packages/core/src/evidenceRequests.ts`** (new) — the shared rule:

```ts
/** Resolves every pending request whose stepSpec.id matches. Idempotent.
 *  Returns the ids resolved (a seam for the notification event, later). */
export async function resolveRequestsForStep(
  repo: EvidenceRequestRepository,
  input: { assessmentId: string; stepId: string; outcome: 'done' | 'skipped' },
): Promise<string[]>
```

Exported from the package root so a host that writes evidence without going
through the HTTP API can call it — that path exists today and is why the rule is
not inlined into the route handlers.

**3. `packages/core/src/http/app.ts`** — two call sites:
- `PATCH /assessments/:id/progress`, after the link/progress write, with
  `outcome` taken from the request body's `status`.
- `POST /assessments/:id/evidence-links`, with `outcome: 'done'` — attaching
  an existing item from the subject's evidence library is a legitimate answer.
- `POST /reviews/:assessmentId`: validate `inadequateEvidenceRefs` against
  `deps.evidence.findByAssessment(assessmentId)` → `400` on refs that point
  outside the assessment. (Hosts creating requests straight through the
  repository own that check themselves; note it in the port's doc comment.)

**4. `packages/storage-postgres/schema/003_evidence_request_resolution.sql`**:

```sql
-- Column follows the id-reference-list convention (text[], cf. findings.evidence_refs).
ALTER TABLE evidence_requests
  ADD COLUMN inadequate_evidence_refs text[] NOT NULL DEFAULT '{}';

-- One-off backfill: requests answered before the resolution rule existed are
-- stuck 'pending'. Conservative — only requests that provably have an answer.
-- Skips left no trace anywhere and are unrecoverable; they stay 'pending' and
-- can be skipped again.
UPDATE evidence_requests er
   SET status = 'fulfilled'
 WHERE er.status = 'pending'
   AND EXISTS (SELECT 1 FROM assessment_evidence ae
                WHERE ae.assessment_id = er.assessment_id
                  AND ae.step_id = er.step_spec->>'id');
```

The backfill marks past bad answers `fulfilled` too. Nothing can distinguish
good from bad retroactively; consistent with the optimistic model.

**5. `packages/storage-postgres/src/evidenceRequestRepository.ts`** — map the
new column in both directions; `undefined` ⇄ `'{}'`.

**6. `packages/capture-web/src/hooks/useAssessment.ts`** — `seenRequestIds`
(`:248`) currently *is* the deduplicator, because `status` never moved; it dies
on reload, so an answered request comes back as a fresh step. With `status` real,
the server-side filter becomes the primary mechanism. Keep the set as a
same-session guard against a poll race adding one step twice, and say so in a
comment — its role changes from mechanism to belt-and-braces.

**7. Adjacent, include or drop (flagged, not decided):** `PATCH /progress`
hardcodes `origin: 'protocol_step'` on the link even when the evidence answers a
request, though `domain-model.md` §3 defines `origin: 'evidence_request'` for
exactly this. The resolution code knows which case it is at that moment, so
setting it correctly is nearly free. Small correctness win; adds a second
behaviour change to a bugfix. Drop it if you want the diff surgical.

**8. Docs** — `domain-model.md` §EvidenceRequest gains the resolution rule and
the optimistic semantics; `guidance-loop.md` renumbers its planned migrations
003/004 → 004/005 and notes that `retake` + `inadequateEvidenceRefs` is a
*second, separate* signal (capture quality) beside its own (guide gaps), so its
"quality retakes never count" line stays true for gap aggregation only.

## Domain-side work (other repo, listed for coordination)

- One line in the direct-storage attach path: call `resolveRequestsForStep`
  after linking, so answering with an item from the uploads panel resolves too.
  Without it, one of the three ways to answer keeps the ghost card.
- The ask-for-more route accepts `kind` and `inadequateEvidenceRefs`.
- Reviewer UI: **"this doesn't answer it" next to a specific evidence item**
  opens the ask form with that item preselected and others tickable. The plain
  ask-for-more button stays as it is, producing a request with no refs — which
  is what happens when there is nothing to point at (the question was skipped or
  ignored). Which button was used tells you which case occurred.
- Capturer UI needs no change: it already filters `status === 'pending'`, so the
  card disappears the moment the rule lands.

## Order of work (two shippable slices)

**Slice 1 — the fix.** Items 2, 3 (first two call sites), 4 (backfill only), 6 +
the domain's one-line call. Closes the reported defect on all three answer paths.
**Slice 2 — the signal.** Items 1, 3 (validation), 4 (column), 5 + the domain's
re-ask UI. Lands with slice 1 rather than later because an unrecorded
re-request is a training example that cannot be reconstructed.

## Verification

- `pnpm verify` green in the framework; unit tests for `resolveRequestsForStep`
  against the in-memory repos (done/skip/idempotent/multi-request/no-match), and
  supertest coverage on all three HTTP answer paths.
- Migration applied to the CI Postgres service container; a test asserts the
  backfill flips an answered-but-pending row and leaves an unanswered one alone.
- Driven in a real browser against the running app: answer by photo, by text, and
  by library attach → the card disappears in all three; reload does not
  resurrect it; a re-ask records the evidence it rejected.
- Migrations reach dev before prod.

## Out of scope, filed as backlog items

- **The requester is never told his question was answered.** He finds out by
  looking. Wants the event-boundary pattern (`FulfillmentRequestedEvent`,
  `capture-web`'s `onEvent`) plus a notification decision — email? in-app? —
  that has not been made. Deliberately not bundled: the fix should not grow a
  state-machine change.
- **`maxRefinementRounds` never binds on branch assessments.** The counter only
  moves on re-submission (`app.ts:375`), and branch assessments are created
  directly in `awaiting_evidence` and never submitted — so the orchestrator,
  the only reader of the budget, never runs on them. An analyzer can therefore
  ask a capturer for more information an unlimited number of times. Pre-existing,
  unchanged by this work, and a product decision (how often may a reviewer
  press a user?) rather than a bugfix.
- Aggregation, dashboard and dataset export for the re-request signal — later,
  alongside the `guidance-loop.md` phases.

---

# Guidance loop (analyzer evidence-requests → protocol improvement) — DESIGNED 2026-07-18

> Full design in `docs/guidance-loop.md`. Turns the signal the framework already
> persists — analyzers issuing `EvidenceRequest`s (`kind: 'additional'`) because
> the guide didn't capture what they needed — into ranked, curator-reviewable
> suggestions to improve the protocol. Domain-neutral; passes the ADR-006 lint.
>
> Framework surface (small): one **optional** field `EvidenceRequest.gap`
> (`{ topic, anchorStepId?, suggestedCaptureType? }` — a stable aggregation key,
> like `CodedStatement.code`); a `GuidanceGapRepository` read-model port
> (`aggregate` over `evidence_requests⋈assessments`, plus disposition get/set);
> two routes (`GET /protocols/:id/guidance-gaps`, `PUT …/:topic/disposition`);
> and a `GuidanceGapActionedEvent` boundary (framework STOPS — never edits YAML,
> cf. `FulfillmentRequestedEvent`). Postgres migrations 003 (gap columns) + 004
> (dispositions). Raw evidence-requests stay the source of truth; a gap is
> computed on read, so nothing to keep in sync — the only new persisted state is
> the curator's decision.
>
> The dashboard + the apply-to-catalog step live in the **domain** (like the
> review UI): the event auto-drafts a `catalogo_propostas` row into the
> especialista/admin curation that already ships. Phased: (1) contract+capture,
> (2) aggregation+read API/dashboard, (3) disposition+event/loop-close.
> Reuses `EvidenceRequest`, the event-boundary pattern, and the existing
> proposals dashboard — adds one field, one port, two endpoints, one event.

---

# Review loop (Wizard-of-Oz UI) — DONE 2026-07-09

> Delivered right after capture-web, with a scope decision by the user: **the
> review UI lives in the domain repo** (`../nativa/app`) as the first
> real Nativa app — two views, comerciante (capture) and fornecedor (review) —
> instead of a framework-side generic review app. The framework contributed
> only generic surfaces, keeping layers decoupled:
>
> - `AssessmentRepository.findByState` + `GET /assessments?state=review`
>   (work-queue listing), `GET /assessments/:id/evidence` (evidence + link
>   metadata), `AssessmentApiClient.listAssessments/getAssessmentEvidence/submitReview`.
> - `apps/reference` accepts `PROTOCOLS_DIR` (colon-separated) so any vertical
>   serves its own protocol YAML through the same composition root — no fork.
> - Domain repo: first real protocol (`vistoria-imovel-comercial`, PT-BR,
>   schema-validated) + `app/` (Vite, hash-routed two views, `link:` deps on
>   the framework as the sanctioned pre-publish interim per ADR-006).
>
> Verified end-to-end through the SDK surfaces the views use: capture →
> fornecedor queue → evidence request → comerciante answers → final findings
> → `completed` (refinement round 1). ADR-006 acceptance test held: zero
> framework `packages/*` edits were domain-specific.
>
> Next per CLAUDE.md: solution-first script composition, then the item-5 list
> (conditions/recommendations persistence, fulfillment events, telemetry seam).

---

# @assessment-kit/capture-web — the React capture SDK

> **STATUS: DONE (2026-07-09).** Everything below is implemented and verified:
> backend gaps (§1), the SDK (§2), `apps/capture-demo` (§3), git init + private
> remotes + layering lint (§4), all verification steps (55 tests green, SDK-level
> e2e with byte-identical blob round-trip, lint passing). Deviations from plan:
> overlay SVG rendering is a `data-overlay` hook not yet an inline render;
> getUserMedia HUD deferred (file-input capture first, as planned); request-body
> validation still missing (400s arrive as 500s — noted in backlog). Next task
> per CLAUDE.md: the human review UI.

## Context

Build-order item 3 and CLAUDE.md's "immediate next task": `@assessment-kit/capture-web`
is the last empty-stub layer between "backend works" and a clickable POC. The
backend it talks to is real: `apps/reference` wires `@assessment-kit/core`'s HTTP API +
`@assessment-kit/storage-postgres` + `HumanAnalyzer` on port 3002, end-to-end tested
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
  `@assessment-kit/capture-web` depends only on `@assessment-kit/types` (plus React as a peer).
  It must not import `@assessment-kit/core` (it talks to it over HTTP) and must not know
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

## 1. Backend gaps capture-web exposes (fix in @assessment-kit/core first, small)

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
  `@assessment-kit/forms-web` remains the future home for full form rendering.
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
§0) actually guards changes. (Also the moment for the assessment-kit→real-name rename
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
`@assessment-kit/types`, `packages/storage-postgres` (10 repositories + FsBlobStore with
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
