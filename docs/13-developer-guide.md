# VANI 0.1 Developer Guide

## Repository layout

```text
apps/web                 React/Vite interface
apps/api                 Fastify API, migrations, connectors, storage
packages/shared          Shared contracts and citation-key logic
apps/api/migrations      PostgreSQL 18 + pgvector schema
spec                     Frozen machine-readable product contracts
tests/acceptance         Product-level Gherkin acceptance suite
docs                     Product and technical design package
```

## Runtime

VANI is a modular monolith. The browser calls `/api/v1`; the API owns canonical mutations and connects to PostgreSQL. Uploaded PDFs are streamed into `VANI_DATA_DIR`, addressed by SHA-256, and never modified. PostgreSQL stores attachment references, notes, collections, source provenance, relationships, and conversation evidence.

The development server proxies `/api` to port 8080. The production Nginx container proxies the same path to the API container.

## Implemented vertical slices

- PostgreSQL migrations with pgvector and durable canonical entities;
- deterministic, collision-safe citation keys and BibTeX collection export;
- work and collection management;
- Crossref and OpenAlex federated discovery with cross-source deduplication;
- immutable PDF upload and in-browser reading;
- linked notes;
- typed evidence relationships and accessible visual/list graph views;
- collection- or selection-scoped Ask VANI;
- direct-evidence local fallback and optional OpenAI structured synthesis;
- conservative privacy settings and loopback-only defaults;
- Docker development and production topology.

The interface marks the unverified demo records seeded by `db:seed`. They are interaction fixtures, not authoritative citations. The included CLEAR record uses the supplied IEEE citation and verifies the required `meshram-ral26` key.

## Configuration

Copy `.env.example` to `.env`. Do not commit `.env`.

| Setting | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection |
| `VANI_DATA_DIR` | Content-addressed files, exports, backups |
| `VANI_WEB_ORIGIN` | CORS origin |
| `OPENALEX_EMAIL` | OpenAlex polite-pool identity |
| `SEMANTIC_SCHOLAR_API_KEY` | Reserved for the next connector |
| `OPENAI_API_KEY` | Optional remote Ask VANI provider |
| `OPENAI_MODEL` | Model used for structured synthesis |

Without `OPENAI_API_KEY`, Ask VANI uses an extractive local fallback and exposes that limitation. Remote calls receive bounded abstracts only in this release. Private-note remote routing remains disabled in the interface.

## Data lifecycle

Database rows are the canonical record. Search vectors and later embeddings are projections. Files are written to a temporary path, hashed, atomically moved into the SHA-256 hierarchy, then referenced in PostgreSQL. Duplicate bytes share one immutable object.

## Commands

```bash
npm run dev
npm run typecheck
npm test
npm run build
npm run check
npm run db:migrate
npm run db:seed
```

## Release status

This build is a functional v0.1 alpha. The core golden path is operational. Before research-critical production use, complete the P0 integration tests for backup/restore, merge undo, full citation round-trips, PDF text-coordinate extraction, OpenReview, scheduled discovery workers, and claim-level entailment evaluation described in the acceptance package.
