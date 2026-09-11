# F07 — Dependable PDF reading

Status: implemented; validation recorded in the [usage guide](../docs/17-research-workspace.md). September 10, 2026.

## Outcome and behavior

Replace the browser PDF iframe with a locally bundled PDF.js renderer. Render one page at a time with previous/next, typed page navigation, zoom, selectable text and page search across the document. Keep original file download available when rendering/extraction fails. Show actual page count, per-document text extraction state, and clear image-only/OCR-needed and encryption/corruption errors.

Reader supports text highlights, comments and normalized rectangular area selections. Store annotations in PostgreSQL with attachment ID, immutable document hash, page, quote, normalized rectangles, color, tags and comment. Do not modify original PDF bytes. Existing embedded PDF annotations remain in the original; they are distinct from native VANI annotations. Remember page and zoom per attachment server-side. Cancel stale page renders; don't load all canvases.

Index selected attachment on demand using server Poppler text extraction with a 60-second timeout, 100 MB input and 2,000-page/20 MB text bounds. Expose missing tools, empty pages, failures and partial coverage; retries are explicit. OCR is not silently simulated. Text search uses extracted pages with navigation to the matched page; exact annotation rectangles come from PDF.js selection geometry, not guessed text coordinates.

API: attachment document GET and index POST; position PUT; annotation GET/POST/PATCH/DELETE with revisions. UI: reader attachment/version chooser and canvas controls.

Acceptance: navigate/search/zoom/remember position in a real browser; highlight selection and area comment persist after reload; original hash unchanged; multi-page/rotated page geometry uses normalized viewport rectangles; rendering and text failures remain visible.

## Validation and delivery

Implement only after this specification exists. Use unit tests for rules and ranking, disposable PostgreSQL integration tests for persistence/concurrency, and browser smoke tests for the user flow. Preserve F01–F03 behavior, run repository checks, commit and push. Implementation details and any verified limitations belong in the usage guide.
