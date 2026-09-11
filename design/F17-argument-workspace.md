# F17 — Argument workspace

Status: Implemented. This specification was written before implementation.

See [Connected research guide](../docs/18-connected-research.md) for setup, limits and validation.

## Intended outcome

Arrange claims, supporting evidence, caveats and open questions in an editable outline that preserves source references through edits and reorder.

## Interaction design

Choose an F09 argument. Add typed outline blocks, attach multiple passages or notes, edit text, move blocks up/down or remove a block. Preview a citation-preserving Markdown outline and copy/download it. Evidence remains stored once in its source record.

## Persistence and API

argument gains outline JSON and version. GET/PATCH /knowledge/arguments/:id; outline blocks have stable UUID, kind, text, passageIds and noteIds; schema max100 blocks with unique IDs. Validate references and compare version; save atomic. GET /:id/export resolves citations and latest quotes.

## Acceptance and verification

Reorder claims with evidence, reload and export: passage IDs and citations unchanged. Stale save fails; invalid/duplicate block IDs fail. Missing/deleted evidence is labeled unavailable rather than fabricated.

Use integration tests against disposable PostgreSQL for persistence, validation and concurrency. Use browser workflows for editing, navigation and reload. Preserve F01–F10 data and stable source IDs. All mutations report errors without discarding the draft. Lists expose their bounds; this remains a local single-user workspace.

## Delivery boundaries

No cloud synchronization, collaborative editing or model download is introduced. External discovery runs only when requested. Source text, user interpretation, computed association and reviewed suggestion retain separate provenance. See the implementation guide for operational limits and validation results.
