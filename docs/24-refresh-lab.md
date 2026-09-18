# Collection refresh lab

Start with `npm run build` and `npm run lab:start`. Open
[the local lab](http://127.0.0.1:18082/lab). The developer machine needs existing
Node 22.22+, PostgreSQL 18 with pgvector, and Poppler. This helper does not install
system packages. `npm run lab:status` checks it; `npm run lab:stop` shuts down its
API and PostgreSQL while preserving data. Startup binds only to loopback.

The lab has its own database/cluster on port 55442, API/page on 18082, and private
PDFs, logs, credentials and reports in `.vani-refresh-lab/`. That directory is
ignored by Git. It never reads your production `.env`. Only the explicit refresh
worker and paper enrichment run; scheduled discovery and audits are disabled.
Do not run the fixture test suite against the lab's main database.

1. Create a named collection and upload the seed PDFs.
2. Enter the research question and explicit public search phrases. Save focus
   and seed anchors. The displayed phrases go to scholarly providers; uploaded
   PDF text is not submitted to them.
3. Press **Deep refresh / resume**. Inspect retrieved candidates, run status,
   source coverage and local-model health. Results refresh every five seconds.
4. Label candidates and explain your judgment. Add expected/missed papers with
   a title, DOI/URL and why they belong. These are evaluation labels, not new
   retrieval seeds. They do not silently alter the algorithm.
5. Save a review snapshot before changing the focus or running another round.
   JSON stores all retrieved records, stages, assessments, source paths,
   model invocations, feedback, focus and expected-paper matches. Markdown gives
   a reviewable list and diagnostics. Files are immutable and their paths appear
   in the page. Compare rounds on the same question and expected-paper set.

Retrieval is not admission: review-mode candidates are not automatically added
to collection membership. Metadata-only results are not semantically verified.
Model scores are not calibrated probabilities. Expected-paper matches use exact
normalized DOI/title; publication versions can need manual matching. Expected
papers that are explicit seeds are excluded from the hit-rate denominator. This
rate is coverage of a user-supplied set, not recall of all relevant literature.
Compare two saved JSON reports with `npm run lab:compare -- BEFORE.json AFTER.json`.
The comparison shows newly retrieved papers and changed stages/judgments, and
flags a changed focus or expected-paper set. It never changes a policy.
Historical candidates and their stages remain visible, including stale results.
Snapshots include private collection information and should be shared deliberately.

## Local models

Cloud inference is disabled. On this M1 Max / 64 GB test machine, the optional
lab-owned setup uses Ollama 0.34.2, Qwen 3.5 9B and Qwen3 Embedding 0.6B. The reader
is smaller than the 5090 default, so its judgments are a separate evaluation
configuration. The runtime archive is SHA-256 verified; installed model digests
are recorded in `.vani-refresh-lab/installed-models.json`. The server listens on
127.0.0.1:11436 and stops with the lab. Models/runtime stay under the lab directory;
Ollama also creates its standard local client key under `~/.ollama`.

After initializing the lab, explicitly download/configure these models with:

```bash
python3 scripts/refresh-lab/install-models.py
```

This optional bootstrap targets Apple Silicon macOS and downloads approximately
7.3 GB of model weights. No model is downloaded by ordinary `lab:start`. To select an
existing local Ollama server/model, stop the lab and run:

```bash
python3 scripts/refresh-lab.py start \
  --ollama-url http://127.0.0.1:11434 \
  --reader YOUR_INSTALLED_READER \
  --embedding YOUR_INSTALLED_EMBEDDING_MODEL
```

Settings persist in the lab directory. With no models, D0 retrieval still runs,
but D1–D3 pause. The lab exposes those candidates and the pause instead of claiming
an empty search or pretending lexical retrieval is deep model evaluation. To test
the school's exact configuration, use the same installed models and compare saved
snapshots; different models/hardware are not interchangeable quality measurements.

## Initial findings and validation

A live public-topic smoke test for visuomotor diffusion policies retrieved 100
provider records / 99 deduplicated candidates, then paused at ranking because no
local Ollama server was available on this Mac. Examples included Diffusion Policy,
Universal Manipulation Interface and DROID. This was an infrastructure test, not a
relevance evaluation on the user's uploaded papers. Its results and diagnostics
are retained in the lab's clearly labeled smoke collection.

The investigation also found two production issues: the scanned counter read
`d0` instead of `discovered`, and the collection-update trigger could erase saved
public queries when seed IDs changed and collection keywords were null. The
counter is fixed; migration 013 preserves queries on seed/topic-only edits. The
refresh enqueue path now rejects private-only seeds with no executable public
queries rather than creating an empty search. Existing erased queries cannot be
reconstructed reliably by that migration; re-enter the intended public phrases.
These are confirmed code defects, not yet a diagnosis of the user's Linux run.

Validation: all 138 API tests passed with PostgreSQL integrations enabled on a fresh
disposable lab database (including seed-query preservation, empty-public-input
rejection and the D0–D3 fixture pipeline); three report tests,
workspace builds/type checks/lint, and a Chrome test of PDF upload, focus editing,
expected-paper feedback and snapshot export passed. Mocked model tests establish
pipeline behavior, not semantic accuracy. The user's paper-specific run awaits
seed attachments.

Real-model validation also found that generic JSON mode allowed a null required
screening field, pausing the run. Local generation now supplies the task's JSON
Schema to Ollama, while retaining server-side schema and evidence validation.
See [Ollama structured output documentation](https://docs.ollama.com/capabilities/structured-outputs).
The installed reader passed the exact-quote JSON smoke test; the embedding model
returned 1,024-dimensional vectors. Ollama reported GPU residency for the reader.
These checks do not establish relevance accuracy on the user's papers.

After installing the local models, the same live smoke collection completed
embedding/ranking of 99 candidates and a deliberately limited three-paper D1
screening pass. All three produced validated structured assessments; one paper
advanced to D2 and reached the visible PDF-evidence backlog. The first real-model
attempt's schema error remains in invocation history, followed by successful
attempts after the fix. This bounded smoke run used no user-supplied seed papers
and does not establish D2/D3 relevance quality. The fixture integration test covers
those stage transitions separately.

## Seed-paper evaluation observations

The first three-PDF evaluation exposed filename-only titles and empty abstracts
after upload. For the assisted run, the operator corrected titles/abstracts from
the supplied first pages through the metadata API; the uncorrected state was
preserved privately. This is not an unattended PDF-to-discovery success.

The discovery pool also rediscovered uploaded seeds as public records. Reports
now mark matched seeds/members and exclude them from the new-candidate-record
count. Different publication versions can still occupy separate records. This
annotation does not suppress evidence of duplicate retrieval or silently alter
model selection.

Remaining evaluation targets include automatic seed metadata extraction,
column-aware PDF text for synthesis, resolving uploaded bibliographies into
citation anchors, filtering supplementary-file records, and version-aware
deduplication before spending deep-reading budget. The local private report
records the actual run settings, operator interventions, and result limits.

The initial seeded run retrieved and embedded 1,338 candidate records from 1,600
provider records. It selected 24 for screening but completed only two D1
assessments, both rediscovered seeds, before the first D2 comparison timed out
and paused the run. A selected count is not a completed-assessment count. The
operator's review shortlist and separately downloaded public PDFs must not be
reported as completed automated D2/D3 results. Follow-up should suppress seed
rediscovery before selection, complete broad screening before long comparisons,
and checkpoint candidate failures without concealing them or blocking all peers.
