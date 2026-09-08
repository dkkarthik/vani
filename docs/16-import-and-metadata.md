# Import research and review metadata (F02 / F03)

The design specifications are [F02 bulk import](../design/F02-bulk-import-and-migration.md) and [F03 metadata review](../design/F03-verified-editable-metadata.md).

## Upgrade

Run `npm install`, then `npm run db:migrate` against your VANI database and restart the API/web application. Normal API startup also applies migration `005_imports_metadata.sql`. This adds import sessions, assertions, decisions, and correction locks without changing existing paper IDs or citation keys.

PDF imports require Poppler's `pdfinfo` on the API server. The supplied API Docker image already installs Poppler. For a native macOS server: `brew install poppler`.

## Bring in a bibliography

1. Open **Library → Import research** and select a destination collection.
2. Upload UTF-8 BibTeX/BibLaTeX, RIS, or CSL JSON. Add referenced PDFs in the same selection. Alternatively, select PDFs alone or paste DOI/arXiv identifiers, one per line.
3. Enable **Resolve identifiers online** only if you want those identifiers sent to Crossref, DataCite, or arXiv. Bibliography parsing and PDF inspection remain local.
4. Select **Preview import**. Inspect warnings and exact-match predictions, exclude unwanted records, and use **Edit record** to correct metadata.
5. Select **Confirm selected records**. The report shows created/reused papers, excluded rows, and failures. Failed runs can be retried; successful rows are preserved.
6. Reopen a session from **Recent imports**, download its JSON report, or download the exact original files.

Limits: 100 files/text inputs, 500 records, 200 MB total, 10 MB per bibliography and 50 MB per PDF. Larger libraries should be split into batches. Identifier resolution is sequential and can take time; arXiv requests are spaced by at least three seconds.

A matching DOI, exact imported source identity, or original PDF hash reuses the existing paper. Similar titles alone do not merge. Existing canonical metadata, citation keys, notes, attachments, and memberships are preserved. Import-preview corrections are recorded as user decisions; the original source values stay separate.

Attachment paths from Zotero/Mendeley exports are references only. VANI matches a uniquely named PDF explicitly uploaded in the same batch. Missing or ambiguous files are reported. Upload the intended files in a new batch to resolve missing attachments.

## Correct and reconcile metadata

Open a paper and select **Review metadata**.

- Edit canonical fields and **Save metadata**. Changed fields become protected corrections. Author/editor order can be changed with the up arrows; organizations can use an unsplit family/organization name.
- Enter a DOI or arXiv identifier and select **Look up source**. This stores provider evidence and displays differences without replacing canonical values.
- Choose fields in **Compare and reconcile**, then **Apply selections and record review**. Replacing protected corrections requires the explicit override checkbox.
- To retain other differences deliberately, select **Keep current values for remaining differences**. These decisions remain in history and the record is marked partial when material authoritative disagreements remain.
- A stale save returns a conflict. Reload the latest record and review before saving again. A DOI owned by another paper is rejected rather than merging records.

Verification indicates reviewed bibliographic agreement, not scientific quality. Uploaded records alone are unverified. This release can mark agreement with an authoritative provider verified; it does not claim independent multi-source verification.

## Transfer boundaries

Plain notes are imported. Rich formatting is flattened and raw inputs are retained. Tags, source collection hierarchies, unsupported identifiers/fields, and native annotation conversion are reported rather than silently discarded. PDF annotations remain embedded in the immutable original. OCR, fuzzy duplicate merging (F04), and full archive migration are separate features.

Non-journal metadata is retained and editable. The existing bibliography export formatter remains article-oriented; comprehensive type-aware export is outside F02/F03.

## Verification

- `npm run check` — type checks, unit tests, and builds for shared/API/web/extension.
- `npm run lint`.
- Integration tests, using disposable PostgreSQL with pgvector and a disposable object directory:

  ```sh
  DATABASE_URL=postgres://USER@127.0.0.1:PORT/vani_test \
  VANI_DATA_DIR=/tmp/vani-test-objects VANI_INTEGRATION_TEST=true \
  npm run test -w @vani/api -- --fileParallelism=false
  ```

- Browser smoke test against the same disposable database:

  ```sh
  NODE_ENV=test DATABASE_URL=postgres://USER@127.0.0.1:PORT/vani_test \
  VANI_DATA_DIR=/tmp/vani-test-objects VANI_INTEGRATION_TEST=true \
  npm run research:smoke
  ```

Install Playwright Chromium first (`npx playwright install chromium`) or set `VANI_SMOKE_CHROMIUM` to an installed compatible executable. The harness starts temporary localhost API/Vite services, creates test research records, verifies preview edits, confirmation, exact original downloads, protected corrections, deliberate source replacement and history, then closes services. Screenshots go to `/tmp/vani-research-smoke` or `VANI_SMOKE_OUTPUT`.

Provider tests use deterministic fixtures, including Crossref/DataCite fallback, provider failures, and arXiv preprint identity; they do not depend on public service uptime. The repository includes a synthetic one-page annotated PDF fixture, validated with qpdf/Poppler and checked for byte-for-byte preservation during import.
