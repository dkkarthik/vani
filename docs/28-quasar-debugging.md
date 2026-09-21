# Sustained debugging on quasar

This system uses SSH keys and a dedicated debug workspace. It adds **no network
command-execution endpoint** and makes **no GoLF focus or membership changes**.
Production source stays at `/data/projects/vani` and the installation stays at
`/data/install/vani`; debugging defaults to
`/data/install/vani-debug`. All commands below run from the Git checkout on the
laptop. No sudo is used.

## Prerequisites

- VPN and key-based `ssh kdantu@quasar.cse.buffalo.edu` must work. The host key must
  already be trusted by SSH. The controller will not bypass host-key verification
  or ask for a password. Shell startup output is separated from JSON and binary
  responses, so login banners and ssh-agent messages cannot corrupt report downloads.
- The account can create the debug directory beside the installation. Use
  `--root /another/writable/vani-debug` on every command if necessary.
- The managed installation supplies Node/npm, PostgreSQL/pgvector, Poppler, Ollama
  and already downloaded models. The runner uses those binaries through its own
  environment, never the production DB connection or cloud credentials.
- Quasar must have outbound npm and Playwright download access for sandbox builds.
  Browser jobs install a pinned Chromium headless shell under the debug workspace
  (`runtime/browsers`) and verify it launches before stopping production. Missing
  OS libraries fail this preflight; no sudo is used.
- Allow extra disk space for a checkout with npm dependencies, fresh test databases,
  private sandbox PDFs, reports and screenshots. Old runs are retained, not deleted
  automatically. A debug-directory permission failure is not worked around by
  writing inside production.

Use `--identity /path/to/key`, `--ssh-port PORT`, or `--host YOUR_SSH_ALIAS` when
needed. Only the key path is supplied; key contents are never copied to quasar.

## Deploy the committed tools

```bash
python3 -I scripts/debug.py deploy
python3 -I scripts/debug.py run --job doctor
python3 -I scripts/debug.py status
python3 -I scripts/debug.py logs
```

`deploy` transfers a Git archive of HEAD. Uncommitted edits are deliberately not
included. Use `--revision COMMIT` to test a specific committed revision. Each commit
has its own checkout, and an active job blocks deployment. Deployment does not
update or stop production.

A run returns a job ID. Commands default to the most recently launched job; pass
`--id JOB_ID` to inspect an older one. Jobs survive disconnecting the laptop or
closing SSH. Reports include revision, steps, timestamps, exit status and log.

## Jobs

| Job | Purpose | Production effect |
| --- | --- | --- |
| `doctor` | Required executables, runtime versions, GPU and disk report | Read-only host inspection |
| `snapshot` | Full API-visible collection diagnostic capture | GET-only; normal update-check cache may refresh |
| `regression` | Build/typecheck/lint, all API integrations in a fresh PostgreSQL DB, web/extension tests, installer/debug/report tests | No production stop or DB changes; shares host CPU/disk |
| `model-smoke` | Actual local reader output/quote, embeddings and GPU residency | Explicit GPU maintenance window |
| `browser` | Real Chromium rendering of sandbox collections/library/search/settings, screenshots and error capture | Explicit GPU maintenance window; route smoke, not all workflows |
| `lab` | Interactive isolated refresh lab | Explicit GPU maintenance window; operator can add fixtures |
| `soak` | Bounded sandbox health sampling after real model smoke | Explicit GPU maintenance window; does not certify research quality or daily scheduling |

```bash
python3 -I scripts/debug.py run --job regression
python3 -I scripts/debug.py status
python3 -I scripts/debug.py logs
python3 -I scripts/debug.py fetch
```

`fetch` downloads finished-job reports into `.vani-diagnostics/quasar/JOB_ID` by
default. That directory is Git-ignored. It does not export database files or PDFs.
Use `--output PATH` for another private report location. Snapshot reports can contain
paper titles, abstracts and collection details; do not publish them inadvertently.

## GPU testing and the debug channel

Production and sandbox have separate DB locks, so they cannot safely coordinate
one 5090 merely by sharing Ollama. GPU jobs therefore require `--maintenance`:

```bash
python3 -I scripts/debug.py run --job model-smoke --maintenance
# Or open the interactive sandbox for up to two hours:
python3 -I scripts/debug.py run --job lab --maintenance --duration 7200
```

The job builds first, records whether production was running, stops it through its
own launcher, starts separate Ollama on loopback **11437**, and reuses installed
model weights without downloading them. Configured OpenAlex/Semantic Scholar
source credentials are passed only to the sandbox and redacted from step logs;
production database and cloud-model credentials are not passed. On completion, failure or normal
cancellation, it stops sandbox services and restarts production only if it had
been running. Production remains unavailable during this window.

In another terminal, create the tunnel:

```bash
python3 -I scripts/debug.py tunnel
```

Open **http://127.0.0.1:3001/lab** on the laptop. This forwards to quasar loopback
18082 over SSH. It does not require quasar to expose a debug HTTP listener. Port
3001 on the laptop is bound to loopback. Quasar's SSH port must be reachable over
VPN; the controller can use a nonstandard SSH port if configured by the owner.

The isolated lab uses PostgreSQL **55442** and its own data under the release's
`.vani-refresh-lab/`. Port conflicts fail instead of attaching to another server.
The browser job temporarily uses loopback **3003** for the production UI connected
to the lab API. No sandbox route points at production PostgreSQL or its object store.

A 24-hour soak can be requested explicitly:

```bash
python3 -I scripts/debug.py run --job soak --maintenance --duration 86400
```

Duration applies to the lab/soak observation period after setup/model smoke. Jobs
also have individual step timeouts. An empty lab only tests liveness. Scientific
fixtures, labeled expected papers and daily-scheduler acceptance are separate
work still required before calling VANI fully validated.

## Cancel, recover and retain results

```bash
python3 -I scripts/debug.py cancel
python3 -I scripts/debug.py status
python3 -I scripts/debug.py fetch
```

Cancellation is graceful and may take time while services stop and production
restarts. Do not kill the worker with SIGKILL. If it was forcibly killed or the host
rebooted, status reports interrupted; normal startup blocks on unfinished recovery:

```bash
python3 -I scripts/debug.py recover
```

Recovery checks recorded process ownership/identity, stops owned sandbox services,
and restores production if the maintenance journal records that it was running.
Older installed launchers may report a port conflict while closed sockets remain
in TIME_WAIT. Restoration retries these failures twice at 35-second intervals;
the updated launcher uses SO_REUSEADDR for its availability probes. A persistent
failure keeps the maintenance journal active for explicit recovery.

If identity checks fail, recovery refuses to signal an unknown process and reports
what requires inspection. There is no automatic production database restore or
schema rollback. Use `logs` plus the private remote run directory for diagnosis.

Sandbox artifacts persist across runs. A new commit gets a separate lab; old labs
are not silently copied. For reproducible experiments, import a deliberate fixture
and record its hashes. Isolation here means separate processes, ports, database and
data. It is not an OS security boundary against malicious code running as the same
Unix account.

## Verification status

Development-host tests exercise safe deployment, root validation, environment
isolation, locks, real detached jobs/cancellation, timeout cleanup, redaction and
maintenance restoration. Quasar dependency checks, full regression, actual 5090
inference, sandbox browser rendering, SSH tunneling and a bounded health run have
now been exercised. See [the acceptance report](29-quasar-debug-acceptance.md) for
revision IDs, outcomes and limitations. GoLF retrieval quality and long-duration
workload acceptance remain separate tasks.
