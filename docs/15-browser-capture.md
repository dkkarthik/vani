# F01: Chrome browser capture

VANI's Manifest V3 extension saves the current scholarly page, or a DOI resolved through Crossref, into a selected local collection. It extracts metadata for review, retains source URLs and import status, and optionally downloads an available PDF. It requires a running local VANI installation; it is not a standalone reference manager.

## Install and connect

1. Update VANI, run `npm install`, and run `npm run db:migrate`. Restart the API and web app. Container users can rebuild with `docker compose up --build`.
2. From the repository root, run `npm run extension:package`. This creates `apps/extension/dist/` and `dist/vani-chrome-extension-0.1.0.zip`.
3. Open `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose `apps/extension/dist/`. Pin VANI from Chrome's extensions menu.
4. In the VANI web app, open **Settings → Chrome extension → Get capture key → Copy key**.
5. Open the extension's **Settings**, paste the key, and select **Connect and test**.
6. Open a scholarly article and click VANI. Review the detected title and details, choose or create a collection, and select **Save paper**. If prompted, allow the chosen PDF site to attach its PDF. Declining that permission still saves the metadata.

Default addresses are `http://127.0.0.1:8080` for the API and `http://127.0.0.1:5173` for the app. With Docker, change the extension's app address to `http://127.0.0.1:3000`. These addresses can be changed under **Local service addresses**; only HTTP loopback hosts `localhost` and `127.0.0.1` are supported in this release.

For a DOI, expand **Have a DOI instead?**, paste a DOI or `doi.org` link, and choose **Look up**. This contacts Crossref through the local API and fills the same review form. A DOI absent from Crossref can still be captured from its publisher page. arXiv and OpenReview are supported through their article pages.

## What F01 includes

| Capability          | Behavior                                                                                                                                                                                                                                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Metadata extraction | Highwire `citation_*`, Dublin Core, PRISM fields, Schema.org JSON-LD, and page-title/Open Graph fallback. Title, ordered authors, DOI, date/year, abstract, venue, publisher, volume, issue, and pages where supplied.                                                                                         |
| Review before save  | Edit title, author names, year, DOI, venue, and abstract. Sparse metadata is explicitly flagged for review.                                                                                                                                                                                                    |
| Collections         | Choose an existing collection, create one in the popup, and remember the last selection.                                                                                                                                                                                                                       |
| Source provenance   | Retain source and canonical URLs, capture timestamp, extraction method, and captured metadata. Common tracking and credential query parameters are removed from stored URLs.                                                                                                                                   |
| PDF capture         | Detect HTTPS PDF links, including arXiv/OpenReview conventions; choose among candidates. Request permission for the selected host, download at most 50 MB, validate the PDF signature, and attach the original bytes to the work.                                                                              |
| Duplicate handling  | Reuse existing DOI/source matches; similar titles alone do not merge browser captures. Preserve existing work metadata and attach a new source record and collection membership. Repeated PDF bytes reuse the attachment. This is conservative capture deduplication, not the full F04 merge/version workflow. |
| Status and recovery | The service worker continues after the popup closes. Badge and popup show saving, complete, partial, or error status. A persisted capture UUID makes manual retries idempotent. Browser/service interruptions become a retryable status when the popup reopens.                                                |
| VANI handoff        | Open the saved work directly; view captured source links and PDF status in the reader's evidence pane.                                                                                                                                                                                                         |
| Scoped connection   | A revocable capture key permits capture-related routes. It is stored on disk with mode `0600` and in extension-local storage, restricted to trusted extension contexts.                                                                                                                                        |

## Limits and troubleshooting

- **VANI unreachable:** start the local service and check the addresses in extension Settings. A failed metadata save can be retried; this version keeps one most recent capture, not an offline queue of many papers.
- **PDF unavailable:** metadata remains saved. The publisher may require login, block extension requests, redirect to another host, or supply a non-PDF response. Open the PDF normally to check access, retry, or attach a downloaded PDF in VANI. The extension does not bypass paywalls, CAPTCHAs, or browser security controls.
- **Chrome interrupted the save:** reopen the popup and select **Retry save**. It reuses the original request and collection. After changing the API address, reconnect to the original address to retry that job.
- **PDF host access:** Chrome retains optional host grants. Use extension Settings → **Forget PDF site access** to remove them.
- **Disconnect:** clears the extension's key and latest capture after an active save finishes. It does not delete saved VANI records. **Revoke key** in VANI Settings invalidates the key for every extension using it.
- **Direct PDF or sparse publisher page:** Chrome may prevent metadata extraction in its built-in PDF viewer. The extension falls back to the tab URL/title; review those fields or capture the abstract page instead.
- **Coverage:** no claim of universal publisher support. There is no batch tab capture, arbitrary identifier registry support, remote VANI deployment, automatic metadata reconciliation, or background retry scheduling in this first release.

## Implementation

Source lives in `apps/extension`. `packages/shared/src/capture.ts` defines the shared validation contract. The build bundles all scripts locally; it does not load remote executable code. The extension uses `activeTab`, `scripting`, and `storage`, required loopback host access, and runtime optional HTTPS host access for a selected PDF download. Publisher HTML is treated as data and rendered using text/value assignments.

Migration `004_browser_capture.sql` adds provenance and PDF status. A metadata save, source record, and collection membership commit together. Capture imports take a PostgreSQL advisory transaction lock; retries compare the capture ID and request hash, returning `409` if the same ID is reused for different input. An attachment transaction deduplicates by work and object hash. PDF download failure does not roll back a committed paper. The API never fetches supplied page or PDF URLs; exact DOI lookup has a fixed Crossref destination.

| API                                    | Purpose                                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `POST /api/v1/capture-key`             | Get/create the key from an explicit VANI UI action; same/configured origin and `X-Vani-Client: web` required. |
| `DELETE /api/v1/capture-key`           | Revoke the current key through the same UI boundary.                                                          |
| `GET/POST /api/v1/capture/collections` | List/create collections with capture-key authorization.                                                       |
| `POST /api/v1/capture/resolve`         | Resolve an exact DOI in Crossref.                                                                             |
| `POST /api/v1/captures`                | Save/reuse a work, membership, and capture provenance atomically.                                             |
| `GET/PATCH /api/v1/captures/:id`       | Get capture status or record a PDF failure.                                                                   |
| `POST /api/v1/captures/:id/pdf`        | Validate/store a PDF and complete the capture.                                                                |
| `GET /api/v1/works/:id/captures`       | Reader source history; uses the existing local VANI web API access model.                                     |

Capture-scoped routes require `Authorization: Bearer <capture-key>`. This does not retrofit authentication across VANI's existing local web API. Keep the service bound to loopback as documented.

## Verification

```bash
npm run check
npm run lint
npm run extension:package
```

Database integration tests are opt-in. Use an isolated PostgreSQL database with pgvector, and disposable object storage:

```bash
DATABASE_URL=postgres://vani@127.0.0.1:55439/vani_capture_test \
VANI_DATA_DIR=/tmp/vani-capture-test-data \
VANI_INTEGRATION_TEST=true npm run test -w @vani/api -- --fileParallelism=false
```

For the browser smoke test, create a fresh disposable database and install Playwright's test Chromium. `openssl` must be available for the local HTTPS PDF fixture.

```bash
npx playwright install chromium
VANI_SMOKE_DATABASE_URL=postgres://vani@127.0.0.1:55439/vani_smoke_test \
npm run extension:smoke
```

The test starts temporary API/web services, uses a temporary Chrome profile and HTTPS publisher fixture, pairs through the real UI, captures a PDF while closing the popup, repeats the capture, exercises login-HTML failure and retry, and checks the stored attachment bytes and reader source history. It pre-grants **only its fixture host in a temporary extension copy**, because headless Chrome cannot accept its native extension permission bubble. Production permission grants remain unchanged; the native grant/deny prompt remains a manual release check. Test processes and local files are cleaned up; discard the test database afterward. Screenshots go to `dist/extension-smoke/`. Set `VANI_TEST_CHROME` to an existing Chromium executable if needed.

Unit tests also cover extraction formats, unsafe URLs, DOI lookup, permission denial, file validation, interrupted requests, lost upload responses, and capture-key authorization/revocation. Integration tests verify atomicity, concurrent idempotency, duplicate preservation, source history, and attachment deduplication.

Store materials and the remaining publisher-account steps are in [Chrome Web Store submission](../apps/extension/store/submission.md).

## Platform references

- [Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab) and [script injection](https://developer.chrome.com/docs/extensions/reference/api/scripting)
- [Cross-origin requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests), [optional permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions), and [service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Crossref REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/)
