# VANI core algorithm

## Decision

VANI should build a collection around a research question and its closest intellectual neighbors. Replace keyword-based admission with a sequence of broad retrieval, inexpensive comparison, targeted evidence reading, and selective deep analysis. Store the evidence and decisions at every stage so that the collection becomes a queryable account of how its ideas relate.

The recommended foundation is **collection-personalized graph diffusion combined with scientific text representations, aspect-level comparison, and citation-context evidence**. PageRank contributes network proximity; it does not decide conceptual closeness by itself. An LLM helps extract and compare evidence after cheaper methods narrow the candidates. It must not independently invent the network or assign an unexplained relevance score.

Keep five quantities distinct: **proximity to the current work, relationship type, evidence confidence, research influence, and analysis depth**. A famous background paper can have high influence and low proximity. An uncited preprint can have high proximity and incomplete evidence. A contradictory result can be among the closest works.

Status: proposed research-backed design, not an implemented replacement. Literature coverage extends through September 13, 2026. All weights, budgets, thresholds, priorities and acceptance targets below are VANI design proposals to validate, not constants established by the cited literature.

The companion [local model deployment plan](local-model-deployment.md) maps these stages to a Linux workstation with an RTX 5090 and 64 GB RAM, recommends local models, and specifies when cloud escalation is justified.

## 1. What must change in VANI

The present implementation has useful infrastructure but an inadequate decision rule:

| Current component                                                                    | Observed behavior                                                                                                             | Required change                                                                                             |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [collection-focus.ts](../apps/api/src/collection-focus.ts), `keywordMatch`           | Measures the fraction of collection keywords occurring in a title or abstract.                                                | Retain lexical matching for candidate retrieval and explanations; remove it as the admission criterion.     |
| [deep-refresh.ts](../apps/api/src/deep-refresh.ts)                                   | Searches multiple queries and seed neighborhoods, then admits candidates at a keyword score of at least 0.35.                 | Route all discoveries into a candidate pool and evaluate proximity before collection admission.             |
| [collection-discovery.ts](../apps/api/src/collection-discovery.ts), `rankRelated`    | Orders other papers by title-derived term overlap and takes eight.                                                            | Produce relation-specific rankings against explicit focal works and project facets.                         |
| The same file, `reviewMembers`                                                       | Iterates over eligible collection members to generate first passes.                                                           | Let a budgeted scheduler decide which papers need which analysis depth.                                     |
| [ingestion/enrichment.ts](../apps/api/src/ingestion/enrichment.ts)                   | Queues PDF acquisition and contribution summarization together; summaries use abstracts and up to the first twelve PDF pages. | Separate archiving, parsing, brief contribution extraction, targeted reading and full comparative analysis. |
| Existing inclusion reasons, feedback, first passes, typed relationships and Ask VANI | Already persist portions of provenance and reasoning.                                                                         | Extend them with versioned collection assessments, evidence dependencies and historical query support.      |

The existing [deep-refresh specification](collection-deep-refresh.md) describes broader retrieval, not a validated proximity model. This design replaces its admission and analysis policies when implemented. It preserves daily/manual refresh, saved papers, local PDFs, annotations and human judgments.

## 2. What the literature contributes

### 2.1 From citation counts to collection-specific proximity

| Research line                                                                      | What it establishes or investigates                                                                                | Implication for VANI and its limits                                                                                                                                     |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bibliographic coupling, Kessler (1963)                                             | Two papers are connected through shared references.[^1]                                                            | Finds work with common intellectual inputs, including new papers without incoming citations. Normalize overlap: sharing a ubiquitous textbook is weak evidence.         |
| Co-citation, Small (1973)                                                          | Papers are connected when later papers cite them together.[^2]                                                     | Finds relationships recognized by later literature. It is unavailable or sparse for new work and does not explain why the papers were grouped.                          |
| PageRank, Page et al. (1999), and topic-sensitive PageRank, Haveliwala (2002)      | Recursive link importance can be biased toward a topic through the restart distribution.[^3][^4]                   | Use collection seeds to personalize graph exploration. Global importance is a different objective from closeness to a particular contribution.                          |
| CiteRank, Walker et al. (2007)                                                     | Models traffic through paper citations with a preference for starting at recent papers.[^5]                        | Separate current research activity from foundational influence. A recency preference must not erase older direct predecessors.                                          |
| FutureRank, Sayyadi and Getoor (2009)                                              | Combines citations, authorship and publication time to estimate future PageRank.[^6]                               | Authorship and time can inform discovery, but predicted future attention does not establish conceptual overlap. Do not import prestige into the core proximity label.   |
| Rescaled PageRank, Mariani et al. (2016); comparative evaluation, Xu et al. (2020) | Age adjustment improves identification of selected milestone works in the evaluated citation datasets.[^7][^8]     | Use normalized influence as a separate field. Milestone identification is not a test of project-specific related-work retrieval.                                        |
| Node-split personalized PageRank, Yun (2022)                                       | Separates citing and cited roles and generalizes coupling/co-citation to longer-range structural similarities.[^9] | Particularly relevant to VANI: preserve citation direction and distinguish common ancestors from common descendants. Structural agreement still needs content evidence. |

For a directed graph, let an edge from paper A to B mean that A cites B. Following this direction discovers antecedents; reversing it discovers descendants. Ordinary citation diffusion will not fairly cover both without an explicit design choice. Coupling and co-citation provide additional, distinct routes to peers.

With a row-stochastic transition matrix `P`, a normalized seed distribution `s`, and restart probability `α`, personalized PageRank satisfies:

```text
π = α s + (1 − α) Pᵀ π
π = α Σ[k=0..∞] (1 − α)^k (Pᵀ)^k s
```

Restart brings the walk back to the collection's focal works; longer paths contribute progressively less. It is a distribution over graph visits, **not a probability that a paper is relevant**. Its values depend on graph construction and coverage. A missing citation edge cannot establish intellectual distance. These mathematical mechanics follow personalized PageRank; VANI's layer choices below are proposed adaptations.[^4]

The practical conclusion is to use personalized diffusion as one retrieval/ranking channel. Do not substitute global PageRank for the current keyword threshold and call the problem solved.

### 2.2 Scientific representations and the meaning of a connection

| Research line                                              | Contribution                                                                                                                                              | Decision for VANI                                                                                                                               |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Citeomatic, Bhagavatula et al. (2018)                      | Retrieves embedding neighbors and reranks them for citation recommendation.[^10]                                                                          | Establish a cheap candidate stage and a more expensive reranker. Observed citations are useful supervision, not complete relevance labels.      |
| SPECTER (2020)                                             | Trains document representations using citation-informed supervision.[^11]                                                                                 | Scientific embeddings are a strong starting baseline for title/abstract retrieval, including papers with no known citations at inference time.  |
| SciNCL (2022)                                              | Samples positives and negatives using citation-embedding neighborhoods rather than treating all non-citations alike.[^12]                                 | Similarity is graded. Avoid training on arbitrary uncited papers as certain negatives.                                                          |
| ASPIRE (2022)                                              | Uses sentence-level representations and co-citation context to learn fine-grained aspect matching, with single-match and optimal-transport variants.[^13] | Compare the relevant part of a paper, not just its whole-document vector. A shared method in another field should remain discoverable.          |
| SPECTER2 / SciRepEval (2023)                               | Studies multiple task formats and releases representations with task-specific adapters.[^14]                                                              | Benchmark retrieval-oriented representations; one embedding need not serve paper search, classification and passage search equally well.        |
| SciCite (2019) and MultiCite (2022)                        | Model citation purposes; MultiCite emphasizes variable-length, multi-label contexts across a paper.[^15][^16]                                             | Preserve the citing paragraph, section, multiple mentions and multiple intents. A citation is not automatically endorsement or extension.       |
| Intent-aware publication relatedness, Phan and Jung (2026) | Conditions direct-citation, coupling and co-citation connections on citation intent and evaluates resulting cluster coherence.[^17]                       | Test intent-aware graph layers. Comparative intents performed especially well in that study, but its metric is not closest-prior-work accuracy. |
| SciREX (2020)                                              | Studies document-level extraction of scientific entities and multi-entity relationships.[^18]                                                             | Represent experiments as linked task, method, dataset and metric records; do not infer comparability from a dataset name alone.                 |

The 2026 intent-aware study uses hard matching between citation intents and explicitly discusses the uncertainty of assigning numerical similarities between different intents. VANI should initially retain separate intent features and compare hard matching against a soft variant in an ablation. A universal ordering such as “extends = 1.0, compares = 0.8” is not established by this literature.[^17]

### 2.3 Recent work on inspiration, explanations and reusable knowledge

**MIR (ACL 2025)** retrieves methodological inspiration for a research problem using a methodology adjacency graph, adapted dense retrieval and reranking. It supports a distinct search mode for useful methods beyond surface topic similarity. Its dataset is limited to English computational-linguistics papers, and its discussion acknowledges incomplete or imperfect citation-derived annotations. VANI should evaluate the idea in its own domains before claiming generality.[^19]

**PaperWeaver (CHI 2024)** contextualizes paper alerts against a user's collected papers through aspect summaries and pairwise descriptions. Its small user study supports the value of showing connections rather than isolated abstracts. It also generates descriptions for uncited relationships; VANI should label such comparisons as inferences and preserve supporting passages rather than presenting them as actual citations.[^20]

**HippoRAG 2 (ICML 2025)** combines passage and phrase nodes, query-based selection, and personalized PageRank for retrieval over stored knowledge. Its results motivate testing graph-assisted querying of collection evidence. Its QA and memory benchmarks do not demonstrate better scientific related-work selection, so VANI must retain a direct passage-retrieval baseline.[^21]

**GraphRAG (2024)** explores entity graphs and community summaries for corpus-wide questions. The transferable idea is a hierarchy of reusable summaries. Building such summaries across every retrieved paper would contradict VANI's cost objective; generate them only from assessed evidence and update affected communities incrementally.[^22]

**OpenScholar (Nature 2026)** couples scientific retrieval, reranking and citation-backed synthesis with a literature-synthesis benchmark. It supports treating retrieval quality and source attribution as separate measurable components. Its reported results are specific to its evaluation and do not certify an arbitrary VANI-generated comparison.[^23]

**Bright-Pro (ACL 2026)** evaluates retrieval inside agent workflows and the coverage of complementary reasoning aspects. Its evaluation is not specifically a scientific-paper proximity benchmark, but it reinforces a useful distinction: a set of papers should cover the project's reasoning needs, not simply contain many individually similar documents.[^24]

Across these lines of research, no single algorithm establishes the closest ideas for every discipline. Citation influence, citation prediction, topical coherence, methodological inspiration and evidence synthesis are different tasks. The proposed system combines their useful components and evaluates the final task directly.

## 3. Define the current work before ranking other work

Each collection needs a versioned **research focus** with the following fields:

- A plain-language research question, intended contribution and important constraints.
- Explicit focal works: the current manuscript, selected seed papers, or a project note. Focal works have weights and roles; ordinary saved papers are not automatically seeds.
- Separate facets for problem, method, assumptions, findings, evaluation and application. Allow multiple subtopics instead of forcing all seeds into one centroid.
- Positive examples, negative examples and labeled exclusions. Removing a keyword removes a lexical expansion term; it does not silently ban the corresponding concept or discard conceptually close papers.
- A search objective: closest prior work, competing approaches, foundations, methodological inspiration or recent developments. Default to closest prior work and show the other roles alongside it.
- A time boundary: literature available before a manuscript's date versus the current literature. Later work is a descendant, not prior art to an earlier contribution.

Extract this profile first from the focal material, then let the researcher correct it. If seeds disagree, show their subtopics and let the researcher choose their relative importance. A draft or unpublished seed remains local under VANI's existing privacy policy.

For a paper with several contributions, create separate contribution records. A candidate might be the closest precedent for contribution A while being irrelevant to B. Aggregate rankings should retain those distinctions and name the anchor responsible for a high score.

## 4. Feature set for measuring intellectual proximity

The following features define the proposed product and algorithm. **P0** is required for the first replacement of keyword admission; **P1** adds richer contextual evidence; **P2** is an experiment after a measured baseline. Strength is conditional on the project's objective, not a universal fixed weight.

### Research content

| ID / priority | Feature and representation                                                                                                              | Effect on decisions and required explanation                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| CA01 / P0     | **Focal-work and contribution profile.** Versioned question, anchor works, contribution facets and constraints.                         | Every assessment identifies the anchor and contribution it addresses. Adding a peripheral paper cannot silently redefine the collection. |
| CA02 / P0     | **Problem equivalence.** Compare goals, inputs, outputs, population/system and success criteria.                                        | High proximity when the underlying question is the same despite different terminology. State mismatched settings explicitly.             |
| CA03 / P0     | **Method and mechanism overlap.** Compare algorithmic components, causal mechanisms, representations and training/inference procedures. | Separate a substantive shared mechanism from generic use of a common model or tool.                                                      |
| CA04 / P0     | **Contribution overlap and difference.** Extract what changes relative to prior work.                                                   | Explain both the shared advance and the distinguishing contribution. Similar abstracts alone cannot establish lack of novelty.           |
| CA05 / P1     | **Assumption compatibility.** Record supervision, observability, distribution, compute, data and theoretical assumptions.               | Conflicting assumptions reduce direct comparability while preserving relevance as an alternative.                                        |
| CA06 / P1     | **Experimental comparability.** Structured task–dataset/version–split–metric–protocol–budget records.                                   | Compare results only within compatible settings; retain units, direction of improvement, uncertainty and table anchors.                  |
| CA07 / P1     | **Finding, limitation and failure-mode overlap.** Claim-level results and conditions.                                                   | Surface replication, disagreement, unresolved limitations and boundary cases. Contradiction can increase reading priority.               |
| CA08 / P0     | **Facet-specific scientific retrieval.** Whole-paper and aspect-level representations, alongside lexical search.                        | Retrieve a method match across domains without letting a broad field match dominate the closest-work list.[^11][^13][^14]                |

### Intellectual relationships and citation structure

| ID / priority | Feature and representation                                                                                                   | Effect on decisions and required explanation                                                                                                   |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| CA09 / P0     | **Direct citation in both directions.** Resolve citing and cited work versions.                                              | Distinguish predecessor and follower; identify the exact citation path. A bare edge is a candidate signal.                                     |
| CA10 / P0     | **Bibliographic coupling.** Degree-normalized, optionally rarity-weighted shared references.                                 | Find sibling approaches and new work. List the informative shared references, not just their count.                                            |
| CA11 / P0     | **Co-citation.** Normalized shared citing works with dates and provenance.                                                   | Recognize papers treated together by later literature; mark incomplete incoming coverage and citation lag.                                     |
| CA12 / P0     | **Collection-personalized diffusion.** Separate forward, reverse and coupling layers with seed weights.                      | Find relevant work beyond one hop; retain the contributing anchors, layer scores and representative paths.                                     |
| CA13 / P1     | **Citation intent and context.** Multi-label intent per mention, paragraph, section and confidence.                          | Separate background, use, extension, motivation and comparison. Preserve multiple roles for one paper pair.[^15][^16]                          |
| CA14 / P1     | **Explicit baseline comparisons.** Identify the baseline's originating paper, implementation and table/paragraph mention.    | Strong evidence for targeted reading when task and protocol fit. A generic software baseline does not automatically become closest prior work. |
| CA15 / P1     | **Dependency and extension lineage.** Evidence that a paper imports or modifies a specific method, theorem or dataset.       | Show what was inherited and what changed; do not infer “builds on” from citation alone.                                                        |
| CA16 / P1     | **Citation placement and local co-citation.** Section, within-paragraph/sentence grouping and repeated substantive mentions. | Differentiate a related-work list from a methods dependency. Saturate repeated mentions and group related signals to avoid double-counting.    |
| CA17 / P1     | **Intent-aware coupling and co-citation.** Compare the purposes of shared references/citances.                               | Test whether two papers use the same reference for comparable reasons. Preserve uncertain and mixed intents.[^17]                              |
| CA18 / P2     | **Methodological analogy.** Map a problem–mechanism pair across subject areas.                                               | Display as an inspiration route with an explicit transfer hypothesis, not evidence of equivalent prior work.[^19]                              |

### People, artifacts, time and evidence quality

| ID / priority | Feature and representation                                                                                                       | Effect on decisions and required explanation                                                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CA19 / P0     | **Author continuity.** Disambiguated identities, overlaps, dates and confidence.                                                 | Expand the search around relevant authors. Apply a small capped ranking contribution; never make shared authorship sufficient for a close label.                  |
| CA20 / P1     | **Research-group lineage.** Time-specific affiliations, repeated collaboration and explicit group/project links.                 | Surface a group's related sequence of contributions. Same university, surname or author order is insufficient evidence of the same group or intellectual lineage. |
| CA21 / P1     | **Shared artifacts.** Method aliases, code lineage, datasets, benchmark versions and project identifiers.                        | Stronger when an artifact is central to the contribution; weaker for ubiquitous libraries. Link each connection to its source.                                    |
| CA22 / P0     | **Age and field-aware influence.** Citation trajectory and normalized centrality where coverage supports it.                     | Show influence separately from proximity; do not impose minimum citation counts or let venue reputation decide admission.[^7][^8]                                 |
| CA23 / P0     | **Identity and version families.** DOI, arXiv versions, conference/journal extensions, corrections and retractions.              | Merge duplicate evidence, preserve substantive extensions and provenance, and prevent a preprint plus journal copy from counting as independent support.          |
| CA24 / P0     | **Coverage and uncertainty.** Missing abstracts, unresolved references, partial PDFs, parser quality and classifier uncertainty. | Unknown is different from no overlap. An inaccessible paper may remain potentially close with analysis blocked.                                                   |
| CA25 / P0     | **Independent support and counterevidence.** Group features by originating source and intellectual lineage.                      | Five derived signals from one citation do not count as five independent confirmations. Explain conflicting evidence and why a paper is not closer.                |

### Collection behavior and retained reasoning

| ID / priority | Feature and representation                                                                                                      | Effect on decisions and required explanation                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CA26 / P0     | **Candidate staging.** Discovery records exist separately from accepted collection membership.                                  | A keyword hit is inspectable without becoming a saved paper or triggering a deep read.                                                                 |
| CA27 / P0     | **Separate proximity and analysis depth.** Store each as an independent state.                                                  | A close but unreadable paper remains close/insufficient evidence; a deeply read paper does not become close merely because money was spent reading it. |
| CA28 / P0     | **Budgeted progressive reading.** Gates for metadata, abstract, passages and full comparison.                                   | Spend deep-analysis budget on the closest supported candidates; expose deferred work and actual consumption.                                           |
| CA29 / P0     | **Evidence-backed relationship cards.** Persist similarities, differences, role, anchors, score components and source passages. | Answer “why here?”, “why this tier?” and “what would change the decision?” with inspectable evidence.                                                  |
| CA30 / P0     | **Queryable collection memory.** Structured graph/SQL queries plus passage retrieval over assessment evidence.                  | Answer questions about relationships, exclusions and historical decisions; generated summaries remain linked to primary evidence.                      |
| CA31 / P0     | **Explicit feedback and drift control.** Close/background/off-topic/correction judgments with reasons.                          | Promote selected papers to anchors deliberately; keep dismissals local to the collection and do not interpret a skipped paper as negative feedback.    |
| CA32 / P1     | **Coverage and diversity.** Facet coverage, independent groups, competing mechanisms and bridge papers.                         | Diversify an eligible reading set without mislabeling distant papers as close or suppressing an actual nearest neighbor.                               |
| CA33 / P0     | **Incremental reassessment.** Dependency hashes, source versions, run manifests and invalidation.                               | Recompute only changed material; never overwrite the historical reason for admission with a new explanation.                                           |
| CA34 / P0     | **Evaluation and audit.** Frozen benchmark collections, budgets, ablations and source-grounding checks.                         | Demonstrate improvement over keyword matching before changing automatic admission.                                                                     |
| CA35 / P1 | **Periodic learning audits.** Full-pool D0/D1 audit every three days and D2/D3 audit monthly; source-backed judgments, held-out policy evaluation and versioned adaptation. | Improve retrieval and reading policies during idle periods, with controls for missed candidates, feedback loops and rollback. See the [learning-audit specification](core-learning-audits.md). |

## 5. Proposed retrieval and ranking algorithm

### 5.1 Retrieve broadly without admitting broadly

Build a union of candidate channels: title/abstract lexical search, scientific embedding neighbors, facet-specific neighbors, direct references, citing papers, shared-reference peers, co-cited peers, relevant author/group continuations, and explicit baseline identifiers extracted from focal papers. Preserve every discovery path after canonicalization.

Give each channel a quota so that a large keyword result list cannot crowd out an uncited method match. Search before and after the focal paper according to the requested time mode. Daily refresh uses source update watermarks with overlap; manual deep refresh revisits older literature and previously unexplored graph neighborhoods. Both feed the same evaluator.

Use reciprocal rank fusion for an initial shortlist: sum `channel_weight / (k + rank)` for channels that retrieved a paper, with absent channels contributing zero. `k = 60` is a historical baseline, not a required setting. Deduplicate strongly correlated query variants into one channel family. RRF avoids mixing incompatible raw score scales but is neither calibration nor proof of relevance.[^26]

Never treat Semantic Scholar or OpenAlex's supplied recommendation rank as the final decision. Their outputs are candidates with recorded provider provenance.

### 5.2 Construct a typed local graph

Start with canonical paper nodes and typed edges. Keep author, artifact and concept nodes in storage, but compute bounded paper-to-paper projections for the first release. Add passage and claim nodes progressively when reading depth permits.

The first graph layers are citation-to-predecessor, citation-to-descendant, bibliographic coupling, co-citation and semantic neighbors. Intent-specific dependencies and comparisons become additional layers when evidence exists. Avoid flattening all edge types into an undirected graph.

For shared-reference vectors, a simple proposed baseline is cosine similarity over binary references weighted by inverse reference frequency. Compute rarity on a declared corpus snapshot and cap extreme values. Use analogous normalized vectors for co-citers. Empty or unavailable reference lists yield a missing feature, not an assertion of no relationship. The basic relationships come from coupling and co-citation; rarity weighting and these normalization choices are VANI implementation hypotheses.[^1][^2]

Normalize each outgoing layer separately. For node `i`, combine only available layer transitions with nonnegative weights summing to one. If a layer has no outgoing edges, redistribute its mass over available layers; if none exist, restart at the collection seeds. This keeps the combined transition matrix stochastic. Pin the graph boundary, layer weights, seed distribution and restart value in the run manifest.

Evaluate both a multiplex mixture and separate per-layer PPR features. The latter is easier to audit and less likely to obscure why a candidate is present. Start with separate layer features and compare a node-split coupling variant later.[^9]

Run a bounded sparse computation on the retrieved neighborhood, not the global scholarly graph. Record omitted neighbors, truncation and residual tolerance. Local scores must not be presented as global PageRank or compared across graph snapshots without normalization.

### 5.3 Compare against anchors and facets

For each candidate, compare the relevant facets to each focal contribution. Retain at least the best-matching anchor, any contradictory anchor and the collection's subtopic coverage. Do not rely solely on an average embedding: a valid match to a small subtopic can disappear in an average.

Use separate feature families:

```text
semantic: problem, mechanism, contribution, assumptions, evaluation
relational: direct context, baseline, extension, coupling, co-citation, PPR
contextual: author continuity, artifact continuity, time, field
evidence: coverage, extraction reliability, provenance independence
feedback: researcher judgments, scope exclusions, selected objective
```

A transparent first reranker can use normalized features with explicit missing-value indicators and contribution caps. It should expose feature values and uncertainty before there is enough labeled data to train a ranking model. Once labels exist, compare a constrained learning-to-rank model and ordinal tier classifier against that baseline. Train/calibrate separately for different analysis depths; fields unavailable in an abstract-only record must not act like negative evidence.

Do not average a citation score, cosine similarity and an LLM's self-reported confidence as though they were comparable probabilities. Keep learned ranking utility, calibrated tier probabilities and evidence coverage in separate fields. Until calibration is measured, present ordinal assessments with reasons rather than “93% related.”

### 5.4 Require substantive evidence for the closest tier

There are two legitimate routes to the closest tier:

1. **Explicit relationship route:** a direct comparison, extension, dependency or replication/contradiction connects the candidate to a focal contribution, and contextual reading confirms that the relationship is substantive for the project's question.
2. **Uncited semantic route:** the candidate addresses a closely matching problem and contribution or mechanism, with passages from the candidate and focal material supporting that comparison. No citation, author overlap or minimum publication age is required.

A high graph score alone cannot satisfy either route. Neither can a shared author, venue, dataset name or generic topic. When evidence is incomplete, use “potentially close—needs targeted reading.” A new uncited paper can become fully close once its own text supports the relationship; third-party recognition is not mandatory.

Represent contradictions at the claim level with conditions. Different datasets, assumptions or metrics can explain apparent disagreement. “Paper A reports an improvement” is distinct from “VANI has verified A is better.”

### 5.5 Select a useful set after estimating proximity

Maintain a closest-work ranking and a separate suggested reading order. Reading order can balance closeness, missing facet coverage, competing explanations and redundant work, using an MMR-style objective as a baseline.[^27] Diversity must not change a paper's underlying proximity label.

Reserve a small exploration quota for uncited work, unusual terminology, different groups and cross-domain mechanisms. Exploration permits targeted inspection, not automatic full-paper analysis. Log which channel found a paper that the main ranking would have missed.

## 6. Tiered understanding and explicit cost control

### Proximity categories

| Category             | Meaning                                                                                                              | Default collection treatment                            |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Unassessed candidate | Retrieved through at least one channel; relevance not established.                                                   | Candidate inbox only.                                   |
| Background           | Helps understand the area but has weak overlap with the focal contribution.                                          | Optional background shelf; no automatic deep analysis.  |
| Related              | Shares a meaningful problem, mechanism, evaluation setting or lineage, with material differences.                    | Suggested related shelf; compact comparison.            |
| Closest              | Direct predecessor, strong competitor, substantive extension, or comparable evidence affecting a focal contribution. | Main related-work set and highest reading priority.     |
| Out of scope         | Assessed mismatch or explicit collection exclusion.                                                                  | Retained decision record, hidden from ordinary results. |

“Insufficient evidence” and “conflicting evidence” are confidence states that can accompany a provisional category. They are not synonyms for background or out of scope.

### Analysis depths

| Depth                        | Work performed                                                                                                                                     | Entry rule and retained output                                                                                                    |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| D0: discovery record         | Metadata, identities, existing abstract, cached embeddings and graph features. No per-candidate generative model call.                             | Every candidate. Keep source paths and preliminary scores.                                                                        |
| D1: brief assessment         | Compare title/abstract facets, existing citation contexts and focal profile. Batch/local inference where useful.                                   | Shortlist plus exploration quota. Save a brief contribution account, likely relationship, differences and uncertainties.          |
| D2: targeted reading         | Inspect relevant methods/related-work/experiment passages, baseline tables or theorem statements.                                                  | Likely related/close candidates or uncertainty that could materially change the decision. Save source-linked comparison evidence. |
| D3: deep comparative dossier | Analyze full relevant sections and necessary supplements, assumptions, method details, results, limitations and distinctions from closest anchors. | Only supported closest works, plus explicit researcher overrides. Save a reusable structured dossier and evidence coverage.       |

Deep analysis must not be the prerequisite for deciding which papers merit targeted reading. The stages resolve that circularity: D1 predicts value, D2 establishes the substantive relation, and D3 invests in the closest set. Full-text availability is an independent state. A partial extraction remains labeled partial regardless of the requested depth.

### Example budgets to validate

For an initial manual refresh, test a starting budget of up to 20,000 deduplicated D0 candidates, 2,000 D1 assessments, 40 D2 reads and 10 new D3 dossiers. These are ceilings, not targets: a collection with three close works should not force seven distant papers into D3. Focal-paper analysis has a separate one-time budget and is reused across refreshes.

For daily updates, process changed/new records and revisit unresolved high-value candidates within a shared daily budget. Do not reset the full D3 allowance independently for every click or every collection. Deduplicate overlapping requests and reuse a paper's parsing and factual extraction across collections; only collection-specific comparisons need separate evaluation.

Schedule the next action by estimated decision value per cost: likely effect on the closest-work list or an unresolved question, multiplied by probability the action resolves the gap, divided by estimated inference/IO cost. Early versions can implement this with transparent priorities and measured costs instead of pretending to know an exact expected-value model.

Enforce limits on API requests, downloads, bytes, tokens, runtime and concurrent jobs. Save checkpoints; stop or defer when the budget is exhausted. A run result reports candidates screened, tier changes, deep reads, coverage gaps and budget used—not just papers downloaded. Support explicit continuation from the frontier rather than restarting the same search.

### Continuous learning and idle-time audits

**CA35** adds an audit of every retained D0/D1 record every three days and every retained D2/D3 record each calendar month. The [detailed specification](core-learning-audits.md) defines full-corpus coverage, selective stronger-model rejudgment, independent discovery probes, provisional versus confirmed labels, bounded policy changes, held-out evaluation, shadow promotion and rollback. The final related/closest set supplies a comparison target, not unquestioned ground truth. Audit the rejected and unadvanced population as well as successful promotions.

Run audits through the installation queue during low workload, using separate audit budgets under shared resource/cloud limits. Reuse existing evidence, checkpoint unfinished work and yield to interactive use. Initially adapt collection-specific retrieval/ranking parameters and validated prompts; model-weight fine-tuning is deferred. Preserve all original decisions and explicit research focus.

### Preserve the local-PDF requirement without reading everything deeply

When a paper is **accepted into a collection**, retain VANI's behavior of attempting an authorized accessible PDF download and storing a local copy. Provide a brief contribution summary with explicit source coverage. Downloading and parsing a document does not authorize or require a D3 analysis.

For D0 candidates, retain metadata and accessible URLs without bulk downloading every hit. D2 may fetch a candidate's PDF to resolve its relationship; if it is rejected, retain its assessment and follow a declared candidate-cache retention policy. User uploads are always preserved. Missing/paywalled PDFs remain visible gaps and do not imply low relevance.

## 7. Persist the collection's reasoning as evidence and decisions

Store concise, inspectable rationales, structured feature values and source-linked claims. Do not store only a generated paragraph or treat an earlier generated summary as independent corroboration. The durable object is the relationship assessment and its evidence.

### Proposed records

| Record                      | Required contents                                                                                                                                                     |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `collection_focus_revision` | Question, contribution facets, constraints, positive/negative anchors, weights, objective, date boundary, author and revision.                                        |
| `discovery_run`             | Focus revision; provider queries/cursors and timestamps; graph snapshot; model/config versions; limits, costs, failures and stopping reason.                          |
| `collection_candidate`      | Canonical work, all discovery channels, run IDs, first/last seen, stage, membership decision and deferred action.                                                     |
| `paper_analysis`            | Work/version/content hash, depth requested/completed, extraction coverage, facts, section/artifact records and reusable factual summaries.                            |
| `collection_assessment`     | Candidate and anchor contributions; proximity category; role(s); confidence; depth; per-feature values; positive/negative evidence; missing information; next action. |
| `relationship_evidence`     | Typed direction, source work/version, attachment hash, page/section/table/offset, exact permitted excerpt, extraction method, confidence and provenance family.       |
| `assessment_revision`       | Prior/new decision, triggering change, model/prompt/config hashes, human edits, valid time and superseded state.                                                      |
| `collection_memory_item`    | Comparison, claim or subtopic synthesis; dependency IDs; evidence pointers; scope; creation/revision time and stale status.                                           |
| `collection_query`          | Question, scope and as-of version; retrieved evidence/assessments; answer claims and citations; coverage limitations.                                                 |

A paper may have one shared factual analysis and several different collection assessments. Membership records should point to the admission assessment while a separate pointer identifies the current assessment. Reclassification must not erase the original reason for saving a paper.

Every relationship uses an explicit epistemic status: **observed metadata**, **author-stated relationship**, **system-inferred relationship**, or **researcher-confirmed judgment**. Confirmation records who reviewed it; it does not mean the underlying scientific result is proven.

### Example assessment

The following is a fictional schema example, not an assessment of an actual publication. Identifiers and scores are illustrative; production evidence IDs must resolve to stored passages.

```json
{
  "collectionId": "collection-robot-learning",
  "focusRevision": 7,
  "candidateWorkVersion": "candidate-A:v2",
  "anchorContribution": "seed-S:contribution-1",
  "proximity": "closest",
  "relationshipTypes": ["baseline_for", "alternative_method"],
  "confidence": "supported",
  "analysis": { "completedDepth": "D2", "nextDepth": "D3" },
  "reason": "Addresses the same control objective and is explicitly compared under the focal paper's evaluation protocol.",
  "differences": [
    "Requires expert action labels that the focal method does not require."
  ],
  "evidenceIds": [
    "seed-S:table-2:baseline-row",
    "candidate-A:section-3:assumption"
  ],
  "featureEvidence": {
    "problemMatch": "seed-S:abstract + candidate-A:abstract",
    "directBaseline": "seed-S:table-2:baseline-row",
    "authorOverlap": false,
    "citationCoverage": "partial"
  },
  "epistemicStatus": "system_inferred_relationship",
  "unresolved": [
    "Independent reproduction of the reported comparison has not been assessed."
  ],
  "modelVersion": "pinned-model-version",
  "rankingConfigVersion": "proximity-v1",
  "sourceSnapshotHash": "content-addressed-snapshot"
}
```

Store uncertainty as data, not only prose. Missing references, unavailable supplements and ambiguous baseline identifiers each need a machine-readable reason. A score change should explain which inputs changed. If a quotation or table cannot be located in the stored source version, the associated claim cannot be published as grounded evidence.

## 8. Querying the accumulated reasoning

Support both deterministic relationship queries and natural-language questions:

- “Which works are closest to contribution two, and what separates our method from each?”
- “Which papers did our seeds use as baselines, and are the evaluation settings comparable?”
- “Show the method lineage across this research group, including papers from other groups.”
- “Which works challenge this result under the same assumptions?”
- “Why was this paper excluded, and would the revised collection focus change that?”
- “What changed in the closest-work set since last month?”
- “Which potentially close papers still lack enough evidence for a decision?”

First resolve collection, focal contribution, relationship type and time scope. Use structured filters for facts such as membership history, baseline links and authorship. Retrieve supporting passages with hybrid search; optionally use query-personalized graph traversal for multi-hop relationships. Rerank a bounded evidence set and produce source-linked claims.

Graph paths establish a retrieval route, not the logical entailment of an answer. The answer must connect each asserted relationship to source evidence. Community summaries can guide retrieval but must resolve to underlying passages and assessments. Keep a direct passage-retrieval fallback and evaluate it against graph-assisted retrieval.[^21][^22][^23]

A historical query uses the focus, paper versions and assessments valid at that time. A current query warns about stale or superseded evidence. By default, answering a question uses stored evidence; any new external search or depth escalation is a separately recorded action with a budget. Existing local/private material must not be sent to remote services without the relevant authorization.

## 9. Data sources and practical constraints

| Source                                         | Useful inputs                                                                                                                  | Limits and proposed handling                                                                                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAlex                                       | Work identities, authors/affiliations, references, citations, topic metadata and accessible-content locations.                 | Record missing reference coverage; its own documentation explains dropped/unmatched references. Treat `related_works` as provider suggestions, not verified idea proximity.[^28][^29] |
| Semantic Scholar                               | Citation/reference contexts, intent and influence fields where available; scientific embeddings and recommendation candidates. | Store provider provenance and absence separately. The documented influential flag depends on full-text access; absence is not proof of low influence.[^30][^31]                       |
| Crossref and existing VANI metadata connectors | DOI resolution, publication/version metadata and source reconciliation.                                                        | Preserve the current identity pipeline and test actual returned fields; missing abstracts/references must not become negative evidence.                                               |
| Local PDF, publisher XML, repository text      | Paragraph-level citation contexts, method sections, experimental tables and exact source anchors.                              | Parse once, record coverage and version; inspect supplements only when needed. Prefer structured text when available.                                                                 |
| Researcher annotations and project notes       | Contribution intent, corrected aliases, actual use of prior methods and explicit exclusions.                                   | Preserve authorship and scope. Human interpretation is distinct from a quotation from the paper.                                                                                      |

API availability, quotas, licenses and model access must be checked at implementation time. Do not assume provider access implies permission to redistribute full text. Pin model and parser versions and validate domain/language coverage. “Unknown group,” “unresolved reference,” and “PDF unavailable” are valid states.

The most damaging failure is a self-reinforcing loop: a weak candidate is accepted, becomes a seed, produces more weak candidates, and its generated summary is then treated as evidence. Prevent this by requiring explicit anchor promotion, recording evidence ancestry and separating generated inferences from primary sources.

## 10. Implementation sequence and migration

1. **Evaluation and focus model.** Build benchmark collections and graded judgments; add focal contributions, explicit seed roles, negative examples and versioned scope. Preserve the current algorithm as a baseline.
2. **Candidate staging and cheap hybrid ranking.** Stop automatic keyword-based membership in the new mode. Add D0/D1, canonicalized discovery paths, semantic retrieval, normalized coupling and per-layer PPR features. Persist assessments and expose relationship cards.
3. **Targeted citation and comparison reading.** Extract contexts from focal works first, because one focal analysis can prioritize many references. Add baseline linking, citation intent, D2 evidence and an analysis scheduler. A researcher can already request a D3 read explicitly.
4. **Selective automatic deep analysis.** Enable automatic D3 only after tier calibration and grounding tests meet release gates. Produce contribution-level dossiers for the closest supported works; reuse factual analysis across collections.
5. **Queryable memory and incremental updates.** Connect assessments, typed relationships and passages to Ask VANI, with current/historical scopes, dependency invalidation and saved query evidence.
6. **Periodic learning (CA35).** Add the three-day early-stage and monthly deep-stage audits, initially as reports and shadow proposals. Enable automatic bounded adaptation only after the learning-audit evaluation and scheduling gates pass.
7. **Experiments.** Evaluate intent-aware diffusion, node-split graphs, learned ranking and methodological-inspiration retrieval. Adopt a more complex model only if it improves relevance at an acceptable cost.

Use a collection-level algorithm version and a shadow mode that compares old/new outputs without altering saved membership. Preview reclassification of existing papers; keep their files and annotations. Explicitly accepted papers remain saved even if the new model calls them background. Automated decisions apply only to the collection snapshot under which they were computed; changed focus or evidence requires reassessment before admission.

The queue must recover after interruption, coalesce duplicate refreshes, preserve partial progress and avoid repeated billing/inference through idempotent stage keys. Split the present enrichment queue into acquisition/parsing, brief summary and comparative-analysis tasks. Existing API/UI behavior remains available during rollout, with the collection visibly identifying its active algorithm.

Rollback changes the active ranking/automation configuration; it does not delete saved evidence or prior assessments. This document does not authorize implementation or bulk reclassification as part of the research change.

## 11. Evaluation that answers the actual product question

### Benchmark construction

Start with approximately 30–50 researcher-defined collections across VANI's intended fields, each with focal contributions and a pooled set of about 100–200 judged candidates. Include candidates from all retrieval channels, independent expert additions, hard same-topic negatives, uncited work, same-group/off-topic papers and known baseline comparisons. Budget these annotations separately from algorithm development.

Use graded judgments: background, related and closest, with a separate out-of-scope label, relation type and evidence sufficiency. At least a subset needs independent second judgments and adjudication. Store disagreement rather than disguising it as a precise ground truth.

Split by collection and time; group preprint/journal versions together. Where feasible, hold out author groups and topics to test transfer. Freeze the citation graph at the simulated discovery date. Avoid training on future co-citations, and do not evaluate a citation-trained model only by its ability to reproduce the same observed citations.

External datasets provide complementary checks: CSFCube for faceted similarity, SciRepEval for representation behavior, MultiCite for citation relationships, MIR for inspiration, and ScholarQABench for grounded synthesis. None replaces the VANI-specific task.[^25][^14][^16][^19][^23]

### Baselines and ablations

Compare keyword overlap, lexical ranking, SPECTER2 retrieval, graph-only PPR, coupling-only, hybrid retrieval without context, context-aware reranking, and the full progressive pipeline. Remove authorship, global influence, each graph layer and each evidence stage in turn. Compare against a full-analysis strategy on a small matched sample to measure how much quality the cheaper pipeline preserves.

Use realistic candidate pools. Random unrelated negatives make retrieval appear easier than distinguishing two papers about the same task whose contributions differ. Report results separately for new/uncited papers, old foundations, cross-field methods, inaccessible full text and underrepresented languages/domains.

### Proposed release gates

| Objective                           | Measurement and initial target                                                                                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Find the nearest works              | Expert-judged nDCG@10 and precision of the closest tier; target closest-tier precision of at least 0.85 on held-out collections. Report sample size and uncertainty.                        |
| Avoid missing key work              | Recall of pooled expert-labeled closest works at the candidate stage; target at least 0.90. This is measured pool recall, not a claim of exhaustive literature coverage.                    |
| Justify the added complexity        | Positive held-out nDCG improvement over both keyword and embedding-only baselines, with paired confidence intervals by collection. Investigate strata with regressions.                     |
| Spend deeply only where useful      | Track D3 reads per confirmed closest paper and tokens/cost per useful addition; target at least 80% fewer D3 reads than analyzing the entire matched candidate pool.                        |
| Preserve quality under the budget   | Compare closest-work recall at equal cost and quality at equal recall; publish the Pareto curve rather than a single unqualified cost-saving claim.                                         |
| Ground explanations                 | Every factual relationship claim resolves to source evidence; expert audit of semantic support, not only substring quotation checks. Zero fabricated source references in release fixtures. |
| Handle uncertainty                  | Calibration error/Brier score where probabilities are shown, error rate among high-confidence decisions, and coverage of abstentions. No probability display until evaluated.               |
| Prevent social/popularity shortcuts | Counterfactual author/venue changes must not flip closest admission without content evidence; explicit tests for new, zero-citation, different-group neighbors.                             |
| Make memory useful                  | Answer relationship/history questions against saved evidence; measure citation correctness, answer coverage and abstention on unsupported questions.                                        |
| Keep operations dependable          | No duplicate admissions or D3 charges after restart/repeated clicks; stale snapshot rejection; unchanged work reuses cached analysis.                                                       |

Targets are provisional product requirements. If they are not met, keep suggested/review mode rather than silently lowering thresholds to fill a collection.

### Concrete acceptance scenarios

1. A paper with different vocabulary but the same problem and mechanism is retrieved and can enter the closest tier through evidence from its own text.
2. A famous, highly cited paper sharing broad keywords remains background if its contribution is distant.
3. A same-lab paper on another problem is not admitted as close solely through author/group links.
4. A direct baseline with incompatible evaluation conditions is shown as relevant with a comparability warning; no unsupported performance ordering is generated.
5. A replication or contradiction under matching conditions receives high reading priority rather than being suppressed for disagreement.
6. An inaccessible candidate remains potentially close/analysis blocked; uploading its PDF resumes targeted reading without a fresh discovery cycle.
7. Removing a query keyword stops that lexical expansion while preserving independently supported relationships; explicit topic exclusion follows a separate rule.
8. An edited focal contribution invalidates affected assessments but preserves their history and previously saved papers.
9. Two collection refreshes finding the same work share the PDF/factual extraction, while maintaining separate proximity explanations.
10. A historical question reproduces the evidence and decision valid at the requested time, including why an earlier candidate was excluded.

## 12. Recommended first delivery

Deliver the focus model, candidate staging, scientific semantic retrieval, normalized citation neighborhoods, per-layer personalized PageRank, basic evidence-backed comparisons and a strict depth budget together. Those components address both bad admission and indiscriminate processing.

Then add baseline/context extraction and collection memory queries. Keep advanced graph learning and cross-domain inspiration behind measured experiments. The enduring asset should be the versioned comparison evidence attached to the collection; an embedding model, graph implementation or LLM can then be replaced without losing what the researcher has learned.

## Sources

The references below distinguish original algorithm/empirical papers from provider documentation. Older foundational papers with limited accessible text support the named definitions and historical context; proposed implementation details and performance targets are explicitly identified above. Conference/publication years are used rather than crawler dates.

[^1]: M. M. Kessler. [Bibliographic coupling between scientific papers](https://doi.org/10.1002/asi.5090140103). _American Documentation_ 14(1), 1963. Foundational definition; publisher bibliographic record.

[^2]: Henry Small. [Co-citation in the scientific literature: A new measure of the relationship between two documents](https://asistdl.onlinelibrary.wiley.com/doi/abs/10.1002/asi.4630240406). _Journal of the American Society for Information Science_ 24(4), 1973. Publisher abstract and definition.

[^3]: Lawrence Page, Sergey Brin, Rajeev Motwani and Terry Winograd. [The PageRank Citation Ranking: Bringing Order to the Web](http://ilpubs.stanford.edu:8090/422/). Stanford technical report, 1999. Original report endpoint was unavailable; mathematical background is also available in Manning, Raghavan and Schütze's [PageRank chapter](https://nlp.stanford.edu/IR-book/html/htmledition/pagerank-1.html) and the original topic-sensitive work below.

[^4]: Taher H. Haveliwala. [Topic-Sensitive PageRank](https://snap.stanford.edu/class/cs224w-readings/Haveliwala02Topicsenitive.pdf). WWW, 2002. Original paper, Stanford copy.

[^5]: Dylan Walker, Huafeng Xie, Koon-Kiu Yan and Sergei Maslov. [Ranking Scientific Publications Using a Simple Model of Network Traffic](https://arxiv.org/abs/physics/0612122). Preprint 2006; journal version _Journal of Statistical Mechanics_, P06010, 2007, titled “Ranking scientific publications using a model of network traffic.”

[^6]: Hassan Sayyadi and Lise Getoor. [FutureRank: Ranking Scientific Articles by Predicting their Future PageRank](https://epubs.siam.org/doi/10.1137/1.9781611972795.46). SDM proceedings, 2009. Publisher abstract; later electronic-publication date is not the conference year.

[^7]: Manuel Sebastian Mariani, Matúš Medo and Yi-Cheng Zhang. [Identification of milestone papers through time-balanced network centrality](https://arxiv.org/abs/1608.08414). _Journal of Informetrics_ 10(4), 2016.

[^8]: Shuqi Xu, Manuel Sebastian Mariani, Linyuan Lü and Matúš Medo. [Unbiased evaluation of ranking metrics reveals consistent performance in science and technology citation data](https://arxiv.org/abs/2001.05414). _Journal of Informetrics_ 14(1), article 101005, 2020.

[^9]: Jinhyuk Yun. [Generalization of bibliographic coupling and co-citation using the node split network](https://arxiv.org/abs/2110.15513). Preprint 2021; _Journal of Informetrics_, 2022. Personalized diffusion across citing/cited roles.

[^10]: Chandra Bhagavatula, Sergey Feldman, Russell Power and Waleed Ammar. [Content-Based Citation Recommendation](https://aclanthology.org/N18-1022/). NAACL, 2018. Citeomatic candidate retrieval and reranking.

[^11]: Arman Cohan, Sergey Feldman, Iz Beltagy, Doug Downey and Daniel Weld. [SPECTER: Document-level Representation Learning using Citation-informed Transformers](https://aclanthology.org/2020.acl-main.207/). ACL, 2020.

[^12]: Malte Ostendorff et al. [Neighborhood Contrastive Learning for Scientific Document Representations with Citation Embeddings](https://aclanthology.org/2022.emnlp-main.802/). EMNLP, 2022. SciNCL.

[^13]: Sheshera Mysore, Arman Cohan and Tom Hope. [Multi-Vector Models with Textual Guidance for Fine-Grained Scientific Document Similarity](https://aclanthology.org/2022.naacl-main.331/). NAACL, 2022. ASPIRE; [authors' implementation](https://github.com/allenai/aspire).

[^14]: Amanpreet Singh, Mike D'Arcy, Arman Cohan, Doug Downey and Sergey Feldman. [SciRepEval: A Multi-Format Benchmark for Scientific Document Representations](https://aclanthology.org/2023.emnlp-main.338/). EMNLP, 2023. SPECTER2; [official implementation](https://github.com/allenai/SPECTER2).

[^15]: Arman Cohan, Waleed Ammar, Madeleine van Zuylen and Field Cady. [Structural Scaffolds for Citation Intent Classification in Scientific Publications](https://aclanthology.org/N19-1361/). NAACL, 2019. SciCite.

[^16]: Anne Lauscher et al. [MultiCite: Modeling realistic citations requires moving beyond the single-sentence single-label setting](https://aclanthology.org/2022.naacl-main.137/). NAACL, 2022.

[^17]: Tuan Anh Phan and Jason J. Jung. [Leveraging citation intent for publication relatedness](https://link.springer.com/article/10.1007/s10791-026-09995-x). _Discover Computing_ 29, article 98, February 16, 2026. Intent-aware relations, clustering evaluation and discussion of hard/soft matching.

[^18]: Sarthak Jain, Madeleine van Zuylen, Hannaneh Hajishirzi and Iz Beltagy. [SciREX: A Challenge Dataset for Document-Level Information Extraction](https://aclanthology.org/2020.acl-main.670/). ACL, 2020.

[^19]: Aniketh Garikaparthi et al. [MIR: Methodology Inspiration Retrieval for Scientific Research Problems](https://aclanthology.org/2025.acl-long.1390/). ACL, 2025; [full text](https://arxiv.org/html/2506.00249v1).

[^20]: Yoonjoo Lee et al. [PaperWeaver: Enriching Topical Paper Alerts by Contextualizing Recommended Papers with User-collected Papers](https://arxiv.org/html/2403.02939v1). CHI, 2024. Contextual explanations and a 15-participant evaluation.

[^21]: Bernal Jiménez Gutiérrez, Yiheng Shu, Weijian Qi, Sizhe Zhou and Yu Su. [From RAG to Memory: Non-Parametric Continual Learning for Large Language Models](https://proceedings.mlr.press/v267/gutierrez25a.html). ICML, 2025. HippoRAG 2; [full text](https://arxiv.org/html/2502.14802v1).

[^22]: Darren Edge et al. [From Local to Global: A Graph RAG Approach to Query-Focused Summarization](https://arxiv.org/abs/2404.16130). 2024 preprint. Entity graphs and community-level synthesis.

[^23]: Akari Asai et al. [Synthesizing scientific literature with retrieval-augmented language models](https://www.nature.com/articles/s41586-025-10072-4). _Nature_ 650, 857–863, February 2026. OpenScholar and ScholarQABench; prefer this publication over the earlier preprint's differing evaluation figures.

[^24]: Yilun Zhao et al. [Rethinking Reasoning-Intensive Retrieval: Evaluating and Advancing Retrievers in Agentic Search Systems](https://aclanthology.org/2026.acl-long.1705/). ACL, July 2026; [full text](https://arxiv.org/html/2605.04018v1). Bright-Pro and complementary evidence evaluation.

[^25]: Sheshera Mysore, Tim O'Gorman, Andrew McCallum and Hamed Zamani. [CSFCube — A Test Collection of Computer Science Research Articles for Faceted Query by Example](https://arxiv.org/abs/2103.12906). NeurIPS Datasets and Benchmarks, 2021. Facet-specific relevance judgments.

[^26]: Gordon V. Cormack, Charles L. A. Clarke and Stefan Büttcher. [Reciprocal Rank Fusion outperforms Condorcet and individual Rank Learning Methods](https://cormack.uwaterloo.ca/cormacksigir09-rrf.pdf). SIGIR, 2009. Original author-hosted paper.

[^27]: Jade Goldstein and Jaime Carbonell. [Summarization: Using MMR for Diversity-Based Reranking and Evaluating Summaries](https://students.lti.cs.cmu.edu/11899/files/Final-p181-goldstein.pdf). Original author paper on relevance and redundancy; related [author's mathematical handout](https://www.cs.cmu.edu/afs/cs.cmu.edu/academic/class/15381-s01/public/www/lec/ir/jgc-ir-handout.pdf), 2001.

[^28]: OpenAlex. [Citations](https://help.openalex.org/data/works/citations/). Official documentation, accessed September 13, 2026. Reference construction and missing-link explanations.

[^29]: OpenAlex. [Works attributes](https://help.openalex.org/data/works/attributes/). Official documentation, accessed September 13, 2026. Related-work suggestions and full-text availability fields.

[^30]: Semantic Scholar. [Academic Graph API reference](https://api.semanticscholar.org/api-docs/snippets) and [API overview](https://www.semanticscholar.org/product/api). Official documentation, accessed September 13, 2026. Contexts, intents, embeddings and source access.

[^31]: Semantic Scholar. [What are Highly Influential Citations?](https://webflow.semanticscholar.org/faq/influential-citations). Official documentation, accessed September 13, 2026. Model-derived influence and full-text coverage limitations.
