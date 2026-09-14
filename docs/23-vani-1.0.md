# VANI 1.0: local research engine

VANI — **Visualizing Academic Networks and Ideas**. **See how ideas connect.**

## Ubuntu installation

Use the school desktop's normal user account, not a root shell. The installer targets Ubuntu 22.04, 24.04 and 26.04 on x86_64. Actual Ubuntu/RTX 5090 acceptance still needs to run on that machine; the development verification uses macOS and PostgreSQL 18.

```bash
git clone https://github.com/dkkarthik/vani.git
cd vani
bash scripts/setup-ubuntu.sh --dry-run --profile local-5090
bash scripts/setup-ubuntu.sh --install --profile local-5090
```

The 5090 profile uses `qwen3.8:27b-q4_K_M` for reading and reasoning, and `qwen3-embedding:0.6b` for embeddings. It targets a 32 GB GPU, nominal 64 GB system RAM and at least 80 GiB free disk. The smaller profile uses `qwen3.5:9b`; `app` installs the application without models. Neither requires a cloud API key or CUDA toolkit.

The installer downloads pinned, SHA-256-verified Node 22.22.0 and Ollama archives, installs Ubuntu packages, creates a private PostgreSQL Docker project, builds VANI, migrates the database, and starts user services. It never runs npm as root. It preserves `.env` values, parses them as data, stores new secrets with mode 0600, and backs up the database before migration. An incompatible existing database/client or service stops installation with an error; it is not overwritten.

Default native endpoints are UI `http://127.0.0.1:3000`, API `http://127.0.0.1:8080`, installer-owned Ollama `http://127.0.0.1:11435`, and PostgreSQL `127.0.0.1:5432`. Existing `.env` values take precedence. The installer-owned Ollama service disables cloud models, uses one parallel request and one loaded model. Docker deployment from earlier releases is not the supported local-model path because the inference router requires a loopback endpoint in the API's network namespace.

```bash
bash scripts/setup-ubuntu.sh --check --profile local-5090 --json
bash scripts/setup-ubuntu.sh --install --profile local-5090 --resume
npm run models:smoke
```

No arguments print help. `--check` and `--dry-run` do not install, write configuration or invoke sudo. They inspect local services; outbound connectivity checks require `--check-network`. `--install-driver` explicitly authorizes Ubuntu's recommended NVIDIA driver installation; a requested reboot exits 4. `--skip-models` defers downloads and reports incomplete model readiness. `--yes` accepts the printed install plan; `--with-dev-tools` adds compiler/Git packages. Exit codes: 0 ready/help, 2 dependencies incomplete, 3 unsupported host, 4 reboot, 1 operational failure; invalid CLI syntax exits 2.

State, journals, runtimes, model files, database configuration and backups live under `$XDG_DATA_HOME/vani` (default `~/.local/share/vani`). An ownership marker prevents another checkout from silently taking over that installation. Resume rechecks idempotent operations instead of trusting a potentially stale checkpoint. Download interruption is safe but restarts the current archive transfer. Existing external PostgreSQL instances require a compatible `pg_dump` client; the owned container uses its matching client.

```bash
systemctl --user status vani vani-ollama
journalctl --user -u vani -u vani-ollama -n 100
systemctl --user restart vani
systemctl --user stop vani vani-ollama
```

User services normally start at login. For unattended boot, explicitly enable lingering with `loginctl enable-linger "$USER"`. Services are local single-user tools; exposing them to a network requires a separate authenticated deployment design.

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

Before relying on the school desktop unattended, run setup check and `npm run models:smoke`, verify the reported model digests/GPU residency, exercise a real seeded collection through D3, and inspect quiet-window audit reports. Ubuntu installation, NVIDIA-driver changes, sustained GPU residency, throughput and retrieval-quality calibration remain target-machine acceptance work.

### Recorded development verification — 2026-09-13

- `npm run check`: type checks, API unit tests, three web tests, fourteen extension tests, and all production builds passed.
- Isolated PostgreSQL 18 integration run: 134 API tests passed, including migrations, D0–D3, durable local invocation records, self-anchor exclusion, map projections, conversation scope, and two-stage policy promotion. Provider responses were test fixtures.
- Installer fixtures: five tests passed; Python compilation passed. Read-only dry-run on this macOS host correctly returned unsupported-host exit 3 without attempting installation.
- Built application in headless Chrome: collection focus controls and the local conversation route rendered without page errors. The existing structured question planner remains available at `/questions`.
- A synthetic sparse graph of 20,000 candidates ranked in approximately 1.7 seconds in a background worker on the development machine. This excludes retrieval, embeddings, PDF processing and model generation and is not a 5090 throughput benchmark.
- Ubuntu VM installation, real local-model inference and GPU performance were not run on this development host. Use the setup and model-smoke commands on the school desktop to finish hardware acceptance.
