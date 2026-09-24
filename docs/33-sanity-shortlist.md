# Sanity shortlist: a second local relevance pass

The discovery experiment now keeps its broad candidate list and adds an optional
**Sanity shortlist**. Its purpose is a small, inspectable reading queue. It does
not claim that the remaining papers are scientifically unrelated.

## Using it

In a collection's Recommended papers panel, choose **Refine with Sanity**.
Enter a **Local relevance focus**, optionally enter **Required context** terms
or phrases (one per line), set the maximum shortlist size, and choose **Save and
refine locally**. All these preferences stay local. Public search queries are
unchanged, and refinement does not fetch new source pages or postpone the next
daily source refresh. Wait for an active refresh to finish before changing the
shortlist preferences.

Once enabled, the default view is **Sanity shortlist**. The other views retain
**Broad recommendations**, **Filtered by Sanity**, **Saved**, and **Dismissed**.
Expand a card's shortlist explanation to see its reason, second-pass score,
focus/context matches, closest positive example and weighted feature terms.
The main score in shortlist/filtered views is the second-pass score; the broad
view retains the original model's score.

Thumbs feedback retrains both models. Saving still adds a collection member
immediately. Nothing starts deep reading or enrichment. A source refresh rebuilds
the shortlist after all bounded source tasks finish; broad results remain
inspectable while this runs. Stale results are withheld if settings or labels
change before publication. Turning off the shortlist restores the broad view.

## What is borrowed from arXiv Sanity

Like [arXiv Sanity Lite](https://github.com/karpathy/arxiv-sanity-lite/blob/d7a303b410b0246fbd19087e37f1885f7ca8a9dc/serve.py#L120),
this pass learns a class-balanced linear SVM from positive examples against the
corpus background. It uses sparse TF-IDF unigrams/bigrams, a 20,000-feature ceiling,
logarithmic TF, smoothed IDF, L2 normalization, `C=0.01`, and common/rare-term
pruning. Unlike VANI's first-pass approximation, it uses the entire bounded
background and solves the regularized squared-hinge objective to a measured
convergence tolerance instead of stopping after 80 gradient steps.

The TypeScript solver is independent of scikit-learn and requires no new Python
ML dependency. Its objective includes a regularized intercept. Unit tests compare
it with an analytical optimum and an independent SciPy optimization of a weighted
asymmetric example. This is not a claim of bitwise parity with upstream software.

VANI-specific additions are deliberate: author tokens are excluded; explicit
negative judgments weigh more than unlabeled background; plural variants match;
local-focus features receive extra weight and survive the upper document-frequency
ceiling; an optional context gate and an adjustable shortlist limit select the
visible set. With fewer than 100 documents, document-frequency pruning is relaxed.
The design and numerical bounds are in [the specification](../design/sanity-shortlist.md).

## GoLF sandbox result

The researcher selected adaptive spatial representations, meshes, and graph
construction as the priority. The trial used local focus terms for those methods
and required at least one of: mesh, occupancy, discretization, grid, spatial map,
topological map, roadmap, floor plan, octree, or quadtree.

| Outcome                                           | Papers |
| ------------------------------------------------- | -----: |
| Broad candidates examined                         |    500 |
| Shortlisted                                       |     30 |
| No required context in available title/abstract   |    429 |
| Too little local-focus overlap                    |     12 |
| No usable discriminative features                 |      1 |
| Passed checks but ranked below the 30-paper limit |     28 |

The model used one positive seed, 2,425 usable background papers and 6,314 features.
Seven corpus records with empty feature vectors were excluded from fitting.
It converged in 389 coordinate-descent passes; the recorded feature/training/scoring
time was approximately 880 ms on the development Mac. This excludes queue,
database publication and UI polling time and is not a hardware-independent SLA.

The pass made **zero additional model invocations or core runs**, preserved the
existing enrichment queue, source queries, feedback and saved membership, and
used already retained metadata. Prior sandbox records still include one failed
synthesis attempt from the earlier seed-upload flow and one queued enrichment
job; those are not new work from this pass.

Verification passed 187 API tests (including database integrations), 21 web tests,
14 extension tests, TypeScript checks, builds and lint. Chrome exercised activation,
focus/context entry, view switching and per-paper explanations with no runtime
errors. Private before/after records and screenshots remain under the ignored
`.vani-diagnostics/simple-discovery/` directory. Quasar production is unchanged.

## Limits to evaluate next

Thirty is a display ceiling, not a precision measurement. This remains a lexical
learner with only one positive paper and no GoLF thumbs labels so far. A paper can
match a term such as "grid" incidentally; a genuinely related paper can use a
synonym absent from the focus list. Metadata-only records without abstracts may
fail a context check. Cross-source publication variants may also remain.

The first pass supplies the candidate set: a relevant paper outside its bounded
list cannot be recovered by this second pass. The shared corpus and broad limits
remain visible and adjustable. The next meaningful evaluation is to label several
close and poor matches, record expected papers, and compare the next shortlist.
The saved notes support that review but are not automatically interpreted by
this classifier. Deep scientific comparisons remain separate work.

## Reviewing without losing your place

Feedback and Save to collection update the card in place. The visible papers and scores stay fixed while the next ranking runs in the background. Choose **Show updated ranking** when ready to load the new order; changing the view, sort, or page also ends the held review. Saved cards stay visible until then.

The sort choice is remembered for each collection in this browser. Metadata scores are signed classifier margins, shown to six decimal places: highest first places −0.39 above −0.45. This ordering applies across the full view before pagination.
