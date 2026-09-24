# Collection citations and PDF access

## Request

Every paper listed in a collection should carry a usable bibliographic citation and a link to view its PDF when a PDF location is known. This includes saved papers and all simple-discovery views: recommendations, Sanity shortlist, filtered papers, saved recommendations, and dismissed papers.

## Display specification

- Use one consistent author–date reference: all supplied author names in source order; year; full title; journal, conference, or repository; volume, issue, page range or article number when supplied. Append a linked DOI and/or arXiv identifier. This is a readable scholarly reference format, not a claim of exact APA/IEEE style conformance.
- Keep names as supplied, including single-field full names and group authors. Do not truncate at five authors, invent initials, infer publication dates from retrieval dates, or fabricate missing metadata. Show `Authors unavailable`, `n.d.`, and a concise missing-metadata notice when needed.
- Preserve the title's existing reader/source navigation. Add a distinct `View PDF (local copy)` or `View PDF (source)` action. Prefer an existing main-paper PDF attachment, then a provider-declared PDF location or an explicit arXiv identifier. Do not label a DOI landing page or generic open-access landing page as a PDF.
- If no PDF location is known, display `PDF link unavailable`; keep a separate paper/DOI record link for further access. External source links may require publisher access and are not a promise of a locally downloaded or verified-open file.
- Open PDF/source links in a new tab, leaving the review position intact. Permit only HTTP(S) external URLs without embedded credentials and locally constructed attachment-content paths. Render citation text as text, never HTML from providers.

## Data and implementation

- A shared deterministic reference builder reads normalized metadata and retained OpenAlex, Crossref, and arXiv payloads. It recovers bibliographic fields and known PDF links for existing records on read, without a new discovery run.
- Collection-member and recommendation APIs attach reference data. Resolve attachment IDs and source records in batched queries, respecting canonical work identities after merges. Prefer main-paper attachments; do not present a supplementary document as the paper.
- Retain Crossref volume, issue, pages, article number, publisher, and PDF link metadata on future ingestion. Preserve nonempty bibliographic fields and PDF URLs when the public corpus merges records from different sources. Keep arXiv and published-version metadata together as identifiable sources, without rewriting a published citation as a preprint.
- No migration, model calls, PDF downloads, refresh jobs, or automatic relevance/feedback changes are required to render references.

## Verification

- Unit checks: complete/missing metadata, all authors, identifiers and legacy arXiv IDs, OpenAlex page ranges, Crossref PDF content type, unsafe URLs, landing-page exclusion, and metadata preservation during source merges.
- Integration checks: saved local PDF preference, canonical merged attachments, source fallback, recommendation and collection-member responses, no network calls or model jobs while listing.
- UI checks: full citation and identifier links in recommendation cards and saved collection rows; local/source PDF actions; missing-PDF state.
- Build, typecheck, relevant automated suites, and inspect the live GoLF sandbox. Confirm its saved seed opens the existing PDF and the shortlist exposes source PDF links without rerunning discovery.
