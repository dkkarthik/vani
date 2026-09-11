# F28 — Explain what a new paper adds

Status: implemented and verified. This specification was written before implementation. See the [usage and verification guide](../docs/19-research-planning.md).

## Outcome and interactions

Compare a selected new paper with an explicit existing corpus, chosen topic notes and arguments. Show text overlap, relevant excerpts, distinct terms and questions to investigate, with editable interpretation and scope limits.

## Data and API design

POST insights/addition uses bounded local evidence and lexical comparisons. Persist topics/argument IDs and their title/description snapshots. Potential missing perspectives are phrased as questions, never field-wide novelty claims.

All new APIs live under `/api/v1/knowledge`; existing F01–F20 identities remain intact. Server validation checks references and optimistic revisions. Errors preserve the editor draft. This is a local single-user feature, not a synchronization or collaboration system.

## Acceptance criteria

Target excluded from baseline; shown comparisons cite stored sources. Empty baseline is explicit. Topic/argument context retained and reports editable; no global novelty score.

## Verification plan

Use disposable PostgreSQL integration tests for persistence, invalid references, stale writes and repeat operations. Use controlled provider responses for model/discovery validation and browser tests for key editing/reload/navigation/export flows. Run workspace checks, commit only task changes and push to GitHub.

## Boundaries

No unrequested cloud processing, exhaustive literature-coverage claim, automatic correctness verification or inferred prerequisite is presented as fact. Source quotations, user interpretation and heuristic suggestions remain separately labeled. Limits and fallbacks appear in the UI and delivery guide.
