# VANI 0.1 System Architecture

## 1. Architecture summary

VANI 0.1 is a modular monolith with asynchronous workers. This minimizes operational complexity while preserving boundaries that can later become independent services.

```text
Browser UI
   │
   ▼
Application API ─────────────── Event stream
   │                                │
   ├── Collection service           │
   ├── Work/identity service        │
   ├── Citation service             │
   ├── Search/discovery service     │
   ├── Graph service                │
   ├── Document/annotation service  │
   └── Ask VANI orchestrator        │
   │                                │
   ▼                                ▼
PostgreSQL + pgvector ◄──── Background workers
   │                          ├── connector ingestion
   │                          ├── identity resolution
   │                          ├── document parsing/OCR
   │                          ├── embeddings
   │                          ├── relationship extraction
   │                          ├── citation verification
   │                          └── scheduled discovery
   ▼
Content-addressed filesystem
```

## 2. Deployment topology

The default distribution uses containers or system services for:

- `vani-web`: browser frontend;
- `vani-api`: HTTP API and event stream;
- `vani-worker`: one or more background worker processes;
- `postgres`: PostgreSQL 18 with pgvector;
- optional local model runtime configured by the user.

All components run on one Linux machine. The API binds to `127.0.0.1` by default. Remote access is an explicit configuration requiring authentication and TLS through a reverse proxy.

## 3. Canonical storage

### PostgreSQL

PostgreSQL stores:

- canonical scholarly entities;
- source payload metadata and provenance;
- version and identity relations;
- collections and memberships;
- typed graph relationships;
- annotations and notes;
- review discussions;
- discovery configurations and runs;
- jobs and attempts;
- model executions and answer claims;
- vector embeddings through pgvector.

Use relational columns for stable, frequently queried fields and `jsonb` for source-specific or evolving fields. Important `jsonb` paths must be indexed selectively rather than through one indiscriminate index.

### Content-addressed object store

Object layout:

```text
VANI_DATA/objects/sha256/ab/cd/abcdef...
VANI_DATA/tmp/<uuid>
VANI_DATA/exports/<export-id>/...
VANI_DATA/backups/...
```

Ingestion procedure:

1. Stream into a uniquely named temporary file.
2. Compute SHA-256 and byte size while streaming.
3. Validate expected MIME and file structure.
4. `fsync` temporary file when durability is required.
5. Atomically rename to the hash path.
6. Insert or reference the database `object` row.
7. Queue derivative generation.

Original objects are immutable. Parsed text, OCR, thumbnails, normalized PDFs, and exports are separate derivative objects linked to their producer and input hashes.

## 4. Search architecture

### Lexical retrieval

Initial implementation uses PostgreSQL `tsvector` and GIN indexes over:

- title with highest weight;
- author and venue names;
- abstract and keywords;
- parsed section text;
- annotation text;
- note text;
- review and discussion text.

Use separate document and personal-knowledge search vectors so private notes can be excluded from remote-model workflows.

### Semantic retrieval

Maintain embeddings at multiple levels:

- work title and abstract;
- document section;
- extracted claim;
- method/task/dataset description;
- note block;
- collection interest profile.

Use exact search for small filtered sets. Use HNSW for large corpus search, with iterative scans and exact fallback for selective filters. Every vector row stores model, dimensions, normalization, source-text hash, and creation time.

### Hybrid ranking

Candidate generation unions:

- exact identifier matches;
- lexical results;
- semantic nearest neighbors;
- citations and references;
- co-citation and bibliographic coupling;
- shared entities and typed relationships;
- source-native recommendations.

The reranker receives feature values, not opaque documents. Store the final feature decomposition so the UI can explain results.

## 5. Graph architecture

PostgreSQL remains the graph source of truth. Use indexed adjacency queries and materialized projections for common neighborhoods.

Key indexes:

```text
(subject_entity_id, predicate, object_entity_id)
(object_entity_id, predicate, subject_entity_id)
(collection_id, subject_entity_id)
(evidence_span_id)
```

Client graph payloads are bounded, filtered projections. The API never sends an unbounded corpus graph. Layout seeds and persisted node positions belong to saved perspectives, not canonical work records.

Do not introduce a separate graph database in v0.1. Profile multi-hop operations after the evaluation corpus is loaded.

## 6. Background jobs

Implement a PostgreSQL-backed queue with `FOR UPDATE SKIP LOCKED` semantics.

Every job contains:

- type and schema version;
- idempotency key;
- owner entity or run;
- priority;
- input payload;
- state;
- attempt count and maximum;
- scheduled, started, heartbeat, and completed timestamps;
- failure classification;
- result references.

Job states:

```text
queued → running → succeeded
                 ↘ retry_wait → running
                 ↘ failed
queued/running → cancelled
```

Workers heartbeat. An expired lease returns a job to `retry_wait` unless it exceeded the attempt limit. Side effects use idempotency keys and upserts.

## 7. Ingestion flows

### Identifier or query

```text
input
 → connector search/resolve
 → raw source record
 → normalized candidate
 → identity resolution
 → canonical work/version
 → citation verification
 → index and embedding jobs
 → recommendation/collection UI
```

### PDF upload

```text
PDF
 → object validation and hash
 → embedded identifier extraction
 → metadata lookup
 → user-assisted match if ambiguous
 → immutable attachment
 → text/structure extraction
 → reference parsing
 → section embeddings
 → relationship extraction
```

### OpenReview forum

```text
submission note
 → public replies and edits
 → review-thread hierarchy
 → manuscript version links
 → critique extraction
 → author-response alignment
 → resolution proposal
```

Only fields readable to the connector identity are ingested. Private or removed fields are not inferred.

## 8. Ask VANI architecture

Ask VANI is an orchestrator, not one prompt.

1. Resolve question scope and paper references.
2. Build an evidence plan from question intent.
3. Retrieve bounded evidence from authorized stores.
4. Expand relevant typed graph edges.
5. Ask a model to construct claim candidates using structured output.
6. For each claim, verify that cited evidence entails or materially supports it.
7. Remove, weaken, or mark unsupported claims.
8. Render the answer with source anchors.
9. Persist question, scope snapshot, model runs, claims, and evidence links.

Remote calls receive the minimum required excerpts. Full documents are not sent unless the user and access policy allow it.

## 9. Provider interfaces

### LLM provider

Required capabilities:

- structured JSON generation;
- token counting;
- streaming responses;
- model identity and version capture;
- configurable data-handling classification;
- retryable versus terminal error distinction.

Provider calls are wrapped by task-specific schemas. Prompts are versioned artifacts. Model output is untrusted until validated.

### Embedding provider

Embedding identities include provider, model, revision, dimension, distance metric, and normalization. A model change creates a new embedding namespace and rebuild job; it never silently mixes vectors.

### Parser provider

Document parsing produces a versioned intermediate representation containing pages, blocks, sections, references, figures, tables, coordinates, and confidence. OCR is a fallback for pages without usable text.

## 10. Permissions and content classes

Document access classes:

```text
user_uploaded
open_access
authorized_subscription
metadata_only
external_link_only
```

Processing decisions are policy-based:

| Operation | User uploaded | Open access | Subscription | Metadata only |
|---|---:|---:|---:|---:|
| Local storage | yes | yes | if terms allow | no |
| Local parsing | yes | yes | if terms allow | no |
| Remote LLM | explicit setting | explicit setting | explicit + terms | metadata only |
| Redistribution | user decision | license dependent | no | metadata only |

## 11. Observability

Use structured logs with correlation IDs for requests, discovery runs, jobs, connector calls, and model executions. Never log API keys, authorization headers, complete private notes, or entire PDFs.

Required operational views:

- queue depth and job age;
- connector latency, errors, and rate-limit state;
- ingestion throughput;
- parse and extraction failures;
- search latency and result counts;
- vector-index health;
- object-store integrity checks;
- model usage by task and privacy class.

## 12. Backup and recovery

A consistent backup contains:

- PostgreSQL logical or physical backup;
- object-store snapshot;
- manifest of object hashes and sizes;
- configuration excluding unexported secrets;
- schema and application version.

Restoration verifies object hashes, referential integrity, index rebuildability, and collection export. A backup is not considered successful until an automated restore test passes.

## 13. Technology-selection constraints

The coding agent may select implementation languages and UI frameworks, subject to:

- maintained open-source dependencies;
- first-class Linux support;
- no mandatory proprietary cloud service;
- WebGL or canvas graph rendering capable of at least 5,000 loaded elements and 500 smoothly interactive visible nodes;
- PDF rendering with text and geometric coordinates;
- generated API clients from `spec/openapi.yaml` where practical;
- migrations for every database change;
- reproducible local development and production startup.

