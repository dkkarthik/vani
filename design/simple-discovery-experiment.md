# Simple discovery experiment

Branch: `codex/simple-discovery-inbox`. Implement and evaluate separately; do not deploy over production or rewrite the core reasoning modules.

## User outcome

Collections gain a prominent Recommended papers inbox. Refresh publishes ranked metadata as source batches arrive, without a PDF, model server, cloud token, or evaluated admission policy. Recommendations are visibly distinct from saved collection members. Save adds a member immediately; thumbs up/down and an optional explanation refine local ranking. Abstracts remain labeled abstracts, not generated summaries.

## Sources and privacy

Reuse OpenAlex and Crossref record normalization and add arXiv Atom search plus a bounded recent category feed (CV, LG, RO by default). Only explicitly saved public queries and public category codes are sent externally. Private seeds, feedback explanations, and collection titles remain local. Each source has independent progress, limits and failures; a 429 or outage must not suppress successful sources or retained results. Respect arXiv spacing and Retry-After. Store a shared public metadata corpus, source identities and provenance; deduplicate by normalized DOI, arXiv ID and conservative title/year identity. Existing publicly sourced core candidates may populate the corpus; private/uploaded records cannot. No claim of exhaustive ingestion: show result ceilings and source coverage.

## Ranking

Implement an independent sparse TF-IDF unigram/bigram ranker in TypeScript with no new Python runtime. Train a deterministic, regularized linear classifier using squared hinge loss (linear SVM objective), positive seed/saved/upvoted examples, strongly weighted explicit negatives, and a bounded lower-weight unlabeled background. Keep author names out of scientific vocabulary. Feature vocabulary and training sample are bounded; ranking runs in a worker thread.

With no positive examples, use cosine similarity to locally held focus/public-query text and label the fallback. Store algorithm/version, training counts, corpus fingerprint, signed decision score, cosine baseline and paper-specific weighted terms. Scores are not probabilities. Negative judgments are excluded from the default inbox but remain inspectable and reversible. Explanations are retained for human review; this experiment does not automatically interpret free text as negative keywords or scientific facts.

## Persistence and lifecycle

Dedicated additive migration and tables for settings, shared papers/aliases, runs/source tasks, rankings, feedback history and current collection model. Optimistic settings versions protect concurrent edits. A single durable worker lock prevents duplicate provider work; task progress and reranking checkpoints survive restarts. Repeated refresh clicks reuse the active run. Rank publication is transactional and tied to the run/settings revision; interrupted batches can safely retry. Daily refresh is opt-in, independently scheduled, and a collection using simple discovery is excluded from the legacy daily discovery scheduler.

Ranking publishes a bounded top list from the retained corpus, deduplicates against seeds/members, and preserves explicit judgments across reranking. Saving a recommendation does not invoke enrichment or deep reading automatically. Core algorithms, reading validation and reasoning APIs remain intact. `VANI_SIMPLE_DISCOVERY_ONLY=true` disables legacy reasoning/audit/enrichment worker lanes in an isolated test deployment, leaving the new discovery worker active. No existing held runs are resumed.

## Front end

Collection panel: opt-in settings, public queries and arXiv categories, source toggles, manual refresh, rerank retained papers, daily switch, latest run/source progress, ranking method, seed/training counts and warning states. Paginated cards show abstract, bibliographic link, source provenance, ranking explanation and terms, Save, thumbs up/down, clear judgment and optional note. Filter recommended/saved/dismissed. Existing deep refresh and focus panels remain available below the new inbox.

## Verification

Pure ranking tests: synonym limitation is explicit; learning separates relevant methods from background, explicit negative and positive evidence act in the expected direction, no-seed fallback, deterministic fitting, bounded vocabulary and duplicate/version handling. Provider fixtures: arXiv normalization, query privacy, independent source failures, rate limit handling. Database integrations: immediate metadata publication, restart/repeat refresh, distinct membership, durable feedback, save without model/PDF calls, stale settings, cancelled runs and shared-corpus privacy. UI: refresh, cards, feedback, save and settings behavior. Full existing regression suite must pass. Test in an isolated local/quasar environment and retain private experiment results, never merge/deploy to production implicitly.
