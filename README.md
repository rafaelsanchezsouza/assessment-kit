# assessment-kit — a framework for guided visual assessment

Open-source framework for building **guided visual assessment** applications:
a user captures evidence about a subject (photos, questionnaires, documents)
following a declarative protocol; pluggable analyzers (human experts or AI)
produce findings; findings become conditions; conditions map to recommended
solutions fulfilled by products, professionals, or the user's own actions.

**The framework is the engine. Protocols, models, catalogs and mappings are
content — they live in private vertical repositories.**

## Packages
| Package | Role |
|---|---|
| `@assessment-kit/types` | Shared domain contracts (zero-dependency) |
| `@assessment-kit/core` | Protocol interpreter, assessment state machine, analyzer orchestrator |
| `@assessment-kit/analyzer` | Abstract analyzer plugin interface (ports) |
| `@assessment-kit/analyzer-human` | Human-expert adapter — v1's only analyzer, AI slots in later |
| `@assessment-kit/capture-web` | Guided photo capture SDK (React) |
| `@assessment-kit/forms-web` | Questionnaire renderer |
| `@assessment-kit/protocol-tools` | Protocol schema + validator/compiler CLI |
| `apps/reference` | Clone-and-run demo with a sample protocol |

## Docs
- [Domain model](docs/domain-model.md)
- [MonkJs research notes](docs/research/monkjs-deep-dive.md)

## Status
Pre-alpha: contracts and skeleton. See docs/domain-model.md for the design.

## Try it now — HTML prototype
`apps/prototype/index.html` is a self-contained, zero-dependency prototype of the
guided capture flow (house exterior assessment). Open it directly in a mobile
browser — no build step, no server:

- protocol-driven wizard using the same `ProtocolStep` shape as `@assessment-kit/types`
- native camera via `<input capture="environment">`
- client-side blur check (Laplacian) with a retake prompt — compliance-as-analyzer, demoed
- a branching questionnaire answer that triggers a dynamic evidence request (the refinement loop)
- final review + downloadable assessment manifest (JSON)

It exists to feel the UX and demo the concepts; the real SDK lives in `@assessment-kit/capture-web`.

## Suggested build order
1. **`@assessment-kit/protocol-tools` validator CLI** — small, makes CI honest, everything depends on trustworthy protocols. YAML → JSON Schema validation (ajv) + referential checks (unique step ids, branch targets exist, assets present).
2. **`@assessment-kit/core`: state machine + persistence + draft-sync API** — the server is the source of truth for assessment state; devices sync per-step progress and keep an offline buffer. This is where the resumability decision lives.
3. **`@assessment-kit/capture-web` against the demo protocol** — guided HUD, SVG overlays, client-side physics checks (blur/orientation/resolution), retrying upload queue. Port the prototype's lessons here.
4. **`@assessment-kit/analyzer-human` + a minimal review UI** — expert sees evidence, emits findings and evidence requests. At this point the full Wizard-of-Oz loop for the first vertical works end-to-end: capture → human review → recommendations → (manual) fulfillment.
5. Only then: conditions/recommendations persistence, the fulfillment event bus, and the first AI analyzer behind the same contract.
