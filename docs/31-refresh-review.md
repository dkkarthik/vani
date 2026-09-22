# Reviewing deep refreshes

Open a collection → **Research focus and related work** → **Deep refresh history and feedback**.

Choose a refresh by date. The summary shows outcomes and stages reached or retained from earlier discovery. Filter by recorded stage, outcome, or paper title. Stage filters include earlier stages recorded during that run, even when the paper subsequently advances. Paper lists and refresh history are paginated.

For each paper, open **Inspect decision timeline and sources** to see that run's search paths, ranking features, screening/comparison results, and reading validation diagnostics. Retained candidates are marked separately from papers actually retrieved again. Completed runs preserve their original decisions even after later refreshes or feedback. Existing candidates have explicitly partial history: the update cannot reconstruct traces that were never recorded.

## Feedback and its effects

- **Good match** records “related”; **Poor match** records “out of scope” for this collection. No explanation is required.
- Add a longer explanation and select **Save explanation**. **Clear judgment** removes the current judgment's effect but preserves its audit history.
- Subsequent ranking uses up to 100 recent labeled examples. An exact judgment contributes ±0.2; similar titles contribute smaller bounded adjustments. Baseline scores, adjustments, and influencing paper IDs are stored. This is a transparent heuristic, not a trained relevance model or proof of scientific similarity.
- Up to 12 recent judgments and bounded explanations are supplied to local initial screening as researcher preferences, not evidence. Exact negative judgments can avoid further reading of that paper. Clearing one of these human exclusions makes it stale for reconsideration on a later refresh.
- Feedback alone does not launch inference, re-read every previously reviewed paper, accept a paper, resume a held run, or change public queries. Existing evidence gates and prospective policy-audit safeguards remain.

## Improving search queries

Use **Edit saved queries** for direct changes, or **Suggest queries from feedback (local model)** for one local synthesis call. Suggestions use the current focus, saved queries, and recent positive/negative judgments and explanations. No cloud approval is passed. The model's proposal is a draft, not an automatic search.

Review and edit the public query list, then select **Apply public queries**. The existing versioned focus save rejects concurrent edits rather than overwriting them. Other focus settings are preserved. Applying focus changes supersedes the old run, as with the existing focus editor. Use **Deep refresh** to start discovery with the revised focus. Approved queries are sent to scholarly sources; private feedback is not sent automatically.

## Storage and debugging

Migration `018_refresh_review.sql` adds `core_run_candidate` snapshots and `core_run_event` transitions. Vectors are omitted from the snapshot. Snapshot/event writes occur in the candidate transaction. Feedback history retains the originating run ID when supplied. Full model packets remain available through the existing reading-attempt diagnostics, subject to their retention policy.

API endpoints:

- `GET /api/v1/collections/:id/core/runs?offset=0`
- `GET /api/v1/collections/:id/core/runs/:run?stage=D1b&outcome=not_related&search=&offset=0`
- `GET /api/v1/collections/:id/core/runs/:run/candidates/:candidate`
- `POST /api/v1/core/candidates/:id/feedback` with `label`, optional `reason`, optional `runId`; `clear` removes the active judgment.
- `POST /api/v1/collections/:id/core/query-proposal` returns an unapplied proposal, focus version, feedback IDs, and local model provenance.

The timeline covers staged candidates; it does not claim to enumerate papers that a provider never returned or pages beyond discovery ceilings. No trace retention cleanup is enabled yet; database backups include this history.

## Verification

Fresh local PostgreSQL 18: all 169 API tests passed, including real database history immutability, discovery path isolation, feedback provenance and clearing, and existing D0–D3 pipeline tests. Local web tests include quick feedback, optional explanations, and versioned query application. A separate routing test verifies that query proposals pass private evidence to local inference without cloud approval.

The first committed revision was submitted to quasar's isolated regression job `5e9a849d96154849b6f96566299160d2`. SSH subsequently became unreachable, so that remote result and production rollout are not yet verified. No production refresh was resumed for these tests.
