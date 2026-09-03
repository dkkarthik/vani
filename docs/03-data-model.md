# VANI 0.1 Data Model

## 1. Modeling rules

- Use UUIDv7 identifiers for application entities.
- Treat source payloads and binary originals as immutable.
- Represent source normalization and canonicalization as provenance-bearing transformations.
- Keep a conceptual work separate from its manifestations and files.
- Do not encode provenance only in application logs.
- Use soft deletion for user entities and tombstones for deleted upstream records.
- Record `created_at`, `updated_at`, and optimistic-lock version on mutable rows.

## 2. Scholarly identity

### `work`

Represents the intellectual work shared by related manifestations.

Core fields:

```text
id, canonical_title, normalized_title, work_type,
language, abstract, verification_status,
preferred_manifestation_id, created_at, updated_at
```

### `manifestation`

Represents a specific preprint, submission, accepted manuscript, proceedings article, journal version, correction, or retraction.

```text
id, work_id, manifestation_type, title, subtitle,
venue_id, publisher_id, volume, issue, article_number,
page_first, page_last, page_literal,
submitted_date, accepted_date, online_date, issued_date, print_date,
language, version_label, status, citation_key,
verification_status, created_at, updated_at
```

`manifestation_type` values:

```text
submission, preprint, accepted_manuscript, proceedings_version,
journal_version, version_of_record, revision, correction,
retraction, editorial_notice, supplement
```

### `identifier`

```text
id, entity_type, entity_id, scheme, original_value,
normalized_value, authority, verified_at, is_primary
```

Supported schemes include DOI, OpenReview, arXiv, DBLP, PMID, PMCID, ISBN, ISSN, IEEE article number, ACM ID, Semantic Scholar, and OpenAlex.

Enforce uniqueness over `(scheme, normalized_value)` where the scheme is globally unique. Preserve aliases and retired identifiers.

### `manifestation_relation`

```text
subject_manifestation_id, predicate, object_manifestation_id,
source_record_id, verification_status, created_at
```

Predicates include `is_preprint_of`, `is_revision_of`, `is_version_of`, `corrects`, `retracts`, `extends`, and `is_supplement_to`.

## 3. People, organizations, and venues

### `person`

```text
id, display_name, given_names, family_name, particles,
suffix, literal_name, normalized_name, orcid,
verification_status
```

### `authorship`

```text
manifestation_id, person_id, position, role,
is_corresponding, raw_name, source_record_id
```

### `organization`

```text
id, name, normalized_name, organization_type, ror_id, country
```

### `affiliation`

An authorship can have zero or more affiliations. Preserve raw publisher text even when organization resolution succeeds.

### `venue`

```text
id, canonical_name, short_name, abbreviation, venue_type,
publisher_id, issn_print, issn_electronic, isbn,
homepage_url, verification_status
```

Venue aliases are separate rows so `RA-L`, `IEEE RA-L`, and the full journal name resolve to one venue.

### `event`

Represents a conference instance:

```text
id, venue_id, edition, year, name, acronym,
start_date, end_date, city, country, official_url
```

## 4. Source and field provenance

### `source_record`

```text
id, connector, external_id, entity_hint,
retrieved_at, source_updated_at, schema_version,
license, access_class, request_id,
payload_object_hash, payload_json,
payload_hash, tombstoned_at
```

Large payloads may live in the object store; `payload_json` contains query-critical portions.

### `field_assertion`

Every canonical field can have multiple assertions:

```text
id, entity_type, entity_id, field_path,
raw_value_json, normalized_value_json,
source_record_id, authority_rank,
asserted_at, normalization_rule,
verification_status, conflict_group_id
```

### `canonical_decision`

```text
id, entity_type, entity_id, field_path,
selected_assertion_id, decision_type,
rule_version, user_id, explanation,
created_at, supersedes_decision_id
```

This makes a user correction an auditable selection or new assertion rather than a destructive edit.

## 5. Files and document structure

### `object`

```text
hash_sha256, byte_size, mime_type, created_at,
storage_path, integrity_status
```

### `attachment`

```text
id, manifestation_id, object_hash, attachment_type,
filename, source_url, access_class, license,
source_record_id, is_primary, created_at
```

### `document_parse`

```text
id, attachment_id, parser_name, parser_version,
status, started_at, completed_at,
parsed_object_hash, text_hash, quality_metrics_json
```

### `document_block`

```text
id, parse_id, parent_block_id, block_type,
page_start, page_end, ordinal,
section_path, text, text_hash,
bounding_boxes_json, confidence
```

Block types include title, abstract, heading, paragraph, list, equation, figure, table, caption, footnote, reference, and appendix.

### `evidence_span`

```text
id, attachment_id, parse_id, document_block_id,
page_start, page_end, exact_text,
prefix_text, suffix_text, start_offset, end_offset,
bounding_boxes_json, text_hash
```

Evidence spans are immutable anchors. If a document changes, re-anchoring creates a new span and a relation to the previous span.

## 6. Collections and research state

### `collection`

```text
id, parent_id, name, description, collection_type,
query_definition_json, frozen_at, created_at, updated_at
```

Types: `manual`, `smart`, `snapshot`.

### `collection_membership`

```text
collection_id, work_id, preferred_manifestation_id,
status, priority, rationale, added_by,
source_run_id, ordinal, created_at, updated_at
```

Statuses:

```text
inbox, to_read, skimming, reading, read,
foundational, cited, rejected, archived
```

### `collection_snapshot`

Stores a stable ordered membership and preferred manifestation set used for reproducible exports and saved Ask VANI answers.

### `research_question`

```text
id, collection_id, text, scope_json, status, created_at, updated_at
```

### `thesis_claim`

```text
id, collection_id, text, status, confidence,
created_at, updated_at
```

Claims link to evidence spans, notes, relationships, and Ask VANI answer claims.

## 7. Notes and annotations

### `annotation`

```text
id, attachment_id, annotation_type, body_markdown,
color, tags_json, page_start, page_end,
selector_json, evidence_span_id,
created_at, updated_at, deleted_at
```

`selector_json` follows W3C Web Annotation concepts and contains redundant geometric, text-quote, and text-position selectors.

### `note`

```text
id, note_type, title, markdown,
structured_blocks_json, collection_id,
work_id, manifestation_id,
created_at, updated_at, deleted_at
```

Types: `source`, `claim`, `synthesis`, `research_decision`, `daily_log`, `ask_vani_answer`.

### `note_link`

```text
source_note_id, predicate, target_type, target_id,
created_at
```

Predicates include supports, contradicts, refines, derived_from, discusses, answers, and related_to.

Maintain note revision history and permit full Markdown export.

## 8. Scholarly entities and typed relationships

### `concept`

Represents a normalized idea, task, method, dataset, benchmark, metric, or claim subject. Concepts have aliases and evidence-backed mentions.

### `entity_mention`

```text
id, concept_id, manifestation_id, evidence_span_id,
surface_form, mention_role, extractor_run_id,
confidence, verification_status
```

### `typed_relationship`

```text
id, subject_type, subject_id, predicate,
object_type, object_id,
subject_manifestation_id, object_manifestation_id,
confidence, verification_status,
extractor_run_id, created_at, updated_at
```

### `relationship_evidence`

```text
relationship_id, evidence_span_id, evidence_role,
entailment_status, confidence
```

One relationship may have multiple supporting and contradicting spans.

## 9. Reviews and scholarly discourse

### `discussion_thread`

```text
id, manifestation_id, source, external_id,
thread_type, visibility, source_record_id
```

### `discussion_event`

```text
id, thread_id, parent_event_id, event_type,
external_id, public_actor_label, content_markdown,
rating_json, confidence_json,
created_source_at, modified_source_at,
source_record_id, deleted_at
```

Types include official_review, meta_review, author_response, rebuttal, official_comment, public_comment, decision, and revision_notice.

### `critique`

```text
id, discussion_event_id, category,
summary, target_type, target_id,
target_evidence_span_id, critique_evidence_span_id,
severity, extraction_confidence,
verification_status
```

### `critique_resolution`

```text
id, critique_id, status, author_response_event_id,
revision_manifestation_id, resolution_evidence_span_id,
explanation, confidence, verified_by_user,
created_at, updated_at
```

## 10. Discovery, ranking, and feedback

### `discovery_profile`

```text
id, collection_id, name, seed_json, source_config_json,
ranking_config_json, filter_config_json,
schedule, enabled, created_at, updated_at
```

### `discovery_run`

```text
id, profile_id, trigger_type, status,
query_snapshot_json, corpus_snapshot_hash,
started_at, completed_at, summary_json
```

### `recommendation`

```text
id, run_id, work_id, rank, score,
feature_values_json, explanation_json,
status, status_reason, created_at, updated_at
```

Statuses: new, accepted, dismissed, deferred, superseded.

### `recommendation_feedback`

Records explicit relevance, reason labels, and optional user text. Feedback changes future ranking but never erases the original run.

## 11. Search and model artifacts

### `embedding`

```text
id, owner_type, owner_id, model_id,
source_text_hash, dimensions, vector,
created_at, superseded_at
```

### `model_run`

```text
id, task_type, provider, model, model_revision,
prompt_template, prompt_version,
input_hash, privacy_class, parameters_json,
started_at, completed_at, usage_json,
output_object_hash, validation_status
```

### `answer`

```text
id, conversation_id, question,
scope_snapshot_json, collection_snapshot_id,
answer_markdown, model_run_id,
created_at, superseded_at
```

### `answer_claim`

```text
id, answer_id, text, support_status,
confidence, ordinal
```

### `answer_claim_evidence`

Links answer claims to evidence spans, verified metadata assertions, reviews, relationships, and notes.

## 12. Jobs and audit

### `job` and `job_attempt`

Use the state model in the architecture document. Idempotency keys are unique per job type and logical operation.

### `audit_event`

```text
id, actor_type, actor_id, action,
entity_type, entity_id,
before_json, after_json,
request_id, created_at
```

Sensitive values are redacted before insertion.

## 13. Deletion and retention

- Removing a work from a collection deletes only the membership.
- Deleting a user-uploaded attachment is recoverable until trash is emptied.
- Emptying trash removes database references, then moves the object to a garbage-collection grace set.
- An object is physically deleted only when no retained row references its hash and the grace interval has elapsed.
- Upstream deletion creates a tombstone; it does not silently erase citations, decisions, or existing provenance.

