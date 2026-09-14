# F43 — Ubuntu dependency checker and installer

> Installation update: [Rootless installation revision](F43-rootless-installation.md) supersedes the sudo, Docker, systemd, and old storage-layout portions below. Current setup installs under `~/vani` without root access.

Status: **planned; not implemented**. Requested September 13, 2026. Priority: P1. This feature adds a repeatable Ubuntu setup and diagnostics workflow to VANI. No executable installer, dependency installation or machine configuration is delivered by this specification.

## Outcome

A researcher can inspect a workstation, understand what is missing, install the required dependencies, and verify that VANI can store papers, extract PDF text and use the selected local model. Running setup again preserves an existing library and healthy installations.

The first deployment target is the owner's Ubuntu desktop with an RTX 5090 and 64 GB RAM. Follow the [local model deployment plan](local-model-deployment.md) for model selection and resource budgets. Installing dependencies does not implement the [core proximity algorithm](core-algorithm.md) or its proposed cloud-escalation router.

## Supported environments and profiles

Target Ubuntu **22.04, 24.04 and 26.04 LTS on x86_64**, with systemd. Validate each release in its own test image before claiming installer support. Docker currently lists these Ubuntu releases as supported. Other distributions, architectures, containers and WSL receive an explicit unsupported-install result and whatever diagnostics can be collected safely. [Docker's Ubuntu requirements](https://docs.docker.com/engine/install/ubuntu/).

| Profile       | Intended outcome                                                                                                                        |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `app`         | Native Node API/web processes, PostgreSQL with pgvector in Docker, local PDF tools; no required generative model.                       |
| `local-5090`  | App profile plus native Ollama, `qwen3.8:27b-q4_K_M` and `qwen3-embedding:0.6b`, initially 16K context and one inference job at a time. |
| `local-small` | App profile plus Ollama, `qwen3.5:9b` and the same embedding model; explicit alternative when the larger model is unsuitable.           |

The default install profile is `local-5090`; hardware findings must confirm its suitability. Insufficient memory must produce an actionable result, not silently switch models or offload a large model to CPU. The `app` profile remains usable without a GPU. Offer optional developer/browser-test tools separately from runtime dependencies.

## Proposed command interface

The following commands describe the interface to build. **They do not exist yet.** The entry point must work from any directory and handle repository paths containing spaces.

```bash
# Inspect dependencies without changes or downloads.
bash scripts/setup-ubuntu.sh --check --profile local-5090

# Print the exact proposed actions, privileges and download estimates.
bash scripts/setup-ubuntu.sh --dry-run --profile local-5090

# Install missing dependencies and configure the selected profile.
bash scripts/setup-ubuntu.sh --install --profile local-5090

# Recheck and continue an interrupted installation.
bash scripts/setup-ubuntu.sh --install --resume --profile local-5090

# Produce a redacted machine-readable diagnostic report on stdout.
bash scripts/setup-ubuntu.sh --check --json --profile local-5090
```

No arguments shows help and performs no mutation. `--check` and `--dry-run` never invoke sudo, install packages, start services, pull images/models, run inference, create files or migrate a database. Local read-only service probes have timeouts. Network availability checks require a separate `--check-network` flag; cached version information must be distinguished from remotely verified information.

Additional planned options: `--yes` for routine actions already listed by the install plan, `--skip-models` to defer large downloads, `--with-dev-tools` for browser-test dependencies, and `--install-driver` to explicitly include NVIDIA driver changes. Validate incompatible flags before doing work. Skipped required models mean app-ready/model-pending, not fully ready for `local-5090`.

Exit codes: `0` selected profile ready; `2` required dependency or manual action outstanding; `3` unsupported install target or invalid arguments; `4` reboot/session renewal required; `1` operational failure. Optional warnings do not turn a healthy selected profile into a failure. JSON includes a schema version, profile, overall state and per-dependency findings.

## Dependency inventory

Maintain a versioned dependency manifest so checks, installation and diagnostics use the same requirements. Each entry records profiles, detection and compatibility rules, installation source, verification, privileges, download/storage estimates and whether a restart is needed. Pin tested versions/digests at implementation time; do not blindly upgrade healthy software on every setup run.

| Dependency or capability          | Check                                                                                                                | Installation or remediation plan                                                                                                                                                                                                                                                                                          |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ubuntu and shell                  | Distribution/release, architecture, Bash, systemd, target user and writable install/config/data paths                | Fail unsupported install targets early. Run project tasks as the normal user; elevate individual system actions only.                                                                                                                                                                                                     |
| Workstation resources             | System RAM, available disk on model/data/temp filesystems, GPU memory and competing GPU use                          | Compare to profile allowances and model sizes. Report a suggested smaller profile when needed. Use the deployment plan's 64 GB RAM/100 GB free-disk starting allowance as guidance, not a universal app minimum.                                                                                                          |
| Download/build utilities          | CA certificates, curl, Git, tar/gzip/xz/zstd, and utilities actually invoked by setup                                | Install missing Ubuntu packages through apt. Install compiler/Python build prerequisites only when needed by locked dependencies or the developer profile.                                                                                                                                                                |
| Node.js and npm                   | Version satisfies repository engines and the tested compatibility manifest; usable npm and lockfile                  | Reuse a compatible runtime. Otherwise install a pinned supported LTS distribution from the official source with checksum/signature verification, without overwriting unrelated runtime managers. Repository currently requires Node 22+. [Node downloads](https://nodejs.org/en/download).                                |
| Docker Engine and Compose plugin  | CLI, Compose v2, daemon accessibility, supported versions and usable target Docker context                           | Reuse a working installation. On a clean host install through Docker's signed Ubuntu apt repository. Report conflicting packages instead of removing them automatically. Keep Docker access explicit; do not silently alter user group privileges. [Docker installation](https://docs.docker.com/engine/install/ubuntu/). |
| PostgreSQL and pgvector           | Existing configured connection, server major version, vector extension, readiness and schema status                  | For a new installation use a tested digest of the project's PostgreSQL 18/pgvector image, a named persistent volume and loopback binding. Reuse an explicitly configured database; never replace it with an empty one because it is unavailable.                                                                          |
| PDF extraction                    | `pdfinfo` and `pdftotext` execute; extraction of a known fixture succeeds                                            | Install Ubuntu `poppler-utils`, required by the existing document indexer and first-pass reader. Check `pdftoppm` for future selected-page image processing.                                                                                                                                                              |
| Extension packaging               | `zip` and `unzip` when packaging is requested                                                                        | Install missing utilities; verify the generated archive with the existing extension package command. Browser extension installation remains a documented browser action.                                                                                                                                                  |
| NVIDIA driver, local profiles     | GPU discovery, `nvidia-smi`, usable memory and actual inference acceleration                                         | Reuse a working compatible driver. With `--install-driver`, select an Ubuntu-supported driver appropriate to the detected GPU; handle Secure Boot/reboot requirements explicitly. Do not reboot automatically. [Ubuntu driver guidance](https://ubuntu.com/server/docs/how-to/graphics/install-nvidia-drivers/).          |
| Ollama, local profiles            | Binary/version, reachable local API, installed model digests, service owner and effective settings                   | Install a pinned verified official Linux release and configure a VANI-owned service or clearly identified drop-in. Native Ollama keeps the first deployment independent of GPU container setup. [Ollama Linux installation](https://docs.ollama.com/linux).                                                               |
| Models, local profiles            | Exact configured reader/embedding model identities and local availability; install verification also tests inference | Pull the selected models, show download progress and record resolved digests. Verify local text/JSON output and embedding shape. Measure GPU residency; no hosted model fallback.                                                                                                                                         |
| Application dependencies          | Lockfile, installed workspace dependencies and build artifacts                                                       | Run `npm ci` and the project build as the target user. Never run npm as root. Record the repository revision and lockfile hash.                                                                                                                                                                                           |
| Configuration and application     | Effective environment, data permissions, configured ports, API/database health and web accessibility                 | Generate a launcher/service that actually loads configuration; root `.env` is not currently loaded by native API scripts. Verify the final running processes, not just generated files.                                                                                                                                   |
| Optional test/research components | Playwright/browser availability; future OCR, scientific embedding and reranker worker dependencies                   | Install browser dependencies only with developer tools selected. Add OCR/Python-model workers to the manifest when their VANI integration exists; do not report them as active merely because a package was installed.                                                                                                    |

A CUDA compiler/toolkit or NVIDIA Container Toolkit must not become a blanket prerequisite for this native Ollama profile. Detect the capabilities required by the selected runtime. The future all-container GPU profile has separate container-runtime requirements.

## Install workflow

1. **Discover and plan.** Collect all dependency results before proposing changes. Classify each as ready, missing, incompatible, inaccessible, optional, deferred or reboot-required. Include download sources/sizes, system changes and effects on existing services. Check port ownership rather than assuming an open port belongs to VANI.
2. **Install prerequisites.** Acquire an installer lock, wait a bounded time for apt locks, verify downloads and apply missing package actions. Display privileged actions before elevation. Resume from failures without resetting successful stages. A dependency's presence alone is insufficient if its version or functionality fails verification.
3. **Prepare local inference.** Reuse compatible drivers and Ollama. Apply loopback-only inference, disable Ollama cloud features, use the selected context/concurrency settings, and pull models unless deferred. Existing shared Ollama configuration requires an explicit change plan; never overwrite another workload's service settings silently.
4. **Configure VANI.** Create missing configuration atomically with private file permissions and generate a launcher/service environment. Preserve existing `.env`, data paths and credentials. Parse configuration as data, never shell-source it. Set a new install to local-only behavior with no cloud key and demo seeding disabled. If existing configuration enables cloud, show the conflict and require a resolved local-only launch configuration before claiming cloud-free readiness; do not erase saved credentials.
5. **Prepare storage and build.** Start only the selected VANI database service, wait for readiness, install locked workspace dependencies and build. For new databases run migrations. For existing libraries require a successful backup and the application's supported migration path; migrations are a separate reported action. Never delete volumes, reset schemas or insert demo records during normal setup.
6. **Verify and report.** Test PDF extraction on a temporary fixture, database/vector/schema readiness, API health, web response, local JSON synthesis, embeddings and GPU residency. Temporary data is isolated from the research library and cleaned up. Report separate app, PDF, reader and embedding readiness. Show how to start/stop VANI, access the UI and rerun diagnostics.

Use native API/web services and native Ollama with Docker PostgreSQL, as in the deployment plan. The current Compose API's host-gateway address does not make host-loopback Ollama reachable on Linux. Do not solve this by exposing inference to the campus network. An all-container GPU installation is a later profile.

The current code selects cloud synthesis whenever a cloud key is configured. Until the shared provider router exists, the installer-generated local launcher must explicitly provide an empty effective `OPENAI_API_KEY`. The legacy chat path must be reported accurately: installing Ollama alone does not give that path local generative synthesis.

The required application dependency is **LM-R01 — Shared local-first model router**, specified in the [local-model feature plan](local-model-deployment.md#71-required-implementation-workstream-lm-r01--shared-local-first-model-router). After it is implemented, diagnostics must verify its effective policy and report whether cloud dispatch is allowed; a configured key alone does not imply cloud use.

## Recovery, diagnostics and product integration

Store a redacted installation report with setup version, manifest version, repository revision, detected versions/digests, completed actions and remaining issues in a user-owned configuration/state directory outside Git. Retain managed-file backups and a resume journal. Always recheck actual machine state on resume; journal completion is not proof a dependency still works.

Failures identify the failed stage and a concrete next action. Interrupted downloads, insufficient disk, unavailable sudo, blocked package repositories, Docker socket permissions, API conflicts and failed inference must not end in a success banner. Never print secret values, database passwords, authorization headers or an unrestricted environment dump. Do not auto-remove software or user data as rollback.

Plan a VANI **Settings → System health** view that reuses the same diagnostic schema: application, database, PDF tools, local models, GPU and effective cloud mode. Users can refresh diagnostics and export a redacted report. The web API remains unprivileged; package/driver installation runs through the local installer, not a browser endpoint accepting arbitrary shell commands. CLI setup is available before the app can start.

## Acceptance criteria and verification plan

| Scenario                                         | Required outcome                                                                                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Clean supported Ubuntu host                      | One planned install run produces the selected profile or an explicit reboot/manual-action state with a usable resume command.                    |
| Check/dry-run without sudo or network            | No package, file, service, download, database or inference mutations; unavailable probes are distinguished from missing dependencies.            |
| Existing healthy installation                    | Second install is a no-op for compatible dependencies/configuration; library, models and service settings retain identity.                       |
| Existing incompatible installation               | Report the exact conflict; no package purge, forced upgrade, credential overwrite or database replacement.                                       |
| Interrupted apt/model/build stage                | Re-run verifies and resumes safely; concurrent invocations do not corrupt configuration or state.                                                |
| Driver update or Secure Boot action              | Pending action is explicit; no automatic reboot and no false GPU-ready result.                                                                   |
| Offline/missing-model setup                      | Existing capabilities remain usable; deferred model readiness stays visible and no cloud request occurs.                                         |
| Private configuration and unusual paths          | Paths containing spaces work; secret values are redacted; configuration text cannot execute shell code.                                          |
| Model available but CPU-offloaded or wrong model | Local-5090 verification reports the mismatch and remediation rather than passing on HTTP success alone.                                          |
| Local-only profile with a pre-existing cloud key | Effective VANI and Ollama execution cannot spend cloud tokens; stored credentials are preserved.                                                 |
| Fully verified installation                      | PDF fixture extraction, database/vector checks, application health, local structured output and embeddings pass; report records tested versions. |

Use shell static analysis and fixture-based command tests for parsing, no-mutation modes, process errors, idempotence and redaction. Use disposable Ubuntu 22.04/24.04/26.04 VMs for actual package/service installation, plus an RTX 5090 workstation for driver, memory and inference acceptance. A container-only test cannot establish systemd/driver correctness. Run the relevant VANI checks before committing and pushing the implementation.

## Implementation deliverables and order

1. Shared dependency manifest, diagnostic schema, check-only command and test fixtures.
2. Ubuntu install actions, verified downloads, configuration loader, locking and resumable state.
3. Database/app setup, local-model profile and isolated functional verification.
4. System health UI, deployment documentation and full Ubuntu/GPU acceptance results.

Expected future files include `scripts/setup-ubuntu.sh`, versioned setup helpers/manifest, setup tests and a user installation guide. These are planned paths, not files shipped in this documentation change. Model routing, deep paper analysis and automatic cloud escalation remain separate implementation work.
