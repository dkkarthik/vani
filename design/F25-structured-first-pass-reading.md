# F25 — Structured first-pass reading

Status: implemented and verified. This specification was written before implementation. See the [usage and verification guide](../docs/19-research-planning.md).

## Outcome and interactions

Create a short editable contribution/context/limitations report for one selected paper, with exact source snippets and honest abstract/indexed-PDF coverage. Optional local model synthesis may propose sections; without it, show clearly labeled extractive triage.

## Data and API design

insight_report stores kind=first_pass, selected work IDs, source snapshot, structured sections, history and revision. Snapshot limits: 50 indexed pages/work and 120k characters total; complete-document label only when all indexed pages actually included and extraction ready.

All new APIs live under `/api/v1/knowledge`; existing F01–F20 identities remain intact. Server validation checks references and optimistic revisions. Errors preserve the editor draft. This is a local single-user feature, not a synchronization or collaboration system.

## Acceptance criteria

Save/correct a report and inspect history. Abstract-only and partial PDFs never become complete-document claims. Missing limitations remain unassessed. Model quotations/source IDs are validated against supplied evidence.

## Verification plan

Use disposable PostgreSQL integration tests for persistence, invalid references, stale writes and repeat operations. Use controlled provider responses for model/discovery validation and browser tests for key editing/reload/navigation/export flows. Run workspace checks, commit only task changes and push to GitHub.

## Boundaries

No unrequested cloud processing, exhaustive literature-coverage claim, automatic correctness verification or inferred prerequisite is presented as fact. Source quotations, user interpretation and heuristic suggestions remain separately labeled. Limits and fallbacks appear in the UI and delivery guide.
