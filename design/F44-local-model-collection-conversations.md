# F44 — Local-model collection conversations

Status: **planned; not implemented**. Priority: P1. Requested September 13, 2026. Move VANI's natural-language collection conversation to the configured local model, including follow-up questions and answers grounded in saved collection evidence.

## Outcome and existing behavior

From a collection, the researcher can ask for a summary, compare contributions, investigate limitations, ask why a paper belongs, and continue with follow-up questions. Retrieval, conversation context and generation stay on the workstation. A configured cloud API key does not affect this workflow.

Two existing paths need coordinated treatment:

- [ask.ts](../apps/api/src/ask.ts) selects cloud synthesis when a key exists; its no-key fallback is extractive rather than an Ollama conversation.
- [F26](F26-grounded-collection-questions.md) already supports grounded questions through the knowledge/insights workflow, including optional local-only synthesis. Reuse its passage retrieval and evidence validation.

F44 is the user-facing conversation feature. **LM-R01**, the [shared model router](local-model-deployment.md#71-required-implementation-workstream-lm-r01--shared-local-first-model-router), supplies execution and enforcement. [F43](F43-ubuntu-dependency-checker-and-installer.md) prepares and diagnoses the runtime. This specification does not implement these capabilities.

## Interaction design

Show the collection scope and a “Local model” indicator; expose the configured model in details. Preserve existing history and label historical answers with their original provider. Earlier cloud answers must not be relabeled as local.

Support questions such as “What are the main contributions?”, “How does this differ from the previous paper?”, “Which assumptions are shared?” and “Why was this paper included?” Follow-ups retain referenced papers and conversational intent within the collection. Ask for clarification when a reference is ambiguous.

Answers link claims to inspectable passages, pages, annotations or explicitly included notes. Distinguish quotation, synthesis and inference. State when only abstracts are available, a comparison lacks evidence, or the saved inclusion reason is heuristic. Do not promise sophisticated proximity reasoning before the core algorithm has generated those assessments.

Show queued, generating, complete, insufficient-evidence and local-model-unavailable states. Allow cancellation and retry without losing the question or duplicating the turn. If Ollama is unavailable, show setup guidance and an explicitly labeled option to retrieve source excerpts. Never silently send the request to cloud or present an extractive fallback as a completed model answer.

## Retrieval and conversation context

1. Resolve the conversation's collection server-side. Missing client scope must inherit that collection, not widen to the whole library. Validate selected works and notes against the conversation scope; reject mismatches.
2. Search stored abstracts, available PDF passages, annotations and selected notes locally. Use local embeddings when available, with a labeled lexical fallback. Do not perform online discovery merely to answer a collection question.
3. Retrieve saved inclusion reasons and versioned assessments when relevant. Preserve their evidence depth and uncertainty; only query reasoning actually stored in VANI.
4. Assemble bounded context from the question, relevant recent turns, a concise local history summary and original source passages. Earlier generated answers supply conversational context, not independent scientific evidence. Revalidate their cited sources when reused.
5. Generate through LM-R01's `collection_conversation` task profile, validate output and citations, then persist the answer, scope/evidence snapshot and provenance.

Start with the deployment plan's 16K context profile and bounded answer budget. Summarize long histories locally while retaining original turns in storage. Retrieve evidence again when focus changes instead of arbitrarily truncating sources. Scope or paper-version changes invalidate dependent cached answers; reuse requires equivalent questions, context, evidence, settings and scope.

## Routing and persistence

**Collection conversations are local-only at the task level**, even if installation-wide cloud escalation is enabled for other jobs. LM-R01 enforces the strictest installation, collection and task policy. Users need neither remove cloud credentials nor remember a per-message switch.

Reuse the configured local reader; no separate chat model is required. Embeddings and reranking also stay local. Validate endpoint and model identity so a hosted model behind a local proxy is not labeled local. Missing models, timeouts, malformed output and unsupported evidence produce bounded local retry or explicit unresolved outcomes, never cloud fallback.

Reuse conversation/answer records where practical. Persist context version, scope snapshot, evidence references, model/digest, settings, routing reason, usage, completion state and request idempotency key. Store validated claims and concise justification; raw model deliberation is not the durable evidence record.

Migrate `/api/v1/conversations/:id/messages` to the shared pipeline. Grounded knowledge-question requests retain their existing local-only guarantee. Leave no legacy direct-cloud conversation path. Historical messages and citations remain readable without regeneration or contacting their original provider.

## Acceptance criteria

| Scenario                                              | Required behavior                                                                               |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Healthy local model with cloud credentials configured | Local generation and zero cloud inference requests.                                             |
| Global cloud escalation enabled for research jobs     | Collection conversations still stay local-only.                                                 |
| Follow-up referring to a prior paper/comparison       | Correct context resolution, or clarification when ambiguous.                                    |
| Missing client scope or foreign work IDs              | Inherit the conversation's collection or reject mismatch; no accidental library-wide retrieval. |
| Private notes or uploaded manuscript                  | Local processing throughout retrieval, history summarization, retries and generation.           |
| Unsupported claim or citation                         | Reject or qualify it; never invent a source, page, inclusion reason or assessment.              |
| Local service failure or cancellation                 | No cloud fallback or duplicate answer; preserve the question and expose recovery.               |
| Long history, changed scope or updated PDF            | Bounded context, cache invalidation and refreshed evidence validation.                          |
| Upgrade from cloud-backed conversations               | Original history/provenance preserved; subsequent turns use the local pipeline.                 |

## Delivery and verification

Implement after LM-R01's local execution and policy enforcement. Deliver shared retrieval/context assembly, migration of both question paths, UI states, durable provenance and setup diagnostics. The initial version uses today's stored evidence; richer questions over proximity dossiers become available when the core algorithm supplies them.

Use API/integration fixtures for scope, history, citations, cancellation, failure and idempotence. Provider spies must observe zero cloud calls even when global escalation is enabled. Browser tests cover a collection question, follow-up, source navigation and unavailable-model recovery. Validate a real Ollama conversation and memory use on the target workstation, then run relevant repository checks before committing and pushing implementation.
