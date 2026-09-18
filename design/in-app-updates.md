# In-app updates for managed Ubuntu installations

## User flow

A global update notice checks the official GitHub main branch at most every six
hours. Settings shows installed/latest commit, a manual check, and Update VANI.
The button installs the checked commit from dkkarthik/vani; no repository, branch,
shell command, or filesystem path is accepted from the browser. New commits after
that check appear on a subsequent check. One initial terminal upgrade is required.

## Execution and data

The rootless launcher identifies the managed installation and Python interpreter.
The installer records the source commit and a digest of copied application sources.
Unsupported developer checkouts and changed managed sources cannot self-update.
Checks use GitHub's public commits API; failures are visible and cached briefly.
Only a button click starts installation. Mutations require loopback, a recognized
local Host/Origin, and a custom same-origin request header.

A file lock coalesces simultaneous requests. A detached Python worker survives
service shutdown and writes atomic progress under <install>/updates. It downloads
a commit-pinned GitHub archive, rejects traversal/links, and invokes the existing
installer with the existing root/profile and --skip-models. It never edits the
user's source checkout. The installer provides its database backup, migration and
restart workflow. Source checkout edits, research data, PDFs, model files and
configuration are retained. Active inference stops during maintenance.

The UI polls persisted status while services are reachable and shows reconnecting
with recovery instructions during downtime. After successful restart it offers
Reload VANI. Failures are recorded in updates/status.json and logs/update.log;
if the API cannot restart, the browser cannot retrieve the failure, so it explicitly
shows the log/recovery instructions after extended disconnection. No automatic
schema rollback or claim of zero downtime: recover with the normal installer from
a known-good source checkout and inspect the saved database backup if migrations
failed. Interrupted jobs are identified from the process lock, never silently
reported successful. No background installations and no automatic model downloads.

## Verification

Test check caching, archive safety, single-worker lock, pinned installer arguments,
source-edit protection and error persistence, API request guards and UI start /
reconnect/success behavior. Run installer lifecycle tests, workspace checks and
builds. Actual Ubuntu install/restart acceptance remains a target-host check.
