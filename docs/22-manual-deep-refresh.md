# Refresh a collection on demand

Open a collection and press **Deep refresh**. VANI immediately queues a persistent search using that collection’s active keywords. The button shows progress and disables while the job is active. You can leave the page and return to see the latest result.

Manual refresh works even when daily discovery is paused and leaves its schedule unchanged. Add keywords first if the collection has none. Changes to keywords or collection focus stop an older refresh; press the button again to search with the revised settings. Papers already admitted before an edit remain in the collection.

The search covers older and newer papers from OpenAlex and Crossref, using up to four keyword queries and references/citing papers from up to five public collection seeds or members. It applies collection discovery feedback and the existing 35% keyword matching threshold, avoids duplicate memberships, and imports up to 200 matching candidates per run. Each addition records its source, query, matching keywords and supporting text in its inclusion reason.

Results show candidates reviewed, papers added and any source warnings. This is a bounded broader search, not exhaustive coverage. A provider outage is reported; it is not presented as a successful empty search. Available PDFs and primary-contribution summaries enter the existing local processing queue after import. Papers without accessible PDFs retain an explicit availability status.

Jobs survive API restarts and are recovered by the discovery worker. Startup applies migration `011_collection_refresh.sql` automatically. The existing daily refresh endpoint remains compatible; the new UI uses `POST /api/v1/collections/:id/deep-refresh` and polls `GET` on the same path.

## Verification

Automated coverage includes paused schedules, repeated requests/imports, no date restriction, admission reasons and enrichment, keyword edits during search, source outages, interrupted job recovery and discovery feedback. The Chromium ingestion smoke also presses the button, waits for completion, checks the added paper/reason and confirms daily settings were preserved.
