# F20 — Distinct relationship layers

Status: Implemented. This specification was written before implementation.

See [Connected research guide](../docs/18-connected-research.md) for setup, limits and validation.

## Intended outcome

Provide separate direct citation, bibliographic similarity, semantic similarity, evidence and personal layers with readable legend and inspectable derivation.

## Interaction design

Map gains a layer explorer with checkbox filters and an accessible edge list alongside the graph. Selecting an edge shows endpoints, direction, origin, score meaning, derivation and source passages. Personal links are separate from scholarly evidence.

## Persistence and API

POST /knowledge/layers aggregates canonical work citation facts, shared-reference Jaccard similarity from stored OpenAlex records, cosine similarity from matching model cached metadata vectors, plus knowledge edges and existing typed relationships. Bound to100 works/2000 edges with visible coverage. No semantic vectors means unavailable, not invented similarity. Compute bibliographic overlap only from known reference sets.

## Acceptance and verification

Fixture shared references produce reproducible Jaccard; citation direction and sources remain visible; real cached vectors produce cosine; disabled layers disappear from both graph/list. Missing data is labeled; accepted suggestions are not relabeled bibliographic facts.

Use integration tests against disposable PostgreSQL for persistence, validation and concurrency. Use browser workflows for editing, navigation and reload. Preserve F01–F10 data and stable source IDs. All mutations report errors without discarding the draft. Lists expose their bounds; this remains a local single-user workspace.

## Delivery boundaries

No cloud synchronization, collaborative editing or model download is introduced. External discovery runs only when requested. Source text, user interpretation, computed association and reviewed suggestion retain separate provenance. See the implementation guide for operational limits and validation results.
