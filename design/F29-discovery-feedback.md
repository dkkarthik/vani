# F29 — Feedback that improves discovery

Status: implemented and verified. This specification was written before implementation. See the [usage and verification guide](../docs/19-research-planning.md).

## Outcome and interactions

Accept, dismiss or defer discovery results with a reason; retain the decision per topic/collection. Suppress unchanged accepted/dismissed and not-yet-due deferred results. Material metadata changes allow re-review with prior decision visible.

## Data and API design

discovery_feedback stores normalized identity/context and meaningful metadata fingerprint, state/reason/deferUntil/revision. Hook F19 explorer and living collection candidate filtering. Feedback is explicit suppression/ranking preference, not hidden model training.

All new APIs live under `/api/v1/knowledge`; existing F01–F20 identities remain intact. Server validation checks references and optimistic revisions. Errors preserve the editor draft. This is a local single-user feature, not a synchronization or collaboration system.

## Acceptance criteria

Re-running identical candidate does not resurface it. Expired defer or changed title/abstract/year/DOI/retraction state does. Manual restore is available and preserves decision audit.

## Verification plan

Use disposable PostgreSQL integration tests for persistence, invalid references, stale writes and repeat operations. Use controlled provider responses for model/discovery validation and browser tests for key editing/reload/navigation/export flows. Run workspace checks, commit only task changes and push to GitHub.

## Boundaries

No unrequested cloud processing, exhaustive literature-coverage claim, automatic correctness verification or inferred prerequisite is presented as fact. Source quotations, user interpretation and heuristic suggestions remain separately labeled. Limits and fallbacks appear in the UI and delivery guide.
