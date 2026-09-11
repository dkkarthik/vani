# Collection ingestion, local PDFs and contribution summaries

Status: implemented and verified. Written before implementation. See the [usage guide](../docs/20-collection-ingestion.md).

## User workflow

Create a collection, or open an existing manual collection, and add a PDF or paper URL/DOI. Optional title overrides the extracted title. Ingestion adds membership without replacing existing members. A seed checkbox appends the canonical paper to the discovery seed set (maximum ten), preserving the existing schedule and topic. The discovery editor can infer a revised focus from all selected seeds or accept a user-written focus; uploads contribute local indexed excerpts when abstracts are absent. New unconfigured collections remain unscheduled until discovery is configured.

## Ingestion and processing

A collection endpoint accepts either a multipart PDF (50 MB maximum) or a JSON paper URL/DOI. Uploads are validated, stored by hash, deduplicated and indexed locally. Links resolve DOI records, direct PDFs, or publisher/arXiv citation metadata. Preserve source provenance and explicit failure messages. Public URL downloads validate each redirect and pin public DNS addresses; reject credentials, private/reserved destinations and oversized responses. No authentication or paywall bypass.

Persist one enrichment job per canonical work. Imported discovery candidates queue PDF acquisition from provider locations, DOI lookup or arXiv. The existing worker processes bounded batches independently of daily discovery being enabled. Existing local PDFs are reused. Store attachment bytes before indexing and generating a primary-contribution report. Model output requires an exact supporting excerpt; local extractive fallback highlights a contribution passage when synthesis is unavailable. PDF text stays local; scanned/unavailable full text produces an explicit limited-coverage status. Failed PDF acquisition can be retried and must not discard metadata or prevent an abstract-based summary.

## UI and consistency

Collection rows show local PDF status and the primary contribution with coverage. Reports show supporting excerpts and processing errors. Retry requeues enrichment without deleting existing content. Empty collection creation must succeed independently of model availability. Background processing survives process restart. Repeated imports/downloads do not duplicate attachments or memberships. All changes preserve existing papers, seed sets, user titles and schedule settings.

## Verification

Unit tests cover URL validation, metadata parsing and contribution extraction. Disposable database integration tests cover uploads, links, duplicate ingestion, additive seeding, PDF storage, provider failure, retry and worker summaries. Browser checks cover new/existing collection upload/link forms, seed refinement and visible PDF/contribution status. Run relevant workspace checks, commit and push.
