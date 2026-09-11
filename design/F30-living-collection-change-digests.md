# F30 — Living collections and change digests

Status: implemented and verified. This specification was written before implementation. See the [usage and verification guide](../docs/19-research-planning.md).

## Outcome and interactions

Monitor configured discovery sources through the existing local worker; show new papers, metadata corrections, recorded retractions and new connections in a collection digest. Pause, run/retry, acknowledge, and remain quiet when unchanged.

## Data and API design

collection_digest stores unique event fingerprint/payload; collection_watch_snapshot retains current canonical works/metadata and edges. Hook worker after successful refresh; snapshot endpoint also catches local F03/F04/F14 changes. Surface provider failure separately. No external notification or Codex automation is created.

All new APIs live under `/api/v1/knowledge`; existing F01–F20 identities remain intact. Server validation checks references and optimistic revisions. Errors preserve the editor draft. This is a local single-user feature, not a synchronization or collaboration system.

## Acceptance criteria

Initial snapshot establishes baseline; repeat unchanged run creates zero events. New/edited/retracted/connected fixtures yield distinct events once. Pause prevents scheduled runs; retry resumes an explicit refresh. Provider-derived correction is stored as source provenance, never silently overwrites corrected canonical metadata.

## Verification plan

Use disposable PostgreSQL integration tests for persistence, invalid references, stale writes and repeat operations. Use controlled provider responses for model/discovery validation and browser tests for key editing/reload/navigation/export flows. Run workspace checks, commit only task changes and push to GitHub.

## Boundaries

No unrequested cloud processing, exhaustive literature-coverage claim, automatic correctness verification or inferred prerequisite is presented as fact. Source quotations, user interpretation and heuristic suggestions remain separately labeled. Limits and fallbacks appear in the UI and delivery guide.
