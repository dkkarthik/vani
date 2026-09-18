# Collection refresh evaluation lab

Provide an isolated, persistent local environment for reproducing paper-upload and
Deep Refresh behavior with real scholarly providers. Use the same API, ingestion,
core worker and local-model router as VANI. Never substitute mocked results or
silently use cloud inference when a local model is absent.

The lab owns a PostgreSQL cluster/database, PDFs, logs and review snapshots under
`.vani-refresh-lab/` (git ignored), on loopback ports 55442 and 18082. It must not
read the production .env, run against a production database, or run scheduled
audits/daily discovery. Explicit refresh drives the production core worker;
enrichment runs on its own loop so missing inference cannot conceal retrieval.

A lab page supports named collections, PDF seed uploads, an explicit research
question and public search phrases, refresh, diagnostics, candidate review,
expected/missed-paper entry, and immutable JSON/Markdown snapshots. Public query
text is shown before submission. Seed PDFs remain local. Candidate feedback uses
the production human-feedback endpoint. Expected papers are separate evaluation
labels, never silently added as retrieval seeds. Each snapshot records all
candidates and their stages, current focus, provider coverage/errors, model
invocations, seed enrichment, human feedback and expected-paper matches. Metadata
only candidates have no claimed semantic relevance; discovery paths are displayed
as retrieval explanations. Unjudged records are not negatives, and expected-paper
hit rate is not global literature recall.

Compare saved snapshots after explicit changes; no automatic tuning or promotion
from a tiny demonstration set. A user can supply missed papers for future runs.
The first evaluation using the user's papers must wait for their attachments.
Validate infrastructure with disposable fixtures and live provider queries, clearly
separating that smoke test from evidence of relevance quality.

## Seed rediscovery in evaluation reports

Keep retrieved seed records in the audit trail, but label exact normalized DOI/title
matches to existing members and explicit anchors. Exclude those matches from the
new-candidate-record count. When both records have different DOIs, do not merge by
title alone. This report annotation does not change ranking, admission, or human
labels. Publication/preprint versions can remain separate records and require
review; do not present the count as unique new scientific works.
