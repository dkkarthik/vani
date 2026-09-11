# F04 — Deduplication and version identity

Status: implemented; validation recorded in the [usage guide](../docs/17-research-workspace.md). September 10, 2026.

## Outcome and behavior

Review suspected duplicate pairs from matching normalized titles, trigram title similarity and shared PDF hashes. Show reasons and both records; never auto-merge. Users can dismiss a pair, link distinct versions, or preview a logical merge choosing the canonical record.

A logical merge preserves both original records, their citation keys, source assertions and document/annotation IDs. The source becomes an alias of the target and disappears from the canonical library; old IDs and keys resolve to the target. Reading exposes original attachments and notes across the alias family. Copy missing collection memberships and graph edges to the canonical target; preserve conflicting project state in the original membership and merge audit. Target metadata and corrections win. Merging different nonempty DOIs or different known manifestation types is blocked; use a version link instead.

Version relations are directed: preprint_of, version_of, corrects, retracts. Require an explanation and optional supporting URL. Display correction/retraction notices with the related record. These are user-recorded relationships, not automated claims of retraction. Preview/commit compares both work revisions; commit uses the existing identity advisory lock and increments revisions. Duplicate dismissal and merge audit are durable.

API: GET /identity/candidates; POST /identity/preview; POST /identity/merge; POST /identity/dismiss; GET/POST /works/:id/versions; GET /identity/resolve?key=. UI: /organize identity tab and links from reader.

Acceptance: stale or incompatible merge rejected without mutation; double merge idempotent; source IDs/keys still open canonical record; PDFs, notes, annotations and source metadata remain accessible; version/retraction notices survive reload.

## Validation and delivery

Implement only after this specification exists. Use unit tests for rules and ranking, disposable PostgreSQL integration tests for persistence/concurrency, and browser smoke tests for the user flow. Preserve F01–F03 behavior, run repository checks, commit and push. Implementation details and any verified limitations belong in the usage guide.
