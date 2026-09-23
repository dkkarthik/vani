# How Karpathy’s arXiv Sanity finds related papers

Source-code review, 23 September 2026.

## Main finding

arXiv Sanity is a content-based recommendation system built around **TF-IDF text features and linear support-vector machines (SVMs)**. Its effectiveness comes from ingesting a broad paper stream, letting researchers provide inexpensive examples of their interests, and repeatedly ranking the indexed corpus. It does not use a language model to read every candidate, and its relevance rankers do not construct a citation graph or run PageRank.

There are two distinct official implementations. The original **arxiv-sanity-preserver** uses extracted PDF text, precomputed cosine neighbors, and personalized SVM recommendations. The rewrite, **arxiv-sanity-lite**, uses metadata text and tag-specific SVMs. Crucially, Lite’s single-paper similarity view also trains an SVM; it is not simply cosine similarity to that paper.

For VANI, the strongest lesson is to add an inexpensive, inspectable relevance learner before expensive evidence reading. This is a candidate-ranking technique, not a replacement for scientific comparison or evidence validation.

## 1. Scope, downloaded sources, and verification

I downloaded the two official repositories, inspected their ingestion, feature extraction, serving, recommendation, feedback, and email paths, and pinned this review to these commits:

| Repository                                                                                                                          | Reviewed commit                            | Commit date |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ----------- |
| [karpathy/arxiv-sanity-preserver](https://github.com/karpathy/arxiv-sanity-preserver/tree/17b2c281b55574135bda9b9710e4706dee6d652b) | `17b2c281b55574135bda9b9710e4706dee6d652b` | 2021-11-27  |
| [karpathy/arxiv-sanity-lite](https://github.com/karpathy/arxiv-sanity-lite/tree/d7a303b410b0246fbd19087e37f1885f7ca8a9dc)           | `d7a303b410b0246fbd19087e37f1885f7ca8a9dc` | 2022-02-13  |

Complete shallow clones, including licenses and Git metadata, are retained locally under `.vani-diagnostics/research/arxiv-sanity/{preserver,lite}`. They are intentionally outside VANI’s tracked implementation. Source links below use immutable commit URLs.

This is a source audit, not a measured recommendation-quality benchmark or an assertion about the implementation currently running behind a public website. I did not start either upstream web server, run its ingestion against arXiv, or send email. I executed Lite’s original keyword-search function in isolation with synthetic metadata to verify its matching behavior. The probe output is retained alongside the clones in `search-probe.json`. SVM and feature-extraction behavior below is established from source inspection, not a newly run training experiment.

## 2. Discovery comes before relevance ranking

### Lite’s corpus

The ingestion daemon requests arXiv categories `cs.CV`, `cs.LG`, `cs.CL`, `cs.AI`, `cs.NE`, and `cs.RO`. These are a fixed, broad feed, not queries generated for each user’s tags. The API helper requests batches of 100, sorted by `lastUpdatedDate`. Records are keyed by the version-independent arXiv ID; a record replaces the existing entry when its update timestamp is newer. The daemon defaults to 100 records per invocation; the documented operational command requests 2,000. Repeated scheduled invocations accumulate the local corpus. These batch limits are not a claim that the entire historical literature is indexed. [Ingestion daemon](https://github.com/karpathy/arxiv-sanity-lite/blob/d7a303b410b0246fbd19087e37f1885f7ca8a9dc/arxiv_daemon.py), [API helper](https://github.com/karpathy/arxiv-sanity-lite/blob/d7a303b410b0246fbd19087e37f1885f7ca8a9dc/aslite/arxiv.py), [update commands](https://github.com/karpathy/arxiv-sanity-lite/blob/d7a303b410b0246fbd19087e37f1885f7ca8a9dc/Makefile).

The original defaults to a similar feed but includes `stat.ML` instead of `cs.RO`. Its category query is configurable on the command line. These differences matter for robotics and for methods appearing in numerical analysis or scientific computing. Neither default is an exhaustive scholarly discovery policy. [Original fetcher](https://github.com/karpathy/arxiv-sanity-preserver/blob/17b2c281b55574135bda9b9710e4706dee6d652b/fetch_papers.py).

**Implication:** a tag can reorder only papers already in the feature index. It cannot discover an unindexed paper merely because the paper would be relevant. VANI must evaluate corpus coverage separately from ranking quality.

### Operational edge cases in Lite

The daemon exits early when its first batch contains no new IDs, and otherwise can stop after three consecutive batches with no new IDs. Replacement-only batches still count as having no new papers for this stopping rule. Also, the retry loop exits only when a response contains exactly 100 papers. A valid short response can therefore cause repeated requests; the exception retry counter does not bound that path. These are code-level ingestion risks, not evidence that the public service suffered a particular outage. A production implementation should accept short terminal pages, distinguish updates from genuinely unchanged batches, and use a durable ingestion cursor. [Daemon loop](https://github.com/karpathy/arxiv-sanity-lite/blob/d7a303b410b0246fbd19087e37f1885f7ca8a9dc/arxiv_daemon.py#L49).

## 3. What represents a paper?

### Lite: title + abstract + author names

Despite shorthand descriptions referring to abstracts, `compute.py` concatenates the **title, abstract (`summary`), and all author names**. It does not put category labels, extracted citations, affiliations, or PDF body text into this feature vector. All three included fields share the same bag of words; there are no separately calibrated author and content channels. [Feature extraction](https://github.com/karpathy/arxiv-sanity-lite/blob/d7a303b410b0246fbd19087e37f1885f7ca8a9dc/compute.py#L25).

The defaults are:

| Setting                    | Lite                                                                                         |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| Features                   | Unigrams and bigrams                                                                         |
| Maximum vocabulary         | 20,000 features                                                                              |
| Minimum document frequency | 5 documents                                                                                  |
| Maximum document frequency | 10% of fitted documents                                                                      |
| Processing                 | Lowercase, Unicode accent stripping, English stop words                                      |
| Token pattern              | ASCII letter/underscore first; letters/digits/underscore thereafter; at least two characters |
| Term frequency             | Sublinear: logarithmic rather than raw count                                                 |
| IDF                        | Enabled, smoothed                                                                            |
| Vector normalization       | L2                                                                                           |
| Matrix                     | Sparse, converted to float32                                                                 |
| Fitting corpus             | All papers by default; optional random `max_docs` subset                                     |

Conceptually, a term receives more weight when it is important within a document but relatively uncommon in the fitted corpus. L2 normalization makes vector length comparable across documents. A bigram can preserve a phrase such as “mesh refinement,” although parsing, stop-word removal, and frequency thresholds determine whether it survives.

These settings are consequential. A new acronym appearing in fewer than five documents disappears from the vocabulary. Broad terms occurring in more than 10% of the corpus disappear too. Author-name tokens may survive and become predictive, producing an implicit same-author affinity without any explicit authorship graph. There is no stemming or semantic synonym model in this pipeline.

### Original: extracted full PDF text

The original reads PDF-derived text files and admits only those with more than 1,000 and fewer than 500,000 characters. It fits a vocabulary on at most 5,000 shuffled documents, using random seed 1337, and transforms all qualifying documents. It uses at most 5,000 unigram/bigram features, `min_df=1`, `max_df=1.0`, logarithmic TF, smoothed IDF, and L2 normalization. [Original analysis](https://github.com/karpathy/arxiv-sanity-preserver/blob/17b2c281b55574135bda9b9710e4706dee6d652b/analyze.py).

This exposes methods, experiments, and references to the ranker, but only as undifferentiated text. Bibliographic overlap can influence similarity through shared words; it is not parsed co-citation or bibliographic coupling. PDF extraction errors and common boilerplate can also affect the representation. Papers without qualifying extracted text cannot participate in this feature-based ranking.

## 4. How “related to this paper” is computed

### Original: cosine nearest neighbors

The original converts its TF-IDF matrix to dense form and computes dot products in query batches of 200. Since vectors are L2-normalized, dot products equal cosine similarity. For each paper it stores the first 50 IDs in descending similarity order. The seed itself is not explicitly excluded from that list; a nonzero seed normally ranks at the top, subject to ties. The server retrieves this cached list and can fall back to the indexed version when an older version URL is used. [Neighbor computation](https://github.com/karpathy/arxiv-sanity-preserver/blob/17b2c281b55574135bda9b9710e4706dee6d652b/analyze.py#L87), [similar-paper serving](https://github.com/karpathy/arxiv-sanity-preserver/blob/17b2c281b55574135bda9b9710e4706dee6d652b/serve.py#L98).

This asks: **which papers share the seed’s weighted vocabulary?** It is simple and explainable, but no relationship such as “extends,” “compares against,” or “uses the same experimental protocol” is inferred explicitly.

### Lite: one-positive SVM

Lite labels the selected paper positive and every other indexed paper negative, fits a linear SVM, and ranks the entire corpus by its decision function. This asks a different question: **which papers share the features that distinguish this seed from the corpus background?** Shared generic vocabulary may be less discriminative than in a direct cosine-neighbor view. The two methods are not mathematically interchangeable. [Lite `svm_rank`](https://github.com/karpathy/arxiv-sanity-lite/blob/d7a303b410b0246fbd19087e37f1885f7ca8a9dc/serve.py#L120).

## 5. Personalized recommendations and feedback

### Training labels

The original trains one SVM per user, using saved-library papers as positives. Lite trains from one selected tag, the union of selected tags, or the union of all tags. Multiple tags are therefore useful for separating research interests, but choosing several tags constructs a union of positives, not an intersection of their meanings.

In both systems, all other indexed papers receive the negative training label. **Not saved is treated as negative, even though it usually means not yet reviewed.** This is a practical implicit-feedback heuristic, not a clean dataset of explicit relevant and irrelevant judgments. [Original SVM training](https://github.com/karpathy/arxiv-sanity-preserver/blob/17b2c281b55574135bda9b9710e4706dee6d652b/buildsvm.py), [Lite tag training](https://github.com/karpathy/arxiv-sanity-lite/blob/d7a303b410b0246fbd19087e37f1885f7ca8a9dc/serve.py#L120).

### Classifier and score

Both use `LinearSVC`, balanced class weights, up to 10,000 iterations, and tolerance `1e-6`. The original uses `C=0.1`; Lite defaults to `C=0.01` and exposes C through the web interface. Smaller C means stronger regularization. Balanced class weighting helps prevent thousands of background examples from overwhelming a handful of positive examples.

The ranking score is:

`score(paper) = w · TFIDF(paper) + b`

Lite multiplies this decision-function value by 100 for display. **It is not a percentage probability of relevance.** Scores from independently trained tags are not automatically calibrated against each other.

The original saves up to 1,000 ranked IDs per user in a batch-generated cache, then excludes library papers and applies recency filters when serving recommendations. Consequently, a recent paper outside the cached global top 1,000 cannot appear merely by selecting a short date window. Lite’s web path trains on request, scores all feature-indexed papers, then filters and paginates. Tag edits thus affect the next ranking request, assuming the feature index contains those papers; there is no incremental online-learning state carried from the preceding fit.

### What feedback can and cannot express

Adding/removing tags changes membership in the positive set. There is no explicit collection-specific thumbs-down training set or free-text explanation channel in the reviewed ranker. Removing a positive makes it background again. Tag names are selectors, not semantic prompts: the learner sees the tagged papers, not an instruction encoded in the tag’s name.

This is particularly relevant to VANI’s new feedback UI. Explicit negative examples and explanations contain information that arXiv Sanity’s basic learner does not have.

## 6. Keyword search is a separate algorithm

Lite’s search box does not transform the query into TF-IDF or train the SVM. For each whitespace-separated query fragment it adds:

- 20 points if the fragment occurs anywhere in the title;
- 10 points if it occurs anywhere in the concatenated author names;
- up to 3 points for its occurrence count in the abstract.

Matching is lowercase substring matching. Any fragment can produce a result; it is effectively OR-like retrieval, not an all-terms requirement. There is no phrase parser, BM25, embedding query, or citation-aware expansion in this function. A nonempty search-box query overrides the selected recommendation ranking mode. [Lite search and dispatch](https://github.com/karpathy/arxiv-sanity-lite/blob/d7a303b410b0246fbd19087e37f1885f7ca8a9dc/serve.py#L172).

I verified this using the unchanged function extracted from its syntax tree. For query `mesh missingterm`, fixtures scored 20 for a title containing “mesh,” 20 for “Meshing tools,” 10 for an author named “Mesh Person,” and 3 for an abstract containing “mesh” four times. None contained “missingterm,” yet all were returned. This validates mechanics only, not real-paper quality.

The original has a different metadata search score: title, author, and category tokens contribute fixed weights, while abstract tokens use fitted IDF where available. A tiny recency boost breaks close scores. A subtle source detail: although title construction passes `scale=3`, its `forceidf=5` branch ignores scale, so title tokens receive 5, not 15. Both implementations scan their corpus structures rather than implementing a modern inverted-index search engine. [Original search cache](https://github.com/karpathy/arxiv-sanity-preserver/blob/17b2c281b55574135bda9b9710e4706dee6d652b/make_cache.py), [original query scoring](https://github.com/karpathy/arxiv-sanity-preserver/blob/17b2c281b55574135bda9b9710e4706dee6d652b/serve.py#L83).

## 7. Explanation, recency, popularity, and email

**Explanations:** Lite exposes the 40 largest positive and 20 most negative SVM feature weights. It also has an inspection page showing a paper’s nonzero TF-IDF terms, weights, and IDFs. These are excellent debugging affordances. However, global feature weights are not a paper-specific scientific explanation. The natural extension is to show each candidate’s actual contributions `w_j × x_j`, together with supporting text and separate evidence-based comparisons. [SVM feature display and inspection](https://github.com/karpathy/arxiv-sanity-lite/blob/d7a303b410b0246fbd19087e37f1885f7ca8a9dc/serve.py#L159).

**Recency:** Lite filters on the record’s arXiv update timestamp, so an old paper with a new version can count as recent. The original recommendation filter uses publication time. Neither inserts a learned temporal relevance term into the SVM itself.

**Popularity:** the original has separate rankings based on the number of user libraries containing each paper and a separate Twitter popularity path. Those are not collaborative-filtering components of its personalized SVM. Similar-user behavior, follower graphs, and popularity are not features in the reviewed SVM training code. [Original popularity routes](https://github.com/karpathy/arxiv-sanity-preserver/blob/17b2c281b55574135bda9b9710e4706dee6d652b/serve.py#L392).

**Email:** Lite trains one SVM per tag, filters to recent papers (default three days), removes papers saved under any of the user’s tags, merges duplicates using the maximum score across tags, and sends up to 20 recommendations by default. This differs from the web view’s single SVM over a union of selected tags. Taking maximum uncalibrated margins can favor tags whose classifiers produce larger score ranges. [Email calculation and merge](https://github.com/karpathy/arxiv-sanity-lite/blob/d7a303b410b0246fbd19087e37f1885f7ca8a9dc/send_emails.py#L82).

## 8. Compute cost and operational tradeoffs

Lite’s ranking requires sparse text features and CPU-based linear classification, with no cloud tokens and no GPU model calls. It refits features when the operator runs `compute.py`; it refits the SVM for a ranking request. The feature matrix is loaded from a pickle file inside that request path. This is much cheaper conceptually than generative comparison of every paper, but actual latency and memory should be benchmarked at VANI’s corpus size rather than inferred from a historical hosting claim.

The original’s dense all-paper cosine computation has approximately quadratic dependence on the number of papers for all-pairs comparisons. Batching limits intermediate memory, not total arithmetic. It also densifies the feature matrix for user SVM training. VANI should preserve sparse operations and avoid copying that all-pairs design.

Lite can download PDFs for thumbnails, but that separate daemon uses temporary PDFs, renders images, and deletes the temporary PDF. The recommendation path does not depend on full-text reading, and this is not a persistent PDF archive. [Thumbnail daemon](https://github.com/karpathy/arxiv-sanity-lite/blob/d7a303b410b0246fbd19087e37f1885f7ca8a9dc/thumb_daemon.py).

Feature publication is atomic at the pickle-file level, but metadata/tag updates and the feature index are separate. A tagged paper absent from the current feature matrix can cause an unguarded ID lookup failure. Dataset generation IDs and guarded lookups would be needed for robust production use. Also, the checked-in dependency pins are historical; this audit does not establish that installing them unchanged is appropriate today. [Storage](https://github.com/karpathy/arxiv-sanity-lite/blob/d7a303b410b0246fbd19087e37f1885f7ca8a9dc/aslite/db.py), [dependency pins](https://github.com/karpathy/arxiv-sanity-lite/blob/d7a303b410b0246fbd19087e37f1885f7ca8a9dc/requirements.txt).

## 9. What it misses for CV, robotics, and embodied AI

These are implications of the inspected representation and objective, not measured failure rates:

1. **Different words for related ideas.** Adaptive resolution, hierarchical discretization, octrees, sparse maps, and adaptive mesh refinement can describe neighboring ideas while sharing few retained tokens. Lexical methods alone may miss the bridge.
2. **Same application, different contribution.** Many navigation papers mention robots, terrain, and planning while solving different problems. Text affinity does not establish methodological proximity.
3. **Same method, incompatible experiment.** The model does not explicitly distinguish sensing assumptions, online versus offline operation, compute budgets, simulator versus hardware, locomotion platforms, or evaluation protocols.
4. **Author shortcuts.** Author-name features can promote a familiar group’s less relevant work. Names are not disambiguated researcher identities or evidence of contribution overlap.
5. **References without relationships.** Shared reference text in the original is not an extracted “uses as baseline” or “extends” relation. Lite omits reference text entirely from its feature construction.
6. **Implicit-negative bias.** Undiscovered relevant papers are part of the negative training set. A narrow positive set can encourage narrow recommendations; neither implementation supplies a measured recall guarantee.
7. **No scientific acceptance gate.** A high SVM margin does not show that a paper was read, its claim verified, or its contribution compared against an anchor.

## 10. Recommendations for VANI

These are proposed changes, not implemented as part of this review.

### A. Add a cheap collection learner to D1a

Build a sparse title/abstract TF-IDF index and train a small regularized linear classifier for each collection. Use seed papers and explicit positive judgments as positives, explicit negative judgments as negatives, and a separately identified, lower-weight or sampled unlabeled background. Do not describe unlabeled papers as human rejections.

This would be a more expressive local feedback mechanism than VANI’s current bounded lexical score adjustment: the classifier can learn discriminative combinations of features from examples. It should complement the existing semantic, graph, and facet signals, with the baseline and learned contribution logged separately.

### B. Keep retrieval broad and diverse

A cheap ranker cannot repair an absent candidate. Combine broad arXiv category ingestion, collection public queries, semantic retrieval, and citation/author expansion. For GoLF-like interests, assess coverage of numerical methods and scientific computing as well as CV/robotics. Evaluate category additions against actual target papers before widening the feed indiscriminately.

Keep separate retrieval/ranking channels and combine them using rank fusion or calibrated scores. Reserve an exploration quota for candidates missed by the learned classifier. Do not let a tiny training set veto every other discovery route.

### C. Learn separate facets instead of one undifferentiated collection

Use subtopics such as adaptive discretization, sparse spatial representations, or traversability as separate profiles where appropriate. Compare per-facet rankings and explain which facet retrieved a paper. Lite’s tags motivate this design, but raw maximum SVM scores across facets should not be assumed comparable.

### D. Make score explanations actionable

For each candidate, show the most influential positive/negative term contributions, the supporting field or text, and which feedback examples influenced training. Keep authorship as a distinct, capped feature rather than mixing names into scientific vocabulary. Allow a researcher to say that a term is misleading for this collection. Preserve model version, feature-corpus version, label provenance, and the ranking snapshot in VANI’s refresh history.

### E. Reserve generative reading for candidates whose decisions need it

Run sparse and embedding-based ranking over the broad candidate set; use D1b/D2/D3 for ambiguous, promising, or deliberately exploratory papers. Keep the exact-evidence gate. A classifier’s confident score is not permission to fabricate a paper summary or skip contribution verification.

### F. Cache and evaluate before automatic promotion

Retrain a collection classifier when its labels materially change or when a new feature generation is published; cache by collection, label version, and feature generation. Use stable feature generations to avoid changing vocabularies mid-run.

Compare current VANI ranking, cosine TF-IDF, positive/background SVM, and explicit-feedback learning on the same frozen candidate pool. Measure held-out recall at D1/D2 budgets, precision among deeply read papers, cross-facet coverage, false rejection rate, latency, and GPU reading time. Hold out versions and closely related paper families together to reduce leakage. Include uncaptured target papers in a separate discovery-coverage audit, since ranker evaluation alone cannot measure retrieval omissions.

**Recommended first experiment:** shadow-rank the locomotion and GoLF candidate pools with a sparse collection SVM, expose its term contributions in the existing review UI, and collect real judgments before allowing it to change admission or reading budgets. This imports arXiv Sanity’s strongest idea while preserving VANI’s richer evidence and feedback model.
