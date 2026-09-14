# Rootless installation revision

Supersedes the privileged installation portions of F43 and VANI-1.0.

## Contract

Check the entire prerequisite inventory before any installation writes. Print all missing items, their remedies, and whether setup can install them locally. JSON exposes the same inventory and missing/blocking lists. Check/dry-run never create directories. No sudo, apt, Docker, system service installation, shell profile changes or driver modification.

All managed application files, configuration, PostgreSQL cluster, PDFs, models, caches, temporary files, logs, backups and installer journals live in `~/vani`. The source checkout may be anywhere (including `~/vani`); setup copies a runnable snapshot into `~/vani/app`. Ignore XDG_DATA_HOME. Do not import old database URLs/data paths silently. Detect earlier configured installs and stop with migration instructions; never create an empty replacement for existing research data.

## Provisioning

Bootstrap a checksum-pinned micromamba executable using Python's archive reader. Use micromamba only as an archive extractor for checksum-pinned standalone Conda, with environment registration disabled. Use an isolated conda-forge environment for PostgreSQL 18, matching pgvector, Poppler, tar, xz and zstd. Save the resolved explicit package list. Use the existing pinned Node/Ollama downloads. No compiler or container daemon is required. The minimum host bootstrap is Ubuntu x86_64, Python 3.10+ with SSL/bz2/lzma, working HTTPS trust and writable home space. Local model profiles additionally require adequate RAM and a working NVIDIA driver/GPU. Missing host requirements stop install only after the complete report is printed.

PostgreSQL listens only on 127.0.0.1:55432, uses SCRAM password authentication, private filesystem permissions and a cluster ownership marker. Probe available vector/pg_trgm extensions before migrations; back up before every migration. Preserve existing managed config/cluster and reject conflicting data paths, remote database URLs, or an incompatible major version.

## Lifecycle

Use an unprivileged foreground supervisor and a detached start/stop/status command under `~/vani/bin/vani`. It owns PostgreSQL, Ollama and the application children, writes logs under `~/vani/logs`, and shuts down children on termination. No systemd user manager or lingering is required. Lock out concurrent supervisors/installations. A crash of any child terminates the others and records failure. Start on login manually; no unattended boot promise.

## Verification

Test complete preflight reporting and no-mutation modes, bootstrap/checksum handling, no privileged commands, paths with spaces, source snapshots, legacy-data guards, secret permissions, configuration-as-data, managed database authentication/backups, supervisor lifecycle and partial-failure behavior. Run relevant application checks. Report Ubuntu/GPU tests separately from local fixture verification.
