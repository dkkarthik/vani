# Sanity shortlist: a second local relevance pass

## Problem and scope

The first discovery experiment already uses TF-IDF and a linear SVM, but publishes
up to 500 candidates without a relevance gate. GoLF's full abstract contains both
representation methods and social-navigation applications; either can dominate
lexical matching. Repeating the same ranker or reducing the page size does not
address this.

Add an opt-in second pass on `codex/simple-discovery-inbox`. Keep broad retrieval,
its model, source provenance and results intact. Leave D0–D3 reasoning untouched
and disabled in the local sandbox. No network requests, PDFs, GPU, or generative
model calls belong to this pass.

The researcher has selected **adaptive spatial representations, meshes, and
graph construction** as GoLF's priority. A collection-specific local focus field
will make this preference explicit. It is never sent to scholarly providers.

## Algorithm

1. Fit sparse unigram/bigram TF-IDF on the retained local corpus, including seed
   papers and explicit feedback. Normalize accents/case and English plural forms,
   remove stop words and numeric PDF extraction artifacts, use logarithmic TF,
   smoothed IDF and L2 normalization. Authors are excluded.
2. Follow Sanity Lite's discriminative feature selection: 20,000 features,
   minimum document frequency 5 and maximum frequency 10%. For corpora below 100
   documents, use minimum 1 and maximum 80%. Explicit local-focus terms may
   survive the upper frequency ceiling because VANI's query-selected corpus is
   narrower than Lite's category-wide corpus. Persist the actual bounds.
3. Fit a class-balanced, L2-regularized, squared-hinge linear SVM with `C=0.01`
   against the whole bounded background, rather than the first pass's 1,500-paper
   sample and fixed 80 gradient steps. Use deterministic dual coordinate descent,
   a regularized intercept, convergence diagnostics, and a bounded iteration
   budget. Explicit thumbs-down examples receive more weight than unreviewed
   background. Persist the actual model and solver diagnostics.
   Empty vectors do not enter fitting; an unusable positive example must never
   become a negative training label.
4. When a local focus is supplied, multiply matching TF-IDF features by 3 before
   normalization, and require at least two distinct focus-word matches for an
   unreviewed candidate to enter the shortlist. Match English plural variants.
   This is an explicit VANI preference extension, not a claim that upstream Lite
   interprets natural-language instructions. Notes remain uninterpreted.
   An optional editable list of required context terms/phrases adds an OR gate:
   at least one must occur in title/abstract. This keeps generic uses of
   "adaptive graph" from satisfying a spatial-representation focus on their own.
   For the GoLF trial, use mesh, occupancy, discretization, grid, spatial map,
   topological map, roadmap, floor plan, octree and quadtree. This lexical gate is
   a VANI extension and does not establish semantic compatibility.
5. Score the first pass's broad candidate set. A candidate must have a nonzero
   feature vector and share discriminative features with a positive example.
   Rank eligible papers by the new SVM margin and retain at most 30 by default
   (configurable 5–100). Explicit positive judgments bypass the focus/overlap gate
   but remain subject to the display limit; negative judgments remain dismissed.
   The limit is a maximum, not a target. Never fill an empty shortlist with
   unrelated papers. There is no probability or scientific-relevance claim.
6. Persist each candidate's decision, reason, margin, nearest positive example,
   weighted overlap, matched focus terms and top model contributions. Distinguish
   insufficient feature overlap, focus mismatch, negative feedback and outside
   the shortlist limit. A missing positive example or failed convergence yields
   a visible unavailable state, not a fabricated relevance verdict.

This is an independent TypeScript implementation of the same linear-SVM
objective, not a scikit-learn byte-for-byte port. The focus weighting, explicit
negatives, author omission, small-corpus rule and shortlist gate are VANI
extensions. Sources: [Lite feature extraction](https://github.com/karpathy/arxiv-sanity-lite/blob/d7a303b410b0246fbd19087e37f1885f7ca8a9dc/compute.py),
[Lite SVM](https://github.com/karpathy/arxiv-sanity-lite/blob/d7a303b410b0246fbd19087e37f1885f7ca8a9dc/serve.py#L120),
[LinearSVC objective and class weights](https://scikit-learn.org/stable/modules/generated/sklearn.svm.LinearSVC.html).

## State, API and UI

- Add defaulted `shortlist` settings: enabled, maximum papers, local focus and
  optional required context phrases.
  Existing profiles remain readable. Explicit activation updates settings with
  optimistic version checks and queues a local rerank; it must not cancel a
  running source refresh.
- A separate **Refine with Sanity** action opens the focus/limit controls and
  enables the pass. Once enabled, ordinary feedback reranks both models. On a
  source refresh, the second pass waits for source tasks to finish before fitting.
- Store results under the existing per-collection model and recommendation JSON,
  with version/status, counts, fingerprints and label/settings freshness checks.
  No public shared-corpus record stores private seed/focus text or feedback.
- Default the enabled collection's view to **Sanity shortlist**. Keep **Broad
  recommendations**, **Filtered by Sanity**, **Saved** and **Dismissed** views.
  Show broad-to-shortlist counts, local focus and whether only one positive
  example is available. Cards expose the second-pass explanation.
- A shortlist requires a current completed second-pass model. During refresh,
  show that it is being rebuilt and let the researcher inspect broad results.
  Concurrent settings/feedback changes cannot publish a stale shortlist.
- Filtering does not delete records, add collection members, rewrite public
  queries, or trigger deeper reading. Saving and feedback use existing paths.

## Verification

- Unit tests: solver convergence against an independent reference objective;
  deterministic order; frequency/stop-word/plural handling; method-focus examples
  outrank generic application examples; explicit negatives and reversed feedback;
  no positives, no overlap and a limit that never forces admission.
- API/database tests: defaulted old settings, retained broad results, filter views
  and reasons, feedback recomputation, active-refresh protection, no extra provider
  or model calls, no new core/enrichment work.
- UI tests and browser check: activate/save local focus, select shortlist/broad/
  filtered views, inspect reasons and continue existing thumbs/save interactions.
- GoLF sandbox: record before/after ranking, sizes and source/model/core counters;
  inspect the resulting titles without claiming measured precision before user
  relevance labels exist. Preserve all existing user judgments and membership.
