# F26 — Grounded collection questions

Status: implemented and verified. This specification was written before implementation. See the [usage and verification guide](../docs/19-research-planning.md).

## Outcome and interactions

Ask over explicitly selected works and optional selected notes; retrieve matching abstract/page/annotation/note passages and cite every returned quotation, synthesis or inference. Show unavailable evidence and never search outside the chosen corpus.

## Data and API design

POST insights/ask persists question, corpus and evidence snapshot. Optional local-only model returns typed claims with exact quotes; invalid claims are discarded. Extractive fallback states that it retrieves passages rather than fully answers. Each source snapshot has a durable source-inspection URL.

All new APIs live under `/api/v1/knowledge`; existing F01–F20 identities remain intact. Server validation checks references and optimistic revisions. Errors preserve the editor draft. This is a local single-user feature, not a synchronization or collaboration system.

## Acceptance criteria

Out-of-scope requests produce insufficient evidence when no matches exist. Foreign citations and fabricated quotes fail validation. Uploaded papers/notes are never sent to a cloud model by this workflow.

## Verification plan

Use disposable PostgreSQL integration tests for persistence, invalid references, stale writes and repeat operations. Use controlled provider responses for model/discovery validation and browser tests for key editing/reload/navigation/export flows. Run workspace checks, commit only task changes and push to GitHub.

## Boundaries

No unrequested cloud processing, exhaustive literature-coverage claim, automatic correctness verification or inferred prerequisite is presented as fact. Source quotations, user interpretation and heuristic suggestions remain separately labeled. Limits and fallbacks appear in the UI and delivery guide.
