# Simple discovery experiment

Branch: `codex/simple-discovery-inbox`. This is an opt-in alternative discovery
path integrated into the existing collection page. It does not replace the deep
reasoning implementation or deploy itself to quasar.

For a more selective second pass, use [Sanity shortlist](33-sanity-shortlist.md).
It retains this broad discovery path and adds a local focus, refined SVM model,
and inspectable inclusion/exclusion decisions.

## What to try

1. Open a manual collection and expand **Discovery settings** under
   **Recommended papers**.
2. Enable simple discovery. Save explicit public queries such as `adaptive mesh
refinement`, `sparse spatial representations`, and `hierarchical spatial
discretization`. These are examples, not an evaluated GoLF search policy.
3. Choose OpenAlex, Crossref, and/or arXiv. arXiv can also supply a recent category
   feed; the defaults are `cs.CV,cs.LG,cs.RO`. Save discovery settings.
4. Press **Refresh recommendations**. Metadata appears as batches complete.
   Expand source coverage to see counts, exhausted/limited searches and failures.
5. Use **Good match** or **Poor match** to train and rerank locally. Poor matches
   remain in the Dismissed view; Clear feedback reverses the judgment. A note is
   stored for review, but this classifier does not interpret its text.
6. **Save to collection** immediately adds a member and a positive training
   example. Recommendations and saved membership are deliberately separate.
7. Optionally import up to 2,000 earlier public candidates, then **Rerank retained
   papers**. Existing closest/related/out-of-scope core feedback becomes a local
   label if the new inbox has no record for that paper. Private/uploaded records
   are excluded from the shared corpus.
8. Turn on the 24-hour schedule when ready. While this mode is enabled, legacy
   daily discovery is skipped for this collection. Feedback reranking does not
   postpone the next source refresh.

Existing collection members and focus anchors are positive seed examples. Their
titles and abstracts train locally; uploading a private seed does not authorize
sending its content to a public provider. Public queries/category codes are the
only online search inputs. The deeper refresh/focus controls remain available in
the collapsed **Deep reading and research focus** section.

## What changed

The loop is: collect public metadata → TF-IDF text features → locally trained
linear SVM ranking → visible inbox → human feedback → rerank. With no usable
positive training examples, the UI labels a cosine-similarity fallback to the
locally held focus and public-query text.

This follows [arXiv Sanity Lite's](https://github.com/karpathy/arxiv-sanity-lite)
simple feedback loop, not a byte-for-byte port. The TypeScript implementation
fits a deterministic class-weighted squared-hinge linear SVM with gradient
descent; it does not use scikit-learn's solver. Explicit negative judgments carry
more training weight than unlabeled background. Author names are excluded from
the scientific text vocabulary. No Python ML dependency, embedding server, LLM,
PDF download, or cloud token is needed for this path.

Each card exposes actual weighted terms, a cosine baseline, and source/query
provenance. Ranking scores are not relevance probabilities or scientific
evidence. Abstracts are provider metadata, not generated contribution summaries.
Saving does not automatically enqueue enrichment or D2/D3 reading. Existing deep
modules and their APIs remain in place for the next phase of work.

The shared corpus deduplicates DOI variants, arXiv versions, and conservative
title/year identities. Successful sources keep publishing when another source
fails. A throttled source displays its cooldown and can be retried later; it
cannot hold the whole inbox behind an error. API usage is bounded, with spacing
and Retry-After handling; arXiv uses its documented
[Atom search API](https://info.arxiv.org/help/api/user-manual.html).

## Bounds and known limits

| Setting                         | Current bound                                                      |
| ------------------------------- | ------------------------------------------------------------------ |
| Public query phrases            | 8 per collection                                                   |
| Source pages                    | 2 by default; 1–5 pages of up to 100 records per query/source      |
| arXiv category feed             | One bounded combined feed; 12 category codes maximum               |
| Shared ranking pool             | 20,000 recently updated public records, plus labeled/saved records |
| Positive seed members           | Up to 200 members, plus up to 30 focus anchors                     |
| Unlabeled training background   | Deterministic sample of up to 1,500 records                        |
| Vocabulary                      | 20,000 unigram/bigram features                                     |
| Visible recommendations         | 500 by default; configurable 20–1,000                              |
| Earlier public candidate import | Up to 2,000 records per request                                    |

Query retrieval still depends on wording and provider coverage. Sparse lexical
ranking cannot reliably connect ideas expressed with entirely different terms.
There is no exhaustive arXiv mirror, citation traversal, or automatic prose-to-query
rewriting in this experiment. Crossref frequently lacks abstracts and can return
books/chapters; these records remain visibly bibliographic candidates.

The current model and current per-paper scores are replaced during reranking.
Runs retain source tasks/counts/errors and feedback retains its append-only
history, but this experiment does not yet provide immutable snapshots of every
historical ranking. The earlier deep-refresh trace remains separate and intact.

## Isolated execution

Use this branch in a separate checkout and a disposable PostgreSQL database with
pgvector. Do not point the experiment at the production database just to preview
the UI. Build with `npm ci` and `npm run build`; the existing migrations include
the additive `019_simple_discovery.sql` schema.

For a development preview, set these values to your isolated database/data paths
and run the API from the repository root. The example URL assumes a separately
provisioned local test database; it does not create one or configure its password.

```bash
DATABASE_URL='postgres://vani@127.0.0.1:55449/vani_simple_preview' \
VANI_DATA_DIR='/tmp/vani-simple-preview-objects' \
VANI_API_HOST=127.0.0.1 VANI_API_PORT=8086 \
VANI_WEB_ORIGIN=http://127.0.0.1:3004 \
VANI_SIMPLE_DISCOVERY_ONLY=true \
node apps/api/dist/index.js
```

In another terminal in the same checkout:

```bash
VANI_DEV_API_TARGET=http://127.0.0.1:8086 \
npm run dev -w @vani/web -- --host 127.0.0.1 --port 3004
```

Open <http://127.0.0.1:3004/collections>. `VANI_SIMPLE_DISCOVERY_ONLY=true` idles
legacy core/audit/enrichment worker lanes in this API process while leaving the
new discovery worker and scheduler active. It is not a global switch for other
running installations. Without it, existing core jobs may continue even when
simple discovery is enabled for a collection.

The existing [quasar debug regression job](28-quasar-debugging.md) can test the
committed branch without stopping production. The old model-backed lab/browser
jobs are not needed for this metadata-only experiment.

## Verification on the development Mac

- A live query for `adaptive mesh refinement`, one page per source, returned
  **100 OpenAlex + 100 Crossref + 100 arXiv records**, stored as **286 deduplicated
  public records**. All three tasks completed at their configured ceiling.
- Chrome verified live rendering, refresh/rerank controls, settings save, thumbs
  feedback, dismissed/clear behavior, and saving a recommendation. The preview
  collection contained one saved paper after testing.
- The preview database recorded **zero model invocations, zero enrichment jobs,
  and zero core runs**. After the save it trained the local SVM from one positive
  example and 285 background records.
- Regression verification passed **178 API tests (including database
  integrations), 20 web tests, and 14 extension tests**, plus TypeScript checks,
  builds and lint. New tests cover source isolation,
  private seed query safety, deduplication, local feedback, immediate saving,
  settings revisions, and daily scheduling.
- A synthetic 10,001-document ranking benchmark took approximately 553 ms on this
  Mac. This is a throughput observation, not a scientific relevance result.

Private trial JSON/screenshots are kept under the ignored
`.vani-diagnostics/simple-discovery/` directory. This trial establishes that the
new inbox fills without model/PDF gates. It does **not** establish retrieval
quality for the real GoLF or legged-locomotion collections: that requires the
actual seeds and your relevant/missed-paper judgments. Quasar SSH was unreachable
during this implementation, so no production update or quasar validation is
claimed here.
