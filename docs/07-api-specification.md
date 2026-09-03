# VANI 0.1 Application API

## 1. Conventions

- Base path: `/api/v1`.
- JSON request and response bodies unless returning an artifact or stream.
- UUIDv7 resource identifiers.
- ISO 8601 UTC timestamps.
- Cursor pagination for collections that can grow.
- `Idempotency-Key` required on import, export, job-trigger, merge, and bulk-write endpoints.
- Optimistic concurrency through `ETag`/`If-Match` or resource version.
- Server-sent events or WebSocket event stream for long-running jobs.
- The machine-readable skeleton is `spec/openapi.yaml`.

## 2. Resource groups

### System

```text
GET  /health
GET  /capabilities
GET  /settings
PATCH /settings
GET  /connectors
PATCH /connectors/{connector}
```

### Works and manifestations

```text
GET  /works
POST /works/resolve
GET  /works/{workId}
PATCH /works/{workId}
GET  /works/{workId}/manifestations
GET  /manifestations/{manifestationId}
GET  /manifestations/{manifestationId}/provenance
POST /works/merge
POST /works/{workId}/split
POST /manifestations/{manifestationId}/verify
```

Merge/split returns an asynchronous job when more than one dependent entity is affected.

### Import and files

```text
POST /imports
GET  /imports/{importId}
POST /objects
GET  /attachments/{attachmentId}
GET  /attachments/{attachmentId}/content
GET  /attachments/{attachmentId}/parse
POST /attachments/{attachmentId}/reparse
POST /attachments/{attachmentId}/export-annotated
```

Uploads use resumable multipart transfer. The server computes content hashes; client hashes are hints only.

### Collections

```text
GET  /collections
POST /collections
GET  /collections/{collectionId}
PATCH /collections/{collectionId}
DELETE /collections/{collectionId}
GET  /collections/{collectionId}/members
POST /collections/{collectionId}/members
PATCH /collections/{collectionId}/members/{workId}
DELETE /collections/{collectionId}/members/{workId}
POST /collections/{collectionId}/snapshots
POST /collections/{collectionId}/exports
```

Deletion moves collections to trash; memberships do not delete works.

### Search and discovery

```text
POST /search
POST /recommendations/explain
GET  /discovery-profiles
POST /discovery-profiles
PATCH /discovery-profiles/{profileId}
POST /discovery-profiles/{profileId}/runs
GET  /discovery-runs/{runId}
GET  /discovery-runs/{runId}/diff
PATCH /recommendations/{recommendationId}
```

`POST /search` accepts `lexical`, `semantic`, `hybrid`, and `graph` modes plus an explicit scope.

### Graph

```text
POST /graph/neighborhood
POST /graph/path
POST /graph/compare
GET  /relationships/{relationshipId}
PATCH /relationships/{relationshipId}/verification
POST /perspectives
GET  /perspectives/{perspectiveId}
PATCH /perspectives/{perspectiveId}
```

Graph requests require node/edge limits and return truncation metadata.

### Notes and annotations

```text
GET  /notes
POST /notes
GET  /notes/{noteId}
PATCH /notes/{noteId}
DELETE /notes/{noteId}
GET  /attachments/{attachmentId}/annotations
POST /attachments/{attachmentId}/annotations
PATCH /annotations/{annotationId}
DELETE /annotations/{annotationId}
POST /annotations/{annotationId}/reanchor
```

### Reviews and discussion

```text
GET  /manifestations/{manifestationId}/discussion
POST /manifestations/{manifestationId}/discussion/refresh
GET  /critiques/{critiqueId}
PATCH /critiques/{critiqueId}/verification
PATCH /critique-resolutions/{resolutionId}
```

### Ask VANI

```text
POST /conversations
GET  /conversations/{conversationId}
POST /conversations/{conversationId}/messages
GET  /answers/{answerId}
GET  /answers/{answerId}/claims
POST /answers/{answerId}/save-as-note
POST /answers/{answerId}/show-on-graph
```

Message request includes:

```json
{
  "question": "What is the innovation of A over B?",
  "scope": {
    "type": "selected_manifestations",
    "ids": ["...", "..."]
  },
  "include": {
    "notes": true,
    "reviews": true,
    "external_search": false
  },
  "evidence_policy": "verified_or_direct"
}
```

### Jobs and events

```text
GET  /jobs/{jobId}
POST /jobs/{jobId}/cancel
POST /jobs/{jobId}/retry
GET  /events
```

## 3. Search response

Each result includes:

```json
{
  "work": {},
  "preferred_manifestation": {},
  "rank": 1,
  "score": 0.87,
  "features": {
    "semantic": 0.91,
    "lexical": 0.42,
    "citation": 0.30,
    "method_overlap": 0.75,
    "user_profile": 0.55
  },
  "why_shown": [],
  "verification_status": "verified_multi_source",
  "access": {}
}
```

Do not expose a score without its feature decomposition and ranker version.

## 4. Answer response

```json
{
  "id": "...",
  "status": "complete",
  "scope_snapshot": {},
  "markdown": "...",
  "claims": [
    {
      "id": "...",
      "text": "Paper A introduces...",
      "support_status": "directly_supported",
      "evidence": [
        {
          "type": "document_span",
          "manifestation_id": "...",
          "page": 4,
          "section": "Method",
          "exact_text": "..."
        }
      ]
    }
  ],
  "limitations": [],
  "model_provenance": {}
}
```

## 5. Error format

```json
{
  "error": {
    "code": "CITATION_CONFLICT",
    "message": "Two authoritative records disagree on author order.",
    "retryable": false,
    "details": {},
    "request_id": "..."
  }
}
```

Required error classes include validation, not found, conflict, authentication, authorization, policy denied, rate limited, upstream unavailable, parse failure, model failure, insufficient evidence, and internal error.

## 6. Event model

Events include:

```text
job.updated
import.updated
document.parsed
citation.verified
citation.conflict_detected
discovery.run_updated
recommendation.created
relationship.created
relationship.verification_changed
answer.updated
collection.export_ready
```

Events contain resource IDs and safe summaries, not complete private content.

## 7. API security

Local mode may use a generated session secret without interactive login. Any non-loopback binding requires authenticated users, CSRF protection, secure cookies or tokens, and transport security. Connector credentials are never returned by read endpoints.

