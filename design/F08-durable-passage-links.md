# F08 — Durable passage links

Status: implemented; validation recorded in the [usage guide](../docs/17-research-workspace.md). September 10, 2026.

## Outcome and behavior

Every native annotation has a stable /passages/:id link. Resolve to the immutable attachment/document hash and page, retaining quote and normalized rectangles. The reader selects the exact attachment version and page and overlays the saved region, even after a logical work merge or another PDF is added.

An anchor has explicit exact/uncertain/unavailable state. Hash mismatch, out-of-range page, missing text quote, removed annotation or unavailable document must not silently open a nearby passage as exact. Image/area selections can be exact spatial anchors without text; quotation normalization ignores whitespace only. An uncertain anchor still offers the original document and page with a warning.

Copy links from the reader/evidence workspace; create a note containing a Markdown passage link and exact quote. Search hits link to page locations; annotation hits link to the stable passage. Relationships may include passage IDs in evidence and offer passage navigation. Validate passage IDs when creating new evidence-backed links.

API: GET /passages/:id; POST /passages/:id/note. UI /passages/:id resolves reader; display uncertainty in reader and evidence cards.

Acceptance: links survive reload and alias merges; correct old PDF opens after a second PDF is added; uncertain quote/invalid page is labeled; notes and relationships retain passage IDs without copying mutable PDF coordinates.

## Validation and delivery

Implement only after this specification exists. Use unit tests for rules and ranking, disposable PostgreSQL integration tests for persistence/concurrency, and browser smoke tests for the user flow. Preserve F01–F03 behavior, run repository checks, commit and push. Implementation details and any verified limitations belong in the usage guide.
