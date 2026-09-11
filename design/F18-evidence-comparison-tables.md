# F18 — Evidence comparison tables

Status: Implemented. This specification was written before implementation.

See [Connected research guide](../docs/18-connected-research.md) for setup, limits and validation.

## Intended outcome

Compare chosen papers on question, method, dataset/population, results, assumptions and limitations, with sourced editable cells.

## Interaction design

Create a named comparison for up to20 papers. Matrix cells start explicitly unrecorded. Edit interpretation and link a passage or choose an exact abstract quotation with provenance label. Each correction records a revision; inspect sources and export a Markdown table.

## Persistence and API

comparison stores workIds and version; comparison_cell stores work/column/text/source plus history on update. GET/POST /knowledge/comparisons; GET /:id; PUT /:id/cells; GET export. Validate passage belongs to that paper or abstract quote occurs in current abstract. Nonempty findings require a source; no automatic unsupported extraction.

## Acceptance and verification

Two-paper matrix survives reload; cell opens correct page, edited value/history retained; cross-paper evidence and invented abstract quote rejected; empty cells explicitly unrecorded in UI/export. Alias merge does not break original table rows.

Use integration tests against disposable PostgreSQL for persistence, validation and concurrency. Use browser workflows for editing, navigation and reload. Preserve F01–F10 data and stable source IDs. All mutations report errors without discarding the draft. Lists expose their bounds; this remains a local single-user workspace.

## Delivery boundaries

No cloud synchronization, collaborative editing or model download is introduced. External discovery runs only when requested. Source text, user interpretation, computed association and reviewed suggestion retain separate provenance. See the implementation guide for operational limits and validation results.
