# VANI 0.1 Implementation Backlog

## 1. Delivery model

Build vertical slices with deployable outcomes. Each milestone includes migrations, API, UI, tests, logs, and documentation. Do not postpone provenance, access policy, or export correctness as cleanup work.

## 2. Milestone 0 — Foundation

### Deliverables

- project scaffolding and reproducible development environment;
- PostgreSQL 18 and pgvector migrations;
- configuration and secret management;
- object-store implementation;
- background job framework;
- health, capability, and event endpoints;
- structured logging and request correlation;
- initial backup/restore script and test.

### Exit criteria

- idempotent job survives worker termination;
- object ingest deduplicates and verifies hashes;
- database migration up/down policy documented;
- restored empty deployment passes health checks.

## 3. Milestone 1 — Trustworthy library

### Deliverables

- work/manifestation/person/venue/source-record models;
- Crossref, OpenAlex, DBLP, arXiv, and Semantic Scholar connectors;
- import adapters for BibTeX, BibLaTeX, RIS, CSL-JSON, and PDFs;
- identity candidate matching and human conflict review;
- field assertions and canonical decisions;
- venue abbreviation registry;
- citation-key generation and freeze behavior;
- manual/nested collections;
- collection BibTeX/BibLaTeX/CSL-JSON/RIS export;
- citation validation panel.

### Exit criteria

- import and reconcile the reference corpus;
- `meshram-ral26` generated correctly;
- no silent duplicate or conflicting-field overwrite;
- BibTeX round-trip gates pass.

## 4. Milestone 2 — Read and remember

### Deliverables

- PDF attachment and manifestation matching;
- document parsing and structure storage;
- PDF reader and outline;
- full-text search;
- highlights, comments, area annotations, and tags;
- evidence anchors;
- note types and Markdown export;
- annotated PDF export;
- citation preview and source-link navigation.

### Exit criteria

- annotations survive restart and export;
- exact source location opens from a note;
- original PDF hash never changes;
- re-anchoring failure is visible.

## 5. Milestone 3 — Discover and visualize

### Deliverables

- embeddings and vector namespaces;
- hybrid search;
- discovery profiles and runs;
- positive and negative seeds;
- recommendation feature decomposition and feedback;
- citation, co-citation, coupling, and semantic relationships;
- first deep predicates: evaluates_on, uses_method, uses_as_baseline, compares_against;
- graph projection API;
- map UI, filters, detail panel, edge evidence, stable perspectives;
- scheduled discovery and update diff.

### Exit criteria

- discovery and relationship evaluation gates pass;
- all deep edges expose evidence or inference state;
- graph remains interactive at target size;
- rerun produces an incremental diff without duplicate recommendations.

## 6. Milestone 4 — Reviews and Ask VANI

### Deliverables

- OpenReview v2 connector and v1 fallback fixtures;
- discussion hierarchy and review timeline;
- critique extraction and resolution proposals;
- LLM and embedding provider interfaces;
- privacy routing and model-run provenance;
- scoped conversations;
- evidence planning and hybrid retrieval;
- claim-level answer validation;
- comparison and shortcomings answer modes;
- save answer as synthesis note;
- answer-to-reader and answer-to-graph links.

### Exit criteria

- OpenReview permissions and anonymity tests pass;
- Ask VANI citation precision gate passes;
- insufficient evidence produces a qualified answer;
- saved answers contain collection snapshot and model provenance.

## 7. Milestone 5 — Release hardening

### Deliverables

- complete reference evaluation corpus;
- performance profiling and index tuning;
- accessibility audit;
- connector failure and offline behavior;
- full backup/restore drill;
- export compatibility matrix;
- installer/container packaging;
- user data directory migration policy;
- security review and dependency audit;
- user documentation.

### Exit criteria

- all P0/P1 acceptance tests pass;
- no unresolved critical security or data-loss issue;
- reference workstation meets performance targets;
- clean install and restore are documented and verified.

## 8. Priority order

### P0 — Release blocking

- durable objects and database;
- identity/version correctness;
- provenance and citation verification;
- collections and exports;
- PDF/annotation durability;
- scoped/evidence-linked Ask VANI;
- backup/restore;
- access-policy enforcement.

### P1 — Required v0.1 quality

- hybrid discovery;
- graph visualization;
- initial deep relationships;
- OpenReview ingestion;
- scheduled diffs;
- accessibility and keyboard workflows.

### P2 — Post-v0.1 candidates

- broad public-discourse ingestion;
- eLife/F1000/PREreview connectors;
- Zotero live synchronization;
- concept and evidence matrices;
- spaced review and knowledge checks;
- collaboration;
- optional graph projection engine;
- patent/grant connectors.

## 9. Explicitly deferred

- Google Scholar scraping;
- generalized IEEE/ACM full-text crawling;
- automatic paper-quality scores;
- autonomous inclusion/exclusion decisions for systematic reviews;
- autonomous thesis writing;
- irreversible model-driven metadata edits;
- multi-node deployment and MinIO;
- native mobile clients.

