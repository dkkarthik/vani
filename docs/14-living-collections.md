# Living collections

Collections now accept either a topic/query or up to ten library papers. Import papers through Discover (title or DOI search), then select them as seeds. In paper mode, the configured model synthesizes one moderately narrow shared topic; it is displayed in the collection and editable. Unavailable models or incoherent seeds produce a visible error, not a fabricated topic. An optional focused-topic override is supported.

## Daily discovery

The API process starts a PostgreSQL-coordinated worker. New profiles run within a minute, then at **07:00 America/New_York** by default (editable hour and IANA timezone). It handles daylight-saving time, restart catch-up, pausing, and manual refresh. The API must remain running; this is not a desktop reminder. Existing collections need a discovery profile configured; they are not silently assigned topics.

OpenAlex and Crossref provide up to 100 candidates each per run. Initial searches use relevance; subsequent searches sort by publication date with a rolling 90-day overlap to catch delayed indexing. A transparent lexical topic-overlap threshold filters unrelated candidates. This is a bounded search, not an exhaustive systematic review; source limits and partial failures are visible. All-source failures retry after one hour. A PostgreSQL advisory lock prevents overlapping worker instances. Membership insertion is idempotent. DOI, connector identity, and identifier-less normalized title/year matches prevent repeated imports.

Newness is membership-specific, independent of publication date and reading status. The UI acknowledges only the displayed, filtered list in a visible tab; concurrent arrivals remain unread. NEW badges persist during that visit and disappear on the next visit. Existing memberships are baselined as seen during migration because historical visit data did not exist.

## First pass and novelty

The structured report follows [S. Keshav's first pass](https://systems.cs.columbia.edu/ds2-class/papers/keshav-paper.pdf): category, context, apparent correctness of assumptions, contributions, and clarity. It records available section coverage, supporting excerpts, limitations, model provenance, and timestamp. One provisional novelty statement is compared against up to eight nearby collection papers. Exact quotations and comparison IDs are checked against supplied evidence; this validates source attribution, not the truth of model interpretation or global priority.

Available arXiv HTML is retrieved from a fixed allowlisted host. Other papers use stored abstracts until a searchable PDF is attached. Uploaded PDF text is extracted locally with Poppler and sent only to Ollama. Public titles, abstracts, and arXiv text use the existing configured OpenAI provider when a key is present, otherwise Ollama. Reports clearly label abstract-only triage, incomplete full-text review, missing evidence, and model failures. A full pass is not claimed without all required sections. The comparison set itself remains abstract-grounded. Missing/failed reports are retried on subsequent runs; attaching a PDF queues incomplete reports for retry. Use Retry first pass to reassess an existing report against an expanded collection.

## Running

1. Apply migrations with `npm run db:migrate` (also applied on API startup).
2. Configure `OLLAMA_BASE_URL` and `OLLAMA_MODEL`, or `OPENAI_API_KEY` and `OPENAI_MODEL` for public-paper synthesis. Local development currently reads environment variables from the process; export them or use your runtime's env-file support. Simply creating `.env` does not load it into the Node process.
3. Install Poppler for local PDF extraction (`pdftotext`); the API Docker image includes it.
4. Start VANI, open a collection, and choose **Configure discovery**; or use **New collection**.

Do not infer that a successful build means a scheduler is live: a reachable database and running API are required. Ollama must be reachable from the API host/container. Configuration, run timestamps, warnings, reports, and seen markers are durable database state.

API additions: `POST /collections/:id/discovery`, `POST /collections/:id/refresh`, `POST /collections/:id/seen` (explicit work IDs), `GET /collections/:id/members` (newness, status, reports), and `POST /collections/:id/members/:workId/first-pass/retry`.
