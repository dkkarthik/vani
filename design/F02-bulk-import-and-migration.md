# F02 — Bulk import and migration

Status: implemented and validated. Version 1, September 8, 2026.

## Outcome

A researcher can bring a bibliography, a list of identifiers, and selected PDFs into a collection without silently losing records or replacing existing metadata. The workflow is **upload → preview and correct → confirm → inspect a durable result report**. F03 supplies the metadata model and editor.

## Supported inputs and fidelity

- UTF-8 BibTeX/BibLaTeX (`.bib`), RIS (`.ris`), CSL-JSON (`.json`), and newline-separated DOI/arXiv identifiers (`.txt` or pasted text).
- Multiple explicitly selected PDFs, alone or alongside a bibliography. A bibliography's attachment paths are treated as references, never as permission to read arbitrary local files or fetch URLs. Match a uniquely named uploaded PDF to a referenced basename; otherwise show a missing/ambiguous attachment warning. Unmatched PDFs become reviewable standalone records.
- Preserve title, ordered authors (including unsplit organizations), editors, abstract, issued year/date, journal/book container, publisher/place, volume, issue, pages/article number, edition, ISBN, ISSN, URL, language, publication type, and preprint identity where supplied.
- Import plain source notes from recognized note fields. Preserve original bibliography bytes and each raw source assertion. Unknown fields, tags, collection hierarchies, unsupported identifiers, rich notes, and annotations that cannot become native VANI objects are named in the report. Embedded PDF annotations remain in the original PDF; extraction into native annotations is outside F02.
- Resolve identifiers only after an explicit **Resolve identifiers online** choice. Exact DOI lookup uses Crossref and DataCite fallback; arXiv lookup uses its official API. No title search or arbitrary URL fetching. Local PDF import does not upload PDF contents or extract a DOI from the body automatically.

## User interface

Library gains **Import research**, leading to `/imports`. Select a destination collection, add files or paste identifiers, choose online resolution, and prepare a preview. Show format/file counts, per-row validity, title, duplicate/new decision, attachments, notes, and warnings. Every source file produces rows or an explicit error. Malformed bibliography syntax blocks that file; other files remain reviewable.

Preview corrections become protected user decisions; they never replace the immutable normalized source assertion. Each valid row can be included/excluded and its metadata corrected using F03's field controls. The preview predicts exact DOI, imported-record fingerprint, and PDF hash matches. Similar titles alone do not merge. Existing matches retain their current metadata; imported assertions become available in F03. Show this policy before confirmation.

Confirm the selected rows once. Display progress, created/reused works, imported notes and files, errors, skipped rows, and completeness warnings. Allow retry of failed/unprocessed rows without repeating successful rows. List recent import sessions so closing/reloading the page does not lose the report. Offer JSON report download and original-input download.

## Durable state and transaction rules

`import_session` stores target collection, state (`preview`, `running`, `complete`, `partial`), revision, files, diagnostics, and timestamps. `import_item` stores ordinal, source identity, raw payload, normalized metadata, inclusion, notes, attachments, warnings, error, result work ID, and outcome. Preview preparation stages immutable local objects but creates no works, memberships, or notes.

Preview edits require the current revision. Confirmation takes a session lock, freezes selection, and commits one item per transaction. The work, collection membership, source assertion, notes, attachment links, and item outcome commit atomically. A database advisory lock shared with browser capture serializes canonical identity/citation-key allocation. Transactions recheck identity; previews are advisory. No matched work's canonical fields are overwritten.

Import processing is locally bounded and database-driven: a confirmation request processes the session, while status can be read concurrently. A second confirmation joins/serializes on the session lock. After a server interruption, retry resumes unfinished rows; `running` means retryable when no runner holds the database lock. Row errors never roll back completed rows. Existing citation keys remain stable. Repeated import of an exact identifier, identical normalized source metadata, or PDF content reuses work identity, notes, attachments, and memberships.

Limits: 100 input files, 500 records per session, 10 MB per text bibliography, 50 MB per PDF, 200 MB total upload; bounded identifier lookup time and sequential arXiv requests. Exceeding a limit is an explicit error, not truncation. Invalid/encrypted PDFs that Poppler cannot inspect are reported as input errors. Image-only PDFs can be stored with a filename-derived provisional title and a metadata-review warning; OCR is outside this feature.

## API

- `POST /api/v1/imports` — multipart files plus collection ID, optional identifier text, and resolution choice; returns persisted preview.
- `GET /api/v1/imports` and `GET /api/v1/imports/:id` — history and complete report.
- `PATCH /api/v1/imports/:id` — revision-checked preview row edits/inclusion.
- `POST /api/v1/imports/:id/commit` — commit/resume, using the preview revision.
- `GET /api/v1/imports/:id/files/:fileId` — download an original supplied file.

The existing single-user loopback API boundary applies. Inputs cannot select server paths. Filenames are display data; storage uses content hashes. HTML from imported records is never executed.

## Acceptance and validation

1. Mixed BibLaTeX/RIS/CSL/identifier/PDF fixtures produce complete, inspectable previews; nested braces, Unicode names, multiline RIS, books, chapters, theses, and organization authors are covered.
2. Unsupported fields, missing files, malformed rows, and failed lookups appear in the report. No work exists before confirmation.
3. A PDF paired to a bibliography row keeps the original SHA-256. Independent PDFs remain selectable.
4. Duplicate DOI and repeated-source imports preserve existing corrections and keys, while adding the intended collection membership and source provenance.
5. Double confirmation, retry after a partial failure, stale preview edits, and concurrent capture do not duplicate records or overwrite corrections.
6. Imported plain notes and attachments are idempotent. The report and originals survive page reload.
7. A real-browser fixture exercises preview edits, confirmation, report reopening, and navigation into the resulting record.

## References

[Citation.js parsers](https://citation.js.org/api/0.7/tutorial-plugins.html), [CSL-JSON schema](https://github.com/citation-style-language/schema), [arXiv API](https://info.arxiv.org/help/api/user-manual.html), and the [desired feature catalog](feature-research.md). F04's fuzzy matching/merge and full archival migration are separate workflows; all known transfer limitations are surfaced here.
