# F09 — Library-wide evidence workspace

Status: implemented; validation recorded in the [usage guide](../docs/17-research-workspace.md). September 10, 2026.

## Outcome and behavior

Provide /evidence to browse excerpts, area selections and comments across papers. Filter by free-text topic (quote/comment), collection, tag, annotation type and work. Show paper title/key, original document filename/hash, page, quote, comment, tags and passage certainty. Pagination includes total count; archived/deleted annotations are excluded.

Create named arguments (title and optional description) and add selected evidence to one or more arguments without moving or copying annotations. A many-to-many join retains argument-specific rationale. Removing evidence from an argument leaves the passage and its other uses intact. Open source passage, create a linked note, edit annotation comments/tags and copy Markdown citations from the workspace.

API: POST /evidence (structured filters); GET/POST /arguments; PUT/DELETE /arguments/:id/evidence/:annotationId. UI supports argument filter, multi-select and add/remove actions. No AI-generated interpretation is presented as source quotation.

Acceptance: filters combine; shared evidence appears in multiple arguments; removal from one leaves the other; source links preserve document identity; edited comments are reflected everywhere; deleted evidence is not returned as active.

## Validation and delivery

Implement only after this specification exists. Use unit tests for rules and ranking, disposable PostgreSQL integration tests for persistence/concurrency, and browser smoke tests for the user flow. Preserve F01–F03 behavior, run repository checks, commit and push. Implementation details and any verified limitations belong in the usage guide.
