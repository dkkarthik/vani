# F23 — Focused graph timeline and list views

Status: implemented and verified. This specification was written before implementation. See the [usage and verification guide](../docs/19-research-planning.md).

## Outcome and interactions

Switch the same board corpus among spatial graph, chronological timeline and accessible list. Filter year and relationship layer, focus a node, expand one hop explicitly and return to the prior selection with Back view.

## Data and API design

Board state includes visible cardIds, year range, layers, view, and up to20 history snapshots. Neighbors come from F20 bounded local layers; imported expansion cards preserve prior positions. Undated/non-work cards remain labeled.

All new APIs live under `/api/v1/knowledge`; existing F01–F20 identities remain intact. Server validation checks references and optimistic revisions. Errors preserve the editor draft. This is a local single-user feature, not a synchronization or collaboration system.

## Acceptance criteria

View switching preserves IDs and filter results. Expanding does not duplicate cards. Back restores prior filters/selection. Graph/list use the same visible records and layers.

## Verification plan

Use disposable PostgreSQL integration tests for persistence, invalid references, stale writes and repeat operations. Use controlled provider responses for model/discovery validation and browser tests for key editing/reload/navigation/export flows. Run workspace checks, commit only task changes and push to GitHub.

## Boundaries

No unrequested cloud processing, exhaustive literature-coverage claim, automatic correctness verification or inferred prerequisite is presented as fact. Source quotations, user interpretation and heuristic suggestions remain separately labeled. Limits and fallbacks appear in the UI and delivery guide.
