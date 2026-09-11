# F22 — Guided editable reading paths

Status: implemented and verified. This specification was written before implementation. See the [usage and verification guide](../docs/19-research-planning.md).

## Outcome and interactions

For the board question, propose background, comparison and next-step papers from the selected corpus using indexed citations, shared-reference/similarity links and question term matches. Expose the reason; add suggestions deliberately, reorder entries, edit rationale and mark steps complete.

## Data and API design

Reading path is stored inside board state with cardId, role, rationale, complete. Suggestions are deterministic heuristics, never scholarly prerequisite claims. POST board path-suggestions returns only known work cards.

All new APIs live under `/api/v1/knowledge`; existing F01–F20 identities remain intact. Server validation checks references and optimistic revisions. Errors preserve the editor draft. This is a local single-user feature, not a synchronization or collaboration system.

## Acceptance criteria

A suggested background cites the known relationship and question; applying and reordering retains reasons. Completed steps are skipped by Resume next. No silent reordering on refresh.

## Verification plan

Use disposable PostgreSQL integration tests for persistence, invalid references, stale writes and repeat operations. Use controlled provider responses for model/discovery validation and browser tests for key editing/reload/navigation/export flows. Run workspace checks, commit only task changes and push to GitHub.

## Boundaries

No unrequested cloud processing, exhaustive literature-coverage claim, automatic correctness verification or inferred prerequisite is presented as fact. Source quotations, user interpretation and heuristic suggestions remain separately labeled. Limits and fallbacks appear in the UI and delivery guide.
