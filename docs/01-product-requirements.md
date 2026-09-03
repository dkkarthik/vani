# VANI 0.1 Product Requirements

## 1. Product definition

VANI is a local-first research environment for discovering, reading, organizing, interrogating, and maintaining an understanding of academic literature.

VANI emphasizes conceptual similarity over citation popularity, while retaining citations, shared authorship, methods, datasets, evaluations, formal peer review, and user knowledge as independently inspectable relationship layers.

## 2. Primary user

The v0.1 user is an individual graduate researcher or research engineer who:

- works primarily on Linux;
- maintains collections of tens to thousands of papers;
- frequently reads IEEE, ACM, arXiv, DBLP, and OpenReview material;
- wants continuous discovery rather than one-time search;
- needs local PDF, annotation, and note ownership;
- values semantic similarity more than raw citation counts;
- needs trustworthy citations and BibTeX export;
- wants LLM assistance grounded in their actual collection.

## 3. Product principles

1. **Evidence before fluency.** A polished answer without supporting evidence is a failure.
2. **Local ownership.** User papers, annotations, notes, and exports remain usable without VANI.
3. **Provenance everywhere.** Imported and derived values retain source, time, version, and confidence.
4. **Similarity first.** Semantic and methodological relationships are first-class; citations are one signal.
5. **Progressive disclosure.** The default interface is understandable, while expert details remain accessible.
6. **Stable research memory.** Citation keys, graph positions, saved views, and collection snapshots do not change unexpectedly.
7. **LLMs are assistants, not authorities.** They propose structured results that are checked against sources.
8. **Attention is not quality.** Reviews, public opinion, and popularity are displayed as distinct evidence classes.

## 4. Golden workflow

1. User creates a collection named for a research question or thesis topic.
2. User seeds it with keywords, a natural-language idea, papers, identifiers, a BibTeX file, or PDFs.
3. VANI searches configured sources and reconciles records.
4. VANI presents recommendations with a decomposed “why shown” explanation.
5. User accepts, dismisses, or defers recommendations.
6. Accepted papers enter the collection with citation verification status.
7. Lawfully available PDFs are stored locally; other records retain external access links.
8. User reads, highlights, annotates, and writes source-linked notes.
9. VANI extracts evidence-backed relationships and presents them in the graph.
10. User asks questions of selected papers or the collection.
11. Answers cite exact passages, reviews, tables, relationships, and notes.
12. A scheduled discovery run produces a diff rather than recreating the collection.
13. User exports the collection using stable citation keys.

## 5. Functional requirements

### 5.1 Seeding and import

- **VANI-D1:** Accept keyword, Boolean, and natural-language queries.
- **VANI-D2:** Accept DOI, arXiv, OpenReview, PMID, DBLP, IEEE article, URL, and title input.
- **VANI-D3:** Accept one or more seed papers.
- **VANI-D4:** Import BibTeX, BibLaTeX, RIS, CSL-JSON, and PDFs.
- **VANI-D5:** Preserve the imported file or payload and report all normalization changes.
- **VANI-D6:** Do not create duplicate work records for repeated imports.

### 5.2 Source discovery

- **VANI-SRC1:** Support Crossref, OpenAlex, Semantic Scholar, DBLP, arXiv, and OpenReview in v0.1.
- **VANI-SRC2:** Support authorized IEEE metadata when credentials and license permit.
- **VANI-SRC3:** Allow connectors to be enabled, disabled, prioritized, and rate-limited.
- **VANI-SRC4:** Record the source query, query time, pagination state, and raw response.
- **VANI-SRC5:** Resume an interrupted ingestion without duplicating records.
- **VANI-SRC6:** Never automate Google Scholar access in v0.1.

### 5.3 Identity and versions

- **VANI-ID1:** Reconcile source records into a canonical work identity.
- **VANI-ID2:** Represent preprint, submission, accepted manuscript, version of record, correction, and retraction separately.
- **VANI-ID3:** Relate versions without destructively merging them.
- **VANI-ID4:** Expose merge and split operations with full undo history.
- **VANI-ID5:** Require human review for high-impact ambiguous matches.

### 5.4 Collections

- **VANI-COL1:** Support manual, nested, smart, and frozen-snapshot collections.
- **VANI-COL2:** Permit one work to belong to multiple collections without duplication.
- **VANI-COL3:** Store collection-specific status, priority, rationale, and notes separately from the work.
- **VANI-COL4:** Attach discovery profiles and schedules to collections.
- **VANI-COL5:** Support selected-item and complete-collection export.
- **VANI-COL6:** Deduplicate recursively included works during export.

### 5.5 Citation verification and export

- **VANI-CIT1:** Treat LLM-generated bibliographic fields as provisional.
- **VANI-CIT2:** Verify core fields against authoritative and corroborating sources when available.
- **VANI-CIT3:** Store field-level provenance and conflicts.
- **VANI-CIT4:** Generate stable `{surname}-{venue}{yy}` citation keys.
- **VANI-CIT5:** Validate keys, types, fields, LaTeX escaping, identifiers, versions, corrections, and retractions before export.
- **VANI-CIT6:** Export BibTeX, BibLaTeX, CSL-JSON, RIS, and lossless VANI JSON.
- **VANI-CIT7:** Freeze a citation key after export unless the user approves a rename.

### 5.6 Files, reading, and annotation

- **VANI-F1:** Store PDFs and arbitrary attachments in an immutable content-addressed store.
- **VANI-F2:** Record access class, source, license, hash, MIME type, size, and retrieval time.
- **VANI-F3:** Render PDFs in the application with page thumbnails, search, navigation, and citation previews.
- **VANI-F4:** Support highlights, underlines, comments, area annotations, and tags.
- **VANI-F5:** Store annotations separately from the original PDF.
- **VANI-F6:** Export a copy of a PDF with embedded annotations.
- **VANI-F7:** Re-anchor annotations across document versions and flag uncertain anchors.
- **VANI-F8:** Support source, claim/evidence, synthesis, and research-decision notes.

### 5.7 Search and discovery

- **VANI-SEARCH1:** Search identifiers, structured metadata, full text, annotations, and notes lexically.
- **VANI-SEARCH2:** Search paper, section, claim, method, task, and note embeddings semantically.
- **VANI-SEARCH3:** Combine semantic, lexical, graph, recency, quality, and user-feedback signals.
- **VANI-SEARCH4:** Explain each recommendation by score component and evidence.
- **VANI-SEARCH5:** Accept positive and negative seeds.
- **VANI-SEARCH6:** Provide accept, dismiss, defer, and “not relevant because” feedback.
- **VANI-SEARCH7:** Avoid recommending near-duplicate versions as distinct discoveries.

### 5.8 Relationships and graph

- **VANI-R1:** Support the frozen v0.1 ontology in `spec/relationship-ontology.yaml`.
- **VANI-R2:** Require evidence or an explicit inference label for derived relationships.
- **VANI-R3:** Store direction, confidence, extraction method, target versions, and verification state.
- **VANI-R4:** Support user correction and rejection without erasing the original extraction record.
- **VANI-G1:** Display paper, author, concept, dataset, method, and review/discussion relationships.
- **VANI-G2:** Provide typed edge filters, semantic zoom, clustering, and saved perspectives.
- **VANI-G3:** Preserve graph layout positions across incremental updates where possible.
- **VANI-G4:** Show a relationship explanation and evidence on edge hover or selection.

### 5.9 OpenReview discourse

- **VANI-PR1:** Ingest public official reviews, comments, rebuttals, meta-reviews, decisions, and revisions.
- **VANI-PR2:** Preserve forum hierarchy, visibility, timestamps, edits, and provenance.
- **VANI-PR3:** Extract critique categories and link them to manuscript versions and passages where possible.
- **VANI-PR4:** Distinguish raised, acknowledged, disputed, addressed, partially addressed, unresolved, and indeterminate concerns.
- **VANI-PR5:** Never infer anonymous reviewer identity.
- **VANI-PR6:** Do not equate acceptance with resolution of criticism.

### 5.10 Ask VANI

- **VANI-QA1:** Support questions over the current paper, selected papers, a collection, descendants, or the entire library.
- **VANI-QA2:** Keep the active scope visible.
- **VANI-QA3:** Retrieve from verified metadata, full text, graph edges, reviews, annotations, and notes.
- **VANI-QA4:** Validate answer claims and citations in a separate pass.
- **VANI-QA5:** Link substantive claims to exact evidence or label them as inference.
- **VANI-QA6:** Distinguish author limitations, reviewer concerns, later findings, user assessments, and VANI inferences.
- **VANI-QA7:** State when evidence is insufficient or contradictory.
- **VANI-QA8:** Save an answer as a versioned synthesis note with corpus snapshot and model provenance.
- **VANI-QA9:** Never silently introduce external model knowledge into a collection-scoped answer.

### 5.11 Continuous discovery

- **VANI-CD1:** Permit manual, daily, weekly, monthly, and custom schedules.
- **VANI-CD2:** Store each run as an immutable query and corpus snapshot.
- **VANI-CD3:** Present new, changed, corrected, retracted, and newly connected works as a diff.
- **VANI-CD4:** Avoid repeating dismissed recommendations unless materially new evidence changes their status.
- **VANI-CD5:** Permit pause, resume, retry, and cancellation.

## 6. Non-functional requirements

### Performance

- Metadata ingest after retrieval: at least 100 records/second on the reference machine.
- Lexical search p95: under 200 ms for one million metadata records.
- Filtered semantic search p95: under 500 ms for one million paper vectors.
- One-hop graph neighborhood p95: under 100 ms.
- First interactive render: under one second for 500 visible nodes.
- Local annotation persistence: under 100 ms.

### Reliability

- Jobs are idempotent and resumable.
- Raw source records and user content are never stored only in an index.
- Every database mutation that changes canonical identity is auditable and reversible.
- Exports are deterministic for a fixed collection snapshot and configuration.

### Portability

- Support complete export of metadata, files, notes, annotations, collections, and graph relationships.
- Use Markdown, JSON/JSON-LD, BibTeX/BibLaTeX, RIS, CSL-JSON, and standard PDF annotations where applicable.
- No core user artifact requires a vendor service to read.

### Security and privacy

- Bind to localhost by default.
- Encrypt credentials at rest using an OS-protected or user-supplied secret.
- Redact secrets from logs.
- Require explicit authorization before private content is sent to a remote LLM.
- Treat retrieved web and document content as untrusted input.

### Accessibility

- All primary actions must be keyboard reachable.
- Graph information must have a non-graph tabular representation.
- Color must never be the sole relationship indicator.
- PDF and answer citations must be navigable with assistive technology.

## 7. v0.1 release outcome

VANI 0.1 is complete when the acceptance suite proves that a user can move through the complete golden workflow with verified citations, durable local artifacts, inspectable relationships, grounded collection answers, and a valid collection-level BibTeX export.

