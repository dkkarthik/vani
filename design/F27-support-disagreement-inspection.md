# F27 — Support and disagreement inspection

Status: implemented and verified. This specification was written before implementation. See the [usage and verification guide](../docs/19-research-planning.md).

## Outcome and interactions

Choose two source passages and record exact claims, methods, populations and conditions side by side. Record supports/challenges/mixed/incomparable/unresolved judgment and rationale, then explicitly confirm it.

## Data and API design

kind=inspection report stores two passage snapshots and editable structured comparison fields. Confirmation requires rationale and preserves user origin/history; editing clears prior confirmation. No automatic contradiction claim.

All new APIs live under `/api/v1/knowledge`; existing F01–F20 identities remain intact. Server validation checks references and optimistic revisions. Errors preserve the editor draft. This is a local single-user feature, not a synchronization or collaboration system.

## Acceptance criteria

Inspect both original sources; conflicting conditions can remain incomparable. Confirmed judgment is clearly user-confirmed and edit invalidates it. Stale edits fail.

## Verification plan

Use disposable PostgreSQL integration tests for persistence, invalid references, stale writes and repeat operations. Use controlled provider responses for model/discovery validation and browser tests for key editing/reload/navigation/export flows. Run workspace checks, commit only task changes and push to GitHub.

## Boundaries

No unrequested cloud processing, exhaustive literature-coverage claim, automatic correctness verification or inferred prerequisite is presented as fact. Source quotations, user interpretation and heuristic suggestions remain separately labeled. Limits and fallbacks appear in the UI and delivery guide.
