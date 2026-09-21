# Quasar debugging acceptance — 2026-09-21

## Scope and environment

Tests use SSH as `kdantu@quasar.cse.buffalo.edu`. Production source is
`/data/projects/vani`, installation `/data/install/vani`, and the isolated debug
workspace `/data/install/vani-debug`. No production source update, collection
focus edit, or paper admission is part of this acceptance run. GPU checks use
explicit maintenance windows; regression checks use a separate PostgreSQL cluster.

## Findings and fixes

1. Quasar's shell emits ssh-agent startup text on stdout. This broke JSON parsing
   and would corrupt binary report downloads. The controller now frames command
   output with a unique marker; regression coverage includes JSON and arbitrary
   binary bytes with shell noise. Report downloads succeeded on quasar.
2. Chromium was absent. Browser jobs now download the pinned Playwright headless
   shell into the debug workspace and launch it before stopping production. This
   preflight passed without root privileges on quasar.
3. The installed production launcher tested ports without SO_REUSEADDR, causing
   false conflicts from recently closed sockets. The updated launcher fixes the
   probe; the debugger retries startup for older installed launchers and preserves
   the recovery journal if restoration still fails. Manual recovery restored the
   initial failed run.

## Verified runs

| Job | Revision | Run ID | Result |
| --- | --- | --- | --- |
| Read-only production snapshot | 6adbf22 | fe90fd6c37914de1b61b13aaa13acd11 | Passed and fetched |
| Dependency doctor | b99f0fa | ae84497028f44843936982cc99651444 | Passed |
| Corrected full regression | 6adbf22 | f094cdad9f684bb5936a4fb485472191 | Passed |
| Full regression | b99f0fa | 630ab4237e2743e5b3ec9fde4be6b9db | Passed |
| 90-second health soak | 6adbf22 | ffdbe41c26ba4bb6877d44ad8a8cbd5e | Passed; production restored |
| Browser/model retest | 6adbf22 | 88aca7b029ba4d808fc2255c73568b4d | Passed, including automatic production restoration |
| Initial browser/model | b99f0fa | 7c44d53512824dd3842db279640563e4 | Model passed; missing Chromium and restart conflict exposed; recovered |

Regression passed 158 API tests (including database integrations), 17 web tests,
14 extension tests, 38 installer tests, and 9 report/proxy checks, plus typechecks,
builds and lint. The initial revision passed 17 debug tests; the corrected revision
passed all 19 on quasar. Local verification after fixes also passed 19 debug
tests, 38 installer tests and lint.

The actual model smoke used `qwen3.8:27b-q4_K_M` and `qwen3-embedding:0.6b`.
It returned valid JSON and an exact quotation, 1,024-dimensional embeddings,
and reported full reader GPU residency. Synthetic reader throughput was roughly
72–80 tokens/second; this is not an estimate of paper-analysis throughput.

Private evidence is retained under each remote `runs/<id>` directory and fetched
to the Git-ignored `.vani-diagnostics/quasar/<id>` on the laptop. Manuscripts,
production data and raw diagnostic snapshots are not committed.

The corrected browser run rendered collections, library, search and settings with
no captured JavaScript errors or HTTP 5xx responses. Screenshots were retrieved;
the collections screenshot shows the expected empty isolated library. The SSH
tunnel on laptop loopback port 3001 returned the lab metadata with `cloud: off`
and the dedicated debug release path. The tunnel was then closed. The bounded health run recorded three successful
samples of database, PDF, reader and embedding readiness. Production subsequently
reported `VANI running` and its health endpoint returned `status: ok`; sandbox
API, model and browser web ports were closed. The production snapshot job
completed and its private artifacts were fetched successfully.

The debug workspace is deployed at `6adbf22`. The production installation and
source checkout were not upgraded during these tests; they can take the launcher
fix through the normal update flow.

## Limits

Passing infrastructure tests does not establish retrieval recall or relatedness
ranking quality. Browser checks cover route rendering and server/browser errors,
not complete interactive workflows. GoLF evaluation and long-duration throughput,
daily scheduling and learning-audit acceptance remain separate work.
