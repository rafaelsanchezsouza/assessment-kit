# Guided Assessment Framework — Domain Model

> Reference document. Vocabulary is deliberately domain-neutral: verticals (renovation, skincare, health) rename concepts in their own UI. Framework code and schemas use only the terms defined here.

## 1. Overview

The framework powers applications where a user performs a **guided assessment** of a **subject** (a storefront, a face, a patient file), the system derives **conditions** from **evidence**, and maps them to **solutions** — fulfilled by products, professionals, or the user's own actions.

```
Subject ──has timeline of──▶ Assessment
Subject ──owns──▶ Evidence library (image | structured_input | document)
Assessment ──follows──▶ Protocol (versioned)
Assessment ──references──▶ Evidence (captured during it, or reused from library)
Evidence ──consumed by──▶ Analyzer (plugin: CV, LLM, human, comparison)
Analyzer ──emits──▶ Finding[] + EvidenceRequest[]
Finding[] ──interpreted into──▶ Condition[]
Condition ──addressed by──▶ Recommendation ──points to──▶ Solution (catalog)
Accepted Solution ──dispatched via──▶ Fulfillment (product | service | self_action | plan)
Applied Solution + later Assessment ──▶ OutcomeRecord (the feedback loop)
```

## 2. Entities

### Subject
The durable, real-world thing being assessed. Owns the assessment timeline.

| Field | Notes |
|---|---|
| `id`, `type` | `type` is vertical-defined (e.g. `storefront`, `face`) |
| `attributes` | Free-form JSON, schema owned by vertical |
| `owner_id` | The end user |

Invariant: **Subject is the durable entity; Assessments are events in its history.**

### Protocol (Assessment Protocol)
Declarative, versioned definition of the guided flow. Data, never code.

| Field | Notes |
|---|---|
| `id`, `version` | Immutable once published; new edits → new version |
| `subject_type` | What it assesses |
| `steps[]` | Ordered `ProtocolStep`s |
| `branching_rules` | Conditional step activation |
| `refinement_policy` | `max_refinement_rounds`, skippability |

### ProtocolStep
| Field | Notes |
|---|---|
| `id`, `title`, `guidance` | Instructions shown to user |
| `capture_type` | `image` \| `structured_input` \| `document` |
| `capture_spec` | Overlay/angle/framing for images; JSON-schema form for structured input; accepted formats for documents |
| `validation_rules` | Client-side checks (blur, framing, required fields) |
| `optional`, `condition` | Branching |

### Assessment
One execution of a protocol against a subject.

| Field | Notes |
|---|---|
| `id`, `subject_id`, `protocol_id`, `protocol_version` | **Version is mandatory** — comparisons break without it |
| `state` | See state machine (§4) |
| `prior_assessment_id?` | Set for re-assessments; enables comparison analyzers |
| `applied_solution_ids?` | Solutions applied since prior assessment |
| `refinement_round` | Bounded by protocol policy |

### Evidence
An atomic captured artifact. **Owned by the Subject, referenced by Assessments** — this enables evidence reuse (last month's photos in a new assessment) and bulk import (a decade of exam PDFs) without an assessment context.

| Field | Notes |
|---|---|
| `id`, `subject_id` | Subject-level ownership |
| `type` | `image` \| `structured_input` \| `document` |
| `payload_ref` | Blob URI (images/documents) or inline JSON (structured) |
| `metadata` | Capture timestamp, device, geolocation, capture params |
| `document_date?` | Date the content refers to, when distinct from capture time (e.g. a 2019 lab report uploaded today) |

Assessments link to evidence via **AssessmentEvidence** `{assessment_id, evidence_id, step_id, origin}`, where `origin` ∈ `protocol_step` \| `evidence_request` \| `library_reuse` and `step_id` may reference a dynamic step from an EvidenceRequest.

Notes:
- `structured_input` = questionnaire answers, already machine-readable.
- `document` = unstructured file (report, PDF); requires an extraction analyzer before semantic analyzers can consume it.
- New types (`audio`, `video`) are additive — no redesign required.

### Analyzer (plugin interface)
Consumes evidence, emits findings. **Human experts and AI models implement the same contract.**

```
analyze(input: {
  assessment: Assessment,
  evidence: Evidence[],
  prior_assessment?: AssessmentSnapshot   // for comparison analyzers
}) -> {
  findings: Finding[],
  evidence_requests: EvidenceRequest[]
}
```

| Registration field | Notes |
|---|---|
| `id`, `kind` | `cv_model` \| `llm` \| `human` \| `rule` \| `extraction` \| `comparison` |
| `consumes` | Evidence types / step IDs it handles |
| `async` | Human analyzers resolve in hours, not ms — orchestration must be async-first |

### Finding
Atomic, factual observation. No interpretation.

| Field | Notes |
|---|---|
| `id`, `assessment_id` | |
| `statement` | Structured: `{code, params}` + human-readable text |
| `evidence_refs[]` | Which evidence supports it (traceability) |
| `confidence` | 0–1, **first-class** — drives refinement requests |
| `effective_date` | When the observation is true of the subject (from `document_date` if present, else capture time). Trends and comparisons MUST use this, never the assessment date |
| `produced_by` | Analyzer id + version (provenance) |

Findings are **queryable at subject level** across all assessments (longitudinal view: "all `{code: glucose}` findings for subject X over time"), not only within one assessment.

### EvidenceRequest
A dynamically generated capture step — "I need more."

| Field | Notes |
|---|---|
| `reason` | Shown to user ("possible moisture in left corner") |
| `step_spec` | Same shape as ProtocolStep — reuses all capture machinery |
| `requested_by` | Analyzer id (human or AI) |
| `status` | `pending` \| `fulfilled` \| `skipped` (always skippable) |

### Condition
Interpreted problem or goal, derived from one or more findings.

| Field | Notes |
|---|---|
| `statement` | `{code, params}` + text |
| `finding_refs[]` | The reasoning chain |
| `severity`, `confidence` | |
| `derived_by` | Rule/model/human + version |

### Solution (catalog entry — content lives in the private layer)
| Field | Notes |
|---|---|
| `id`, `title`, `description` | |
| `fulfillmentType` | `product` \| `service` \| `self_action` \| `plan` |
| `conditionsAddressed[]` | Condition codes this solution resolves |
| `evidenceRequirements[]` | Evidence (step specs) needed to *evaluate feasibility* of this solution — the basis of solution-first assessment (see §2b) |
| `fulfillmentPayload` | SKU / matching criteria / instructions / child solution ids |

`plan` (composite) is **modeled now, implemented later** — schema supports child solutions; orchestration of partial fulfillment is deferred.

## 2b. Solution-first assessment (protocol composition)

Two directions share one Solution↔evidence↔condition mapping:

- **Solution-first (v1):** the user selects solutions of interest → the assessment protocol is *composed*, not hand-authored: a thin **base module** (always captured — cheap, and keeps every assessment comparable for future learning) **+ the union of `evidenceRequirements`** of the selected solutions, **deduplicated** (two solutions needing the same wide shot → captured once, feeds both). Each capture step therefore knows which solutions it serves.
- **Evidence-first (future):** the same mapping runs backwards — captured evidence → detected conditions → solutions whose `conditionsAddressed` match. No second system; the catalog is the bridge both ways.

Consequence for data: because each evidence item records which solutions it feeds, every completed assessment is already a labelled dataset for training the future evidence-first recommender.

Composition inputs may be region- or context-scoped: a vertical's catalog can carry priority orderings (e.g. by sub-region) that rank which solutions to surface first, without changing the composition mechanics.

### Recommendation (first-class link object)
| Field | Notes |
|---|---|
| `assessment_id`, `condition_ids[]`, `solution_id` | |
| `rationale` | Why this solution for these conditions |
| `confidence`, `priority` | |
| `recommended_by` | Analyzer/expert + version — **provenance is moat data** |
| `status` | `proposed` \| `accepted` \| `declined` \| `fulfilled` |

### OutcomeRecord (the feedback loop)
Created when a re-assessment exists for a subject with applied solutions.

| Field | Notes |
|---|---|
| `condition_id`, `solution_id` | What was treated, with what |
| `baseline_assessment_id`, `followup_assessment_id` | |
| `delta_findings[]` | From comparison analyzers |
| `outcome` | `improved` \| `unchanged` \| `worsened` \| `unknown` |

This table is the long-term training dataset for automatic recommendations. It accumulates as a side effect of normal use.

## 3. Fulfillment dispatch (framework boundary)

The framework's responsibility **ends** at: `Recommendation.status = accepted` → emit `FulfillmentRequested {solution, fulfillment_type, subject, user}` event. Marketplaces, booking, e-commerce, and instruction delivery are per-vertical implementations subscribing to that event. The framework ships interfaces and a no-op reference handler only.

## 4. Assessment state machine

```
 draft ──start──▶ capturing ──all required steps done──▶ analyzing
                     ▲                                       │
                     │                    ┌──────────────────┤
                     │                    ▼                  ▼
                     └──user opts in── awaiting_evidence   review (optional,
                        (refinement,      │ user skips /    human analyzer
                         bounded rounds)  │ fulfills        pending)
                                          ▼                  │
                                      analyzing ◀────────────┘ (may loop)
                                          │
                                          ▼
                                     completed ──▶ recommendations issued
 any state ──▶ abandoned
```

Rules:
- `awaiting_evidence` is entered only if analyzers emitted EvidenceRequests **and** `refinement_round < max_refinement_rounds`. Always user-skippable.
- `review` exists whenever a registered human analyzer hasn't resolved; async by design.
- `completed` is terminal for the assessment, but the **subject** continues: a new assessment with `prior_assessment_id` set starts the re-assessment path and activates comparison analyzers.

## 5. Design invariants

1. **Protocols and analyzer registrations are data, not code.** A new vertical = new protocol files + catalog + analyzer plugins. Zero engine changes.
2. **Every assessment records its exact protocol version.**
3. **Human and AI analyzers share one contract.** v1 can ship with only the human plugin.
4. **Every finding/condition/recommendation carries provenance** (who/what produced it, at which version).
5. **Confidence is first-class** on findings and recommendations; it drives refinement.
6. **Refinement is bounded and skippable** — capture fatigue kills completion.
7. **Neutral vocabulary in the framework** (`Assessment`, `Condition`) — never `diagnosis`/`treatment` in code or schemas. Regulated verticals (health) are stress tests for the model, not early targets.
8. **Fulfillment is an event boundary.** The framework never implements commerce.
9. **Evidence belongs to the Subject; assessments only reference it.** Enables reuse, bulk import, and longitudinal analysis.
10. **Time of observation ≠ time of capture.** `effective_date` on findings is authoritative for all trend/delta logic.

## 6. Open-source / proprietary boundary

| Open source (framework repo) | Private (vertical repos) |
|---|---|
| Protocol interpreter, schemas, state machine | Actual protocol files |
| Capture SDK (guided photo, forms, quality checks) | Trained models, LLM prompts |
| Analyzer plugin interface + orchestrator | Analyzer implementations with domain knowledge |
| Generic Finding/Condition/Recommendation schemas | Condition taxonomies, finding→condition rules |
| Fulfillment event interface + no-op handler | Solution catalogs, marketplace, matching logic |
| Reference app with demo protocol | OutcomeRecord datasets |

## 7. Open questions (parked)

> Architecture and technology decisions (stack, storage, deployment, and rejected
> alternatives) live in `docs/adr.md`, not here — this document stays domain-focused
> and implementation-neutral.

- Protocol DSL format: XLSForm subset vs. custom YAML/JSON schema.
- ~~Turning analyzer feedback into guide improvements~~ — **designed**, see
  `docs/guidance-loop.md` (aggregate `EvidenceRequest`s into ranked, curator-
  reviewable `GuidanceGap`s; `GuidanceGapActionedEvent` boundary; apply-to-YAML
  stays human/git).
- Multi-analyzer conflict resolution (two analyzers, contradictory findings).
- Consent/privacy model for evidence — especially faces (LGPD) and documents.
- `plan` fulfillment orchestration (deferred by design).
- Triggered assessments: new evidence in the library automatically starts a (partial) re-analysis and alerting. Needed for longitudinal/health-style verticals; not v1.
- Prior art for health-style verticals: FHIR resources (Observation, Condition, DiagnosticReport, CarePlan) map almost 1:1 to our chain — a vertical could adopt them as its schema/taxonomy rather than inventing one.
