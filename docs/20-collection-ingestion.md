# Add papers and refine collection focus

Create a collection, or select an existing manual collection, then use **Add a paper to this collection**:

1. Choose **Upload PDF** or **Paper link or DOI**. Links may point to a DOI, a publisher/arXiv page with citation metadata, or a direct PDF. PDFs are limited to 50 MB. An optional title overrides the filename or extracted page title for new records.
2. Leave **Use as a discovery seed and review collection focus** selected to add the paper to the seed set. Existing members, topic, schedule and seeds remain intact. A collection supports ten seeds; if full, the paper still joins the collection and VANI explains how to replace a seed.
3. In the discovery editor, edit the focused topic or choose **Infer a revised focus from all selected seeds**, then save. Inference uses the local model and includes the first three indexed PDF pages when available. If no local model is running, enter the topic yourself. Adding a seed does not silently change an existing topic.

New empty collections are created independently of a model. Uploading a seed into an unconfigured collection leaves daily discovery paused until you configure it. Scanned or encrypted PDFs may need an unlocked, searchable copy; VANI retains their bytes but cannot infer evidence it cannot extract. Existing canonical titles are preserved when duplicate papers are reused.

## Local copies and contribution summaries

New papers imported from Discover, Explorer, browser capture or scheduled collection discovery enter a persistent processing queue. The existing API worker checks that queue even when the collection's daily discovery is paused. Each tick processes up to five queued papers. Run the API server to process pending work; jobs survive restarts.

VANI tries provider PDF locations, arXiv PDFs or DOI-supplied PDF links. Downloads validate public destinations and every redirect, impose size/time limits and reuse existing local attachments. It cannot download inaccessible or authenticated full text. Collection rows show **PDF: saved** or an explicit unavailable/error state, with a **Retry PDF and summary** action. Failed processing gets bounded automatic retries; an unavailable public PDF can be retried manually or supplied by upload.

The **Primary contribution** appears below each paper. Local model synthesis describes the main advance with a supporting quotation, using the abstract and up to twelve locally indexed PDF pages. Quotes are checked against the supplied text. This is a bounded contribution summary, not a claim to have analyzed every page or verified the results. If synthesis is unavailable or its citation check fails, VANI shows a labeled extractive contribution passage. If no text exists, it reports that evidence is needed. Coverage, excerpts and processing details remain inspectable. PDF text and focus/summary synthesis stay on the configured local model path.

Original PDFs are immutable files in the configured VANI object store. Repeated uploads reuse matching attachments and collection memberships. Metadata ingestion survives PDF-download failure. Older first-pass reports remain available separately.

## Upgrade and verification

Run `npm run db:migrate` and restart VANI. Migration `009_paper_enrichment.sql` adds the durable work queue and contribution reports. No external automation is created.

The [design specification](../design/collection-paper-ingestion.md) was written before implementation. Run `npm run check` and `npm run lint`. With a disposable `DATABASE_URL`, `VANI_DATA_DIR`, and `VANI_INTEGRATION_TEST=true`, run all API tests and `NODE_ENV=test npm run ingestion:smoke`. Set `VANI_SMOKE_CHROMIUM` when using an existing Playwright browser binary. Tests use controlled provider responses and verify actual stored PDF bytes; screenshots go to `/tmp/vani-ingestion-smoke`.
