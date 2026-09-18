# Reliable seeded refresh and daily 5090 operation

## What changed

PDF ingestion extracts titles and abstracts locally before ranking. Prose indexing
uses word geometry to separate repeated column gutters, rather than joining
adjacent columns line by line. Scans and unusual layouts can still need manual
metadata/OCR; missing extraction is reported. Explicit upload titles and later
metadata corrections are preserved. No publication year is inferred from template
headers. Existing seed PDFs are reindexed and missing metadata repaired when next
used by the core algorithm or when enrichment is retried.

Existing collection members, seed copies, supported publication/preprint versions,
and supplementary-file records stay in the retrieval history but are excluded
before embeddings/reading selection. Exact identity/title evidence is required;
conflicting authors or distant publication years prevent title-only version
matching. This is conservative grouping, not universal bibliographic identity
resolution. Each exclusion stores its reason and matching record. A public seed
match can supply public citation metadata and enqueue reference/citing searches;
unresolved uploaded bibliographies are not silently claimed to be resolved, and
uploaded text does not become an online provider query.

Selection reserves space for explicit contribution/method/problem facets alongside
overall rank and exploration. Use a separate facet for each distinct contribution
(e.g. curriculum allocation and risk-aware planning), rather than combining them
in one long facet. All ready D1 candidates are processed before D2/D3.
A paper's timeout, schema error or invalid evidence now causes candidate-specific
backoff (30, then 60 seconds), with a maximum of three attempts per stage per run.
Peers continue. Failed candidates retain errors; a terminal run can be
`completed_with_errors`. A later daily run retries terminal failures, while enqueue
of an already-live run preserves progress/backoff. Manual deep reading resets that
candidate's retry budget. Source or ranking outages still pause the run visibly.

Local generation timeouts default to 180 seconds for shallow tasks, 360 seconds
for D2 and 600 seconds for D3. Optional `VANI_D1_TIMEOUT_MS`, `VANI_D2_TIMEOUT_MS`
and `VANI_D3_TIMEOUT_MS` settings in the managed environment file override these
within 1–600 seconds. D2/D3 have larger generation allowances and concise evidence
packets. Quotes and scientific comparison validation remain enforced. A longer
timeout does not guarantee a valid comparison from a particular model.

Scheduling, PDF enrichment and audit queues have independent worker loops, so one
long paper comparison does not prevent the daily scheduler from running. The model
router continues to serialize local inference and prioritize interactive work.

## Upgrade on the desktop

Run these from your **source Git checkout**, not the managed `app/` snapshot.
Set the installation directory to the same root you already use:

```bash
git pull --ff-only
bash scripts/setup-ubuntu.sh --check --profile local-5090 --install-dir /your/path/vani
bash scripts/setup-ubuntu.sh --install --profile local-5090 --install-dir /your/path/vani
/your/path/vani/bin/vani status
```

For the default location, use `--install-dir "$HOME/vani"` instead. No sudo is
needed. The existing installer backs up the database, rebuilds with development
build dependencies present, applies migrations and restarts the managed services.
Migration 014 requeues active reading/ranking jobs under the fixed eligibility
rules while retaining historical assessment records. Previously completed candidate
judgments are marked stale for re-evaluation on their next refresh; researcher
feedback remains intact. The next anchor preparation
repairs old PDF text indexes. Original PDF files and researcher labels are kept.

Open http://127.0.0.1:3000 on that desktop. In the collection's discovery settings,
enable daily discovery and choose the local timezone/hour. Confirm its saved
research question, seed anchors, public queries and contribution facets, then run
one manual refresh. Collection discovery enablement is separate from quiet-window
audit enablement. Review mode produces candidates for review; it does not silently
add everything to the library.

The application must remain running for daily work. The rootless supervisor
survives the launching terminal, but does not install a boot service or guarantee
survival of school logout policies. Start it after reboot/login with the same
`bin/vani start` command. No daily desktop schedule was enabled remotely by this
code change.

Before leaving it unattended, inspect local model health/GPU residency and one
real collection through D2/D3. Failed/queued counts and per-paper reading errors
are visible in the related-work panel. Check the managed `logs/` directory for
service errors. This Mac verifies application behavior and local inference; actual
5090 throughput, driver compatibility and sustained daily operation must be
verified on that desktop.

## Verification on the development Mac

- 145 API tests passed with PostgreSQL integrations enabled on a fresh isolated
  database, including migrations, D0–D3, failure isolation, retry exhaustion,
  public seed citation expansion, metadata repair and rotated/two-column PDFs.
- Workspace type checks, tests, production builds and lint passed; 22 rootless
  installer tests and four lab report tests passed.
- All three supplied seed PDFs produced their real titles and abstracts locally.
  The live rerun excluded 100 records (seed copies, supported alternate versions
  and supplementary records) before reading selection. A real quote-validation
  failure was retried and exhausted locally while other candidates continued.
- Chrome rendered the live lab without page errors. Full semantic quality and
  5090 hardware acceptance are separate from these software checks; user relevance
  labels remain pending, and no policy was trained on invented reviewer labels.

## Expanded local reading budgets

Defaults are now 200 targeted comparisons (D2) and 50 deep readings (D3) per
refresh. In **Edit focus and anchors**, adjust **Reading ceilings per refresh**
and click **Save focus changes**. Supported maxima are 1,000 D2 and 250 D3;
discovery and screening ceilings remain 20,000 and 2,000. These are upper bounds:
relevance and evidence still determine advancement. Longer runs may span days;
daily discovery coalesces with an active run rather than spawning competing runs.

Migration 015 upgrades individual budgets still set to the old 40/10 defaults;
custom smaller budgets remain unchanged. It preserves historical assessments and
feedback, supersedes affected active runs, and marks candidates for reassessment.
After upgrading, click Deep refresh to begin under the new budgets, or wait for
the next enabled daily refresh. Original run snapshots remain unchanged.

## OpenAlex HTTP 429

429 means a request-rate or daily-budget limit, not a problem with your public
queries. Core discovery now retains its current search cursor and schedules a
retry. It honors Retry-After, and the daily-reset header when remaining budget is
zero. Without timing headers it backs off exponentially. Cooldown is shared across
core discovery runs and survives restart; repeated refresh clicks do not bypass it.
A waiting run stays active, showing its retry time. Other local work can continue.
Other non-core OpenAlex connector paths do not yet share this cooldown.

For broader searches, obtain a free key at https://openalex.org/settings/api and
add it to your existing `<install>/config/vani.env`:

```dotenv
OPENALEX_API_KEY=your_key_here
```

Restart VANI after editing configuration. Do not put the key in public queries,
commit it to Git, or paste it into a support conversation. An API key raises the
keyless allowance but does not eliminate rate limits. For a previously paused
refresh, install this fix and click Search / resume. Tasks already discarded by
older versions are not reconstructed by the migration.

Official guidance: https://help.openalex.org/api/authentication/ and
https://help.openalex.org/api/errors/.
