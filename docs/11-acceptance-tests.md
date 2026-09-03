# VANI 0.1 Acceptance Tests

## 1. Severity

- **P0:** data integrity, privacy, identity, citation, and complete golden-workflow requirements. All must pass.
- **P1:** required usability, discovery, review, and performance requirements. All must pass or have an approved narrowly scoped exception.
- **P2:** desirable behavior that may move to the next release.

The executable-style scenarios are mirrored in `tests/acceptance/vani-0.1.feature`.

## 2. Golden workflow

### AT-001 — Idea to exported collection — P0

Given an empty installation, when the user creates a collection, seeds it with an idea and two papers, accepts recommendations, imports a PDF, annotates it, asks a collection question, schedules a refresh, and exports BibTeX, then all artifacts remain linked to the correct works and the export parses successfully.

### AT-002 — Offline continuity — P0

With external connectors disabled, the user can search stored metadata/full text, read PDFs, edit notes and annotations, inspect stored graph edges, ask a local-model question if configured, and export a collection.

## 3. Identity and versions

### AT-010 — Duplicate imports — P0

Importing the same DOI through Crossref, BibTeX, and PDF creates one manifestation with three provenance sources.

### AT-011 — Preprint and version of record — P0

An arXiv preprint and verified publisher version are linked but remain distinct manifestations, files, dates, and citation keys.

### AT-012 — Ambiguous similar papers — P0

Two papers with similar titles and overlapping authors are not automatically merged without sufficient evidence.

### AT-013 — Merge undo — P0

An approved merge can be undone without losing collection membership, annotations, notes, or source records.

## 4. Citation correctness

### AT-020 — Standard key — P0

The verified CLEAR IEEE RA-L record produces `meshram-ral26`.

### AT-021 — Venue aliases — P0

`RA-L`, `IEEE RA-L`, and the full journal name resolve to `ral`.

### AT-022 — Collision stability — P0

Two works with the same author/venue/year receive stable distinct keys, and deleting one does not rename the other.

### AT-023 — Field conflict — P0

A publisher/registry author-order conflict is displayed and prevents full verification until resolved.

### AT-024 — Export validation — P0

Invalid DOI, duplicate key, or missing required field blocks export with a specific repair path.

### AT-025 — Retraction warning — P0

A retracted work remains exportable only after a visible warning; the retraction is never silently hidden.

### AT-026 — Round trip — P0

BibTeX, BibLaTeX, CSL-JSON, and RIS exports preserve required identity fields when reimported.

## 5. Files, annotations, and notes

### AT-030 — Immutable original — P0

Creating and editing annotations does not change the stored original PDF hash.

### AT-031 — Annotation export — P1

An exported annotated PDF contains visible annotations and the source database annotations remain editable.

### AT-032 — Evidence navigation — P0

Clicking an annotation-derived note opens the correct manifestation, page, and highlighted text.

### AT-033 — Version re-anchor — P1

An annotation is re-anchored to a new version when exact evidence permits; uncertain matches require user confirmation.

## 6. Discovery and graph

### AT-040 — Recommendation explanation — P0

Every recommendation exposes stored rank features and a readable “why shown” explanation.

### AT-041 — Negative feedback — P1

A dismissed result with a reason is suppressed in equivalent later runs unless materially new evidence appears.

### AT-042 — Edge evidence — P0

A verified `uses_as_baseline` edge opens the experimental passage or table that supports it.

### AT-043 — Inference styling — P0

A semantic/model-inferred edge is visually and textually distinct from a verified edge.

### AT-044 — Stable perspective — P1

Adding new papers preserves positions of existing nodes within defined tolerance.

### AT-045 — Bounded graph — P1

An oversized graph request is truncated explicitly and offers refinement controls.

## 7. Reviews

### AT-050 — OpenReview hierarchy — P0

Public review, rebuttal, meta-review, decision, and revisions appear in correct thread and time order.

### AT-051 — Visibility — P0

Private or unreadable OpenReview fields are not ingested or inferred.

### AT-052 — Anonymity — P0

No workflow attempts to identify an anonymous reviewer.

### AT-053 — Unresolved concern — P1

Acceptance does not automatically mark reviewer concerns resolved.

## 8. Ask VANI

### AT-060 — Scope enforcement — P0

A collection-scoped question uses only selected sources when external search is off.

### AT-061 — Innovation comparison — P0

The answer distinguishes method, assumptions, evaluation, and qualifications and cites exact evidence from both papers.

### AT-062 — Shortcomings attribution — P0

The answer labels author-acknowledged limitations, reviewer concerns, user notes, and VANI inferences separately.

### AT-063 — Unsupported claim removal — P0

A fluent model claim without supporting evidence is removed or explicitly labeled unsupported before display.

### AT-064 — Insufficient evidence — P0

VANI states that a comparison cannot be made when the collection lacks comparable evidence.

### AT-065 — Saved answer provenance — P0

A saved answer includes collection snapshot, model, prompt version, claim evidence, and creation time.

### AT-066 — Evidence link — P0

Every displayed citation opens the correct metadata assertion, paper passage, review event, or note.

## 9. Continuous discovery

### AT-070 — Idempotent rerun — P0

Retrying the same completed source page or job does not create duplicate works, recommendations, or edges.

### AT-071 — Run diff — P1

A refresh separates new papers, metadata changes, review changes, corrections/retractions, and new relationships.

### AT-072 — Resume — P0

An interrupted multi-page run resumes from stored cursors and reports partial-source state.

## 10. Privacy and policy

### AT-080 — Remote model authorization — P0

Private notes or unpublished user PDFs are never sent to a remote model without an applicable explicit setting.

### AT-081 — Secret redaction — P0

Connector and LLM credentials do not appear in logs, errors, exports, or API responses.

### AT-082 — Source restriction — P0

A metadata-only or external-link-only record cannot be queued for unauthorized full-text retrieval.

## 11. Backup and recovery

### AT-090 — Complete restore — P0

After restore to a clean instance, collections, citation keys, PDFs, annotations, notes, graph edges, source provenance, and saved answers are intact.

### AT-091 — Index rebuild — P0

Search and vector indexes can be rebuilt from canonical data without losing user artifacts.

### AT-092 — Corrupt object — P0

Checksum verification detects a corrupt object and identifies affected attachments without returning corrupted content as valid.

## 12. Performance and accessibility

### AT-100 — Search budgets — P1

Lexical, semantic, and graph queries meet PRD p95 targets on the reference corpus and machine.

### AT-101 — Annotation latency — P1

Local annotation save is acknowledged within 100 ms p95 under normal load.

### AT-102 — Keyboard workflow — P1

The golden workflow can be completed without a pointing device except freeform geometric PDF annotation.

### AT-103 — Graph alternative — P0

All graph nodes and relationships in the active view are available in an accessible list/table representation.

