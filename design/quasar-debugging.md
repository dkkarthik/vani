# Sustained debugging and acceptance testing on quasar

## Objective

Make quasar (RTX 5090, 64 GB RAM) the reference host for VANI acceptance testing.
A successful build is not a successful research collection. Track retrieval,
scientific comparison, review/admission, and sustained operation independently.
Every diagnosis and proposed fix should have a reproducible run and a report.

## Access and separation

Use SSH over the user's VPN as the execution channel. Codex can run scoped shell
commands, inspect logs, transfer reports and test a specific Git commit. Obtain
the actual SSH account/port and use the user's existing key or agent. Do not add
an unauthenticated command-execution endpoint on port 3001. Never store credentials
or private seed PDFs in Git.

Production remains `/data/install/vani`, web port 3000. Put debugging beside it at
`/data/install/vani-debug` (or another user-owned directory if permissions require):

- `source/`: separate Git checkout pinned to the tested commit; never run development
  commands in production `app/` or replace it with an experimental checkout.
- `runs/<timestamp>-<commit>/`: manifests, test results, diagnostics and review reports.
- isolated lab PostgreSQL on loopback 55442 with its own role, database and password;
  isolated PDF/object directory; never reuse production DATABASE_URL/VANI_DATA_DIR.
- lab API/UI on loopback 18082. Forward laptop port 3001 through SSH to this port:
  `ssh -N -L 3001:127.0.0.1:18082 <account>@quasar.cse.buffalo.edu`.
  Then use `http://127.0.0.1:3001/lab` on the laptop. This needs the actual reachable
  SSH port; port 3002 is an option only if an administrator exposes SSH there.
- No new public debug listener is required. If direct VPN access to quasar:3001 is
  later preferred, put authenticated access in front of the lab first; lab routes
  can mutate their data and must not become a general production command API.

Reuse installed Node/PostgreSQL/Poppler executables by explicit PATH. Do not run the
normal production installer against the sandbox: it hardcodes production ports.
The existing refresh-lab supervisor already isolates its database on 55442 and API
on 18082; use it from the separate checkout. Keep all raw artifacts private.

## GPU ownership and reproducibility

Separate databases also mean separate model-router advisory locks. They do NOT
serialize model use across production and sandbox. Initially run full inference
acceptance in a recorded maintenance window: capture production checkpoints, stop
production with its owned launcher, run sandbox tests using the existing loopback
Ollama binary/weights with a separate port and state, then stop sandbox inference
and restart production. A wrapper must use try/finally (and signal handling) to
restore production, recording failures. Do not load two large readers concurrently.

A later host-wide GPU lease must be integrated into both production and sandbox
before claiming concurrent runs are coordinated. Sharing the same Ollama server
alone is not sufficient queue isolation. No cloud fallback in acceptance runs.
Record GPU memory/utilization, model names/digests, context, temperature, timeouts,
Git commit, migrations, Python/Node versions and fixture hashes in each run.

## Baseline before changes

Run the checked-in read-only collector from this laptop:

```bash
node scripts/diagnostics/remote.mjs http://quasar.cse.buffalo.edu:3000 \
  .vani-diagnostics/quasar-YYYY-MM-DD-baseline
```

It collects all paginated candidates, saved focus, recent runs, membership,
model/GPU health and update state. GET-only collection does not change the focus,
start a refresh, accept papers or stop services. The updates GET may refresh its
normal GitHub-check cache. Live API pagination is not transactionally consistent;
use a database snapshot over SSH for controlled comparison.

With SSH, capture a database backup and a manifest of GoLF seed attachments before
any correction. Export a bounded collection fixture to the sandbox, preserving
original PDF bytes and metadata while replacing collection/work IDs as needed.
Clone focus/candidates for reproduction as a separate experiment from a fresh
seed-only run; do not mix historical wrong-query retrieval with new retrieval.

## GoLF diagnostic experiments

First inspect saved focus, query provenance, anchors and admission mode. The live
read-only inspection found locomotion queries in GoLF, no contribution facets,
and review mode. Correcting queries and silently auto-accepting papers are different
changes. Fix and test the focus in the sandbox first; do not treat retrieval count
as evidence that scientific relevance is working.

Build a candidate focus from the GoLF seed, with separate facets for adaptive
spatial resolution, sparse graph representations, geometric/connectivity
preservation, and navigation/planning. Query families to evaluate include adaptive
mesh refinement, anisotropic mesh adaptation, adaptive occupancy grids/quadtrees,
sparse spatial representations, graph sparsification, and navigation roadmaps.
These are hypotheses to test, not claims that every paper in those fields is close.
Capture each query, expansion path and score contribution.

Compare three named runs on the same seed:
1. Saved production focus (reproduce the failure).
2. Corrected explicit focus, fixed recorded provider responses (controlled regression).
3. Corrected focus, live retrieval and the 5090 model (real-world acceptance).

Maintain a researcher-reviewed expected-paper set: title/DOI, closest/related/
background/irrelevant, method connection, and reason. Keep a separate held-out set.
Report recall at D0/D1, precision and diversity at D2/D3, and every missed expected
paper's last reached stage/rejection. User labels stay distinct from model labels.

## Test ladder and gates

| Layer | What runs on quasar | Required evidence |
| --- | --- | --- |
| Host | installer check, GPU/driver health, disk, permissions, model identity | exact report, no missing host requirements |
| Regression | typechecks, lint, builds, API tests with fresh PostgreSQL, web/extension tests, installer lifecycle tests | all required tests pass; skipped tests named |
| Ingestion | supplied PDFs and public links into sandbox; metadata/text extraction, duplicate handling | correct titles/abstracts; no seed copies recommended |
| Discovery | query breadth, references/citing expansion, 429/reset, pagination, restart | expected papers retained, retry state survives, no silent drops |
| Local inference | actual configured embedding and reader; D1→D2→D3, quote validity and schema checks | real model results, failure breakdown, throughput and GPU residency |
| Evidence | PDF fetch/index, inaccessible PDF, manual attachment and resume | no unsupported deep judgment; missing PDF actionable |
| Admission | review accept, reject, automatic mode policy gating in sandbox | members change only through the documented policy |
| UI | Playwright against sandbox: focus edits, uploads, refresh, candidates, feedback, conversations | screenshots, console/network failures, persisted state assertions |
| Operations | stop/start, interrupted inference, concurrent refresh requests, source limits | resumable progress; one owner for active work |
| Updates | check, failed install, preserved data, restart in a disposable installation using alternate ports | no production self-update as an acceptance test; mark blocked until isolated installer ports exist |
| Soak | 24-hour run including scheduled discovery and quiet-window audits | queue progress, no unbounded failures, model/GPU telemetry and counts |

Start with bounded smoke tests, then use the production ceilings of 20,000 D0,
2,000 D1, 200 D2 and 50 D3 for GoLF. A full run can take hours; retain checkpoints
and partial results. Model-dependent relevance is not validated by mocked tests.
A one-time short run cannot certify daily scheduling or the 24-hour soak.

## Repeated development loop

Snapshot → reproduce in sandbox → change on a branch → run deterministic tests →
run real-model GoLF regression → compare artifacts → review results → promote the
verified commit through the production updater. Retain previous reports and SQL
backups. Never automatically restore an older schema over newer production data.

The persistent channel is SSH plus the sandbox and on-demand collector, not a
permanently privileged agent. A future diagnostic job runner should expose only
named jobs (health, export, regression, collection-eval, soak), job IDs, bounded
resources, cancellation and redacted results, with authenticated access and an
explicit sandbox ID. No arbitrary shell/SQL/uploaded executable HTTP endpoints.

## Immediate implementation sequence

1. Establish SSH and inspect host/production configuration without printing secrets.
2. Save baseline and backup; provision the separate checkout and isolated lab.
3. Run regression suite on quasar; reproduce GoLF's stored configuration.
4. Run corrected-focus experiment with actual local models and inspect comparison
   failures (preserve raw structured output/evidence mismatch detail privately).
5. Add UI diagnostics for stage counts and explanations. In particular D1b
   `needs_evidence` currently conflates negative screening and spent comparison
   budget; it must not be presented as uniformly missing PDFs.
6. Add collection-aware focus confirmation so locomotion examples cannot silently
   become GoLF's search definition. Show review queue vs admitted-paper counts.
7. Run broad real inference, browser workflow suite, restart tests and 24-hour soak.
8. Document actual pass/fail/not-run results; promote only verified changes.

## Current limits

The read-only VPN API is reachable. SSH port 22 is reachable and its existing host key is recognized. The supplied
account is `kdantu`; noninteractive authentication was rejected by the server. Full on-host regression, isolated model runs, filesystem inspection,
backup and the soak cannot be completed through the existing read-only API. They
remain pending, not passed. The updater reports unsupported despite an installed
revision; inspect build identity/dirty-source state over SSH rather than bypassing
its local-edit protection.

A retained production D1 assessment interprets GOLF as a golf-cart platform.
The short question and empty facets are insufficient context. Add an explicit
regression requiring a seed-grounded contribution brief in shallow screening,
with acronym disambiguation; do not spend D2 slots on this avoidable failure.
Failed D2 raw responses are not retained in assessment history, so the precise
quote/ID validation cause cannot be reconstructed from the current API. Capture
validation failure codes and model response/evidence privately in the sandbox.
