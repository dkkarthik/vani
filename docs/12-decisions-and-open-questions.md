# VANI 0.1 Decisions and Open Questions

## 1. Frozen decisions

| Area | Decision |
|---|---|
| Product | Single-user, local-first Linux web application |
| Database | PostgreSQL 18 with pgvector |
| Binary storage | Immutable content-addressed local filesystem |
| Graph source of truth | Relational typed-edge model in PostgreSQL |
| Lexical search | PostgreSQL full-text search initially |
| Job queue | PostgreSQL-backed durable queue |
| Core sources | Crossref, OpenAlex, Semantic Scholar, DBLP, arXiv, OpenReview |
| IEEE | Authorized metadata connector only |
| Google Scholar | Manual/external use only; no automated connector |
| Versions | Separate manifestations linked to one conceptual work |
| Annotations | Stored separately from immutable PDF, with export support |
| Notes | Markdown-portable with structured links in PostgreSQL |
| Citation key | `{first-author-surname}-{venue-abbreviation}{yy}` |
| Example key | `meshram-ral26` |
| Ask VANI | Scoped retrieval plus claim-level citation validation |
| Reviews | First-class versioned discourse, not a paper-quality score |
| Public discourse | Data model anticipated; broad ingestion deferred |

## 2. Implementation choices to validate in a spike

These do not block starting the build, but the implementation must record a decision before Milestone 1 or 2 exits.

### Backend language and framework

Choose based on maintained async HTTP, PostgreSQL, migrations, typed schemas, background jobs, PDF tooling interoperability, and packaging. The spec does not prescribe Python, TypeScript, Rust, or another language.

### Frontend and graph library

The selected library must support WebGL/canvas rendering, stable programmatic layouts, compound selection, accessible alternatives, and at least the target graph size. Prototype Sigma.js, Cytoscape.js, or an equivalent before commitment.

### PDF parser

Evaluate at least two parsers on the reference corpus for section structure, reading order, citations, tables, and coordinates. Preserve a pluggable parser interface.

### Embedding model

Benchmark a scholarly embedding model and a strong general embedding model on VANI’s relevance set. Do not select solely from public leaderboard scores.

### LLM defaults

Select task-specific defaults after relationship and Ask VANI evaluation. The provider interface and provenance requirements are fixed; the model is not.

### PostgreSQL BM25 extension

Start with native full-text search. Adopt a BM25 extension only if evaluation shows material relevance benefit and operational/licensing review passes.

## 3. User decisions supported through settings

- local versus remote LLM provider;
- whether open-access documents may be sent to a remote provider;
- whether private notes/user PDFs may ever leave the machine;
- source enablement and credentials;
- discovery schedule;
- preferred manifestation export policy;
- citation key template override;
- Unicode versus LaTeX escaping;
- retention and trash grace period.

Defaults must be conservative and visible.

## 4. Post-v0.1 decisions

- live two-way Zotero synchronization;
- public-blog and social-discourse connector set;
- eLife, F1000Research, PREreview, PubPeer, and PCI connectors;
- collaboration and access control;
- graph database projection;
- object storage beyond one machine;
- patent/grant/policy graphs;
- mobile and offline clients;
- spaced-retrieval learning features.

## 5. Change control

A change to a frozen v0.1 decision requires:

1. problem statement and evidence;
2. affected requirements and acceptance tests;
3. migration and compatibility impact;
4. privacy/licensing impact;
5. explicit recorded decision.

Feature additions that do not threaten the golden workflow should enter the post-v0.1 backlog rather than expanding the release boundary.

