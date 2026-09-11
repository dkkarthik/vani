# Connected research: F11–F20

Each feature was specified in its own Markdown document before implementation.

| Feature | Specification | Where to use it |
| --- | --- | --- |
| F11 Rich contextual notes | [Spec](../design/F11-rich-contextual-notes.md) | Knowledge → Notes; existing note URLs |
| F12 Reading intention and progress | [Spec](../design/F12-reading-intention-and-progress.md) | Knowledge → Reading plan |
| F13 Source, topic and argument notes | [Spec](../design/F13-source-topic-and-argument-notes.md) | Knowledge → Notes |
| F14 Manual typed relationships | [Spec](../design/F14-manual-typed-relationships.md) | Knowledge → Connections |
| F15 Entities and alias management | [Spec](../design/F15-entities-and-alias-management.md) | Knowledge → Entities |
| F16 Inspectable relationship suggestions | [Spec](../design/F16-inspectable-relationship-suggestions.md) | Knowledge → Suggestions |
| F17 Argument workspace | [Spec](../design/F17-argument-workspace.md) | Knowledge → Arguments |
| F18 Evidence comparison tables | [Spec](../design/F18-evidence-comparison-tables.md) | Knowledge → Comparisons |
| F19 Question and seed discovery | [Spec](../design/F19-discovery-from-questions-and-papers.md) | Discover → Explore questions, seeds and citations |
| F20 Distinct relationship layers | [Spec](../design/F20-distinct-relationship-layers.md) | Map |

## Upgrade

Run `npm install`, `npm run db:migrate`, then restart VANI. Startup also applies migration `007_connected_research.sql`. It adds note references/images/backlinks, project reading questions and queues, entities and alias audit, typed object connections, suggestion review, argument outlines, comparison cells and discovery-run records. Existing paper IDs, source PDFs, passage URLs and F01–F10 records remain valid.

All new endpoints live under `/api/v1/knowledge`. Source, entity, edge and outline inputs use shared Zod schemas. PUT is now included in the API's CORS methods for the existing and new save operations. Concurrent paper creation serializes citation-key allocation and rechecks identity inside the transaction; simultaneous imports do not allocate the same key.

## Notes and reading

Create a note, choose **source**, **topic** or **argument**, and write in Markdown. Existing claim and synthesis notes remain supported. The live preview renders GFM tables and `$inline$` / `$$block$$` equations. Upload PNG, JPEG or WebP images (10 MB maximum) to local object storage. Only signature-matched raster images are accepted; the preview disables raw HTML and remote images. KaTeX runs with trust disabled. Renderer dependencies and fonts are bundled locally and loaded with the knowledge screens.

Add a source passage separately as a quote, figure or table reference. The quoted excerpt and source link appear outside the personal interpretation. A figure/area reference points to the original PDF selection; it is not an automatically cropped image. Link other notes with a rationale and inspect backlinks. Links reuse the latest source note, so edits do not create disconnected copies.

Notes retain their existing collection association; source-paper and argument associations are editable. The list searches titles and Markdown, filters type and pages 100 notes at a time. Pickers currently show up to 500 works, notes, entities, arguments or recent passages; larger-library selection is a documented initial limit.

In **Reading plan**, select a manual project, record the question a paper may answer and why it was saved, set status/priority/order, and queue a chosen subset. **Resume next** selects a queued unfinished paper by descending priority, ascending order, then title. Read, cited, rejected and archived papers are skipped. The PDF reader restores its existing per-attachment position. Reading history reflects saved PDF positions; metadata-only records have no PDF reading timestamp.

Project states are independent. Saved-search collections cannot receive manually edited reading plans. Planner revisions also advance when F05 or legacy status controls change a membership, preventing a stale planner from overwriting those edits. A work merge copies the new question/queue fields when the target lacks that project membership; overlapping target state still wins, with the source retained in the F04 audit.

## Connections, entities and suggestions

Connect a paper, passage, note or entity to another object. Choose the relation, explain the rationale, and optionally attach passages. New manual connections carry `origin=user`. Existing accepted suggestions retain their machine derivation and review provenance. A confidence number is never substituted for the author's rationale.

Curate **concept**, **method**, **dataset**, **task** and **author** entities. Candidate names come from stored user tags and author metadata in the 500 most recent works; candidates require explicit review. They are not automated full-text named-entity recognition. You can change the proposed type before creating an entity.

Merge same-type entities after inspecting the preview. The original ID resolves through an alias chain, and incident connections continue to resolve. Connections between the two merged entities are retired to avoid self-links; their original records remain in the audit. Split a mistaken match by naming a new entity and selecting the aliases and connections to move. Both operations verify the exact preview snapshot and preserve an audit. The latest 50 audit entries are shown; entities and connections are capped at 1,000 displayed records. Names and aliases are not globally unique identifiers, especially for authors.

**Suggestions** use deterministic phrase rules, not an LLM: use/apply cues for methods, extension cues, and comparison cues near curated names/aliases. Inspect the exact sentence, abstract or PDF location, matching rule and heuristic confidence. This is not a calibrated probability or independent fact verification. Simple negation is suppressed, but nuanced language still needs human review.

Generation covers at most 50 selected works, 100 curated entities, 200 indexed pages per work and 30,000 characters per page. It reads existing abstract/text indexes and does not extract new PDFs. Accepting a suggestion checks the source text is still present and creates a `suggested_reviewed` connection. Rejecting persists the decision. Repeated generation/review is idempotent. The latest 500 suggestions are shown.

## Arguments and comparisons

The argument workspace extends the same arguments used by F09. Build an outline of claims, evidence, caveats and open questions. Each block has a stable ID, text and reusable passage/note references. Move blocks up or down and save atomically. Outline passages become available through F09 argument evidence filters; removing a block does not delete the source annotation or its independent argument association.

Preview and download the **saved** outline as Markdown. It resolves current quotations and stable citation keys; unavailable references are explicitly labeled. Up to 100 blocks with 30 passages and 30 notes each are supported. Note and argument saves use optimistic revisions; conflicts preserve the unsaved draft for review.

Create a comparison for up to 20 papers. Columns cover question, method, dataset/population, results, assumptions and limitations. All cells start **Unrecorded**. Enter a finding and select either a passage belonging to that paper or an exact quotation from its current abstract. VANI validates source ownership and quotation presence, records each replaced cell in history, and rejects stale cell revisions. It does not infer that the source logically proves the user's interpretation.

The comparison is a manually curated evidence table; it does not claim automatic extraction or fill absent evidence. Export preserves citations, abstract quotations and unrecorded cells. Source snapshots in cell history describe what was referenced when saved; later metadata changes do not rewrite history. The comparison list shows the latest 100 tables.

## Discovery and graph layers

The explorer accepts a question/topic plus up to five DOI, OpenAlex or local-paper seeds. Local papers need a DOI or OpenAlex source record. OpenAlex resolves seeds and expands outgoing references and incoming citations; Crossref contributes topic search. Exclude terms from titles/abstracts or specific identifiers. Each result records provider, originating seed and traversal direction, and existing library records are marked.

Provider requests use fixed hosts and 12-second timeouts. Each provider/topic and each seed direction returns at most 20 results. This is a bounded metadata neighborhood, not an exhaustive literature review. Provider failures and empty coverage remain visible alongside successful results. Set `OPENALEX_API_KEY` in the API environment if required by OpenAlex access policy; `OPENALEX_EMAIL` is optional. Credentials are not saved in discovery-run records. No API key is purchased or model downloaded automatically.

Import selected results into the library or a manual project. Original provider records are retained even when an existing DOI is reused. Citation edges are created only from provider `referenced_works` entries and only when both endpoints are already local. The import's citation resolution uses up to 3,000 current OpenAlex source records and affects links touching the imported works. Imported PDFs are not fetched by this explorer.

**Map** separates:

- **Direct citations:** directed references from indexed source records; not agreement or evidential support.
- **Shared references:** undirected bibliographic coupling, scored as shared references divided by their union (Jaccard).
- **Semantic similarity:** undirected cosine similarity using F10's cached vectors for the first 2,000 metadata characters, same model/content hashes, threshold 0.5. Configure/index the local model from Search; absent/stale vectors never produce invented links.
- **Evidence relations:** authored interpretations, reviewed suggestions and clearly labeled legacy assertions. Legacy confidence is not presented as measured similarity.
- **Personal organization:** reading-order and organizational connections, separate from scientific claims.

Layer controls filter both the diagram and accessible relationship list. Select a relation to inspect origin, derivation, scores and source data; passage-backed relations expose source links. Collection scope includes scoped work, passage and note connections. Computation covers at most 100 works and 2,000 returned edges, plus at most 1,000 legacy and 1,000 authored candidates; the diagram previews up to 40 objects. Coverage and caps are visible. Missing connections cannot establish that a research gap exists.

Technical references: [react-markdown](https://github.com/remarkjs/react-markdown), [equation plugins](https://github.com/remarkjs/remark-math), [OpenAlex citation traversal](https://help.openalex.org/how-to/api-recipes/), [OpenAlex filtering](https://help.openalex.org/api/filtering/).

## Verification

```sh
npm run check
npm run lint
```

Run integration tests with disposable PostgreSQL/pgvector and disposable object storage:

```sh
DATABASE_URL=postgres://USER@127.0.0.1:PORT/vani_test \
VANI_DATA_DIR=/tmp/vani-test-objects VANI_INTEGRATION_TEST=true \
npm run test -w @vani/api -- --fileParallelism=false
```

The browser harness starts temporary API and Vite services on ports 58086/55178, uses a separate Chromium context, mocks external providers, then closes services. It leaves synthetic records only in the supplied disposable test database:

```sh
NODE_ENV=test DATABASE_URL=postgres://USER@127.0.0.1:PORT/vani_test \
VANI_DATA_DIR=/tmp/vani-test-objects VANI_INTEGRATION_TEST=true \
npm run connected:smoke
```

Install Playwright Chromium or set `VANI_SMOKE_CHROMIUM` to an existing compatible executable. Screenshots default to `/tmp/vani-connected-smoke`; override with `VANI_SMOKE_OUTPUT`.

New tests cover all ten features, safe Markdown rendering, entity merge/split correction, exact source validation, idempotent review, saved outline/cell exports, partial discovery failure, measured graph scores and concurrent citation-key allocation. Browser coverage includes equations/tables/local images, structured figure references, note backlinks, reading queues, typed links, entity creation, suggestion acceptance, argument export, comparison edits, discovery/import and layer filtering. Provider tests use controlled responses; they do not establish live-provider coverage or validate semantic relevance on a research benchmark.

The dependency audit still reports the two pre-existing moderate Vitest development-tool advisories documented with F04–F10; no unrelated major test-runner upgrade is included.
