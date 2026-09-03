# VANI 0.1 Evaluation Plan

## 1. Objective

VANI must be evaluated as a research system, not by whether its graph and answers appear plausible. The v0.1 evaluation measures identity accuracy, citation correctness, discovery relevance, relationship extraction, evidence grounding, usability, and performance.

## 2. Reference corpus

Build a manually curated robotics corpus containing:

- at least 1,000 metadata records;
- 100 lawfully available PDFs;
- 20 or more OpenReview discussion threads where relevant;
- IEEE, ACM, arXiv, DBLP, and OpenReview examples;
- preprint/final pairs;
- conference/journal extension pairs;
- corrections or retractions;
- ambiguous titles and author names;
- at least three coherent topic collections.

Suggested collection themes:

1. large-scale terrain representation and navigation;
2. semantic mapping and scene representation;
3. learning-based motion planning or field robotics.

Include `CLEAR: A Semantic–Geometric Terrain Abstraction for Large-Scale Unstructured Environments` as the citation-key reference fixture `meshram-ral26`.

## 3. Human-labeled sets

### Identity set

- 100 true duplicate source-record pairs;
- 50 preprint/version-of-record pairs;
- 25 related but distinct conference/journal works;
- 100 hard negative pairs with similar titles or authors.

### Discovery set

- 100 conceptually similar pairs;
- 100 misleading lexical or citation neighbors;
- 50 interdisciplinary bridge cases;
- 50 relevant recent papers with few citations.

### Relationship set

At minimum:

- 50 `uses_as_baseline`;
- 50 `compares_against`;
- 50 `evaluates_on`;
- 40 `uses_method`;
- 30 `extends` or `adapts_method`;
- 30 review critiques and responses;
- 20 support/contradiction candidates.

Each positive includes exact evidence. Negative examples include citations that do not imply the target relationship.

### Citation set

At least 200 verified manifestations with publisher/registry records, including:

- journal articles;
- conference papers;
- preprints;
- datasets/software where supported;
- non-ASCII names;
- organizational authors;
- article numbers and page ranges;
- online/print year differences;
- same-author/same-venue/same-year key collisions.

### Ask VANI set

At least 50 questions:

- factual lookup;
- paper comparison;
- innovation analysis;
- shortcomings by evidence class;
- review/rebuttal interpretation;
- collection synthesis;
- insufficient-evidence cases;
- contradictory-evidence cases.

Answers are scored claim by claim.

## 4. Metrics and gates

### Identity resolution

- DOI exact-match precision: 100%.
- Overall automatic merge precision: at least 99.5%.
- Hard-negative false merge rate: below 0.5%.
- Version-link recall: at least 95%.
- Ambiguous cases must be routed to review rather than incorrectly merged.

### Citation verification

- Core field accuracy on verified records: at least 99.5%.
- DOI validity: 100%.
- Author count/order accuracy: at least 99.5%.
- Duplicate citation keys after validation: zero.
- BibTeX parse success: 100% for non-blocked exports.
- Required round-trip fields preserved: 100%.

### Discovery

- Recall@50 on curated relevant set: at least 85%.
- Precision@10: at least 70% for focused seed sets.
- Recent low-citation recall compared with citation-only baseline: materially higher.
- Recommendation explanation feature values match stored ranker inputs: 100%.

Report metrics separately by seed type and topic. Do not hide weak subgroups in one aggregate.

### Relationship extraction

- `uses_as_baseline` precision: at least 90%.
- `compares_against` precision: at least 90%.
- `evaluates_on` precision: at least 92%.
- exact evidence-span correctness: at least 90%.
- unsupported verified relationships: zero.
- user rejection survives re-extraction: 100%.

Recall is reported, but v0.1 prioritizes precision and evidence correctness.

### Ask VANI

- citation precision: at least 98% of citations support their attached claim.
- unsupported substantive claim rate: below 2%; release target zero on high-severity claims.
- evidence anchor opens the correct source location: at least 99%.
- correctly refuses or qualifies insufficient-evidence questions: at least 95%.
- source-class attribution accuracy: 100%.

### Performance

Use the targets in the PRD on a documented reference workstation. Report cold and warm performance, corpus size, index configuration, and concurrency.

## 5. Baselines

Compare discovery variants:

- lexical only;
- embedding only;
- citation/co-citation only;
- hybrid without user feedback;
- full VANI ranker.

Compare relationship extraction:

- lexical pattern baseline;
- LLM without section/evidence validation;
- full VANI extraction and validation.

Compare Ask VANI:

- one-shot RAG;
- scoped retrieval without claim validation;
- full claim-level validation.

## 6. Human evaluation protocol

Evaluators are blind to algorithm variant where practical. Use two raters for relationship and answer judgments, record disagreements, and adjudicate. Track inter-rater agreement but preserve legitimate disagreement as a result.

Rating dimensions:

- relevance;
- factual correctness;
- evidence sufficiency;
- qualification/uncertainty;
- usefulness for deciding what to read or believe;
- explanation clarity.

## 7. Regression suite

Every release runs frozen fixtures for:

- identity merges and splits;
- citation-key generation;
- source normalization;
- relationship extraction schemas;
- evidence anchors;
- export parsing and round trips;
- Ask VANI claim validation;
- privacy-policy routing.

Model-dependent tests use pinned model versions for release evaluation. If an external provider changes an unpinned model, VANI marks the evaluation stale.

## 8. Evaluation artifacts

Store:

- corpus manifest and licenses;
- labels and adjudication history;
- source snapshots where redistribution permits;
- prompt and model versions;
- metric code;
- result tables and error analysis;
- release decision.

No release passes solely on aggregate scores. All material false merges, incorrect citations, privacy leaks, and unsupported confident answers require explicit disposition.

