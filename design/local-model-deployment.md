# VANI local model deployment plan

Date: September 13, 2026. Target confirmed by the owner: **Linux desktop, 64 GB system RAM, one RTX 5090**. Status: proposed deployment and implementation plan; models have not been installed or benchmarked on that desktop. This document complements the [core algorithm](core-algorithm.md), whose tiered proximity pipeline also remains a proposal.

## 1. Recommendation

Run **Qwen3.8-27B, Q4_K_M, through local Ollama** as VANI's main reading and comparison model. Use the explicit tag `qwen3.8:27b-q4_K_M`. Ollama currently lists an approximately **18 GB** package, with text/image support and Apache 2.0 licensing. The ordinary desktop RTX 5090 has **32 GB GDDR7**, making this a plausible fully GPU-resident configuration with a bounded context window. Package size is not peak inference memory. [Ollama package](https://ollama.com/library/qwen3.8:27b-q4_K_M), [NVIDIA specifications](https://www.nvidia.com/en-us/geforce/graphics-cards/50-series/rtx-5090/).

This is my best starting choice for VANI's mix of scientific reading, structured extraction, occasional figure inspection and selective comparison. Qwen's model card reports improvements over Qwen3.6-27B in scientific reasoning, instruction following and document understanding, and supports switching thinking on and off. Those are vendor evaluations, not evidence that the quantized model has already passed VANI's tasks. The recommendation must pass the evaluation in section 9 before becoming the production default. [Qwen model card](https://huggingface.co/Qwen/Qwen3.8-27B).

Use three complementary local components:

| Component          | Selection                  | Role and deployment                                                                                                                                                                                                          |
| ------------------ | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main reader        | `qwen3.8:27b-q4_K_M`       | Brief extraction, contribution summaries, evidence comparison, collection Q&A; one loaded general model initially.                                                                                                           |
| Passage embeddings | `qwen3-embedding:0.6b`     | Local semantic search through the existing Ollama embedding integration. Ollama lists a 639 MB Q8_0 package. [Package](https://ollama.com/library/qwen3-embedding:0.6b).                                                     |
| Reranker           | `Qwen/Qwen3-Reranker-0.6B` | Reorder a bounded candidate/passage shortlist before expensive reading. Add a local Python worker using the publisher's scoring implementation. [Model and implementation](https://huggingface.co/Qwen/Qwen3-Reranker-0.6B). |

The reranker produces relevance scores; it is neither a chat model nor an embedding endpoint. Its scores are not calibrated probabilities of intellectual proximity. Use a research-specific query/instruction, and preserve distinct task, method and evidence comparisons downstream. Add it after the initial Ollama deployment works.

For the paper-level scientific retrieval channel in the core algorithm, benchmark **SPECTER2's retrieval adapter** alongside the general passage embeddings. It is a separate title/abstract representation, not a replacement for passage search. Keep its vectors in a separate index and combine rankings. Follow the official adapter-loading recipe rather than loading only the base model. [SPECTER2 repository](https://github.com/allenai/SPECTER2).

### Alternatives and why they are secondary

| Alternative     | Verified local package             | Decision                                                                                                                                                                                                                                                                                                                                        |
| --------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Qwen3.6-35B-A3B | `qwen3.6:35b`, Q4_K_M, about 23 GB | Throughput challenger: sparse activation may improve speed, but the whole weight set still needs storage/residency. Less memory headroom than the selected 18 GB package. Benchmark if refresh latency is the bottleneck. [Package](https://ollama.com/library/qwen3.6:35b), [model architecture](https://huggingface.co/Qwen/Qwen3.6-35B-A3B). |
| Gemma 4 31B     | `gemma4:31b`, Q4_K_M, about 20 GB  | Credible alternative reader and useful independent evaluation challenger. Switch if it makes fewer substantive errors on the owner's papers. [Package](https://ollama.com/library/gemma4:31b).                                                                                                                                                  |
| Qwen3.5 9B      | `qwen3.5:9b`, Q4_K_M, about 6.6 GB | Easy-to-run fallback and optional future high-volume triage model. Use if the GPU is shared or the 27B latency is unacceptable. Do not assume equal reliability for close methodological comparisons. [Package](https://ollama.com/library/qwen3.5:9b).                                                                                         |

Start with the main reader and embedding model. Installing several readers at once adds evaluation and scheduling work without demonstrating a benefit. A 70B model at nominal four bits needs roughly 35 GB for weights alone, before overhead; system-RAM offload would sacrifice the simple GPU-resident deployment. Fine-tuning is also unnecessary initially: improve retrieval, evidence packets and evaluation first.

## 2. Map the algorithm to local computation

The largest saving comes from avoiding unnecessary model work. Keep **analysis depth**, **proximity** and **evidence confidence** separate. A D3 job does not automatically justify a cloud request.

| Stage                    | Work performed                                                                                                                        | Local execution                                                           | Cloud policy                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Acquisition              | Scholarly API search, identifiers, deduplication, available PDF download, local archival                                              | Existing connectors, CPU and disk                                         | No LLM calls. Internet retrieval remains necessary and may have separate provider limits.       |
| D0: broad retrieval      | Lexical search, paper/passages embeddings, citation neighbors, coupling, co-citation, personalized PageRank, weak author/group priors | CPU graph algorithms and small embedding models                           | Never cloud. Graph diffusion needs no generative model.                                         |
| D1: brief assessment     | Extract problem, method, primary contribution and apparent overlap from metadata/abstracts; retain uncertainty                        | Qwen3.8 with thinking disabled; compact structured output                 | Never cloud. Uncertain promising work advances to targeted reading.                             |
| D2: targeted evidence    | Read relevant methods, citation contexts, baseline tables and result passages; identify shared and different aspects                  | Small reranker, then Qwen3.8; thinking only when comparison requires it   | Local by default; exceptional consequential ambiguity may qualify under section 5.              |
| D3: closest-work dossier | Compare assumptions, contributions, experiments, limitations and contradictions against focal work                                    | Qwen3.8 with bounded thinking and several evidence-specific calls         | Eligible only after local analysis leaves a specific important question unresolved.             |
| Collection Q&A           | Retrieve saved assessments and original passages; answer with source links                                                            | Local retrieval and Qwen3.8; direct database answers for simple questions | Same gate as D3 for unresolved synthesis; ordinary lookup stays local.                          |
| Refresh and feedback     | Fetch changes, update affected graph scores, apply keyword/seed feedback, invalidate dependent assessments                            | CPU and cached artifacts; model only for changed evidence or decisions    | No cloud for unchanged work. Manual refresh uses the same spending limits as scheduled refresh. |

Download available PDFs for every accepted paper, independently of analysis depth. Record acquisition failure or access limitations. Build a short primary-contribution summary locally, explicitly marked as abstract-based or full-text-supported. Merely finding a keyword match does not require downloading and deeply reading every candidate.

Parse machine-readable PDF text locally first. Run local OCR only on pages that need it. Use the reader's vision capability on selected figures/tables or failed extraction regions, preserving page/crop coordinates. Do not send every PDF page through a vision model. Unsupported equations and ambiguous numerical comparisons remain unknown until verified.

Example: two papers share a benchmark and author. D0 retrieves the candidate; D1 finds a possible method overlap; D2 reads the actual method and baseline table. If the shared benchmark is the only substantive connection, save that explanation and stop. If the candidate changes the same mechanism under the same assumptions, promote it to D3. Cloud becomes relevant only if a material question such as equivalence of the two objectives remains unresolved after the relevant passages have been read locally.

## 3. Fit the workload to the 5090

Begin with **16,384 context tokens, one inference request at a time, and one model resident at a time**. Batch embeddings before reading so models switch between phases rather than for every paper. Give interactive requests priority between background jobs. If measurement shows adequate headroom, allow the small embedding model to remain resident alongside the reader; keep the separate reranker under the same GPU admission controller.

The 18 GB model package is approximately 16.8 GiB on disk. Additional allocations include inference buffers, attention/recurrent state, context, vision processing and display use. Proposed operational gate: peak total GPU allocation below **28 GiB**, with no CPU layer offload during representative jobs. This is a headroom target, not a measured usage estimate. The confirmed 64 GB system RAM supports the database, parser workers and model loading, but cannot substitute for VRAM without a speed tradeoff.

Do not start with the model's advertised 256K context capacity. Raise selected jobs to 32K only after measuring fit and quality. Q8 and BF16 packages are listed around 30 GB and 56 GB respectively; Q4_K_M gives substantially more usable room for evidence. Use the explicit non-MTP Q4 tag for the initial baseline and pin its resolved digest; evaluate speculative decoding or alternative quantization later. [Available quantizations](https://ollama.com/library/qwen3.8/tags).

Initial **VANI design budgets**, including all prompt and evidence tokens:

| Job                    | Maximum input tokens per call | Maximum generated tokens per call | Execution                                                       |
| ---------------------- | ----------------------------: | --------------------------------: | --------------------------------------------------------------- |
| D1 extraction          |                         3,000 |                               768 | Thinking off; normally one call per new paper.                  |
| D2 comparison          |                         8,000 |                             2,048 | Thinking off for extraction, on for difficult comparisons.      |
| D3 evidence comparison |                        10,000 |                             4,096 | Thinking on; at most four bounded calls per dossier initially.  |
| Collection answer      |                         8,000 |                             2,048 | Retrieve a compact evidence set and a short conversation state. |

Generated-token budgets must account for thinking as well as the answer. Confirm the installed runtime's accounting. If the model exhausts its budget before completing valid output, record an incomplete result and reduce/decompose the task. Never silently truncate sources or label truncated output complete. D3 can cover a long paper through section extraction and evidence retrieval without fitting the entire PDF in one prompt.

Allow one bounded corrective retry for malformed output or a recoverable extraction issue. Suggested initial queued-job deadlines are two minutes for D1, five minutes for D2 and ten minutes per D3 call, including cold-load allowance. These are ceilings to tune, not speed predictions. Cancellation must stop local generation, and jobs must resume safely after restart.

Ollama exposes context and concurrency controls; parallel requests multiply memory requirements. Verify GPU residency with `ollama ps` and measure device memory with `nvidia-smi`. [Context documentation](https://docs.ollama.com/context-length), [runtime configuration](https://docs.ollama.com/faq).

## 4. Make local output reliable enough to avoid escalation

Each task receives an explicit schema and a compact evidence packet: focal contribution, candidate aspects, relevant source passages, and the precise question. Return contribution, overlap, differences, relation type, unknowns, source identifiers and concise decision justification. The model does not assign the final proximity label from an unexplained number.

Use Ollama's JSON-schema `format` support and validate again with Zod. Schema validity establishes shape, not scientific correctness. Validate cited IDs against the supplied packet, verify quotes/locations, check numerical units and experimental conditions where possible, and distinguish author claims from VANI inferences. [Structured outputs](https://docs.ollama.com/capabilities/structured-outputs).

Explicitly set `think: false` for brief extraction. Use supported thinking controls only for comparison jobs; test capability detection against the pinned runtime rather than assuming the model card's API-specific `reasoning_effort` field is accepted by Ollama's native endpoint. Parse the final content separately from any thinking field. [Thinking API](https://docs.ollama.com/capabilities/thinking).

Evaluate Qwen's recommended sampling settings against lower-temperature structured extraction; do not blindly apply VANI's present temperature of 0.1 to every task. Select settings based on unsupported claims, usable output and total retry cost. Keep prompts stateless except for deliberately retrieved evidence; do not replay a growing history of model deliberation.

Persist the **concise evidence-backed rationale**, alternatives, uncertainties and decision inputs. Raw model scratchpads are not the collection's evidence or durable reasoning record. A second local check is useful for critical claims, but agreement with the same model is not independent confirmation. Neither a local nor a cloud model may declare an unsupported claim verified just because another generated answer agrees.

## 5. Cloud escalation: a narrow, explicit gate

Default mode is **cloud off**. Add two other settings: **ask before escalation**, and **automatic within a configured budget**. An existing API key is a credential, not a routing decision. The owner can remain in cloud-off mode indefinitely with unresolved questions clearly visible.

Permit an automatic cloud request only when all of the following hold:

1. The unresolved issue could materially change a closest-work assessment or a user-requested comparative answer.
2. Relevant evidence is actually available and the task is within the provider's demonstrated capability.
3. Local analysis and, where justified, one bounded retry or better local retrieval have left a specific ambiguity. Evidence conflicts, failed entailment checks, or repeated errors on an evaluated task class qualify; an uncalibrated self-reported confidence score does not.
4. The exact outbound packet is eligible under collection and document privacy settings, including its question and focal-work description. Private notes, unpublished manuscripts and private derivatives require explicit authorization. Public citations do not make a private research question public.
5. A durable reservation fits the request, collection and installation budgets. The chosen cloud model has shown a useful improvement on this task class in VANI's evaluation.

Send the focal question and the smallest sufficient source packet, usually passages from two to four papers. Ask the cloud model to resolve the particular issue, not to rediscover the collection or re-summarize every paper. Validate and store its response through the same evidence checks as local output. Preserve disagreements and unresolved status.

Do **not** escalate solely because a PDF is missing, a keyword matches, the local service is unavailable, the GPU is busy, a timeout occurs, or a response fails its first schema check. Those conditions call for retrieval, queueing, repair or an explicit unavailable result. Runtime failure must never cause surprise spending.

Proposed initial automatic ceiling, after evaluation: **two cloud judgments per collection per day**, at most **12,000 input and 4,000 generated tokens each**, plus **six judgments installation-wide per day** and a user-set monthly token or monetary cap. Leave automatic mode disabled until the owner chooses its budget. All manual and scheduled refreshes share the same ledger; repeated clicks do not reset limits.

Reserve worst-case allowance transactionally before dispatch, count reasoning tokens according to provider billing, then reconcile actual usage. Record failures and uncertain outcomes; do not automatically re-send a possibly completed paid request. An exhausted budget leaves an item awaiting review and allows other local work to continue. If monetary caps are enabled, version the provider price table used for admission; no dollar-saving claim is made here.

## 6. Spend once and retain the useful work

Store model-independent artifacts globally within the user's installation: canonical paper/version identity, PDF hash, parsed sections, citation contexts and source passages. Cache model outputs using model digest, quantization, prompt/schema versions, generation settings, task type and exact evidence hashes. Store collection assessments separately with focus/seed/exclusion versions.

This separation allows a contribution extraction to serve several collections while each collection retains its own proximity judgment. Changing a keyword should update retrieval and dependent decisions; it should not reparse the PDF or regenerate every contribution summary. A new paper version invalidates only assessments dependent on changed evidence. A new embedding model requires a separate vector namespace and controlled reindexing; never compare incompatible vectors or reuse a mutable model tag as the only cache identity.

Persist the following for querying and audit:

| Record            | Required information                                                                                                                                             |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Evidence artifact | Work/version, file hash, section/page/table/paragraph locator, extracted text and extraction version.                                                            |
| Assessment        | Collection focus version, candidate/focal works, analysis depth, aspect comparisons, relation type, proximity, unknowns and supporting evidence.                 |
| Model run         | Task and input hash, provider/model/digest/quantization, prompt/schema/settings, duration, token counts, retries, validation outcome and resulting artifact IDs. |
| Routing decision  | Local/cloud selection, concrete reason, privacy eligibility, budget reservation and actual use.                                                                  |
| Human feedback    | Accepted/rejected connection, corrected aspect, excluded keyword, timestamp and affected assessment versions.                                                    |

Answer “Why was this included?”, “What changed after I removed that keyword?” and “Which closest papers remain uncertain?” from these records locally. Materialized summaries accelerate retrieval but must link to original evidence; repeated model summaries are not independent corroboration.

Retain the core algorithm's illustrative refresh caps of 2,000 D0 candidates, 200 D1 assessments, 40 D2 readings and 10 D3 dossiers. These are maxima, not a requirement to fill every tier. A refresh with no changes should make **zero generative calls**, local or cloud. Brief summaries required for newly accepted papers count toward the local work budget; excess jobs queue rather than disappear.

## 7. What the current repository supports, and what must change

| Code or configuration                                                                       | Current behavior                                                                                                                                                                                     | Required work                                                                                                                                                  |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [first-pass.ts](../apps/api/src/first-pass.ts), `synthesize`                                | Public evidence uses cloud whenever `OPENAI_API_KEY` is set; private evidence routes to Ollama. Local output uses JSON mode, no explicit thinking/context/output limit, usually a 60-second timeout. | Introduce one task-aware router, structured schemas, budgets, capability checks, token accounting and queued local execution.                                  |
| [ask.ts](../apps/api/src/ask.ts)                                                            | A separate key-driven cloud path; without a key it returns an extractive abstract summary rather than invoking Ollama.                                                                               | Route this path through the same local provider and privacy/budget enforcement. Existing local synthesis in planning must also use the central interface.      |
| [research/search.ts](../apps/api/src/research/search.ts)                                    | Optional local embeddings through `/api/embed`, enabled by `VANI_EMBED_MODEL`; content/model-name cache.                                                                                             | Configure the embedding model, add immutable revision/settings keys and controlled reindexing, then add scientific vectors and reranking.                      |
| [ingestion/enrichment.ts](../apps/api/src/ingestion/enrichment.ts) and collection discovery | Existing PDF and summary jobs, without the proposed D0–D3 routing system.                                                                                                                            | Separate acquisition from reading depth; add shared GPU scheduling and incremental assessment dependencies.                                                    |
| [config.ts](../apps/api/src/config.ts), [.env.example](../.env.example)                     | Existing Ollama URL/model configuration; default reader `qwen3:8b`.                                                                                                                                  | Document effective settings and add validated policy configuration during implementation. Native API scripts do not currently load the root `.env` themselves. |
| [docker-compose.yml](../docker-compose.yml)                                                 | Container API points toward host Ollama and does not forward `VANI_EMBED_MODEL`.                                                                                                                     | Add an explicit deployment profile and embedding configuration. For an all-container deployment, put GPU Ollama on a private Compose network.                  |

Until the router is implemented, **keep `OPENAI_API_KEY` empty in the VANI process** to prevent the existing synthesis and chat code from spending cloud tokens. This enables local synthesis where it already exists; it does not implement local generative chat, the new proximity algorithm or the proposed escalation policy.

Suggested future settings include `VANI_MODEL_POLICY=local_only|local_first`, `VANI_CLOUD_MODE=off|ask|budgeted`, stage budgets and global/collection spending limits. These names are **proposed, not accepted configuration today**. Test that setting a key while cloud mode is off cannot cause a request from any API path or background job.

### 7.1 Required implementation workstream: LM-R01 — Shared local-first model router

**Status: planned; required for the local-model feature.** Implement the router before enabling cloud credentials in the new local-first deployment. This is an application change, not an installer setting. Its first deliverable replaces key-driven routing in both synthesis and legacy chat; advanced D0–D3 scheduling can build on it later.

The router is the sole application entry point for generative inference. Callers describe the task and evidence; they cannot select a cloud endpoint or bypass policy with a provider flag. Keep provider HTTP clients behind the router. Embedding and reranking adapters remain explicitly local and share resource scheduling without acquiring implicit cloud fallbacks.

**Request contract:** task ID/type, optional analysis depth, collection/focal-work IDs, versioned evidence references, prompt/schema versions, output schema, token/deadline limits, cancellation signal and idempotency key. The router resolves authoritative privacy classifications and current collection policy itself. Unknown classification is ineligible for cloud; a caller-supplied `privateEvidence=false` must not override stored source restrictions. Tasks without a collection still receive installation-level policy and budget enforcement.

**Result contract:** validated output or a typed unresolved state, model/provider provenance, evidence references, usage, attempt IDs and a concise routing reason. Distinguish `complete`, `queued_local`, `insufficient_evidence`, `awaiting_cloud_approval`, `budget_exhausted`, `local_unavailable` and `validation_failed`. An extractive fallback must identify itself and retain its limitations; it is not a successful deep comparison.

#### Routing rules

| Situation                                                          | Required decision                                                                                                                                               |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default configuration                                              | `local_first` with cloud mode `off`; use the configured local model even when a cloud key exists.                                                               |
| Explicit `local_only` policy                                       | Never dispatch cloud requests. Reject a conflicting non-off cloud mode during configuration validation.                                                         |
| Valid compatible cached result                                     | Reuse it with original provenance; make no provider request. Recheck evidence scope and policy compatibility before reuse.                                      |
| New synthesis or chat request                                      | Check available evidence, choose the local task profile, queue within GPU limits, execute and validate locally.                                                 |
| Local result passes validation                                     | Return and persist it; no automatic cloud second opinion.                                                                                                       |
| Local evidence comparison remains materially unresolved            | Apply every escalation gate in section 5, including task eligibility, privacy, local attempt history and available budget. D1 remains local-only.               |
| Eligible escalation in `ask` mode                                  | Save a preview of the exact outbound packet, question and token ceiling. Wait for explicit approval of that packet; a changed packet requires renewed approval. |
| Eligible escalation in `budgeted` mode                             | Reserve budget transactionally, recheck effective policy immediately before dispatch, then invoke the approved cloud adapter.                                   |
| Timeout, overload, missing model, cancellation or malformed output | Queue, perform a bounded local repair, or return the appropriate unresolved state. Infrastructure errors never authorize cloud use.                             |
| Missing/invalid policy or missing cloud credential                 | Fail closed for cloud. Report the configuration problem without changing the effective provider implicitly.                                                     |

Keep routing deterministic and inspectable; do not spend another model call deciding which model to use. Store the decision and local validation outcome independently of generated deliberation. Approval and budget checks apply again after a queued job resumes, so a policy change or revoked approval prevents an undispatched cloud request. Preserve reservations for uncertain paid outcomes until reconciled rather than retrying blindly.

#### Code migration and deliverables

1. Add a shared router, task-profile registry and local/cloud provider adapters under the API, with validated configuration and the contracts above. Local model health checks include endpoint locality and model identity; a hosted Ollama model must not be labeled local merely because its proxy URL is loopback.
2. Replace direct provider selection in `first-pass.ts` and direct cloud calls in `ask.ts`. Update collection focus synthesis in `collection-discovery.ts`, contribution summaries in `ingestion/enrichment.ts`, and reports in `planning/insights.ts` to provide explicit task/evidence metadata. Audit all provider request sites so interactive and background work follow the same policy.
3. Add durable model-run/routing records, cache integration and typed failure handling. Surface effective provider, concise reason and unresolved state in responses and collection history. Do not log credentials or unrestricted source payloads.
4. Add explicit cloud approval and budgeted dispatch using section 5's limits. Keep both disabled until their persistence, privacy and budget tests pass. Provide a settings control that can disable future cloud dispatch immediately without removing stored credentials.
5. Update environment examples, Compose forwarding, native configuration loading and the F43 diagnostics contract. Existing installations with a key must migrate to local-first/cloud-off defaults; absent Ollama produces an actionable local-unavailable result rather than preserving cloud-first behavior.

#### Router acceptance gates

- With local inference healthy and a cloud key configured, synthesis, legacy chat, contribution summaries and background collection jobs all select local inference.
- With cloud disabled or `local_only`, provider spies observe zero cloud calls across success, timeout, unavailable model, invalid JSON, retry and restart cases.
- Local chat invokes Ollama rather than falling directly to the current abstract-only extractive path; unsupported answers still return explicit evidence limitations.
- Unknown/private evidence and private derivatives cannot leave through any caller, including a packet combining public papers with a private focal question.
- An eligible approved/budgeted escalation sends exactly the permitted evidence packet once; changed evidence, revoked policy, budget races and uncertain paid outcomes prevent unintended dispatch or duplicate spending.
- Every accepted result passes schema and evidence checks; each attempt exposes a durable provider choice and routing reason. A cloud response receives the same validation as a local response.
- Tests enforce that provider HTTP clients are invoked only through the router, including future request paths. No-key and existing-key upgrades both produce the documented local-first behavior.

This workstream is complete only after the migrated paths and enforcement tests pass. Documentation or installer environment variables alone do not satisfy LM-R01.

## 8. Deployment on the school desktop

Use native Linux Ollama and native VANI Node processes initially, with PostgreSQL in Docker. This matches the API's existing loopback integration and avoids container-to-host inference networking. For long-running use, supervise the built API and web server with restart policies and run the queue after boot. Expose the UI through an authenticated connection if remote access is needed; keep the inference endpoint local.

Install a current NVIDIA driver and current stable Ollama with support for this GPU/model, using the [official Linux installation guide](https://docs.ollama.com/linux). Record the driver, Ollama version and model digests after the acceptance run, and pin them for reproducibility. The setup below is to run on the school desktop, not evidence of an installation performed by this document.

Inspect the machine and download the two initial models:

```bash
nvidia-smi
ollama --version
ollama pull qwen3.8:27b-q4_K_M
ollama pull qwen3-embedding:0.6b
ollama show qwen3.8:27b-q4_K_M
```

For a systemd-managed Ollama installation, add these settings using `sudo systemctl edit ollama`, then reload systemd and restart that service:

```ini
[Service]
Environment="OLLAMA_HOST=127.0.0.1:11434"
Environment="OLLAMA_NO_CLOUD=1"
Environment="OLLAMA_CONTEXT_LENGTH=16384"
Environment="OLLAMA_NUM_PARALLEL=1"
Environment="OLLAMA_MAX_LOADED_MODELS=1"
```

These are Ollama service settings, not VANI settings. `OLLAMA_NO_CLOUD` disables Ollama's hosted features; it does not disable VANI's separate cloud client. [Ollama configuration](https://docs.ollama.com/faq).

For an initial native VANI development session, export the following in the shell that launches VANI. The exports avoid relying on automatic `.env` loading that the current Node scripts do not provide:

```bash
export OPENAI_API_KEY=''
export OLLAMA_BASE_URL='http://127.0.0.1:11434'
export OLLAMA_MODEL='qwen3.8:27b-q4_K_M'
export VANI_EMBED_MODEL='qwen3-embedding:0.6b'
export VANI_DEMO_MODE='false'
```

Then follow the repository's [local development instructions](../README.md#local-development), keeping any existing database/data-directory configuration. A service deployment should provide the same variables in its service environment. Do not commit credentials. Reserve approximately 100 GB of free SSD space initially for models, temporary files and growth; size the PDF archive and backups separately. This is a planning allowance, not a model requirement.

Smoke-test local inference independently before connecting VANI:

```bash
curl --fail http://127.0.0.1:11434/api/chat \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "qwen3.8:27b-q4_K_M",
    "stream": false,
    "think": false,
    "format": {
      "type": "object",
      "properties": {"contribution": {"type": "string"}},
      "required": ["contribution"],
      "additionalProperties": false
    },
    "messages": [{
      "role": "user",
      "content": "Return JSON with a contribution field using only this fictional abstract: We introduce a citation-context index that retrieves methodological predecessors using labeled citation passages."
    }],
    "options": {"num_ctx": 16384, "num_predict": 256}
  }'
ollama ps
```

Verify valid final JSON, GPU residency and no cloud traffic. Repeat with an actual abstract, a selected table image and a bounded thinking-enabled comparison. A successful tiny smoke test is not sufficient evidence of long-context fit. Test the table/image request separately because the current VANI synthesis wrapper does not yet supply images.

The current Compose API's `host.docker.internal` gateway does not make a host service bound only to `127.0.0.1` reachable on Linux. For a later all-container profile, run Ollama with GPU access on the internal service network, set the API URL to that service, forward the embedding variable and avoid publishing port 11434. Keep this topology change separate from the native setup above.

## 9. Evaluation and implementation order

Use the owner's papers to decide whether the recommendation is good enough. Build a small initial evaluation with around 50 papers and 100 labeled focal/candidate pairs across two or three collections, including direct predecessors, same-keyword distractors, same-author unrelated work, uncited recent work and contradictory findings. Split calibration and held-out evaluation by collection/focal topic where possible. Record the small sample's uncertainty rather than treating it as universal validation.

Compare the chosen Q4 model with the 9B fallback and one alternative reader on identical source packets. If cloud use for evaluation is authorized, compare a bounded sample using identical evidence; the researcher adjudicates errors rather than treating cloud answers as ground truth. Evaluate quantized models and the actual chosen prompts/settings, not published full-precision scores.

Initial proposed acceptance targets:

| Measure    | Gate or target                                                                                                                                                                                                    |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hardware   | Representative 16K text and selected-page vision workloads stay fully on GPU; peak total use below 28 GiB; no system swap pressure.                                                                               |
| Extraction | At least 98% schema-valid final results after at most one repair; measure failures separately.                                                                                                                    |
| Grounding  | Every accepted claim has a resolvable evidence locator; at least 95% of audited factual claims are supported. High-impact unsupported comparative claims block automatic admission until corrected.               |
| Retrieval  | At least 90% recall of labeled closest works in the D2 candidate set; include recall by paper age and citation coverage.                                                                                          |
| Summaries  | At least 90% of sampled contribution summaries judged accurate and useful by the researcher; unsupported novelty/superiority claims count as errors.                                                              |
| Efficiency | Zero cloud requests in cloud-off mode; zero model calls on an unchanged refresh. Aim for at least 95% of synthesis calls local after enabling escalation, while separately measuring cloud tokens and error rate. |
| Escalation | Record whether each cloud call resolved the named uncertainty correctly and changed a useful decision; disable automatic escalation for task classes with no observed gain.                                       |
| Operations | Record cold/warm latency, time to completed D1/D2/D3 jobs, tokens/second, peak memory, queue age and model-switch time. Confirm scheduled jobs finish before the next daily run without blocking interaction.     |

The call-share target excludes embeddings and reranking so cheap local operations cannot inflate it. It is a goal, not a promise of 95% token savings. For two capped cloud judgments, maximum daily allowance per collection would be 24,000 input plus 8,000 generated cloud tokens; most days may need none. Measure actual savings against the same workloads and evidence under a cloud-only synthesis baseline, including retries and cache hits.

Implement in this order:

1. **Local runtime and enforceable policy (LM-R01).** Implement the shared router specified in section 7.1, migrate synthesis and legacy chat, and add output/context limits and diagnostics. First ship its local-first/cloud-off behavior with enforcement tests; add its approval/budgeted dispatch in step 4. Deliver a deployment that cannot spend cloud tokens while cloud mode is off, even with a key configured.
2. **Incremental retrieval and reading.** Implement the relevant core-algorithm D0/D1 components, paper/passage representations, artifact caches and dependency invalidation. Add the reranker and single-GPU scheduler; stop rerunning unchanged papers.
3. **Selective depth and queryable evidence.** Add D2/D3 evidence packets, contribution/relationship schemas, local validation and durable collection assessments. Enable local questions over those records.
4. **Controlled escalation.** Add packet inspection, privacy checks, durable token/budget reservations, explicit routing reasons and cloud-off/ask/budgeted UI modes. Keep automatic mode off until evaluation and budget configuration are complete.
5. **Tune against the evaluation.** Adjust contexts, local models, queue settings and promotion thresholds. Consider a smaller D1 model or more advanced inference server only when measured throughput justifies the complexity.

Before each implementation merge, run the relevant repository checks and focused tests for routing bypasses, private derivatives, budget races, uncertain paid retries, schema/evidence failures, cache invalidation, job restart/cancellation and repeated manual refresh. Hardware acceptance must run on the school desktop. This planning change itself requires documentation checks only; it does not establish runtime correctness or 5090 performance.
