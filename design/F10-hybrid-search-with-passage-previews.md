# F10 — Hybrid search with passage previews

Status: implemented; validation recorded in the [usage guide](../docs/17-research-workspace.md). September 10, 2026.

## Outcome and behavior

Provide /search across metadata, full-text pages, notes and annotations. Search mode exact phrase, lexical or hybrid; filter collection, work tag, source kind and year range. Return real measured lexical rank/semantic similarity, matched text, page/location and a source link. Never invent semantic scores (replace the old illustrative rank behavior in the legacy search API).

PDF pages are indexed per immutable object hash using F07. Metadata, notes and annotation text are read live for lexical retrieval. Coverage reports attached/indexed/failed/empty documents and semantic indexing coverage with timestamps. Explicit index/reindex controls operate in bounded batches and report per-document errors; a missing index is visible, not an empty-content claim.

Hybrid adds embeddings from an explicitly configured local Ollama embedding model (VANI_EMBED_MODEL, OLLAMA_BASE_URL), with bounded requests, content-hash/model-based caching, cosine similarity and reciprocal-rank fusion with lexical results. No document text is sent to a cloud service by default. If no embedding model is configured or it fails, hybrid explicitly reports lexical fallback; exact/lexical search remains usable. Provide model setup steps and deterministic embedding-provider fixtures for tests. Never label lexical synonyms as semantic inference.

API: POST /evidence-search; GET /search-coverage; POST /search-index (up to 10 attachments per request); POST /semantic-index (up to 100 chunks per request). Search results are capped with coverage/truncation information, not fabricated completeness. UI shows passage previews, filters, coverage and retry/index controls.

Acceptance: exact phrase distinguishes order; results span all four sources and obey combined filters; page/annotation links open source; unchanged chunks reuse embeddings, edits invalidate hashes; unavailable embedding model is explicit; hybrid ranks a semantic fixture lacking query terms; no made-up semantic score in legacy search.

## Validation and delivery

Implement only after this specification exists. Use unit tests for rules and ranking, disposable PostgreSQL integration tests for persistence/concurrency, and browser smoke tests for the user flow. Preserve F01–F03 behavior, run repository checks, commit and push. Implementation details and any verified limitations belong in the usage guide.
