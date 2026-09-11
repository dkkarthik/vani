# F06 — Batch cleanup with undo

Status: implemented; validation recorded in the [usage guide](../docs/17-research-workspace.md). September 10, 2026.

## Outcome and behavior

A durable preview lists exact before/after values for up to 100 selected works. Operations: set a supported bibliographic field (title, venue, publisher, year, language, publicationType), add/remove tags, merge a tag alias into a canonical tag, or normalize whitespace in author/editor names. Alias merge applies to the selected scope, which is shown explicitly.

Preview stores work revisions and full metadata/tag snapshots. Apply is all-or-nothing and uses F03 metadata validation, correction locks, provenance decisions and stable citation keys. Canonical updates and the batch audit share one transaction. Never allow arbitrary SQL fields or mass identifier replacement. A stale work invalidates the preview and requires a new preview.

Undo restores the prior metadata/tags/locks/status only if every affected work still has the exact post-apply revision. Undo is itself a new audited revision, preserving the edit/undo history. If later edits or merges exist, reject the entire undo with an actionable conflict rather than overwriting them. Applied/undone reports are durable; repeat apply/undo is idempotent.

API: POST /cleanup/preview, GET /cleanup and /cleanup/:id, POST /cleanup/:id/apply and /undo. UI: /organize cleanup tab, with selected IDs, operation form, before/after report and explicit Apply/Undo.

Acceptance: failed/stale batch leaves all rows unchanged; protected metadata records user decisions; tags deduplicate; name normalization preserves author order; successful undo restores before values and keys while retaining history; later edits block undo.

## Validation and delivery

Implement only after this specification exists. Use unit tests for rules and ranking, disposable PostgreSQL integration tests for persistence/concurrency, and browser smoke tests for the user flow. Preserve F01–F03 behavior, run repository checks, commit and push. Implementation details and any verified limitations belong in the usage guide.
