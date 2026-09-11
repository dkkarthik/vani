# F24 — Saved exportable maps

Status: implemented and verified. This specification was written before implementation. See the [usage and verification guide](../docs/19-research-planning.md).

## Outcome and interactions

Save title, question, corpus, filters, groups, positions, path and per-card explanations. Export a readable SVG and editable versioned JSON; import a JSON map as a new board with reference validation.

## Data and API design

GET/POST/PATCH knowledge/boards; GET export?format=svg|json. Export SVG uses escaped labels, layer legend and wrapped text at stored coordinates; collapsed groups retain members in JSON. No external image/resource references.

All new APIs live under `/api/v1/knowledge`; existing F01–F20 identities remain intact. Server validation checks references and optimistic revisions. Errors preserve the editor draft. This is a local single-user feature, not a synchronization or collaboration system.

## Acceptance criteria

Round-trip JSON preserves positions/path and produces a new board ID. SVG includes title, legend and source labels with safe escaping. Stale saves fail without replacing the draft.

## Verification plan

Use disposable PostgreSQL integration tests for persistence, invalid references, stale writes and repeat operations. Use controlled provider responses for model/discovery validation and browser tests for key editing/reload/navigation/export flows. Run workspace checks, commit only task changes and push to GitHub.

## Boundaries

No unrequested cloud processing, exhaustive literature-coverage claim, automatic correctness verification or inferred prerequisite is presented as fact. Source quotations, user interpretation and heuristic suggestions remain separately labeled. Limits and fallbacks appear in the UI and delivery guide.
