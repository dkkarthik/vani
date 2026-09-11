# Research workspace: F04–F10

Each feature has a specification written before implementation:

| Feature | Specification | Entry point |
| --- | --- | --- |
| F04 Deduplication and version identity | [Spec](../design/F04-deduplication-and-version-identity.md) | Organize → Identity |
| F05 Flexible collections and status | [Spec](../design/F05-flexible-collections-and-status.md) | Organize → Collections |
| F06 Batch cleanup with undo | [Spec](../design/F06-batch-cleanup-with-undo.md) | Organize → Cleanup |
| F07 Dependable PDF reading | [Spec](../design/F07-dependable-pdf-reading.md) | Read |
| F08 Durable passage links | [Spec](../design/F08-durable-passage-links.md) | Annotations → Open/Copy passage |
| F09 Evidence workspace | [Spec](../design/F09-library-wide-evidence-workspace.md) | Evidence |
| F10 Hybrid search | [Spec](../design/F10-hybrid-search-with-passage-previews.md) | Search |

## Upgrade and run

Run `npm install` and `npm run db:migrate`, then restart the API and web application. API startup also applies migration `006_research_workspace.sql`. The migration adds aliases, tags, import/cleanup audit, document indexing, reading positions, arguments and embedding caches. Existing original files, work IDs, citation keys and F01–F03 data are retained.

The API server requires Poppler (`pdfinfo`, `pdftotext`) for text indexing. It is already included in the API Docker image; native macOS users can run `brew install poppler`. PDF.js and its worker are bundled locally and loaded when the reader opens.

## Identity and organization

Select two papers in **Organize**, then **Identity → Use two selected papers** to compare them. You can also start from a suggested pair.

A logical merge keeps the target's canonical metadata and preserves the original record as an alias. Old IDs and citation keys continue to resolve. Attachments and notes from the alias family remain available in the reader. Target project state wins where both records were already filed; original states are retained in the source memberships and the merge-history snapshot. Metadata assertions remain available for F03 field-by-field review.

Different nonempty DOIs and different known manifestation types block merging. Record **preprint_of**, **version_of**, **corrects** or **retracts** instead, with a reason and optional supporting URL. Reader notices identify these as user-recorded relationships. VANI does not claim that a registry independently confirmed a retraction.

Collections can be nested, renamed and reparented. Saved searches use the visible structured filters and update as metadata/tags change. They cannot receive manually added/imported papers. Reading status, priority and relevance belong to a manual project membership. Removing a membership does not delete the paper. **Unfiled inbox** shows papers without an active manual membership.

The workspace displays up to 100 papers per page with a total count. Selection is capped at 100 papers per batch. Tag matching is case-insensitive. A saved-search reading-state rule means a matching state in any project; a manual-collection filter uses that project's state.

## Cleanup and undo

Select papers, choose a cleanup operation, and inspect the before/after preview. Supported operations are field replacement, add/remove tags, consolidation of a tag alias within the selected scope, and whitespace normalization of author/editor names.

Apply and undo are transactional. Changes preserve citation keys and record F03 decisions/correction locks. Undo creates another revision and refuses to overwrite subsequent edits or merges. Reopen previous batches in **Cleanup history**.

## Reading and passage links

Choose the PDF version, navigate pages, change zoom, or search extracted text. Page and zoom are saved per attachment. Text extraction status is visible; use **Retry text extraction** after correcting a missing-tool/file problem.

Select text to save a highlight or comment. **Select area** captures a rectangular region, including on an image-only page. Native annotations store normalized rectangles, page and the original document hash without modifying the PDF. Existing embedded PDF annotations remain in the original PDF; they are not automatically converted into VANI annotations.

A passage URL opens the saved attachment and page even if another PDF has since been added or the work has been consolidated. The reader labels an anchor exact, uncertain or unavailable. Missing quotes, changed file bytes and unavailable pages are never silently relocated. **Create linked note** retains a source quotation and passage URL. Relationship evidence can carry passage IDs; the reader exposes these supporting-passage links.

Extraction is bounded to 100 MB PDF input, 60 seconds per Poppler command, 2,000 pages and 20 MB text. Empty/partial/error coverage is visible. OCR is not included; use an OCR tool on a separate PDF version and retain the original.

## Evidence and search

In **Evidence**, combine topic/comment, collection, tag, annotation-type and argument filters. Edit a comment or its tags, create a linked note, or copy a Markdown source citation. A passage can support multiple named arguments. Removing one argument association leaves the annotation and other arguments unchanged; argument-specific rationale is retained.

**Search** supports exact phrase, lexical terms, and hybrid retrieval across metadata, extracted PDF text, notes and annotations. Results include source kind, matched chunk, document page when applicable, and navigation back to the source. Scores are computed from actual term matches and embedding similarities; the previous illustrative semantic scores have been removed.

Metadata, notes and annotations are read live for lexical search. PDF text requires indexing. Use **Index next 10 documents**, or retry one document. Coverage shows indexed, partial, empty, missing and failed documents.

Search is bounded to 3,000 source records of each kind and 12,000 text chunks per request. It returns at most 100 ranked results and explicitly reports a bounded corpus. Chunk overlap preserves phrase matches across ordinary boundaries. This is an initial local workspace search engine, not an unbounded distributed index.

### Enable local semantic search

Lexical and exact search work without a model. Hybrid retrieval needs a local Ollama embedding model:

```sh
ollama pull embeddinggemma
export OLLAMA_BASE_URL=http://127.0.0.1:11434
export VANI_EMBED_MODEL=embeddinggemma
```

Restart the API with these variables and use **Index next 100 semantic chunks** until the report shows no remaining chunks. Content/model hashes cache vectors; changed text is reindexed, unchanged text reuses its vector. Hybrid uses cosine similarity and reciprocal-rank fusion with lexical matches. If the model is absent, offline or invalid, the UI explicitly reports lexical fallback.

No model is downloaded automatically. No PDF or text is sent to a cloud embedding service by default. Changing `OLLAMA_BASE_URL` changes the destination of configured model requests, so use a trusted local endpoint.

Provider implementation references: [Ollama embeddings](https://docs.ollama.com/api/embed), [PDF.js API](https://mozilla.github.io/pdf.js/api/).

## Verification

`npm run check` and `npm run lint` cover all workspaces. Integration tests require disposable PostgreSQL with pgvector and disposable object storage:

```sh
DATABASE_URL=postgres://USER@127.0.0.1:PORT/vani_test \
VANI_DATA_DIR=/tmp/vani-test-objects VANI_INTEGRATION_TEST=true \
npm run test -w @vani/api -- --fileParallelism=false
```

Browser workflow:

```sh
NODE_ENV=test DATABASE_URL=postgres://USER@127.0.0.1:PORT/vani_test \
VANI_DATA_DIR=/tmp/vani-test-objects VANI_INTEGRATION_TEST=true \
npm run workspace:smoke
```

Use `npx playwright install chromium` or set `VANI_SMOKE_CHROMIUM` to a compatible installed executable. The harness starts temporary API/Vite services and closes them afterward; screenshots go to `/tmp/vani-workspace-smoke` or `VANI_SMOKE_OUTPUT`.

Tests cover stale/incompatible merges, alias IDs/keys and source preservation, nested collection cycles, live saved rules, project-specific state, atomic cleanup and guarded undo, multipage/rotated PDFs, text/area annotations, stable and uncertain anchors, argument reuse, four-source search, explicit fallback and deterministic provider-backed semantic ranking/cache invalidation. The annotated/rotated fixtures are synthetic and validated with Poppler/qpdf; import and reader tests compare original file bytes.

The dependency audit reports two pre-existing moderate development-tool advisories in Vitest/@vitest/mocker. PDF.js has no reported advisory in that audit. Upgrading the test runner requires a separate major-version migration.
