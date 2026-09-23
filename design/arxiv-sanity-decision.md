# VANI versus arXiv Sanity: architectural decision assessment

23 September 2026. Analysis only; no ranking, collection, or deployment settings changed.

## Recommendation

Shift VANI's primary user experience and first-pass ranking toward **Sanity Lite's model: maintain a broad paper corpus, learn each collection's interests cheaply, and display ranked recommendations immediately**. Preserve VANI's collections, private seeds, feedback, PDFs, provenance, and optional deeper comparisons. Do not replace the application wholesale with either historical repository, and do not preserve the present pipeline merely because it is more elaborate.

This is a substantial simplification: useful discovery results must no longer depend on successful generative reading, PDF availability, or an evaluated automatic-admission policy. Whether sparse SVM ranking actually beats VANI's current ranking remains an empirical question; source inspection does not establish that.

## What “nothing added” tells us

VANI currently distinguishes candidates from collection members. The code defaults to review mode. Its automatic-admission path requires automatic mode, a non-null policy ID, a non-canary candidate, and an assessment identifying it as related or closest. Manual acceptance is available and bypasses the automatic evidence gate, although structural exclusions and stale focus still prevent acceptance. See `apps/api/src/core/service.ts`, `acceptCandidate` and the end of `readingStep`.

This design does not meet the expectation that a daily refresh visibly fills a collection with useful new papers. It also means that zero added papers is not, by itself, proof that retrieval found no relevant work.

The last verified production snapshot, on 22 September, contained 4,286 locomotion candidates and 6,790 GoLF candidates. Locomotion was held paused; GoLF was awaiting evidence. Locomotion's backfilled summary included 583 missing-evidence and 126 failure records; GoLF included 51 and 84 respectively. These are partial historical snapshots, not a new relevance audit or measured retrieval recall. They establish that many records were captured, not that those records were useful.

An attempted SSH inspection on 23 September timed out. Those figures and statuses must not be described as freshly verified today. The code-level admission and PDF dependencies were checked locally for this assessment.

Three separate problems require separate measurements:

1. **Coverage:** did discovery retrieve papers that should have been considered?
2. **Ranking and reading:** did useful candidates rise high enough, and did assessment complete?
3. **Presentation and membership:** were the papers made visible and added according to the intended workflow?

Changing the ranker alone cannot fix all three. Merely enabling automatic mode also cannot resolve missing policies, failed reading, absent PDFs, or poor relevance.

## Side-by-side comparison

| Dimension                   | VANI today                                                                                                                                       | Original Sanity Preserver                                       | Sanity Lite                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Primary output              | Evidence-bearing candidate assessments plus curated membership                                                                                   | Similar-paper lists and library-based recommendations           | Immediate ranked recommendations from papers or tags                             |
| Candidate acquisition       | Core refresh starts with public OpenAlex/Crossref queries and public anchor expansion                                                            | Broad configurable arXiv category feed                          | Broad fixed arXiv category feed                                                  |
| Cheap relevance signals     | Lexical, embeddings, graph walks, author overlap, bounded feedback adjustment                                                                    | Full-text TF-IDF, cosine neighbors, library SVM                 | Metadata TF-IDF and tag/paper SVM                                                |
| Full-text dependency        | Local PDF required for targeted D2 comparison                                                                                                    | PDF extraction needed for feature-based recommendations         | No PDF dependency for recommendations                                            |
| User learning               | Explicit positive/negative labels and explanations; current score adaptation is a bounded lexical heuristic, with separate gated audit machinery | Saved library defines positives                                 | Tags define positives and can separate interests                                 |
| Unreviewed papers           | Distinct candidate states and feedback provenance                                                                                                | Used as negative SVM examples                                   | Used as negative SVM examples                                                    |
| Cross-vocabulary potential  | Embeddings and citation structure can bridge different terminology, when inputs are available                                                    | Limited; full text may expose shared terms                      | Limited to retained title/abstract/author vocabulary                             |
| Scientific comparison       | Designed to compare contribution, anchors, roles and experimental compatibility                                                                  | None explicitly                                                 | None explicitly                                                                  |
| Explanation                 | Provenance, evidence, source paths and refresh history; more detailed but more fragile                                                           | Primarily similarity/recommendation results                     | Inspectable vocabulary weights; not scientific evidence                          |
| Compute burden              | Local embeddings plus generative reading, multiple workers and data dependencies                                                                 | PDF processing and dense all-pairs similarity plus SVM training | Sparse text features and CPU linear classification                               |
| Operational burden          | Highest of these implementations                                                                                                                 | Batch scripts, PDF tooling, caches; historical code             | Smallest design, but still historical code with ingestion/index-consistency gaps |
| Automatic library additions | Deliberately gated; review mode does not add automatically                                                                                       | Recommendations are separate from saved library                 | Recommendations are separate from tags/saved papers                              |

Source details and immutable code links are in [the source analysis](arxiv-sanity-source-analysis.md). Architectural advantages are capabilities or plausible benefits, not demonstrated quality superiority.

## VANI: advantages worth preserving

- **Fits a broader research workflow.** Private manuscripts, seed PDFs, public links, saved documents, notes and durable collection context matter to this use case.
- **Can recognize non-lexical relationships.** Embedding and graph signals can help when closely related methods use different terminology. This is especially relevant to GoLF's links to sparse representations and adaptive discretization.
- **Can explain scientific proximity.** Evidence-based comparisons can distinguish shared application words from shared methodological contributions and identify experimental incompatibilities.
- **Has richer human feedback.** Explicit negative judgments and natural-language explanations carry information beyond a saved-paper label.
- **Now has useful diagnostics.** Candidate histories and reading-attempt records support auditing and replay.

## VANI: disadvantages we should address directly

- **Too many dependencies precede a useful result.** PDF preparation, model calls, structured output, evidence validation, budgets, pauses, and admission rules can each block progress.
- **Its visible output does not match the requested behavior.** Thousands of candidates behind a review panel are not a successful daily literature service when the collection still appears unchanged.
- **Compute has not translated reliably into utility.** Earlier quasar debugging showed repeated evidence-validation failures and substantial GPU work with little accepted assessment output. More reading calls are not a substitute for a productive pipeline.
- **Learning is weaker than the surrounding architecture suggests.** Today's quick-feedback score adjustment is not a trained per-collection classifier. Free-text feedback is available to screening and query proposals, but this does not establish that ranking improves measurably with use.
- **Complexity complicates diagnosis.** Empty membership can arise from retrieval, prioritization, evidence access, model validation, policy configuration, or simply review mode.
- **There is no demonstrated relevance advantage.** The implemented sophistication should earn its place through comparison with simple baselines.

## Original Sanity Preserver: pros and cons

**Pros:** a straightforward cosine-neighbor baseline; full paper text can reveal techniques absent from abstracts; library examples train personalized relevance; no generative inference or GPU is required by the ranker; it offers independently useful recommendation and popularity views.

**Cons:** its recommendation features depend on successful PDF extraction, retaining one of VANI's troublesome dependencies; dense all-pairs similarity scales poorly; full text mixes contributions with boilerplate and reference lists; a single library-level profile can blend unrelated interests; recommendations are batch-generated; the reviewed repository is old; it lacks explicit negative feedback, private-seed comparison, scientific evidence validation, and the newer diagnostic workflow.

**Assessment:** worthwhile as a baseline, but a poor replacement architecture for VANI. It reduces model complexity while preserving PDF-processing and batch-pipeline complexity.

## Sanity Lite: pros and cons

**Pros:** title/abstract-based recommendations can appear before any PDF succeeds; sparse linear ranking is cheap and inspectable; tag-specific learning aligns naturally with collections; adding examples directly changes the next classifier fit; broad feed ingestion avoids repeatedly relying solely on narrow collection queries; ranked recommendations can be useful without claiming a paper was deeply understood.

**Cons:** terminology and category coverage bound recall; authors are mixed into scientific text; unreviewed papers are treated as negatives; one or a few seeds can produce a narrow profile; there are no explicit citation relationships or experimental compatibility checks; SVM margins are not calibrated probabilities; the historical code needs operational modernization; it does not automatically add recommendations to a saved collection; no evidence yet shows that its rankings are better on these two collections.

**Assessment:** the best foundation of the three for dependable daily discovery. Adopt the design, then validate the ranker. Copying the old application verbatim would lose useful VANI functionality without proving better relevance.

## Proposed replacement for the critical path

1. **Ingest broadly into a shared corpus.** Cover the relevant arXiv categories, supplement with other sources, and measure missed known papers independently of ranking.
2. **Rank cheaply per collection.** Start with TF-IDF cosine and a regularized linear classifier; compare them with embeddings and a small fused ranking. Separate explicit negative labels from unlabeled background.
3. **Publish a visible collection inbox immediately.** Show ranked papers, abstracts, links, discovery reasons, and reading status. An unavailable PDF must not hide an otherwise useful recommendation.
4. **Make membership semantics explicit.** Recommended papers populate the collection's inbox automatically. Saving or confirming them is a separate action. If automatic saving is desired, make it a clear collection setting; do not imply that recommendation alone is verified inclusion.
5. **Enrich asynchronously.** Download PDFs and produce deeper comparisons afterward. Show unavailable, pending, and completed states. Never label an abstract as a full-paper summary.
6. **Learn cheaply from feedback.** Cache collection classifiers by label and feature generation; avoid a model call on every thumbs-up/down. Use explanations to refine facets or reviewed public queries.
7. **Deep-read only where valuable.** Prioritize saved papers, likely closest work, uncertain disagreements, and explicit requests. Keep evidence validation for claims about a paper, not as a prerequisite for displaying it.

The existing application, storage and review interface can support this redesign. The change should remove mandatory steps from the discovery path rather than add another scorer to an otherwise unchanged series of gates.

## Evidence needed before choosing the winner

Freeze a corpus and assemble a small judged set for each collection, including papers the researcher expected but VANI missed. Compare the current ranker, original-style cosine, Lite-style SVM, and a simple hybrid. Use separate training and evaluation labels; hold related versions together. Measure:

- known-paper retrieval coverage before ranking;
- relevant papers among the top 20 and top 50 recommendations;
- recall of held-out relevant candidates at the reading budget;
- time to first visible recommendations;
- GPU/model time per useful paper;
- proportion of recommendations hidden or delayed by processing failures.

A hybrid wins only if its extra signals improve results enough to justify their maintenance and computation. The default decision should favor the simplest system that reliably surfaces useful papers.
