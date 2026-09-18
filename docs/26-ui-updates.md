# Updating VANI from the UI

After one terminal upgrade to install this feature, managed Ubuntu installations
show a global **VANI update available** notice when GitHub `dkkarthik/vani` main has
a different commit. Open **Settings → VANI updates** to check manually or click
**Update VANI**. When installation finishes, click **Reload VANI**.

## Enable it once

From a clean source Git checkout, use your existing installation directory:

```bash
git pull --ff-only
bash scripts/setup-ubuntu.sh --install --profile local-5090 --install-dir /your/path/vani
```

Use your existing profile (`app`, `local-small`, or `local-5090`). The managed
launcher supplies the installation location automatically, including custom paths.
Reload the browser after this first upgrade. Later updates use the button, not
this terminal sequence. The UI displays installed and available commit IDs rather
than relying on the currently fixed 1.0 package version.

## What the button does

- Checks GitHub main automatically every two hours while the UI is open, and on every browser page reload.
  Manual checks also bypass the cached result. Simultaneous checks share a lock;
  network failures disable installation until a successful check and are retried.
- Downloads an archive pinned to the commit shown in the UI. If main changes after
  the check, a later check offers the next commit.
- Runs the existing rootless installer in a detached process, retaining your
  installation path and profile. It backs up the database before migration,
  builds the application, and restarts VANI. Existing models are not pulled again.
- Preserves your source checkout, database, PDFs, configuration, and model files.
  Pending work uses the existing restart/checkpoint behavior; inference in progress
  is interrupted. Migrations can explicitly supersede jobs as documented per release.
- Keeps progress in `<install>/updates/status.json` and logs in
  `<install>/logs/update.log`. Repeated clicks do not start parallel update workers.

VANI is unavailable during part of installation. Leave Settings open: it retries
and offers Reload VANI after reconnection. Updates can take several minutes.
Only a click initiates installation; there are no unattended installs.

## Development and recovery

Unmanaged source checkouts do not self-update. A managed installation copied from
an uncommitted/dirty checkout also requires a clean terminal upgrade first.
The updater checks the managed source digest and refuses to overwrite local edits.
It does not pull into or modify your development checkout. Updating from the UI
uses official main; unpublished development work is not included.

If VANI remains offline, inspect:

```bash
tail -n 100 /your/path/vani/logs/update.log
cat /your/path/vani/updates/status.json
```

Retry the normal installer from a known-good source checkout with the same
`--install-dir`. There is no automatic database downgrade: inspect migration errors
and the SQL backup in `<install>/backups` before attempting a schema rollback.
The browser cannot retrieve a failed status while the API is offline; it shows
recovery instructions during that disconnection rather than claiming success.

Local fixtures cover updater and supervisor behavior. A full real Ubuntu update,
including driver/model residency after restart, still needs verification on the
installation host.
