# F16 — Inspectable relationship suggestions

Status: Implemented. This specification was written before implementation.

See [Connected research guide](../docs/18-connected-research.md) for setup, limits and validation.

## Intended outcome

Generate reviewable links for method use, extension and comparison from explicit text cues and named entities, with exact snippets, derivation and heuristic confidence.

## Interaction design

Run suggestion generation against stored abstracts and indexed PDF text in a bounded selected corpus. Each candidate shows source work/page, target entity, matching phrase, rule, origin, confidence (not calibrated probability), and pending/accepted/rejected state. Accept creates an edge; reject persists a dismissal.

## Persistence and API

knowledge_suggestion unique fingerprint prevents repeated proposals. POST /knowledge/suggestions/generate; GET list; POST /:id/review. Deterministic phrase rules (uses/applies, extends/builds on, compares against) match curated entity names/aliases. Accept transactionally checks source/target availability and records provenance.

## Acceptance and verification

Fixture text yields a method-use and comparison suggestion; unrelated text yields none. Accept/reject are idempotent; repeated generation respects rejection; all accepted edges remain machine-suggested/user-reviewed, never source-verified claims.

Use integration tests against disposable PostgreSQL for persistence, validation and concurrency. Use browser workflows for editing, navigation and reload. Preserve F01–F10 data and stable source IDs. All mutations report errors without discarding the draft. Lists expose their bounds; this remains a local single-user workspace.

## Delivery boundaries

No cloud synchronization, collaborative editing or model download is introduced. External discovery runs only when requested. Source text, user interpretation, computed association and reviewed suggestion retain separate provenance. See the implementation guide for operational limits and validation results.
