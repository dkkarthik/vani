# F12 — Reading intention and progress

Status: Implemented. This specification was written before implementation.

See [Connected research guide](../docs/18-connected-research.md) for setup, limits and validation.

## Intended outcome

Record the question, saving rationale, priority, reading state and selected reading queue per project, then resume the next unfinished selected paper.

## Interaction design

Reading planner chooses a manual project and exposes each membership as an editable row. A checkbox pins a paper to the queue. Resume opens the highest-priority unfinished queued paper, preserving the F07 attachment position; next selection breaks ties by explicit order and title.

## Persistence and API

Add question, queued and reading_revision to collection_membership. GET /knowledge/reading?collectionId and PATCH /knowledge/reading/:collectionId/:workId update the existing membership with optimistic concurrency. Never create state in a computed saved collection.

## Acceptance and verification

Same paper can have different questions and state in two projects. Read/rejected/archived papers do not appear as next queued. Reload retains queue, state and rationale. Stale edit and saved-search destination fail explicitly.

Use integration tests against disposable PostgreSQL for persistence, validation and concurrency. Use browser workflows for editing, navigation and reload. Preserve F01–F10 data and stable source IDs. All mutations report errors without discarding the draft. Lists expose their bounds; this remains a local single-user workspace.

## Delivery boundaries

No cloud synchronization, collaborative editing or model download is introduced. External discovery runs only when requested. Source text, user interpretation, computed association and reviewed suggestion retain separate provenance. See the implementation guide for operational limits and validation results.
