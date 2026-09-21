# VANI 1.0: local research engine

VANI — **Visualizing Academic Networks and Ideas**. **See how ideas connect.**

## Ubuntu installation — no root or sudo

Use a normal account on Ubuntu 22.04, 24.04 or 26.04 x86_64. No root access, sudo, Docker, systemd setup, or compiler is needed. The source checkout can be anywhere, including `~/vani`; the installed application is a separate snapshot in `~/vani/app`.

```bash
git clone https://github.com/dkkarthik/vani.git vani-source
cd vani-source
bash scripts/setup-ubuntu.sh --check --profile local-5090
bash scripts/setup-ubuntu.sh --dry-run --profile local-5090
bash scripts/setup-ubuntu.sh --install --profile local-5090
```

The installer always prints the full dependency inventory **before making installation changes**, including every missing item and its remedy. `local` and `setup` items are installed automatically inside your home directory. `host` blockers are reported together, and installation stops without changes until they are resolved. `--check --json` returns `checks`, `missing`, and `blockers` arrays. Missing local dependencies are expected before the first install; check exits 2 in that case.

Host requirements: Python 3.10+ with SSL, bz2 and lzma modules, working HTTPS certificates, writable home storage, and a supported OS/architecture. For local models, a working NVIDIA GPU driver must already be available. If the driver is missing, ask the system administrator; VANI never installs drivers or attempts privilege escalation. The 5090 profile needs nominal 64 GB RAM, a 32 GB RTX 5090, and 80 GiB free home space. `local-small` needs 16 GiB RAM and an NVIDIA GPU; its inference speed/memory fit must be tested. `app` requires 15 GiB and skips GPU/model provisioning. No CUDA toolkit or cloud API key is required.

Setup downloads checksum-pinned Node and Ollama. A checksum-pinned micromamba archive extractor unpacks standalone Conda, which installs PostgreSQL 18.6, pgvector 0.8.6, Poppler, tar, xz, zstd and their shared libraries into a private environment. Conda environment registration is disabled so it does not add a user-wide environment registry. Shell profiles and existing environments are untouched. Transitive package versions are resolved from conda-forge, verified by the package manager, and recorded in `~/vani/installed-packages.txt`; they are not a fully locked dependency set. Package references: [conda-forge pgvector](https://anaconda.org/conda-forge/pgvector), [standalone Conda](https://github.com/conda/conda-standalone).

The reader is `qwen3.8:27b-q4_K_M`; the embedding model is `qwen3-embedding:0.6b`. `local-small` uses `qwen3.5:9b`. Actual Ubuntu/RTX 5090 installation and model acceptance still need to run on your machine.

All VANI application data and managed runtime files live under `~/vani`, regardless of `XDG_DATA_HOME`:

| Folder/file | Contents |
| --- | --- |
| `app/` | Installed application snapshot and npm packages |
| `config/vani.env` | Private configuration and database credentials |
| `runtime/` | Node, PostgreSQL, PDF tools, archive bootstrap, Conda and Ollama |
| `postgres/` | PostgreSQL cluster, including collections, conversations and reasoning |
| `data/` | Local PDFs and application object storage |
| `models/` | Ollama model weights |
| `cache/`, `tmp/` | Download/package caches and temporary working files |
| `backups/` | SQL dump before every migration |
| `logs/` | Supervisor, database, model server, API and web logs |
| `bin/vani` | Start/stop/status command |

Secrets are mode 0600; new managed directories are private. Settings are parsed as data, never sourced as shell code. The installer preserves existing managed credentials and backs up before migrations. It rejects unmanaged clusters and PostgreSQL major-version mismatches. PostgreSQL uses SCRAM authentication and binds to `127.0.0.1:55432`; the UI listens on all IPv4 interfaces at port 3000, while API/Ollama use loopback ports 8080/11435. See [LAN access](27-lan-access.md) to restrict the UI to localhost. Port conflicts fail explicitly. The owned Ollama runtime disables cloud models and loads at most one model at once.

```bash
~/vani/bin/vani status
~/vani/bin/vani stop
~/vani/bin/vani start
bash scripts/setup-ubuntu.sh --install --profile local-5090 --resume
bash scripts/setup-ubuntu.sh --check --profile local-5090 --json
```

Start launches a detached user-owned supervisor; stop shuts down the application and database cleanly. A child-process failure shuts down its siblings and leaves diagnostics in `~/vani/logs`. There is no automatic boot service or restart-on-crash promise. Start VANI after login/reboot; school logout policies may terminate user processes. The foreground equivalent is `python3 ~/vani/app/scripts/setup/launch.py`.

For upgrades, pull the source checkout and rerun installation. Setup stops the managed supervisor, refreshes the application snapshot, rebuilds, backs up and migrates, then starts it again. `--resume` retries checked steps after interruption. Do not manually edit `~/vani/app`; it is replaced on upgrades. The previous snapshot is retained in `app-previous/` until the next upgrade. Existing dependency environments are checked and reused, not silently upgraded across PostgreSQL major versions.

No arguments show help. `--check` and `--dry-run` do not write files; outbound connectivity probes require `--check-network` (local service probes are always allowed). `--yes` accepts the printed local installation plan. `--skip-models` defers model downloads and leaves model readiness incomplete. The old privileged `--install-driver` and `--with-dev-tools` flags are removed. Exit codes: 0 ready/help, 2 missing dependencies or host blockers, 3 unsupported OS, 1 operational failure. Invalid CLI options exit 2.

### Build fails with `tsc: not found`

The initial rootless installer ran `npm ci` with `NODE_ENV=production`, which omitted TypeScript and other development dependencies required to build VANI. The installer now uses `npm ci --include=dev` while keeping the runtime in production mode. npm documents this behavior in its [omit/include settings](https://docs.npmjs.com/cli/v11/commands/npm-ci/#include).

From your original Git checkout (not the generated `~/vani/app` snapshot), update and resume:

```bash
git pull --ff-only
bash scripts/setup-ubuntu.sh --install --profile local-5090 --resume
```

Use your original profile if different. Resume reinstalls the application dependencies with build tools and reruns the build; it preserves the managed database, PDFs, models and configuration. No global TypeScript package or sudo is required.

### Existing installations

A source `.env` or earlier `~/.local/share/vani` installation marker blocks a fresh home install. This is deliberate: setup will not point at an old database or silently replace your library with an empty one. Existing data is left untouched. Preserve an export of the old database, its `.env`, PDF/object-store files, and model files before migration. Stop the old API/worker before moving data. Archive the old source `.env` and installation marker after backup to allow a fresh install, then explicitly restore the database and object store into the new home installation using matching PostgreSQL tools. Source `.env` settings are not imported. If the old Docker database needs administrator access for export, obtain that export before proceeding. Automatic cross-layout data migration is not implemented.

## Using the research engine

Open a collection and edit its research question, objective, explicit anchor papers, contribution facets, public search queries, exclusions, and audit timezone. Saving a paper does not automatically make it an anchor. Existing paper seeding still carries explicit seeds into the focus. Keyword edits version the focus and invalidate earlier assessments while retaining saved membership and original reasons.

Press **Search / resume** or **Deep refresh**. Scheduled collection refreshes use the same durable pipeline:

1. **D0:** OpenAlex query/citation/reference/author frontiers and complementary Crossref retrieval stage candidates separately from membership. Article/blog URLs contribute DOI/arXiv bibliography leads with retained article provenance. Default frontier budget is 20,000 retrieved records; repeated identities merge paths.
2. **D1a:** Local title/abstract embeddings, lexical facets, normalized bibliographic coupling/co-citation, and separate seeded PageRank walks rank the pool. Author overlap has a capped contribution; raw citation popularity cannot establish closeness. Up to 2,000 candidates receive cheap screening, with deterministic exploration. D1b generative screening is selective: up to four times the D2 ceiling, at least 40 when the candidate pool permits it.
3. **D2:** Up to 40 candidates receive targeted local-PDF comparisons against explicit anchors. Missing PDFs become a visible reading backlog. Exact quotes and source identities are validated. Proximity, relationship role and experimental compatibility are separate fields. Closest requires evidence from both works and an identified focus facet when facets are configured.
4. **D3:** Up to 10 closest candidates receive a broader bounded dossier; users can explicitly request deeper reading. Relevant excerpts, source hashes, quotes, model digest and history are saved. D3 does not mean every page or supplement was read. The source packet and stated gaps show actual coverage.

The ceilings are limits, not quotas or completeness claims. Graph neighbor lists and source pages are bounded and coverage reports omissions. Crossref's complementary query returns up to 100 records; OpenAlex frontiers paginate. Local embeddings rerank retrieved papers; they are not an embedding index of the entire worldwide literature. DOI matching merges provider duplicates; unresolved publication/preprint families can still require the existing duplicate/version tools.

Source-checked relationship inferences appear on the collection map without overriding curated edges; a changed focus removes stale projections. Their confidence is explicitly uncalibrated.

Review mode is the default. **Accept and obtain PDF** records your decision and queues PDF acquisition plus a contribution summary. A publisher restriction or missing public PDF is reported explicitly; VANI does not bypass access controls. Automatic mode additionally requires a promoted policy and a D2/D3 source-backed relationship. Canary-selected candidates require review.

## Continuous learning

Every three local-calendar days the early audit freezes all retained candidates, including discarded and promoted records. Monthly audits freeze papers with completed D2/D3 assessments. Each audit checks all frozen metadata records and selectively rejudges up to 100 early or 50 deep records, reserving at least 25/10 controls where available. Reports distinguish metadata checks from fresh semantic judgments and store sampling probabilities. Model judgments and the final collection remain provisional; unjudged papers are not negatives.

Audits run in the configured quiet window (default 02:00–06:00), after 15 idle minutes, only when GPU load/headroom can be verified and discovery has no queued work. Interactive requests abort active audit inference. Checkpoints persist; two/six-hour audit budgets produce an explicit partial result if exhausted. The next scheduled audit can include unfinished records. `OLLAMA_AUDIT_MODEL` optionally selects a different installed local reasoning model.

Audit suggestions move at most 10% of retrieval weight mass. They cannot silently activate. Calibration uses frozen, initially unjudged candidate groups with independent human labels. Holdout labels are not supplied to audit prompts. Ten distinct research-question groups, 50 pairs and ten closest judgments are minimum data gates, not claims of statistical power. The evaluator computes paired question-group bootstrap improvement, precision@10, recall at the D1 ceiling, regressions and cheaper lexical/semantic/graph baselines. A passing shadow policy becomes a 5% screening canary. A second disjoint prospective evaluation is required for activation. Paper identities cannot be reused across holdout evaluations. These are candidate-pool metrics, not measured recall of all published literature.

Monthly audits currently diagnose deeper-reading quality and feed the same guarded retrieval-weight policy mechanism. Autonomous changes to D2/D3 prompt rules or model weights are not enabled; those require separate adjudicated quality evaluations. Node-split graph experiments, model fine-tuning and cross-collection transfer remain research extensions.

Calibration API (all under `/api/v1`):

- `POST /core/policies/:id/holdouts` with `{question,candidateIds}` freezes a group before labels.
- `POST /core/holdouts/:id/labels` with `[{id,label,reason}]` labels every frozen candidate exactly once. Labels are `closest`, `related`, `background`, or `out_of_scope`.
- `POST /core/policies/:id/evaluate` computes metrics, marks exposed holdouts, and advances/rejects the policy when data suffice.
- `POST /core/policies/:id/rollback` restores its prior active policy without changing saved papers.

Research-question groups must represent genuinely distinct evaluation questions; VANI can enforce disjoint papers but cannot certify human independence from a label submitted through a local API.

## Local conversations and optional escalation

Ask VANI retrieves collection-scoped originals, notes and stored assessments. Generation stays on Ollama even if a cloud key exists. Quotes are checked against supplied text; synthesized claims are labeled separately from direct quotations. Conversations persist across reloads; requests support cancellation and idempotency. Missing models produce a clear unavailable state with an explicit source-excerpts option, never a silent cloud fallback.

Routine synthesis, embeddings, D1/D2 and conversations are local. Optional cloud escalation is restricted to a previewed D3 evidence packet containing open-access works after local targeted reading. Private notes and the collection's unpublished focus are excluded. To enable this advanced API, set `VANI_CLOUD_MODE=approved`, `OPENAI_API_KEY`, `OPENAI_MODEL`, and positive `VANI_CLOUD_DAILY_TOKENS` / `VANI_CLOUD_MONTHLY_TOKENS`. Merely setting the API key does nothing.

`GET /core/candidates/:id/escalation` previews exact evidence, model, packet hash and conservative token reservation. `POST` to that path with `{packetHash,reason}` explicitly authorizes that unchanged packet. A one-use reservation is consumed before dispatch, including uncertain failures. Token caps reserve a conservative envelope rather than billing actual provider cost. Failed/uncertain escalations should be inspected in invocation history before authorizing another request. Remote audit escalation is not exposed automatically.

## Verification and acceptance

Development verification covers migration from an empty PostgreSQL database, the D0–D3 flow with local provider fixtures and a real PDF, stale-focus protection, membership history, server-side conversation scope, quote validation, local routing, cancellation/limits, and installer planning/configuration parsing. Model responses in automated tests are fixtures; they do not establish scientific retrieval accuracy.

Before relying on the school desktop unattended, run setup check and `npm run models:smoke`, verify the reported model digests/GPU residency, exercise a real seeded collection through D3, and inspect quiet-window audit reports. Ubuntu installation, sustained GPU residency, throughput and retrieval-quality calibration remain target-machine acceptance work.

### Recorded development verification — 2026-09-13

- `npm run check`: type checks, API unit tests, three web tests, fourteen extension tests, and all production builds passed.
- Isolated PostgreSQL 18 integration run: 134 API tests passed, including migrations, D0–D3, durable local invocation records, self-anchor exclusion, map projections, conversation scope, and two-stage policy promotion. Provider responses were test fixtures.
- Installer fixtures: five tests passed; Python compilation passed. Read-only dry-run on this macOS host correctly returned unsupported-host exit 3 without attempting installation.
- Built application in headless Chrome: collection focus controls and the local conversation route rendered without page errors. The existing structured question planner remains available at `/questions`.
- A synthetic sparse graph of 20,000 candidates ranked in approximately 1.7 seconds in a background worker on the development machine. This excludes retrieval, embeddings, PDF processing and model generation and is not a 5090 throughput benchmark.
- Ubuntu VM installation, real local-model inference and GPU performance were not run on this development host. Use the setup and model-smoke commands on the school desktop to finish hardware acceptance.

### Rootless installer verification — 2026-09-14

- Eighteen installer tests passed, including real child-process shutdown and crash cleanup, complete missing-dependency reports, read-only planning, credentials/path guards and backup-before-migration failure handling.
- A real temporary PostgreSQL 18 cluster passed initdb, SCRAM authentication, vector/pg_trgm loading, migration, second-run backup preservation and clean shutdown. This used native macOS PostgreSQL, not the Ubuntu binaries.
- The Linux package set resolved successfully with Ubuntu 22.04 kernel/glibc metadata (90 packages). The standalone Conda archive checksum and executable layout were verified. This verifies package resolution and archive structure, not execution of the Linux installer.
- Python compilation, shell syntax and repository lint passed. End-to-end Ubuntu/5090 installation remains target-machine acceptance work.

### Install outside your home directory

Supply `--install-dir` for a dedicated folder you can write to, without sudo:

```bash
bash scripts/setup-ubuntu.sh --check --profile local-5090 --install-dir /mnt/research/vani
bash scripts/setup-ubuntu.sh --install --profile local-5090 --install-dir /mnt/research/vani
/mnt/research/vani/bin/vani status
```

All application files, data, models, caches, configuration, logs and backups use
that directory instead of `~/vani`. Quote paths containing spaces. Relative paths
are resolved from your current directory; `~` is supported. Check/dry-run remain
read-only and report the selected absolute path and its disk space.

Repeat `--install-dir /mnt/research/vani` when resuming or upgrading from your Git
checkout. Installed start/stop/status commands and the foreground launcher infer
their location automatically. Omitting the option from a source checkout still
selects `~/vani`. The directory must be writable by your account; setup never
uses sudo to change that. Choosing another folder does not move your existing
library. Do not move an installed runtime manually; its configuration and package
prefixes contain absolute paths. Only one installation can use the default ports
at a time.
