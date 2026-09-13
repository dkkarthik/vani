# Reviewing VANI’s core algorithm for related academic literature

VANI’s proposed architecture is well suited to the problem: discover broadly, compare contributions, read selectively, and preserve the evidence behind each decision. The highest-value revision is to make scientific comparability and discovery coverage more concrete. Adding increasingly elaborate graph algorithms should follow evidence that they improve those outcomes.

For a group working in computer vision, robotics, machine learning and embodied AI, a useful collection must distinguish a direct competitor from a methodological ancestor, a shared dataset, an implementation dependency and an interesting analogy. It must also distinguish an experimentally comparable result from a conceptually close paper evaluated under different conditions. The current design recognizes these distinctions, but several remain optional or underspecified.

This review recommends six coordinated changes: promote domain-specific comparison fields into the first delivery; represent research artifacts and their lineage explicitly; add curated articles as attributable discovery sources; split inexpensive D1 screening from selective generative extraction; report the coverage and unfinished work of each search frontier; and strengthen continuous learning against selection bias and repeated evaluation on the same examples. These are proposals for implementation, not claims of measured VANI performance.

## Scope and strength of evidence

The review covers the [core algorithm](core-algorithm.md), [periodic learning audits](core-learning-audits.md), [local deployment plan](local-model-deployment.md), and [original feature research](feature-research.md). Public-source coverage was checked on September 13, 2026. The workstation assumption remains Ubuntu/Linux, an RTX 5090 and 64 GB system RAM. The agreed ceilings remain 20,000 D0 candidates, 2,000 D1 assessments, 40 D2 readings and 10 D3 dossiers per manual-refresh frontier.

Three types of evidence inform the recommendations. Official product documentation establishes disclosed behavior, but generally does not reveal complete ranking implementations. Original papers establish results on particular datasets and tasks. Researcher blogs, lab articles, tutorials and project pages illustrate how researchers organize ideas and expose methodological details; their advice and demonstrations are not controlled evaluations of literature-search systems. This is a focused critical review, not an exhaustive systematic review or a hands-on benchmark of commercial products.

The two articles that prompted the original feature work remain useful starting points. Effortless Academic emphasizes reading intentions, visual organization and converting reading into connected notes. The 2021 Litmaps article illustrates several visual discovery interfaces, but is a historical vendor comparison. Its description of Connected Papers should not be used to define citation edges: Connected Papers describes a similarity graph based on co-citation and bibliographic coupling.[^1][^2][^7] Neither article demonstrates that a visual layout measures intellectual proximity accurately.

## What comparable tools teach us

The products address different parts of the workflow. Comparing them as if they all implement the same knowledge graph would obscure their useful contributions.

| Tool or system                  | Publicly documented approach                                                                                                                           | Lesson for VANI                                                                             | Important boundary                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Zotero                          | Capture references and available PDFs, organize collections/tags, search, annotate and follow feeds.[^3]                                               | Preserve durable ownership of files and notes; one paper can support several collections.   | Reference management and local search do not establish automatic contribution-level proximity.                            |
| Mendeley                        | PDF and web import, watched folders, shared libraries and annotation workflows.[^4]                                                                    | Make ingestion into an existing collection reliable and low effort.                         | The reviewed feature page does not disclose a comparable proximity-ranking algorithm.                                     |
| ResearchRabbit                  | Citation and authorship networks support seed-based discovery; its June 2026 explanation explicitly says its core recommendations do not use LLMs.[^5] | Much discovery can remain inexpensive and local once metadata is available.                 | Public descriptions do not establish that its implementation is PageRank or disclose exact weights.                       |
| Litmaps                         | Separate algorithms for shared citations/references, common authors, and semantic title/abstract similarity.[^6]                                       | Preserve multiple candidate channels, especially a text route for new or disconnected work. | A user-selectable algorithm is not evidence that any one channel finds all relevant work.                                 |
| Connected Papers                | Similarity based on co-citation and bibliographic coupling.[^7]                                                                                        | A visual neighborhood can expose families missed by a keyword list.                         | Similarity edges must be visibly different from direct citation edges; graph position is not a verified scientific claim. |
| Semantic Scholar Research Feeds | Contrastively trained paper embeddings and folder-level positive and explicit “not relevant” feedback.[^8]                                             | Offer useful collection-specific learning with simple feedback.                             | VANI should preserve its stronger distinction between saving a paper and explicitly making it a focal seed.               |
| scite                           | Citation statements, surrounding context, section and supporting/contrasting/mentioning classifications.[^9]                                           | Retrieve the passage that explains a relationship.                                          | A citation classification concerns a particular statement; it does not settle the truth or quality of an entire paper.    |
| Elicit                          | Search, explicit screening criteria, abstract/full-text screening and structured extraction.[^10][^11]                                                 | Make criteria, uncertain decisions and extraction evidence inspectable.                     | Systematic-review eligibility differs from identifying a contribution’s closest intellectual neighbors.                   |
| ASReview                        | Open-source active learning assists the ordering and screening of records.[^38]                                                                        | Learning which records to inspect need not require retraining a large language model.       | Screening an imported pool does not solve discovery outside that pool.                                                    |
| arxiv-sanity-lite               | Tags and SVM ranking over TF–IDF abstract features.[^15]                                                                                               | Include a cheap personalized classifier as a serious baseline.                              | Its existence does not establish its accuracy for VANI’s multi-role relevance judgments.                                  |

The distinctive opportunity for VANI is the connection between these capabilities: reliable capture, broad discovery, defensible comparisons, controlled reading effort and durable collection memory. The reviewed documentation does not justify claiming that no competitor has any overlapping feature. It does justify requiring VANI to demonstrate the combined workflow rather than merely adding a graph visualization or an LLM summary.

Elicit’s May 2026 evaluation is especially instructive about measurement. It reports 95.0% search recall for included studies in its evaluated Cochrane setting, with results dependent on retrieval depth and record resolution. Full-text screening reports 99.5% paper-level recall, but 70.1% specificity; the 94.8% figure concerns per-criterion accuracy. Its authors discuss DOI/PDF selection effects, reconstructed extraction questions and limited generalization beyond Cochrane.[^11] VANI should adopt stage-specific reporting and explicit denominators. These figures are not transferable targets for robotics, nor evidence that a generated related-work set is complete.

## Accumulating literature is an iterative research process

### Begin with a question and several ways into the field

Wohlin’s snowballing guidelines explain why a starting set should cover different communities, years and authors, particularly when relevant communities do not cite each other. They also distinguish backward and forward snowballing and the need to inspect citation context. Their software-engineering replication supports a disciplined iterative search procedure, not a universal guarantee that citation search outperforms database search.[^12]

Karpathy’s account of doctoral research emphasizes choosing problems and developing a coherent body of work. Stanford’s CS230 project guidance connects literature review with the problem, dataset, prior work and evaluation plan.[^13][^14] Together, these sources suggest that “papers similar to this PDF” is only a starting interaction. A collection should express what the researcher is trying to learn, compare or build. This supports CA01 and the existing separation of focal contributions from ordinary saved papers.

For VANI, the recommended accumulation cycle is: establish the research question and explicit anchors; search lexical and semantic variants; expand references and citers; inspect methods and baseline sections of promising work; add newly discovered terminology and artifact links; then assess whether important facets remain uncovered. Accepted papers can provide bounded discovery leads without automatically receiving focal-seed weight. Every expansion remains tied to its originating work and collection focus.

This distinction resolves a tension in the design. Prohibiting automatic seed drift is necessary, but prohibiting all expansion from newly assessed work would unnecessarily weaken snowballing. A candidate can become an eligible expansion frontier after a supported assessment, while the persistent research question and personalized restart distribution remain controlled by explicit focal choices. Expansion eligibility, collection membership and focal status need separate fields.

### Use several discovery surfaces, with different purposes

The proposed source strategy has four complementary layers. Broad scholarly indexes supply lexical/semantic candidates and citation neighborhoods. Venue and preprint feeds provide recent arrivals. Selected surveys, lab articles, tutorials and reading lists provide terminology and bibliographies. Project pages and repositories identify datasets, methods, checkpoints and implementation descendants.

For this group, a proposed watch list should include relevant arXiv categories and proceedings from CVPR/ICCV/ECCV, NeurIPS/ICML/ICLR, CoRL, RSS, ICRA and IROS, subject to connector availability and access. This is a source-selection recommendation, not a claim that each venue offers the same API or full-text access. Selective lab and author feeds should complement it. A famous lab’s posts or a trending-paper list should never define the collection’s relevance distribution.

A saved search must retain the exact provider-specific query, filters, time boundary, pagination and truncation state, result identifiers and retrieval time. Provider capabilities differ: preserve a structured search intent as well as the concrete query emitted for each source. Replaying a query against a changing live index is not a reproducible historical evaluation; that requires a retained snapshot or an explicit limitation.

The resulting collection is a living evidence map. It need not claim the completeness of a formal systematic review. The useful promise is that the researcher can see where VANI looked, what it found, which avenues remain unexplored and why particular papers warranted attention.

## What the domain articles reveal

### Conceptual taxonomies connect papers more precisely than topic labels

Lilian Weng’s domain-randomization article organizes sim-to-real work by distinctions such as visual versus dynamics randomization and the information used to guide a randomization distribution. It connects apparently neighboring approaches while exposing differences in real-data access and optimization feedback.[^16] For VANI, “sim-to-real” should therefore identify a family, while observability, data access and adaptation mechanism determine the actual comparison. A method needing target-environment interaction is not an interchangeable baseline for a strictly zero-shot transfer claim.

Weng’s diffusion tutorial and Yang Song’s author tutorial connect diffusion formulations, score estimation, sampling procedures and applications.[^17][^18] These are useful examples of discovering a mechanism across different names and application areas. VANI should extract proposed aliases and conceptual bridges, then confirm their meaning in the cited primary works. Related formulations need not be collapsed into synonyms: a connection between two objectives is different from a claim that two complete algorithms are identical.

Distill’s _Feature Visualization_ organizes prior work through optimization objectives, regularization and parameterization, including tradeoffs in what a visualization can show.[^19] That structure is more useful for comparing contributions than putting all the papers under “interpretability.” A collection on visual explanations should distinguish the object being explained, the construction method, the assumptions and the evidence used to validate the explanation.

The design implication is to make taxonomies attributable and revisable. Store an author’s conceptual grouping as an interpretation, link each member to its primary paper, and retain competing groupings. A compelling tutorial supplies discovery leads and a useful organizing hypothesis; it does not become an unquestionable ontology.

### Paper identity is only one part of a research artifact

The Diffusion Policy project page connects the method to code, experiment data, simulation benchmarks, real-robot examples and separate conference/journal versions.[^20] Open X-Embodiment connects a collaborative paper with standardized robot datasets and models spanning different embodiments.[^21] These pages show why a paper-only graph loses important discovery routes and can double-count evidence.

VANI should represent a paper’s version family separately from the artifacts it uses or releases. A repository implements a method; a checkpoint instantiates a particular training recipe; a dataset supplies training or evaluation material. A later method can share a dataset while changing the mechanism substantially. Conversely, a repository fork may inherit a central implementation without providing a new scientific contribution. None of these relationships should be represented by an undifferentiated “related” edge.

LeRobot’s July 2026 release article illustrates the pace at which policy implementations and evaluation integrations change.[^25] It is evidence about software capabilities at a particular release. Integration or parity testing is a different claim from independently reproducing every published scientific result. VANI should preserve a release tag or commit and the scope of each reported check; a current repository must not silently replace the implementation associated with an older result.

This also changes how support should accumulate. A paper, its project page, the authors’ blog and their code repository may all describe one experiment. They improve accessibility and corroborate identity, but are not four independent replications. Citation counts, shared artifacts and multiple summaries can likewise originate from the same underlying lineage. CA25’s independence rule needs an explicit evidence-family identifier to enforce this.

### Robotics makes evaluation conditions decisive

Physical Intelligence’s π0.5 article distinguishes physical, visual and semantic generalization and describes evaluation in previously unseen homes.[^22] This makes “generalization” an insufficient comparison field. VANI should ask what changes between training and evaluation: objects, layouts, environments, instructions, tasks, embodiments or combinations of these. A company’s demonstration and reported experiment should remain attributable to that company, with the supporting paper consulted for the full protocol.

Marina Barannikov’s robotics experiments report a mismatch between validation loss and task success in the tasks examined.[^23] The appropriate lesson is to preserve the actual evaluation target and the limits of a proxy metric. It would be unjustified to turn this into a universal claim that validation sets are useless. A comparison card should retain both the offline metric and the on-policy or physical evaluation, when available.

Nishimura and Itkina’s Toyota Research Institute article explains noisy policy evaluation, repeated testing and the need to specify success criteria, initial conditions, trial counts and experimental ordering. It presents sequential testing and discusses assumptions and practical limitations.[^24] This supports two VANI requirements: comparisons need experimental context and uncertainty, and repeated learning audits need a statistically defensible evaluation policy. It does not mean a robot-policy test can be copied unchanged into a literature recommender.

For the first domain profile, the proposed experiment record should include task and success definition; dataset/version/split; pretraining and fine-tuning data; embodiment and end effector; observations and privileged state; action representation, control rate and execution horizon; simulator or physical setting; reset and human-intervention policy; evaluation variation; trial count and uncertainty; and code/checkpoint provenance. Each field can be unknown or not applicable. Collect detailed fields at D2, rather than demanding every field before a new abstract can enter D1.

The CV/ML profile also needs output granularity, input resolution, supervision, external training data, evaluation regime and inference budget. For example, a hypothetical representation-learning collection should distinguish a frozen encoder with a linear probe from full fine-tuning, and zero-shot evaluation from training on target labels. A dense-prediction comparison needs the task-specific output and metric rather than an image-level accuracy field. These are proposed schema requirements: a missing training-data description is uncertainty, not proof of contamination or an unfair experiment.

### A worked example: one collection, several legitimate relationships

Consider a hypothetical collection on data-efficient visuomotor manipulation using generative action policies. The following are illustrative roles to test, not completed VANI judgments or an exhaustive related-work list.

| Discovery                                              | Possible value to the collection                                               | What must be checked before a stronger conclusion                                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| A Diffusion Policy paper and its project artifacts     | Direct method comparison for conditional action generation.[^20]               | Observation/action settings, demonstrations, benchmark protocol and which paper/code version is being compared.                              |
| Foundational score-based generative modeling           | A mathematical or methodological ancestor.[^18]                                | Which mechanism is actually inherited; it need not be the closest experimental competitor.                                                   |
| Open X-Embodiment                                      | Dataset lineage, cross-embodiment training context and transfer evidence.[^21] | Which constituent data a specific method used and whether evaluation conditions overlap.                                                     |
| π0.5                                                   | A related approach to generalization in embodied tasks.[^22]                   | Training regime, embodiment, task horizon and generalization axis; shared terminology alone cannot establish a fair head-to-head comparison. |
| A study of validation loss versus success              | Evaluation-method guidance.[^23]                                               | Its task scope and whether the same failure of a proxy applies to the focal project.                                                         |
| A new, uncited paper with a closely matching mechanism | Potentially the nearest current contribution.                                  | Primary text supporting the match; citation absence must not prevent consideration.                                                          |

The output should support “closest to contribution A,” “relevant foundation” and “not directly comparable under this protocol” simultaneously. A single scalar cannot communicate all three. A protocol mismatch may prevent a performance ordering while leaving conceptual proximity high.

## Reassessing the earlier algorithm literature

### Graph methods remain valuable, with a narrower claim

The earlier review appropriately distinguished bibliographic coupling, co-citation, personalized diffusion and influence ranking. CiteRank models traffic with an age-sensitive starting distribution; rescaled PageRank addresses age bias in identifying milestone papers.[^26][^27] These results concern attention or influence under particular evaluations. They do not validate admission to a collection about a specific contribution.

Yun’s node-split work separates citing and cited roles and extends coupling-style relationships using personalized PageRank and embeddings.[^28] It motivates preserving direction and investigating longer paths. It does not establish that a node-split model is the best first implementation for VANI. The initial per-layer PPR design is reasonable, provided it is evaluated against simpler neighborhoods and coupling. Require graph expansion to produce additional judged useful works at acceptable cost; otherwise retain the simpler configuration.

The 2026 intent-aware relatedness study adds useful evidence that citation purpose can improve textual coherence of citation-derived clusters.[^42] Its evaluation remains distinct from deciding which paper is the closest prior work for a robotics contribution. VANI should keep uncertain and mixed intents, avoid universal numerical intent weights and retain a content-only route for uncited work. The earlier design already makes these distinctions correctly.

An existing requirement needs an explicit acceptance check: graph truncation must not look like scientific absence. Every layer needs coverage metadata, degree caps and completion state. A high PPR score on a narrow neighborhood should not be compared directly with a score from a much larger later graph. Ranks and contribution paths are useful explanations; calibrated relevance requires separate judgments.

### Faceted retrieval is more directly aligned with the task

ASPIRE learns fine-grained scientific similarity using sentence-level aspects and co-citation context, including a fast single-match variant.[^29] SciRepEval shows that scientific representation quality depends on the downstream task format and introduces SPECTER2’s task-specific representations.[^30] CSFCube provides graded faceted query-by-example judgments, with 50 query documents from computational linguistics and machine-learning venues.[^31] These are particularly relevant to the choice to compare problem, method and result facets separately.

They also expose an unresolved deployment question. The local plan’s convenient embedding model is not automatically the best scientific-paper retriever. Benchmark its title/abstract and passage behavior against a retrieval-oriented SPECTER2 configuration and a simple lexical baseline. Treat whole-paper retrieval, facet matching and passage selection as separate decisions. Model size, recency or a general embedding leaderboard does not answer this domain-specific question.

SciCite and MultiCite support context-sensitive, potentially multi-label citation interpretation.[^32] MIR supports a distinct methodological-inspiration task, with a computational-linguistics dataset and citation-derived limitations.[^33] The proposed implementation should expose inspiration separately from closest prior work. A useful transferred mechanism may justify reading without implying that it anticipates the focal contribution.

### Memory and synthesis research does not validate discovery recall

PaperWeaver’s study of 15 CS graduate researchers supports contextual explanations of paper alerts. Its short, controlled interaction study is more directly about understanding recommendations than measuring whether all close papers were found.[^34] VANI should evaluate whether relationship cards help a researcher make a correct decision, not merely whether the cards sound informative.

HippoRAG 2 motivates graph-assisted retrieval over stored knowledge; GraphRAG explores corpus-level synthesis through graph structure and community summaries.[^35][^43] They support experiments for collection memory. They do not justify building expensive generated graphs over all 20,000 D0 candidates. Unassessed metadata and validated comparative evidence should have different eligibility for memory answers.

OpenScholar provides stronger evidence for grounded scientific synthesis, with a scientific retrieval system and ScholarQABench.[^36] Bright-Pro evaluates retrieval through complementary reasoning aspects and its role inside agentic workflows.[^37] The transferable requirement is to measure retrieval, evidence coverage and answer support separately. A successful answer on the papers VANI already has cannot demonstrate that D0 found the missing competitor.

The earlier corpus therefore supports the architecture’s decomposition. It does not settle the feature weights, the D1 promotion threshold, the relative benefit of PPR, the local model choice or the automatic-learning gates. Those remain experiments.

## Findings from the design review

| Finding                                                       | Assessment of the current design                                            | Suggested change                                                                                       |
| ------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Explicit focus, candidate staging and no automatic seed drift | Strong; preserves research intent.                                          | Keep, while distinguishing bounded expansion eligibility from focal-seed status.                       |
| Independent proximity, role, confidence, influence and depth  | Strong and central to trust.                                                | Add a separately stored experimental-comparability result.                                             |
| Assumptions, experiments and artifact lineage                 | Present in CA05/CA06/CA21, largely P1.                                      | Promote the minimum domain schema and typed artifact identities to P0; defer expensive extraction.     |
| Broad hybrid retrieval                                        | Sound, but lacks a detailed curated-source contract.                        | Add attributed article-to-paper leads and source/facet coverage records.                               |
| D1 on the local model for up to 2,000 papers                  | Broad coverage is desirable; unconditional generation may dominate latency. | Introduce non-generative D1a and selective generative D1b within D1.                                   |
| Evaluation                                                    | Good task separation, baselines and leakage awareness.                      | Add cheap personalized-learning baselines, protocol fixtures and cumulative holdout-exposure controls. |
| CA35 audits                                                   | Already handles unjudged records, rejected controls and independent probes. | Specify semantic-audit coverage, reference-label independence and repeated-test governance.            |
| Queryable memory and incremental refresh                      | Strong evidence/version foundations.                                        | Add artifact dependencies and source-change-triggered reassessment.                                    |

These are refinements to an already detailed design. Creating a second feature for every existing concept would make the specification harder to implement. The proposed changes below extend the existing CA identifiers.

## Proposed updates and acceptance criteria

### R1 — Domain profiles and explicit comparability

Extend CA01–CA06, CA14 and CA29. Add a versioned domain profile with generic contribution facets and optional CV/ML/robotics fields. Promote the minimum assumption and experiment schemas to P0. Store `comparison_status` as `compatible`, `qualified`, `incompatible` or `unknown`, always relative to a named comparison question and protocol revision. A paper pair can have several experiment-level comparisons.

A compatible status requires evidence for the dimensions material to the claim. Unknown details must not be filled from convention. A performance difference requires compatible metrics, units, splits and conditions, or a clearly qualified author-reported comparison. A conceptually close paper remains close when its experiment is incompatible; the displayed performance comparison is withheld or qualified.

Acceptance: two papers using the same benchmark name but different splits cannot produce an unqualified superiority claim. A same-mechanism paper with different hardware remains discoverable. A multi-contribution paper can be close on one facet and distant on another. Every decisive difference links to its evidence.

### R2 — Attributable discovery and artifact lineage

Extend CA09, CA15, CA21, CA23–CA25 and CA33. Add typed artifacts for papers, versions, repositories/releases, datasets, checkpoints, project pages and curated articles. Distinguish `describes`, `implements`, `trained_on`, `evaluated_on`, `extends` and `discovered_via`. Preserve source snapshots or hashes, dates and identifiers. Resolve ambiguity without merging on title alone.

A curated article can suggest a paper, alias or taxonomy. Its discovery edge does not directly confer proximity, primary-source support or independent corroboration. An assessed paper can become a bounded expansion source without changing focal seeds. Track paper families and evidence families separately: an experiment can span several artifacts, and a journal extension can contain genuinely new results.

Acceptance: a lab post, paper and repository describing one experiment count as one evidentiary origin. Updating a dataset or checkpoint marks dependent comparisons stale, not the entire collection. A newly found reference enters normal screening even when its source article is trusted by the user.

### R3 — Coverage-aware search frontiers

Extend CA08–CA12, CA24, CA26, CA32 and CA33. Persist a coverage ledger by source, query, facet and expansion depth. Record available results, retrieved unique works, missing abstracts/references, unresolved identities, rate limits, cursor state, truncation and marginal discoveries. Unknown provider totals remain unknown. Retain first-seen, publication, revision and retrieval dates independently.

A refresh can pause because its budget expired, its frontier is exhausted or a source is unavailable. Those are different states. Low recent yield can inform scheduling, but does not prove exhaustive recall. Resume unfinished work instead of resetting quotas on every click. Keep independent discovery probes and a protected route for recent, low-citation and different-terminology work.

Acceptance: a source outage does not produce a confident “no new related papers” claim. Zero-citation works can advance through text evidence. Historical evaluation never uses a later citation edge, source revision or artifact release. If a historical source snapshot is unavailable, report that the replay is approximate.

### R4 — Broad D1 coverage with less generation

Extend CA27–CA28 and LM-R01. Preserve the 20,000/2,000/40/10 ceilings. Within D1, use **D1a** for local reranking, cached facets and a lightweight personalized classifier when labels justify one; use **D1b** for compact generative facet extraction on ambiguous, promising or exploration-selected candidates. These are internal substeps, not additional proximity tiers. Up to 2,000 unique candidates receive D1 screening; count D1b generation separately and never present a D1a-only record as a model-written assessment.

The scale matters even without cloud fees. At a hypothetical 768 generated output tokens for each of 2,000 candidates, D1 would emit 1,536,000 tokens. At hypothetical sustained generation rates of 30, 50 or 100 tokens/second, output generation alone would take approximately 14.2, 8.5 or 4.3 hours. These are arithmetic sensitivity examples, not RTX 5090 benchmarks; prefill, retries and model loading add work. Shorter actual outputs reduce it.

Use measured workstation time, queue latency and recall at equal cost to choose the split. Non-generative scores cannot fabricate contribution explanations. Uncertain D1a cases remain eligible for D1b or review; preserve exploration and measure false dismissals. Cache keys include paper, focus, representation and policy revisions. Accepted papers still receive local PDFs where obtainable and contribution summaries under the existing ingestion requirement.

The 40 D2 and 10 D3 limits constrain completed reading, not the number of potentially close works. Retain a ranked `needs_evidence` backlog when more papers deserve examination. Budget exhaustion must never become an out-of-scope label. Measure how often the early-stage expansion produces more unresolved close candidates than later stages can process, and report backlog age and recall under the actual budget.

Acceptance: compare the split against generative D1 on identical judged candidates, including low-ranked controls. It must preserve the agreed recall gates and report cost/coverage tradeoffs. Cloud stays governed by the router; F44 conversations remain local-only. An unavailable local model yields deferred work, not an implicit cloud fallback.

### R5 — Learning audits that can falsify their own assumptions

Extend CA31, CA34 and CA35. Preserve the three-day D0/D1 sweep, calendar-month D2/D3 sweep, quiet-window scheduling, resource limits, stronger local reasoning configuration, checkpoints and rollback. Separate full record-level coverage from fresh semantic rejudgment and reuse of previously validated evidence.

ASReview and arxiv-sanity-lite motivate inexpensive learned ordering, while recommendation-feedback research demonstrates how training on algorithm-shaped observations can produce confounding.[^38][^15][^39] VANI’s final admitted set is therefore an outcome to examine, not a label source to trust automatically. Record why feedback was given: wrong topic, wrong role, weaker contribution overlap, incompatible protocol, duplicate, already known or simply not a reading priority. The last two are not relevance negatives.

Keep tuning examples, diagnostic challenge sets and protected promotion evaluations distinct. A fixed human-reviewed challenge set is useful for regression diagnosis; once its detailed failures inform a proposal, it is no longer an untouched holdout. Record every evaluation exposure, rotate prospective evaluation cohorts, group related papers and use a predeclared repeated-testing policy. The adaptive-data-analysis literature explains why naive repeated reuse can overfit even an initially held-out dataset.[^40]

Stratified controls must retain their sampling probabilities. Weighted population estimates require an appropriate sampling analysis, and should be suppressed when coverage is inadequate. A stronger model’s agreement is not independent human verification. Keep source-grounded model judgments provisional, report performance on human-adjudicated pairs separately, and do not let a model rewrite its own grading rubric.

The current minimum of 50 resolved pairs and 10 closest relationships is a feasibility floor, not proof that small improvements are detectable. Limited labels may justify reports and shadow proposals for many cycles without automatic promotion. For screening completeness within a frozen pool, investigate random-sample stopping methods such as Callaghan and Müller-Hansen’s; their assumptions do not extend automatically to changing web discovery or noisy model labels.[^41]

Acceptance: a rejected close paper can be recovered independently; absence from the final set never creates a negative label; repeated tuning on a reused holdout blocks an unqualified promotion claim. Every run reports metadata coverage, reused judgments, fresh rejudgments, remaining unknowns and label provenance. Policy changes require the existing regression, privacy and budget gates as well as the revised evaluation discipline.

### R6 — A staged evaluation tied to research decisions

Extend CA29–CA30 and CA34. Begin with a manageable pilot across the group’s four areas, for example eight collections with 50–100 pooled candidates each, before the existing broader 30–50-collection benchmark. The pilot is for schema and failure discovery; it is too small to establish universal superiority or justify cross-collection automatic learning.

Include same-topic/different-mechanism negatives, uncited matches, conflicting findings, protocol mismatches, different terminology, shared datasets, version families, inaccessible full text and human-interest signals that are not relevance labels. Use independent second judgments on consequential disagreements. Freeze candidate inputs and record what model pretraining may have seen; a historical graph snapshot alone cannot remove knowledge already present in a language model.

Compare lexical retrieval, scientific embeddings, a TF–IDF/SVM or embedding/linear feedback baseline, coupling, PPR, hybrid retrieval, targeted context and the D1 split. Evaluate three separate tasks: discovering useful candidates; correctly classifying proximity, role and comparability; and answering questions from stored evidence. Retain the existing proposed precision/recall gates, but report sample size, uncertainty, judgment coverage and performance by stratum. Measure reading effort saved at matched quality, not just fewer generated tokens.

Report cumulative recovery from discovery through the final supported assessment, alongside conditional recall at each gate. Illustratively, three successive gates each retaining 90% of the remaining relevant works retain only 72.9% overall. This is arithmetic, not an observed VANI result. D0 pool recall alone can hide later false dismissals. D3 coverage should be measured separately because not every correctly identified close paper needs a dossier.

Acceptance: relationship cards must help researchers identify the right baseline or explain a meaningful difference. They should survive author/venue perturbations, expose unavailable evidence and answer historical “why included?” questions accurately. Advanced graph or reasoning components graduate only after showing incremental benefit over the cheaper baseline.

## Recommended implementation order

First implement the evaluation fixtures, explicit focus, candidate staging and minimum domain/artifact schemas. Build lexical/scientific retrieval and basic graph features with complete discovery provenance. Establish the D1a/D1b cost and recall baseline on the workstation, while preserving the broad ceilings. Extract focal-paper citation and baseline contexts early because one focal read can identify many useful candidates.

Next add D2 experiment comparisons and evidence-linked cards, followed by selective D3 dossiers and local collection queries. Introduce curated-source ingestion as a bounded discovery adapter, with article bibliographies and artifact links entering normal screening. Add coverage and source-change reporting before claiming that refresh or audit completion means the collection is current.

Finally enable read-only periodic audit reports, offline policy proposals, shadow evaluation and gated adaptation. Keep node-split graphs, learned intent diffusion, cross-collection transfer and model fine-tuning as later experiments. The durable result should be a research record that explains which contributions connect, under what conditions, through which evidence and with which unresolved questions.

## Sources

The sources below distinguish practitioner guidance, product documentation and original research. Undated documentation was accessed September 13, 2026. Publication years describe the cited work, not a search engine’s crawl date.

[^1]: Effortless Academic. [A visual strategy to organize academic reading](https://effortlessacademic.com/a-visual-strategy-to-organize-academic-reading/). April 10, 2025. Practitioner workflow article; not a retrieval evaluation.

[^2]: Hamish, Litmaps. [5 visualisation tools to accelerate your research](https://medium.com/litmaps/5-visualisation-tools-to-accelerate-your-research-f235929a6890). February 17, 2021. Historical vendor article; current tool behavior checked separately.

[^3]: Zotero. [The Basics](https://www.zotero.org/support/quick_start_guide). Official documentation, undated.

[^4]: Mendeley. [Features](https://www.mendeley.com/features/). Official product documentation, undated; import and library behavior, not a ranking specification.

[^5]: Nathan, ResearchRabbit. [How ResearchRabbit uses AI](https://learn.researchrabbit.ai/en/articles/13545485-how-researchrabbit-uses-ai). June 14, 2026. Official explanation of network-based core recommendations.

[^6]: Axton Pitt, Litmaps. [Search Algorithms in Litmaps](https://docs.litmaps.com/en/articles/9029858-search-algorithms-in-litmaps). December 9, 2024. Official disclosure of three retrieval approaches.

[^7]: Connected Papers. [About](https://www.connectedpapers.com/about/). Official algorithm description, undated. Similarity mechanism verified through the indexed official text; direct page extraction returned a JavaScript shell. Exact implementation was not inspected.

[^8]: Semantic Scholar. [Frequently Asked Questions: Research Feeds](https://webflow.semanticscholar.org/faq). Official documentation, undated; embedding-based recommendations and explicit folder feedback.

[^9]: scite. [How do I use the scite report page?](https://scite.ai/blog/how-do-i-use-the-scite-report-page). February 12, 2021. Official explanation of citation context and classifications.

[^10]: Jungwon Byun, Elicit. [Introducing Elicit Systematic Review](https://elicit.com/blog/systematic-review). February 20, 2025. Official workflow introduction; historical numerical limits are not treated as current capabilities.

[^11]: Pradyumna Prasad, Elicit. [Evaluating Elicit’s Systematic Literature Review Capabilities](https://elicit.com/blog/evaluating-elicit-slr). May 6, 2026. Vendor evaluation with methods, denominators and limitations; not an independent robotics benchmark.

[^12]: Claes Wohlin. [Guidelines for Snowballing in Systematic Literature Studies and a Replication in Software Engineering](https://www.wohlin.eu/ease14.pdf). EASE, 2014. Original author-hosted paper; iterative search and starting-set design.

[^13]: Andrej Karpathy. [A Survival Guide to a PhD](https://karpathy.github.io/2016/09/07/phd/). September 7, 2016. First-person research guidance grounded in computer vision and machine learning.

[^14]: Stanford CS230. [Project](https://cs230.stanford.edu/project/). Course guidance, undated. Connects the research question, prior work, data, implementation and evaluation.

[^15]: Andrej Karpathy. [arxiv-sanity-lite](https://github.com/karpathy/arxiv-sanity-lite). Official repository, undated. Describes tag-driven SVM recommendations over TF–IDF abstract features; used as a baseline design reference.

[^16]: Lilian Weng. [Domain Randomization for Sim2Real Transfer](https://lilianweng.github.io/posts/2019-05-05-domain-randomization/). May 5, 2019. Technical synthesis with links to original studies.

[^17]: Lilian Weng. [What are Diffusion Models?](https://lilianweng.github.io/posts/2021-07-11-diffusion-models/). July 11, 2021; explicitly updated through April 13, 2024. Technical taxonomy and methodological connections.

[^18]: Yang Song. [Generative Modeling by Estimating Gradients of the Data Distribution](https://yang-song.net/blog/2021/score/). 2021. Author tutorial on score-based modeling and its connections.

[^19]: Chris Olah, Alexander Mordvintsev and Ludwig Schubert. [Feature Visualization](https://distill.pub/2017/feature-visualization/). Distill, 2017. Technical article organizing visualization approaches and tradeoffs.

[^20]: Cheng Chi and collaborators. [Diffusion Policy: Visuomotor Policy Learning via Action Diffusion](https://diffusion-policy.cs.columbia.edu/). Official project page for RSS 2023 and IJRR 2024 versions, code, data and experiments.

[^21]: Open X-Embodiment Collaboration. [Open X-Embodiment: Robotic Learning Datasets and RT-X Models](https://robotic-transformer-x.github.io/). Official project; 2023 preprint and 2024 conference work. Paper, dataset and implementation links.

[^22]: Kevin Black and collaborators, Physical Intelligence. [π0.5: a VLA with Open-World Generalization](https://www.pi.website/blog/pi05). April 22, 2025. Primary lab article and reported experiments; linked paper supplies fuller methods.

[^23]: Marina Barannikov. [Is using a validation set useful for end-to-end learning in robotics?](https://huggingface.co/blog/m1b/validation-loss-robotics). December 1, 2024. Author’s experimental community article; conclusions limited to the examined tasks.

[^24]: Haruki Nishimura and Masha Itkina, Toyota Research Institute. [Statistical Thinking for Robot Policy Evaluation: From Rigorous A/B Testing to Effective Visualization](https://medium.com/toyotaresearch/statistical-thinking-for-robot-policy-evaluation-from-rigorous-a-b-testing-to-effective-0ae886fbd68d). March 6, 2026. Primary research article explaining evaluation practice and the authors’ sequential-testing work.

[^25]: Steven Palma and collaborators. [LeRobot v0.6.0: Imagine, Evaluate, Improve](https://huggingface.co/blog/lerobot-release-v060). July 7, 2026. Official release article; implementation and evaluation integration claims are release-specific.

[^26]: Dylan Walker, Huafeng Xie, Koon-Kiu Yan and Sergei Maslov. [Ranking Scientific Publications Using a Simple Model of Network Traffic](https://arxiv.org/abs/physics/0612122). 2006 preprint; Journal of Statistical Mechanics, 2007. CiteRank.

[^27]: Manuel S. Mariani, Matúš Medo and Yi-Cheng Zhang. [Identification of milestone papers through time-balanced network centrality](https://arxiv.org/abs/1608.08414). 2016. Rescaled PageRank and milestone identification.

[^28]: Jinhyuk Yun. [Generalization of bibliographic coupling and co-citation using the node split network](https://arxiv.org/abs/2110.15513). 2021 preprint; 2022 publication cited in the core design. Structural similarities, not project-specific relevance labels.

[^29]: Sheshera Mysore, Arman Cohan and Tom Hope. [Multi-Vector Models with Textual Guidance for Fine-Grained Scientific Document Similarity](https://aclanthology.org/2022.naacl-main.331/). NAACL, 2022. ASPIRE.

[^30]: Amanpreet Singh and collaborators. [SciRepEval: A Multi-Format Benchmark for Scientific Document Representations](https://aclanthology.org/2023.emnlp-main.338/). EMNLP, 2023. SPECTER2 and task-format evaluation.

[^31]: Sheshera Mysore, Tim O’Gorman, Andrew McCallum and Hamed Zamani. [CSFCube — A Test Collection of Computer Science Research Articles for Faceted Query by Example](https://arxiv.org/abs/2103.12906). NeurIPS Datasets and Benchmarks, 2021.

[^32]: Arman Cohan and collaborators. [Structural Scaffolds for Citation Intent Classification in Scientific Publications](https://aclanthology.org/N19-1361/). NAACL, 2019, SciCite. Also Anne Lauscher and collaborators, [MultiCite: Modeling realistic citations requires moving beyond the single-sentence single-label setting](https://aclanthology.org/2022.naacl-main.137/), NAACL, 2022. Sources also examined in the original core literature review.

[^33]: Aniketh Garikaparthi and collaborators. [MIR: Methodology Inspiration Retrieval for Scientific Research Problems](https://aclanthology.org/2025.acl-long.1390/). ACL, 2025. Original research on methodological inspiration; domain-transfer limits remain relevant.

[^34]: Yoonjoo Lee and collaborators. [PaperWeaver: Enriching Topical Paper Alerts by Contextualizing Recommended Papers with User-collected Papers](https://arxiv.org/html/2403.02939v1). CHI, 2024. Original system and user study; 15 CS graduate researchers.

[^35]: Bernal Jiménez Gutiérrez and collaborators. [From RAG to Memory: Non-Parametric Continual Learning for Large Language Models](https://proceedings.mlr.press/v267/gutierrez25a.html). ICML, 2025. HippoRAG 2; memory/retrieval evaluation.

[^36]: Akari Asai and collaborators. [Synthesizing scientific literature with retrieval-augmented language models](https://www.nature.com/articles/s41586-025-10072-4). Nature 650, 857–863, 2026. OpenScholar; this report uses the published version rather than mixing preprint metrics.

[^37]: Yilun Zhao and collaborators. [Rethinking Reasoning-Intensive Retrieval: Evaluating and Advancing Retrievers in Agentic Search Systems](https://aclanthology.org/2026.acl-long.1705/). ACL, July 2026. Bright-Pro.

[^38]: ASReview team. [Paper introducing the ASReview project](https://asreview.nl/project/intro_paper_asreview/). Official account of the 2021 open-source active-learning research; linked Nature Machine Intelligence paper.

[^39]: Allison J. B. Chaney, Brandon M. Stewart and Barbara E. Engelhardt. [How Algorithmic Confounding in Recommendation Systems Increases Homogeneity and Decreases Utility](https://arxiv.org/abs/1710.11214). 2017 preprint; RecSys, 2018. Simulation evidence about recommendation feedback loops.

[^40]: Preetum Nakkiran and Jarosław Błasiok. [The Generic Holdout: Preventing False-Discoveries in Adaptive Data Science](https://arxiv.org/abs/1809.05596). 2018. Adaptive evaluation and limited holdout exposure; VANI’s operational controls require their own validation.

[^41]: Max W. Callaghan and Finn Müller-Hansen. [Statistical stopping criteria for automated screening in systematic reviews](https://link.springer.com/article/10.1186/s13643-020-01521-4). Systematic Reviews 9, 273, November 28, 2020. Random-sampling stopping criteria for a finite screening pool.

[^42]: Tuan Anh Phan and Jason J. Jung. [Leveraging citation intent for publication relatedness](https://link.springer.com/article/10.1007/s10791-026-09995-x). Discover Computing, February 16, 2026. Citation-intent graph construction evaluated through cluster coherence.

[^43]: Darren Edge and collaborators. [From Local to Global: A Graph RAG Approach to Query-Focused Summarization](https://arxiv.org/abs/2404.16130). 2024. GraphRAG; also covered in the original core literature review.
