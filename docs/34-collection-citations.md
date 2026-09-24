# Citations and PDF links in collections

Every saved collection paper and simple-discovery recommendation displays an author–date reference, including all supplied authors, title, venue, year, and available volume/issue/page or article-number details. DOI and arXiv identifiers link to their records.

`View PDF (local copy)` opens an existing main-paper attachment. If no saved PDF is available, `View PDF (source)` opens a known PDF location from arXiv, OpenAlex, Crossref, or retained ingestion metadata. Source files may require publisher access. `PDF link unavailable` means VANI does not currently know a PDF location; the separate paper-record link remains available.

The display uses stored metadata, without starting discovery, downloading PDFs, calling a model, or changing feedback. Existing retained provider payloads are interpreted on read. Future source merges and saves preserve bibliographic details and PDF locations. Older Crossref records whose details were already discarded can still have gaps until their metadata is refreshed or edited in the paper reader.

Missing fields are explicitly marked. `n.d.` means no date was supplied. These references use a consistent readable format, not a selectable journal-specific citation style. An anonymized manuscript cannot supply the identities of its authors; its citation should retain the anonymous designation and distinguish a submission from a published paper.

Implementation specification: [collection citations and PDF access](../design/collection-citations-pdf-links.md).

Validation: API/shared reference tests, merged-work and saved-source integration tests, collection/recommendation UI tests, typechecking, lint and production builds. A local GoLF browser check displayed references for all 30 shortlisted records, known source PDF links for 25, and a working local PDF for the uploaded seed. No refresh, model, enrichment, membership, or feedback records were created by the display checks.
