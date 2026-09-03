# VANI 0.1 Build Package

**VANI — Visualizing Academic Networks and Ideas**  
**Tagline:** See how ideas connect.

This repository contains the frozen product and technical specification for VANI 0.1. VANI is a local-first research environment that continuously discovers scholarly work, verifies bibliographic records, stores papers and annotations, extracts evidence-backed relationships, visualizes academic networks, and supports grounded conversation over a research collection.

The repository also contains the working VANI application: a React interface, Fastify API, PostgreSQL/pgvector data layer, immutable object store, scholarly connectors, evidence map, and grounded collection conversation.

## Run VANI

### Local development

Requirements: Node.js 22+, Docker, and Docker Compose.

```bash
cp .env.example .env
docker compose up -d postgres
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

Open `http://127.0.0.1:5173`. The API listens on `http://127.0.0.1:8080`.

### Container deployment

```bash
docker compose up --build
```

Open `http://127.0.0.1:3000`. Services bind to loopback by default.

### Verify the build

```bash
npm run check
```

See [Developer guide](docs/13-developer-guide.md) for architecture, configuration, privacy boundaries, and release status.

## Product thesis

Researchers currently move between discovery maps, publisher sites, reference managers, PDF readers, note systems, review platforms, and general-purpose LLMs. VANI 0.1 proves that these activities can form one trustworthy workflow:

> Seed an area → discover papers → verify citations → collect and read papers → understand evidence-backed relationships → ask questions of the collection → monitor changes → export a clean bibliography.

## Package map

| Document | Purpose |
|---|---|
| [Product requirements](docs/01-product-requirements.md) | Scope, users, workflows, functional and non-functional requirements |
| [System architecture](docs/02-system-architecture.md) | Components, data flows, deployment, storage, security, and operational design |
| [Data model](docs/03-data-model.md) | Canonical entities, provenance, versioning, notes, annotations, and collections |
| [Source connectors](docs/04-source-connectors.md) | Initial scholarly sources, connector contract, licensing, and ingestion behavior |
| [Citation verification](docs/05-citation-verification.md) | Authority hierarchy, field verification, citation keys, and exports |
| [Relationship ontology](docs/06-relationship-ontology.md) | VANI 0.1 relationship vocabulary and evidence requirements |
| [API specification](docs/07-api-specification.md) | Application API resources, jobs, events, errors, and permissions |
| [UX specification](docs/08-ux-specification.md) | Navigation, primary screens, interaction rules, and wireframes |
| [Evaluation plan](docs/09-evaluation-plan.md) | Corpus, metrics, algorithm evaluation, and release gates |
| [Implementation backlog](docs/10-implementation-backlog.md) | Milestones, epics, dependency order, and deferred work |
| [Acceptance tests](docs/11-acceptance-tests.md) | End-to-end, reliability, provenance, export, and performance criteria |
| [Decisions and open questions](docs/12-decisions-and-open-questions.md) | Frozen defaults and decisions still requiring implementation validation |

Machine-readable contracts:

- [OpenAPI skeleton](spec/openapi.yaml)
- [Relationship ontology](spec/relationship-ontology.yaml)
- [Venue abbreviations](spec/venue-abbreviations.yaml)
- [Canonical work schema](spec/canonical-work.schema.json)
- [Acceptance scenarios](tests/acceptance/vani-0.1.feature)

## Frozen v0.1 boundaries

VANI 0.1 is a single-user, local-first Linux web application. It includes verified metadata, collections, BibTeX export, PDF reading and annotations, hybrid search, similarity and citation graphs, a limited deep-relationship ontology, OpenReview discussion ingestion, scheduled discovery, and grounded collection Q&A.

It does not include multi-user collaboration, mobile applications, unrestricted publisher crawling, Google Scholar automation, a broad social-media crawler, institutional analytics, patent graphs, automatic thesis writing, or an opaque paper-quality score.

## Architectural defaults

- PostgreSQL 18 is the canonical transactional database.
- pgvector provides vector storage and approximate-nearest-neighbor search.
- PostgreSQL full-text search is the initial lexical index.
- Immutable binaries live in a content-addressed local filesystem store.
- Background jobs use a PostgreSQL-backed queue.
- Search and graph indexes are rebuildable projections, never the sole copy of user data.
- LLM providers are accessed behind a provider interface; local and remote providers are supported.
- Private notes and user-uploaded unpublished documents do not leave the machine without explicit authorization.

## Citation-key convention

The default key is:

```text
{firstAuthor.family:slug}-{venue.abbreviation}{issued.year:2}
```

Example:

```text
meshram-ral26
```

Keys are deterministic, collision-safe, user-editable, and frozen after export unless the user approves a rename.

## Build order

1. Durable metadata, identity, files, collections, and citation exports.
2. PDF reader, annotations, notes, and hybrid search.
3. Discovery runs, graph visualization, and evidence-backed relationships.
4. OpenReview discussion and grounded Ask VANI.
5. Evaluation hardening, import/export round trips, backup, and release packaging.

The authoritative release gate is [docs/11-acceptance-tests.md](docs/11-acceptance-tests.md).
