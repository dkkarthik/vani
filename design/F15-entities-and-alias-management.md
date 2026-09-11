# F15 — Entities and alias management

Status: Implemented. This specification was written before implementation.

See [Connected research guide](../docs/18-connected-research.md) for setup, limits and validation.

## Intended outcome

Manage concepts, methods, datasets, tasks and authors with explicit aliases, reviewable suggestions, merges and split correction.

## Interaction design

Create/edit entity type/name/aliases. Suggest candidates from stored work tags and author metadata (origin shown), then explicitly create or dismiss. Merge same-type entities after preview of affected edges and aliases. Split by creating a new entity and moving selected aliases and incident edges, with preview and revision validation.

## Persistence and API

knowledge_entity stores name/type/aliases/version/merged_into; entity_audit captures merge/split snapshots. Endpoints /knowledge/entities, /suggest, /merge-preview, /merge, /split-preview, /split. Preserve merged IDs via canonical_entity resolution. A split is user-selected reassignment, not automatic semantic disambiguation.

## Acceptance and verification

Merge retains old IDs and edge visibility; prevent cycles and mixed types; split only chosen aliases/edges and preserve audit. Suggestions never silently create trusted nodes; author names are not asserted unique identities.

Use integration tests against disposable PostgreSQL for persistence, validation and concurrency. Use browser workflows for editing, navigation and reload. Preserve F01–F10 data and stable source IDs. All mutations report errors without discarding the draft. Lists expose their bounds; this remains a local single-user workspace.

## Delivery boundaries

No cloud synchronization, collaborative editing or model download is introduced. External discovery runs only when requested. Source text, user interpretation, computed association and reviewed suggestion retain separate provenance. See the implementation guide for operational limits and validation results.
