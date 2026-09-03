# VANI 0.1 Relationship Ontology

## 1. Purpose

The ontology defines relationships VANI can store, extract, verify, rank, and display consistently. It is intentionally small for v0.1. New predicates require a definition, allowed endpoints, evidence rules, inverse behavior, and evaluation examples.

The machine-readable authority is `spec/relationship-ontology.yaml`.

## 2. Evidence classes

```text
direct_text       Explicit statement in a paper, review, or response
structured_data   Table, metadata, reference, or declared dataset/method
computed_graph    Citation/co-citation/bibliographic computation
model_inference   Semantic or LLM-derived inference
user_assertion    Researcher-created relationship
```

Verification states:

```text
verified
user_verified
probable
inferred
disputed
rejected
```

An inferred edge must never be rendered as verified. User rejection suppresses the edge from default views but preserves its extraction provenance.

## 3. Paper-to-paper relationships

### `cites`

- Direction: citing manifestation → cited manifestation/work.
- Evidence: parsed reference plus resolved identity, or authoritative citation graph.
- Inverse label: `cited_by`.
- Notes: citation existence does not imply support or similarity.

### `semantic_similar`

- Direction: symmetric.
- Evidence: stored embedding/model and similarity score.
- Verification: always model-derived unless confirmed by user.
- Notes: expose model and score components.

### `bibliographically_coupled`

- Direction: symmetric.
- Evidence: shared resolved references.
- Required data: shared count, normalized score, shared-reference list.

### `co_cited`

- Direction: symmetric.
- Evidence: third-party works citing both.
- Required data: co-citing works and count.

### `extends`

- Direction: newer/derivative work → prior work.
- Meaning: explicitly continues, generalizes, or materially builds on the prior approach.
- Evidence: direct textual statement plus passages describing the extension.
- Exclusion: topical similarity alone.

### `adapts_method`

- Direction: adapting work → source work/method.
- Meaning: modifies an existing method for a new constraint, task, or domain.
- Evidence: method passage and cited source.

### `uses_as_baseline`

- Direction: evaluating work → baseline work/method.
- Evidence: experimental/setup passage and preferably table/figure reference.
- Required attributes: evaluation location and baseline label.

### `compares_against`

- Direction: evaluating work → compared work/method.
- Meaning: explicit empirical or analytical comparison, not necessarily a baseline.
- Evidence: comparison passage/table.

### `reproduces`

- Direction: reproducing work/report → target work.
- Evidence: explicit reproduction claim and result.
- Attributes: outcome `successful`, `partial`, `failed`, or `mixed`.

### `supports_claim`

- Direction: evidence work → claim or work claim.
- Evidence: explicit conclusion and aligned claim representation.
- Caution: do not infer from citation alone.

### `contradicts_claim`

- Direction: evidence work → claim or work claim.
- Evidence: explicit conflicting result or conclusion.
- Caution: differing populations or evaluation settings must be surfaced.

## 4. Paper-to-entity relationships

### `evaluates_on`

- Work → dataset, benchmark, task, environment, or population.
- Evidence: methods/evaluation text or structured table.

### `uses_method`

- Work → method.
- Evidence: method section or explicit implementation description.

### `introduces_method`

- Work → method.
- Evidence: explicit contribution/novelty claim.
- Verification must preserve whether novelty is author-claimed or independently accepted.

### `introduces_dataset`

- Work → dataset.
- Evidence: dataset contribution statement and identifier/access location where available.

### `uses_metric`

- Work → metric.
- Evidence: evaluation passage or table heading.

### `addresses_task`

- Work → task/problem.
- Evidence: abstract, introduction, or task definition.

## 5. Review and discourse relationships

### `critiques`

- Review/commentary → work, claim, method, experiment, figure, or table.
- Evidence: exact critique passage.
- Attributes: category, stated severity, public source type.

### `responds_to`

- Author response/comment → review or critique.
- Evidence: reply hierarchy or explicit reference.

### `addresses_critique`

- Revision/change → critique.
- Evidence: author response plus revision diff/evidence.
- Resolution is proposed, not assumed from revision existence.

### `disputes_critique`

- Author response or other commentary → critique.
- Evidence: explicit disagreement.

### `editor_adjudicates`

- Meta-review/decision → critique or dispute.
- Evidence: decision/meta-review passage.

### `suggests_related_work`

- Review/commentary → work.
- Evidence: cited or identifiable suggested work.
- Notes: used as discovery input and visibly attributed to the reviewer/commentator.

## 6. Relationship extraction pipeline

1. Identify candidate passages using section labels, citation contexts, tables, and lexical patterns.
2. Resolve all source and target entities.
3. Ask the task-specific extractor for structured candidates.
4. Validate endpoint types and required attributes.
5. Verify cited identifiers and evidence anchors.
6. Run entailment/support classification.
7. Deduplicate equivalent edges while retaining all evidence.
8. Persist model run and confidence.
9. Route high-impact or uncertain edges to user review.

## 7. Display rules

- Edge color indicates predicate family; line style indicates verification state.
- Hover shows human label, direction, confidence, and evidence preview.
- Selection opens all evidence, extraction provenance, and correction controls.
- A bundle of multiple relationship types must be expandable.
- Similarity edges never obscure direct citations or verified deep relationships.
- The graph legend explains each visible predicate and evidence state.

## 8. Initial extraction priorities

Order of implementation:

1. citations and manifestation relations;
2. semantic similarity;
3. evaluates_on and uses_method;
4. uses_as_baseline and compares_against;
5. extends and adapts_method;
6. review critiques and responses;
7. supports_claim and contradicts_claim.

Claim support/contradiction is last because it requires the strongest contextual evaluation.

