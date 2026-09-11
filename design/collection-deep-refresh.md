# Manual deep collection refresh

Specification written before implementation.

Expose a prominent Deep refresh button when a manual collection is selected. An explicit refresh runs independently of the daily schedule, including paused collections. Require active keywords. Display queued/searching/importing/completed/partial/failed/superseded state, candidate and addition counts, and provider warnings. Repeated clicks reuse an active job.

Persist jobs and process them immediately when requested, with worker recovery after restart. Search OpenAlex and Crossref without the daily date window using up to four keyword query variants (100 results/provider/query), plus bounded references and citing-paper expansion from up to five public seed/member papers. Deduplicate candidates and apply current keyword admission and discovery feedback rules; import up to 200 relevant papers. Preserve per-paper inclusion explanations and queue local PDF/contribution processing. Report limits; deep search is broader, not exhaustive.

A keyword/focus change supersedes in-flight work; check the snapshot under a collection row lock before each membership insertion. Keep additions already admitted under the valid prior snapshot. Manual refresh must not alter daily enabled state or next daily run. Preserve originals and deduplicate repeated jobs/imports. All-provider failure must not be reported as an empty successful search.

Verify paused-collection refresh, duplicate clicks, broader/no-date queries, actual admissions and reasons, keyword edits during search, provider failures, recovery, schedule preservation and browser status feedback. Run checks, commit and push.

## Implementation and validation

Implemented with a durable `collection_refresh` queue, immediate API-triggered processing, worker recovery and collection status polling. The full suite passes: 118 API tests (including database integration), 3 web tests and 14 extension tests. Type checks, builds and lint pass. Chromium smoke verifies the visible button, actual additions/reasons and schedule preservation against deterministic provider fixtures; live provider completeness is not asserted. See [usage guide](../docs/22-manual-deep-refresh.md).
