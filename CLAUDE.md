# CLAUDE.md — Project handover: Guided Assessment Framework (GAF)

> Handover from a design session (July 2026). Read this fully before making changes.
> Companion docs in `docs/`:
> - `domain-model.md` — the entity/relationship constitution (domain-neutral)
> - `adr.md` — architecture decisions + rejected alternatives (stack, storage, boundaries)
> - `architecture.mermaid` — the layered open/closed architecture diagram
> - `research/monkjs-deep-dive.md` — prior-art study of the closest existing SDK
>
> Private knowledge-layer material that does NOT belong in this repo: the full NBS
> evidence base with scientific citations (the 14 solutions and their sources) lives in
> the private Nativa repo alongside the real catalog. `catalog/nbs-paraiba.yaml` here is
> only illustrative demo content.

## What this project is

An **open-source framework for guided visual assessment applications**: a user captures
evidence about a subject (photos, questionnaires, documents) following a declarative
protocol; pluggable analyzers (human experts or AI) emit findings; findings become
conditions; conditions map to solutions from a catalog; solutions are fulfilled by
products, professionals, or the user's own actions. Reference analogy: car-insurance
photo inspection, generalized to any domain.

**Open-core split (strategic, non-negotiable):** the framework (engine, schemas,
capture SDK, analyzer interfaces) is open source. Protocols, trained models,
finding→condition rules, solution catalogs and mappings are private vertical content —
the moat is knowledge-as-data, not engine code.

**First vertical (private, "Nativa"):** marketplace connecting business/home owners in
Paraíba, Brazil to nature-based-solutions (NBS) professionals. Second candidate vertical:
skincare. A personal-health scenario was used as a stress test only (regulatory-heavy,
not a target).

## Key decisions already made (do not relitigate casually)

1. **TypeScript end-to-end.** pnpm + turborepo monorepo. Rationale: one language, the
   `@gaf/types` package is the single contract, largest OSS contributor pool.
2. **Domain chain:** Evidence → Finding → Condition → Recommendation → Solution.
   Findings are atomic facts; Conditions are interpretations; Recommendation is a
   first-class link object with rationale + provenance. See docs/domain-model.md.
3. **Evidence types:** `image | structured_input | document`. Evidence is **owned by
   the Subject**, referenced by Assessments (AssessmentEvidence link). Enables reuse,
   bulk import, longitudinal queries.
4. **Human and AI analyzers share one contract** (`Analyzer` in @gaf/types). v1 ships
   with ONLY the human analyzer (Wizard-of-Oz). Analyzer output = findings +
   evidenceRequests.
5. **Two feedback loops:** refinement (EvidenceRequest `kind: retake | additional`,
   bounded by protocol policy, always skippable) and re-assessment
   (`priorAssessmentId`, comparison analyzers, OutcomeRecord).
6. **Protocols are data:** YAML validated against JSON Schema
   (`packages/protocol-tools/schema/protocol.schema.json`), compiled in CI, versioned.
   Every assessment records its exact `protocolVersion`. XLSForm was evaluated and
   rejected.
7. **Solution-first assessment (latest evolution):** each Solution declares
   `evidenceRequirements`; the shooting script = thin base module (always captured)
   + union of requirements of selected solutions, deduplicated. Same mapping runs
   backwards later (evidence → conditions → recommended solutions).
8. **Fulfillment is an event boundary.** Framework emits `FulfillmentRequestedEvent`
   and stops. Marketplace (Medusa/Sharetribe territory) lives in private vertical
   repos. Never implement commerce here.
9. **Storage: ports & adapters.** Framework defines Repository + BlobStore interfaces;
   reference adapter = Postgres (JSONB for flexible parts) + S3-compatible blobs.
   For the Nativa product: Supabase (Postgres underneath, São Paulo region, LGPD).
   Firebase was considered and rejected (relational chain + OSS self-hosting story).
10. **Server is source of truth for assessment drafts**; clients keep an offline
    buffer and sync per-step progress (resumability across devices, decided for v1).
11. **Compliance is an analyzer kind**; photo-retake rides the EvidenceRequest loop.
    Client does cheap physics (Laplacian blur, orientation, resolution); semantic
    checks are server-side analyzers.
12. **Vocabulary is domain-neutral** in code/schemas: Assessment, Condition,
    Recommendation — never "diagnosis/treatment". i18n per package from day one
    (EN default, PT-BR complete).
13. `feedsAnalyzers` on ProtocolStep references analyzer **roles**, not concrete ids.
14. `GAF/@gaf` is a **placeholder name** — global rename pending before first publish
    (npm scope, schema $id URLs, repo name).

## Current state of the repo

- `packages/types/src/index.ts` — **complete and compile-checked** (strict). The whole
  domain model as TS contracts. Treat as authoritative; change only with reason.
- `packages/core` — state machine (real, tested) + **Orchestrator with real
  persistence**: role-routes evidence to analyzers by `feedsAnalyzers`, runs them
  async-first, persists `Finding`/`EvidenceRequest` output, and drives
  `analyzing → review? → awaiting_evidence | completed` per domain-model.md §4
  (`runAndPersist`, `packages/core/src/orchestrator.ts`). Plus a real **HTTP API**
  (`packages/core/src/http/app.ts`, Express): subjects, assessments (create/start/
  progress+evidence/submit), `/reviews/:assessmentId` for the human-analyzer loop,
  findings/evidence-requests reads. `deps` is fully interface-typed against
  `@gaf/types` — core never imports `@gaf/storage-postgres` or `@gaf/analyzer-human`
  directly, keeping the ports/adapters boundary real. Tested with in-memory fake
  repos (`packages/core/src/testSupport/inMemoryRepos.ts`) + supertest — no
  Postgres needed to run `@gaf/core`'s own tests.
- `packages/analyzer-human` — **HumanAnalyzer now works** (in-memory pending-review
  queue; `analyze()` resolves when `submitReview()` is called). In-memory only —
  won't survive a restart; a durable queue is a follow-up, not a blocker.
- `packages/storage-postgres` — **real reference storage adapter** (ADR-002):
  Postgres repositories (one per aggregate, `schema/001_init.sql`, plain-SQL
  migration script, no ORM) + a local-filesystem `BlobStore`. Storage port
  interfaces (`SubjectRepository`, `AssessmentRepository`, ..., `BlobStore`) live
  in `@gaf/types`. Local dev: `docker compose -f packages/storage-postgres/docker-compose.yml up -d`
  then `pnpm --filter @gaf/storage-postgres migrate`. Wired into CI (Postgres
  service container).
- `apps/reference` — **the real composition root, no longer a stub**: loads
  `protocols/demo/backyard-quick-check.yaml`, validates it with
  `@gaf/protocol-tools`, wires `@gaf/storage-postgres` + `HumanAnalyzer` +
  `Orchestrator` into `createApp`, listens on port `3002` (local only — not
  deployed to the shared VM). `pnpm --filter @gaf/reference-app build && \
  DATABASE_URL=... node apps/reference/dist/main.js` after the Postgres compose +
  migrate steps above. End-to-end curl-tested against real Postgres: capture →
  submit → human review → `completed`, findings genuinely persisted.
- `packages/protocol-tools` — **real validator CLI** (`gaf-protocols validate <dir...>`,
  ajv 2020-12 + referential checks) and schemas for both linear protocols
  (`protocol.schema.json`) and solution-first catalogs (`catalog.schema.json`).
  `pnpm protocols:validate` checks `protocols/` and `catalog/` and is wired into CI.
- `packages/analyzer`, `analyzer-human`, `capture-web`, `forms-web` — intentional stubs
  with responsibility comments.
- `protocols/demo/backyard-quick-check.yaml` — valid demo protocol.
- `catalog/nbs-paraiba.yaml` — 14 NBS solutions for Paraíba with regional priorities
  (sertão/agreste/litoral), `requires` (evidence requirements), `conditionsAddressed`,
  evidence one-liners. Demo content standing in for the private knowledge layer.
- `apps/prototype/index.html` — v1 prototype (house assessment, EN). Self-contained.
- `apps/prototype/nbs-v2.html` — **v2 prototype (PT-BR, solution-first)**: context →
  region-prioritized catalog picker → composed deduplicated shooting script (each photo
  shows which solutions it feeds) → Laplacian blur check → conditional analyzer-requested
  step → review → JSON manifest. Demonstrates the framework; does NOT import @gaf/*.
  **Deployed** at `http://csaparahyba.com.br:8090/` (shared Oracle VM, no domain/TLS of
  its own yet) — demo link, not the product.
- CI: build + test (incl. a Postgres service container) + protocol validation
  (`.github/workflows/ci.yml`).

## Build order (agreed roadmap)

1. `@gaf/protocol-tools` validator CLI (ajv + referential checks: unique step ids,
   branch targets exist, assets present). Extend the schema to cover solution-first
   catalogs (Solution.evidenceRequirements + composition rules) — the schema currently
   covers linear protocols only.
2. `@gaf/core`: state machine + persistence + HTTP API. **Done**: storage ports,
   Postgres adapter, Orchestrator persistence/role-routing, the HTTP API itself,
   and `apps/reference` running it end-to-end against real Postgres. Draft-sync
   (per-step resumability across devices) isn't separately built yet — today's
   `PATCH .../progress` is single-shot, not conflict-aware multi-device sync.
3. `@gaf/capture-web`: port the prototype's patterns (guided HUD, blur check, upload
   queue with retry, resumable local buffer). Still an empty stub — this is the
   **real React frontend** and the next actual blocker; `apps/prototype/*.html`
   are throwaway demos, not it. It now has a real backend to talk to
   (`apps/reference`'s API — see above).
4. `@gaf/analyzer-human` has a minimal working loop (in-memory, no UI yet) — a
   real review UI is still needed for the full Wizard-of-Oz experience.
5. Then: conditions/recommendations persistence, fulfillment event bus, first AI
   analyzer (Condition derivation is deliberately NOT in the Orchestrator — it's
   private vertical content per docs/domain-model.md §6; it'll plug in later as
   another `rule`-kind analyzer through the same orchestrator seam).

Immediate next task: **`@gaf/capture-web`** — the React capture SDK. It's the
last empty-stub layer between "backend works" and an actual clickable POC.

## Open questions (parked, see docs/domain-model.md §7)

- Multi-analyzer conflict resolution (contradictory findings).
- Consent/privacy model for evidence — LGPD; deletion must cascade to blobs; consent
  recorded alongside evidence (column from day one).
- `plan` (composite solution) fulfillment orchestration — schema exists, logic deferred.
- Triggered assessments (new evidence → automatic re-analysis) — not v1.
- Real project/product name.

## Conventions

- Strict TS everywhere; `@gaf/types` has zero runtime dependencies.
- Protocols/catalogs: YAML in repo, schema-validated in CI, never hand-edited JSON.
- Every entity that stores an interpretation carries provenance ({id, version} of
  producer) and confidence where applicable.
- Keep prototype HTML files self-contained and runnable by double-click — they are
  the UX lab, not the product.
