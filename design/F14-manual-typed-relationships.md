# F14 — Manual typed relationships

Status: Implemented. This specification was written before implementation.

See [Connected research guide](../docs/18-connected-research.md) for setup, limits and validation.

## Intended outcome

Connect papers, passages, notes and entities using a controlled named relation, rationale and explicit user origin.

## Interaction design

Connections composer selects typed source/target, predicate and rationale, plus optional supporting passages. Inspect or revise the relation and remove it with an explicit action. Endpoint labels and passage previews remain navigable.

## Persistence and API

knowledge_edge stores polymorphic validated references (work, passage, note, entity), predicate, rationale, origin=user, evidence IDs, version and soft deletion. POST/PATCH/DELETE /knowledge/edges. Validate all endpoints on write, canonicalize work/entity aliases, reject self-links.

## Acceptance and verification

Create passage-to-note and paper-to-method links; source navigation works. Stale updates/deletes fail. A personal read_before edge never appears as a citation or verified scientific fact.

Use integration tests against disposable PostgreSQL for persistence, validation and concurrency. Use browser workflows for editing, navigation and reload. Preserve F01–F10 data and stable source IDs. All mutations report errors without discarding the draft. Lists expose their bounds; this remains a local single-user workspace.

## Delivery boundaries

No cloud synchronization, collaborative editing or model download is introduced. External discovery runs only when requested. Source text, user interpretation, computed association and reviewed suggestion retain separate provenance. See the implementation guide for operational limits and validation results.
