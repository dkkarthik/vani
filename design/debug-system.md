# Debug system implementation

SSH is the transport; no HTTP shell or production debug endpoint is introduced.
The laptop controller deploys a committed Git archive to a marked, separate root
and invokes a small named-job runner. Each commit gets its own checkout; unfinished
jobs prevent redeployment. All paths are checked for overlap with production.

Commands: deploy, run, status, logs, cancel, fetch, tunnel, recover.
Jobs: doctor, snapshot (read-only production APIs), regression (fresh isolated
PostgreSQL), model-smoke, browser, lab and soak. GPU jobs require --maintenance, checkpoint
whether production was running, stop it with the owned control command, run a
separate loopback Ollama on 11437 using installed weights, then restore production
in finally. A host job lock prevents two debug jobs from running simultaneously.
The initial design intentionally uses a maintenance window rather than claiming
production/sandbox database locks coordinate a shared GPU.

The regression job installs/builds only in its committed debug checkout, starts a
private PostgreSQL cluster on 55442, creates a uniquely named test database, and
runs integrations, web/extension tests, lint, installer/debug tests and report tests.
It never migrates the production database. Lab uses its own marked data directory
and loopback port 18082. SSH maps laptop 3001 to lab 18082. Soak samples the running
sandbox health for a bounded duration; it does not invent a GoLF fixture or claim
scientific quality or daily-scheduler coverage from empty-lab liveness.

Each job has a stable ID, manifest, append-only log, timestamps, steps, exit status,
revision and runtime/model health artifacts. Status detects a lost process lock and
reports interrupted. Cancel targets the recorded job PID only after checking its
process identity and UID. Recovery after forced termination/reboot is explicit:
stop owned sandbox services and restart production only if its maintenance journal
says this job stopped it. Normal cancellation and failures restore it automatically.
Never kill an unknown process or an occupied unrelated port.

Deploy is non-root; it does not install system dependencies, change firewall/SSH
configuration, copy private keys, or add a system service. Missing runtime tools
are reported by doctor. No production collection or query changes are included.
The database/process boundary isolates test data; executing trusted repository code
under the same Unix user is NOT an OS security sandbox against malicious code.

Verification: archive/path checks, jobs/arguments validation, environment isolation,
job locking, cancellation identity checks, maintenance recovery, subprocess cleanup,
log redaction and a real detached fixture job on the development host. Actual 5090
acceptance remains pending SSH access and is recorded as not run until executed.
