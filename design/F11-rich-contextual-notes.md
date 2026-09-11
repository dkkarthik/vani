# F11 — Rich contextual notes

Status: Implemented. This specification was written before implementation.

See [Connected research guide](../docs/18-connected-research.md) for setup, limits and validation.

## Intended outcome

Write Markdown with a live safe preview, GFM tables, inline/block equations, local PNG/JPEG/WebP images, and labeled figure/table/passage references. Source quotations are structured references rendered separately from personal interpretation.

## Interaction design

Notes editor provides title, type, Markdown, image upload, and reference composer. References point to immutable passage IDs and include a figure/table label; quote and citation are resolved live. Images are stored in the local object store and served only as validated raster formats. Raw HTML and remote image loading are disabled.

## Persistence and API

Add note_reference and note_asset; PATCH /knowledge/notes/:id requires version; POST /knowledge/note-images accepts <=10 MB raster; PUT /knowledge/notes/:id/references/:passageId links a passage with kind/label. Keep original source bytes immutable.

## Acceptance and verification

Render math, table and uploaded image; save/reload interpretation and figure reference; stale edit returns 409 without losing data; unsafe HTML/URL does not execute. Image signatures must agree with MIME type.

Use integration tests against disposable PostgreSQL for persistence, validation and concurrency. Use browser workflows for editing, navigation and reload. Preserve F01–F10 data and stable source IDs. All mutations report errors without discarding the draft. Lists expose their bounds; this remains a local single-user workspace.

## Delivery boundaries

No cloud synchronization, collaborative editing or model download is introduced. External discovery runs only when requested. Source text, user interpretation, computed association and reviewed suggestion retain separate provenance. See the implementation guide for operational limits and validation results.
