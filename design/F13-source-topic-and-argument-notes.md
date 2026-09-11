# F13 — Source, topic and argument notes

Status: Implemented. This specification was written before implementation.

See [Connected research guide](../docs/18-connected-research.md) for setup, limits and validation.

## Intended outcome

Support distinct source context, evolving topic understanding and argument synthesis with reusable links and backlinks.

## Interaction design

Notes workspace filters by type; create/edit source, topic or argument notes. Existing claim/synthesis notes remain readable. Add a link to another note with rationale and inspect inbound/outbound links without copying its content. Source notes may bind a work; argument notes may bind an existing argument.

## Persistence and API

GET/POST /knowledge/notes, PATCH /knowledge/notes/:id; note_link references note IDs with rationale; note.argument_id optional. GET /knowledge/notes/:id returns references and backlinks. PUT/DELETE note link endpoints. Revision-check note content; show latest linked title/content.

## Acceptance and verification

Edit a linked source note and see updated content at its original URL; backlinks resolve; reject self-links and missing targets; preserve existing F08 note URLs and types.

Use integration tests against disposable PostgreSQL for persistence, validation and concurrency. Use browser workflows for editing, navigation and reload. Preserve F01–F10 data and stable source IDs. All mutations report errors without discarding the draft. Lists expose their bounds; this remains a local single-user workspace.

## Delivery boundaries

No cloud synchronization, collaborative editing or model download is introduced. External discovery runs only when requested. Source text, user interpretation, computed association and reviewed suggestion retain separate provenance. See the implementation guide for operational limits and validation results.
