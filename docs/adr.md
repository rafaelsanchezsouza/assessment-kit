# Architecture Decision Records — assessment-kit

Lightweight ADRs. Each records a decision, its context, and the alternatives rejected,
so future contributors understand *why*, not just *what*. Newest concerns first.
The domain model (entities, relationships) lives in `docs/domain-model.md`.

---

## ADR-001 — TypeScript end-to-end, pnpm + turborepo monorepo

**Status:** accepted

**Context.** The system spans a server core (protocol interpreter, orchestrator,
state machine) and browser clients (guided capture SDK, questionnaire renderer,
reference app). The shared domain contracts must stay identical across both.

**Decision.** TypeScript for every package. Monorepo managed with pnpm workspaces +
turborepo. `@assessment-kit/types` is the single source of contracts, depended on by all packages
and having zero runtime dependencies itself.

**Rejected.**
- *Python/FastAPI core (the author's strongest stack).* Would split the codebase across
  two languages and duplicate the type contracts; the client SDK is unavoidably TS.
- *Elixir/Phoenix.* Best technical fit for long-lived human-in-the-loop orchestration,
  but a much smaller contributor pool for an OSS project and a second nontrivial language.
- *Go.* Great for a self-hosted single binary, but heavy JSON/schema-driven work (the
  core of this system) is more ceremony than in TS.

**Consequence.** Analyzers run out-of-process behind a contract, so the core needs no
ML libraries — neutralising Python's main advantage. Contributor onboarding and
end-to-end type safety win.

---

## ADR-002 — Storage: ports & adapters; Postgres + S3 reference; Supabase for Nativa

**Status:** accepted

**Context.** The domain is a relational chain (Subject → Assessment → Evidence →
Finding → Condition → Recommendation → OutcomeRecord) with provenance links and
deliberate longitudinal/cross-entity queries. Parts of the data are schema-flexible
(protocol documents, captureSpec, finding params, fulfillmentPayload). Evidence
includes large binaries (photos, PDFs). The framework is open source and must be
self-hostable.

**Decision.**
- The framework defines **storage ports**: a `Repository` interface per aggregate and
  a `BlobStore` interface for evidence payloads. Adapters ship as packages, mirroring
  the analyzer plugin pattern.
- **Reference adapter:** PostgreSQL (relational chain in tables; JSONB columns for the
  flexible parts) + any S3-compatible object store for blobs (AWS S3 / Cloudflare R2 /
  MinIO for fully self-hosted). Blob keys live in Postgres; blobs never do.
- **Nativa product:** Supabase — Postgres underneath, so the reference adapter works
  unchanged; São Paulo region for LGPD; built-in auth, storage, row-level security;
  exit is `pg_dump`, not a rewrite.

**Rejected.**
- *Firebase/Firestore.* Document store — the relational joins and longitudinal queries
  become client-side gymnastics or denormalization debt; and a proprietary Google
  service as the reference store undermines the OSS self-hosting story. (Firebase-style
  DX is recovered via Supabase without the lock-in.)

**Consequence.** OSS framework and the product exercise the same Postgres adapter.
LGPD obligations (encryption at rest, cascading deletion of blobs, consent recorded
alongside evidence) are adapter/schema responsibilities — see parked question in
domain-model §7.

---

## ADR-003 — Protocols & catalogs are schema-validated data, not code

**Status:** accepted

**Context.** Launching a new vertical must not require engine changes. Protocols and
solution catalogs are authored by domain experts, not only engineers, and can contain
structural errors.

**Decision.** Protocols (and solution-first catalogs) are YAML, validated against a
JSON Schema (`packages/protocol-tools/schema/`), compiled and validated in CI, and
published as versioned artifacts. Referential checks beyond the schema (unique step
ids, branch targets exist, assets present) run in the validator CLI. Private vertical
content flows through the same public pipeline.

**Rejected.**
- *XLSForm / ODK spec.* A mature form DSL, but form-centric assumptions fight the
  additions this framework needs (capture overlays, analyzer routing, refinement
  policy, solution composition). Borrow the "schema-validated data" philosophy, not
  the format.

**Consequence.** The engine treats protocols the way a compiler treats source. The
schema currently covers linear protocols; it must be extended to cover solution-first
catalogs (Solution.evidenceRequirements + composition) — first item on the build order.

---

## ADR-004 — Fulfillment is an event boundary; the framework never implements commerce

**Status:** accepted

**Context.** Verticals fulfill solutions very differently (buy a product, book a
professional, follow instructions). Commerce is commodity and heavy.

**Decision.** When a recommendation is accepted, the framework emits a
`FulfillmentRequestedEvent` and stops. Marketplaces, booking, e-commerce and
instruction delivery are per-vertical implementations subscribing to that event
(Medusa/Sharetribe territory for Nativa). The framework ships the event interface and
a no-op reference handler only.

**Consequence.** Keeps the OSS repo a focused assessment engine, not a half-finished
marketplace starter. Nativa's marketplace lives in its private repo.

---

## ADR-005 — One analyzer contract for humans and AI; async-first orchestration

**Status:** accepted

**Context.** v1's only analyzer is a human expert (an architect / NBS specialist) who
responds in hours or days. AI analyzers (CV, LLM) arrive later.

**Decision.** Human and AI analyzers implement the same `Analyzer` contract
(input: assessment + evidence; output: findings + evidenceRequests). Orchestration is
async-first. Compliance/quality checking is just another analyzer *kind*; photo-retake
requests ride the same EvidenceRequest mechanism as refinement.

**Consequence.** v1 ships Wizard-of-Oz with only the human analyzer; AI slots into the
identical seam with no architectural change. Client does cheap on-device physics
(Laplacian blur, orientation, resolution); semantic checks are server-side analyzers.

---

## ADR-006 — Two repositories: public framework, private domain layer

**Status:** accepted

**Context.** The open-core split (framework OSS, knowledge-as-data private) needs a
repository topology. Git history is permanent: any domain content ever committed to
the framework repo would ship in its public history at publish time, or force an
error-prone history rewrite. The framework repo has not been `git init`-ed yet, so
the split costs nothing today and only gets more expensive.

**Decision.**
- **Two repos.** This repo is the framework, destined for publication: `packages/*`,
  `apps/reference`, the capture demo app, neutral demo protocols, and
  `catalog/nbs-paraiba.yaml` strictly as illustrative demo data. The **private Nativa
  repo** is the domain layer: real protocols/catalogs with the evidence base,
  finding→condition rules, models/prompts, the Nativa application (marketplace,
  demanda state machine, chat, payments — everything past `FulfillmentRequestedEvent`),
  deploy config and secrets.
- Repos enforce **visibility**; packages and dependency direction enforce **layering**.
  These are different concerns — the repo split does not replace the in-repo rules
  (domain-neutral vocabulary in `packages/*`, domain knowledge arrives only as data).
- **Consumption mechanism:** the private repo consumes `@assessment-kit/*` as versioned npm
  dependencies (after the rename, decision on publish). Until first publish, local
  side-by-side clones with `pnpm link`/`file:` overrides for iteration — but only
  registry versions are ever committed. Development may span both repos in one
  working session; the boundary is enforced by CI, not by ceremony.
- **Guardrails:** framework CI greps `packages/` for domain identifiers
  (`nativa|nbs|paraiba`) and fails on a match; the private repo's CI validates its
  real protocols/catalogs with the published `assessment-protocols validate` CLI — the JSON
  Schemas are the inter-repo contract and this is its integration test. Acceptance
  test of the boundary: standing up the Nativa app requires zero edits to `packages/*`;
  when it does, that is a framework bug to fix upstream, never a private patch.

**Rejected.**
- *Single monorepo, split before publishing.* One careless commit puts the moat into
  public history; the "we'll strip it later" plan fails exactly once and permanently.
- *Git submodules.* Inverts the dependency into source-level coupling and adds clone/
  update friction for every OSS contributor; npm versioning is the boundary we want to
  dogfood anyway.
- *Private package registry as the primary mechanism.* GitHub Packages under a private
  scope is acceptable as an interim before first public publish, but the target state
  is public npm — the private repo should experience the framework exactly as an OSS
  consumer would.

**Consequence.** The framework repo's history is publishable from its first commit.
The private repo becomes the first true test of the framework's agnosticism: it can
only compose, configure, and supply data.

---

## Decisions still open

Tracked in `docs/domain-model.md` §7: multi-analyzer conflict resolution; LGPD
consent/deletion model; `plan` composite fulfillment; triggered assessments; the real
project/product name — **settled 2026-08-05: `assessment-kit`**, scope
`@assessment-kit/*`, schema `$id`s on the repo's GitHub Pages.
