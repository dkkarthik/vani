# VANI 0.1 Source Connector Specification

## 1. Connector contract

Every connector implements:

```text
capabilities()
search(query, cursor, filters)
resolve(identifier)
fetch_work(external_id)
fetch_updates(since_cursor)
fetch_related(external_id, relation_types)
fetch_document(external_id, access_context)   # optional
fetch_discussion(external_id)                 # optional
normalize(raw_record)
health()
```

Each operation returns:

- immutable raw payload;
- source and external identifier;
- request and retrieval timestamps;
- source update timestamp where available;
- next cursor;
- rate-limit state;
- license and access classification;
- normalized candidates;
- retry classification.

Connectors must support cancellation, bounded retries with jitter, and explicit backoff on rate limits. They must not hide partial-page or partial-field failures.

## 2. Source priority

Priority is field-specific rather than one global source ranking.

| Field group | Preferred source |
|---|---|
| Version-of-record title, venue, volume, issue, pages | Publisher/proceedings record |
| DOI registration and registered relations | Crossref or DataCite |
| OpenReview submission/review history | OpenReview |
| arXiv version and history | arXiv |
| Computer-science bibliography corroboration | DBLP |
| Broad graph and open metadata | OpenAlex |
| Embeddings, recommendations, citation graph | Semantic Scholar |
| User-provided PDF content | The exact uploaded file |

## 3. v0.1 connectors

### Crossref

Use for DOI resolution, publisher-deposited metadata, funding, licenses, references, relations, corrections, and retractions.

Rules:

- use the polite pool with a configured contact address;
- normalize DOI casing for matching while preserving original form;
- store complete raw JSON;
- do not assume optional metadata is complete;
- inspect update and relation fields on refresh;
- treat abstracts according to their copyright status.

### OpenAlex

Use for broad keyword retrieval, scholarly graph expansion, author/institution candidates, open-access links, topics, and source reconciliation.

Rules:

- preserve OpenAlex IDs;
- do not overwrite publisher-confirmed metadata with aggregate values;
- record snapshot/API version where exposed;
- use cursor pagination for large queries;
- compare work type and version before merging.

### Semantic Scholar

Use for paper and author search, citation graph, recommendations, SPECTER2 embeddings where available, and corpus identifiers.

Rules:

- honor API-key and rate limits;
- distinguish paper recommendations from VANI rankings;
- store the recommendation source as a feature, not a truth label;
- record fields missing due to access tier separately from null metadata.

### DBLP

Use for computer-science record corroboration, author ordering, venue normalization, DBLP keys, and BibTeX/XML exports.

Rules:

- store DBLP record and person keys;
- distinguish CoRR/arXiv records from final proceedings records;
- use DBLP venue strings as aliases when the canonical venue already exists;
- link records through DOI and DBLP-provided electronic-edition URLs.

### arXiv

Use for preprint metadata, version history, category, submission dates, abstract, and user-authorized/open document retrieval.

Rules:

- preserve versioned identifier such as `2601.13361v2` and base identifier;
- create a new manifestation or version relation as required;
- never replace a final publisher record with the preprint record;
- retain arXiv license and document source.

### OpenReview

Use API v2 for current venues and v1 only where required for older venues.

Ingest only publicly readable fields and events:

- submission metadata;
- revisions/edits;
- official reviews;
- meta-reviews;
- official and public comments;
- rebuttals and author responses;
- decisions;
- public dates and venue status.

Rules:

- preserve `forum`, `replyto`, invitations, readers, signatures as publicly represented, and all relevant timestamps;
- never attempt reviewer de-anonymization;
- represent edited events and soft deletion;
- distinguish acceptance date from online/public date;
- map review form fields per venue rather than assuming a universal rating scale.

### IEEE Xplore

The v0.1 connector is disabled until credentials and permitted use are configured.

Rules:

- use the IEEE metadata API or user-initiated exports, never scrape IEEE Xplore;
- store only content permitted by the applicable license;
- retrieve open-access full text only where the API/license permits;
- use IEEE article number as an identifier;
- treat IEEE Xplore as authoritative for IEEE publication-specific fields;
- expose connector limits and authentication status to the user.

## 4. Import-only adapters

Support local import of:

- publisher BibTeX/RIS;
- Zotero exports;
- ACM Digital Library citation exports;
- IEEE Xplore citation exports;
- arbitrary BibTeX/BibLaTeX/RIS/CSL-JSON;
- PDF and supplementary files.

An import adapter is not considered an authoritative online connector. Its provenance is the imported file and, where present, the named producer.

## 5. Full-text acquisition

The acquisition resolver tries, in order:

1. exact user upload;
2. already stored object with the same verified manifestation;
3. open-access URL explicitly supplied by an authoritative source;
4. arXiv or other permitted repository version;
5. authorized connector retrieval;
6. external link for user action.

Do not silently substitute a preprint PDF for the version of record. If used, label the PDF manifestation in the reader and answers.

## 6. Identity candidate output

A connector normalization produces candidate assertions, not canonical mutations. Each candidate contains:

```json
{
  "source_record_id": "...",
  "external_ids": [{"scheme": "doi", "value": "..."}],
  "title": "...",
  "authors": [],
  "venue": {},
  "dates": {},
  "publication_fields": {},
  "relations": [],
  "access": {},
  "normalizer_version": "..."
}
```

The identity service decides whether to create, attach, merge, or request review.

## 7. Licensing and policy record

Each connector has a versioned policy configuration containing:

- source terms URL;
- allowed metadata storage;
- allowed full-text storage;
- allowed local text mining;
- allowed remote processing;
- allowed redistribution;
- attribution requirements;
- record retention requirements;
- last policy review date.

The application enforces the configured policy and shows restrictive decisions in the UI. Legal policy changes do not delete already stored user content automatically; they create an administrative review event.

## 8. Refresh and change detection

On refresh:

- compare source payload hash;
- preserve the new raw record;
- generate field-level assertion changes;
- detect identifiers, corrections, retractions, venue assignment, new pages/issues, and version relations;
- re-run citation verification only for affected fields;
- re-index only changed text;
- invalidate derived answers only if their evidence or scope materially changed.

## 9. Connector tests

Every connector requires fixtures for:

- successful search and resolution;
- pagination;
- missing optional fields;
- rate limiting;
- authentication failure;
- retryable server error;
- malformed response;
- upstream update;
- tombstoned/deleted record;
- ambiguous or duplicate identity;
- license/access classification.

