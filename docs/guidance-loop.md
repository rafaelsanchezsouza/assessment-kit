# Guidance Loop — analyzer evidence-requests → protocol improvement

> Design doc (2026-07-18). Domain-neutral, framework-side. Closes the parked
> open question in `domain-model.md §7` about turning analyzer feedback into
> guide improvements. Companion to `domain-model.md` (entities) and `adr.md`.

## The loop, in one sentence

When an **analyzer** repeatedly has to ask for information the protocol didn't
capture, that is evidence the **protocol** (the guide) is missing a step — the
framework aggregates those asks and hands ranked suggestions to whoever curates
the protocol. Applying the change stays human/git (knowledge-as-data).

### Roles (framework term ← first vertical, "Nativa")

| Framework (neutral)              | Nativa        | Does                                             |
| -------------------------------- | ------------- | ----------------------------------------------- |
| Protocol author / **curator**    | especialista  | Defines the guide; reviews improvement signals  |
| Capturer (subject owner)         | comerciante   | Follows the guide, captures evidence            |
| **Analyzer** (human or AI)       | fornecedor    | Reviews evidence, **asks for more information**  |

The analyzer's "ask for more information" is already a first-class thing in the
model: an **`EvidenceRequest`** (`kind: 'additional'`). We are not inventing a
new capture path — we are **mining a signal the framework already persists**.

## Why this belongs in the framework (ADR-006)

Aggregating *how often* analyzers request evidence the guide didn't ask for,
grouped by protocol and topic, is a statement about **protocol structure and
process**, not about domain semantics. Every identifier here is neutral
(`GuidanceGap`, `topic`, `disposition`, `curator`). What stays private in the
vertical: the *meaning* of a topic, the decision to act, and the actual edit to
the catalog/protocol YAML. So the engine can host the aggregation and the
dashboard API; the vertical owns the vocabulary and the application. Passes the
layering lint.

This mirrors two patterns the framework already has:
- **Analyzer emits findings + evidenceRequests** → we reuse `evidenceRequests`.
- **`FulfillmentRequestedEvent`** (framework stops at the boundary) → we add
  `GuidanceGapActionedEvent` as another event boundary; the vertical decides
  what "apply this suggestion" means.

## Signal: tag the ask so identical asks roll up

`EvidenceRequest.reason` is free text — unusable as an aggregation key. We add a
small, **optional** structured tag so repeated asks about the same missing thing
group together. Same philosophy as `CodedStatement.code`: a machine key chosen
in the vertical, alongside the human text.

```ts
// @gaf/types — additive, backward compatible
export interface GuidanceGapSignal {
  /** Stable slug so repeated asks about the same gap roll up. Vertical-owned
   *  vocabulary (like CodedStatement.code). e.g. "water-meter-photo". */
  topic: string;
  /** Protocol step this gap hangs off, if any; absent ⇒ a proposed NEW step. */
  anchorStepId?: string;
  /** What kind of evidence would fill it — hint for the drafted step. */
  suggestedCaptureType?: CaptureType;
}

export interface EvidenceRequest {
  // ...existing fields...
  /** Present ⇒ this ask is also a learning signal about the guide. Absent ⇒
   *  an ordinary one-off refinement (today's behavior, unchanged). */
  gap?: GuidanceGapSignal;
}
```

Only `kind: 'additional'` requests carry a `gap`. `retake` requests are about
capture *quality* (blurry photo), not guide gaps, and never count.

An analyzer that tags nothing produces zero learning signal — the feature is
strictly opt-in and cannot regress the existing refinement loop.

## Aggregate: GuidanceGap (a read-model, not a stored materialization)

The raw `evidence_requests` remain the single source of truth. A gap is computed
on read (always fresh), so there is nothing to keep in sync. The **only** new
persisted state is the curator's decision.

```ts
export interface GuidanceGap {
  protocolId: string;              // aggregated across versions of one protocol lineage
  topic: string;
  anchorStepId?: string;
  suggestedCaptureType?: CaptureType;
  supportCount: number;            // # of EvidenceRequests rolled up
  distinctAssessments: number;     // # of assessments (dampens one analyst spamming)
  distinctAnalysts: number;        // # of requesting analyzers
  protocolVersions: string[];      // which versions the asks spanned
  sampleReasons: string[];         // a few verbatim reasons, for the curator
  firstSeen: string;
  lastSeen: string;
  disposition: GuidanceGapDisposition; // triage state (default { status: 'open' })
}

export type GuidanceGapStatus = 'open' | 'acknowledged' | 'actioned' | 'dismissed';

export interface GuidanceGapDisposition {
  protocolId: string;
  topic: string;
  status: GuidanceGapStatus;
  note?: string;
  decidedBy: { id: string; version?: string };
  decidedAt: string;
}
```

## Storage port + reference adapter

```ts
// @gaf/types — new port
export interface GuidanceGapRepository {
  /** GROUP BY over evidence_requests⋈assessments; ranked by support desc. */
  aggregate(protocolId: string, opts?: { minSupport?: number; status?: GuidanceGapStatus }): Promise<GuidanceGap[]>;
  getDisposition(protocolId: string, topic: string): Promise<GuidanceGapDisposition | null>;
  setDisposition(d: GuidanceGapDisposition): Promise<void>;
}
```

Postgres (`@gaf/storage-postgres`):
- **Migration `004_evidence_request_gap.sql`** — add nullable columns to
  `evidence_requests`: `gap_topic text`, `gap_anchor_step_id text`,
  `gap_suggested_capture_type text`; partial index
  `WHERE gap_topic IS NOT NULL`. (Columns, not JSONB — cheap GROUP BY / index.)
- **Migration `005_guidance_gap_dispositions.sql`** —
  `guidance_gap_dispositions (protocol_id text, topic text, status text,
  note text, decided_by_id text, decided_by_version text, decided_at timestamptz,
  PRIMARY KEY (protocol_id, topic))`.
- `aggregate()` = `SELECT protocol_id, gap_topic, ... , count(*) support,
  count(DISTINCT assessment_id) ...` from `evidence_requests er JOIN assessments a
  ON a.id = er.assessment_id` `WHERE a.protocol_id = $1 AND er.gap_topic IS NOT
  NULL AND er.kind='additional'` `GROUP BY protocol_id, gap_topic, ...`
  `LEFT JOIN guidance_gap_dispositions` for status; `HAVING count(*) >=
  minSupport`.

## Core service + HTTP API

`packages/core`: a thin `GuidanceGapService` over the port, plus routes on the
existing Express app:

- `GET /protocols/:id/guidance-gaps?minSupport=&status=` → ranked gaps. **This
  is the dashboard's data source.**
- `PUT /protocols/:id/guidance-gaps/:topic/disposition` `{ status, note }` →
  curator triage. Guarded by the `Authorizer` port (a `curate-protocol`
  capability; the vertical maps it to its curator role).
- Drill-down reuses the existing `GET /assessments/:id/evidence-requests`.

When a disposition is set to **`actioned`**, the service emits:

```ts
// @gaf/types — event boundary, framework STOPS here (cf. FulfillmentRequestedEvent)
export interface GuidanceGapActionedEvent {
  type: 'guidance.gap.actioned';
  protocolId: string;
  topic: string;
  anchorStepId?: string;
  suggestedCaptureType?: CaptureType;
  supportCount: number;
  actionedBy: { id: string };
}
```

The framework never touches protocol/catalog YAML. The vertical subscribes and
decides what "apply" means.

## Where the dashboard and the application live (the vertical)

Per the item-4 decision (review UI lives in the domain — less abstraction), the
framework ships only the generic surfaces above. In Nativa:

1. **Capture the signal** — the fornecedor's "pedir mais informação" UI gains a
   topic picker (a short curated list per solution + free entry) → the
   `EvidenceRequest` it already posts now carries `gap`.
2. **The dashboard** — the especialista/admin view lists gaps from
   `GET /protocols/:id/guidance-gaps` ("14 fornecedores em 9 vistorias de
   captação pediram *foto do medidor de água* — considere adicionar este
   passo"), with acknowledge / action / dismiss buttons → the disposition PUT.
   Reuses the existing `AdminView` proposals layout.
3. **Close the loop** — `GuidanceGapActionedEvent` → auto-draft a
   `catalogo_propostas` row (pre-filled from the gap) → it flows into the
   especialista proposal curation that already exists → human applies to the
   catalog YAML → CI validates → redeploy recomposes protocols. The guide
   improves; the next comerciante captures the new step.

So the loop reuses: `EvidenceRequest`, the event-boundary pattern, `catalogo_propostas`,
and the admin curation dashboard already shipped. The framework adds one optional
field, one read-model port, two endpoints, one event.

## Build order (phased, each independently shippable)

1. **Contract + capture** — `gap?` on `EvidenceRequest`/`AnalyzerOutput` plumbing;
   migration 003; domain topic picker. Signals start accumulating. Lowest risk.
2. **Aggregation + read API** — `GuidanceGapRepository.aggregate` +
   `GET …/guidance-gaps`; domain renders the read-only ranked dashboard.
   Delivers visible value with no write path.
3. **Disposition + event** — migration 004; disposition PUT;
   `GuidanceGapActionedEvent`; domain wires it to a `catalogo_propostas` draft.
   Closes the loop.

## Open questions (parked)

- **Topic vocabulary governance** — free slug (easy, drifts) vs. a curated list
  the curator maintains (clean aggregation, more upkeep). Start free, promote to
  a per-solution suggested list once patterns emerge.
- **Support threshold** — what `minSupport` / distinct-assessment floor makes a
  gap worth surfacing. Tune from real data; default `minSupport=3`, dedup by
  assessment.
- **AI analyzers** — once an AI analyzer exists, its `additional` requests feed
  the same loop for free; may need a confidence/weight so a noisy model doesn't
  dominate the ranking.
- **Retake vs. additional** — confirmed: only `additional` + an explicit `gap`
  tag counts; quality retakes never do. Since 2026-08-05 those retakes are not
  discarded, they simply feed a *different* loop: a re-request carries
  `inadequateEvidenceRefs` (the evidence a human judged insufficient **for that
  question**), which is the capture-quality signal. Two axes, one entity — this
  doc's aggregation stays about guide gaps only. Migrations renumbered
  (003 is `evidence_request_resolution`).
