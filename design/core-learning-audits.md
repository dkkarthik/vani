# CA35 — Periodic learning audits for the core algorithm

Status: **planned; not implemented**. This feature extends the [core algorithm](core-algorithm.md) and [local-model plan](local-model-deployment.md). It increases early-stage coverage and improves stage policies through recurring evidence-based audits. No scheduled job or automation is installed by this specification.

## 1. Broader discovery with bounded local work

Raise the initial manual-refresh ceilings from 2,000 to **20,000 unique D0 candidates**, and from 200 to **2,000 D1 assessments** per collection refresh frontier. Keep **40 D2 targeted readings and 10 new D3 dossiers** as initial main-pipeline ceilings. These are starting configuration values to benchmark, not a requirement to fill every tier or a promise that every refresh finishes immediately.

D0 uses local graph/embedding calculations without per-paper generative calls. D1 uses the local model with thinking disabled and compact structured output. Preserve channel quotas and reserve an initial 10% of D1 capacity for exploration across uncited work, unusual terminology and underrepresented facets. Selection probabilities and channel membership must be logged where randomized sampling is used.

Repeated refresh clicks resume/coalesce the same frontier rather than resetting allowances. CPU/GPU time, network requests, download bytes, token limits and installation-wide concurrency remain enforced. Large frontiers can complete across several idle periods, with outstanding counts visible. Daily refresh processes new/changed evidence under shared resource budgets; it does not repeat 20,000 candidates per collection every day.

## 2. Two audit cadences

| Audit             | Cadence              | Complete coverage                                                                                                                              | Main learning objective                                                                                  |
| ----------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Early-stage audit | Every 3 days         | Every retained D0 candidate and D1 assessment for each active collection, including papers that never advanced, were rejected or were deferred | Improve candidate discovery and the decision to spend D2 reading effort.                                 |
| Deep-stage audit  | Every calendar month | Every retained D2 reading and D3 dossier for each active collection, including demoted, rejected and incomplete assessments                    | Improve evidence selection, proximity judgments, deep-reading allocation and the usefulness of dossiers. |

These are per-collection logical cadences coordinated by a single installation scheduler. Monthly means the next calendar-month anniversary in the configured timezone, clamped to the month's last day when necessary. Persist the next due time and coalesce missed runs after downtime. Due means eligible to queue, not permission to interrupt active work.

Each run freezes its collection focus, corpus and policy snapshot. Papers arriving during a run enter the next snapshot. A completed sweep records the audit status of every snapshot member. Checkpoint or defer work when budgets expire; show incomplete coverage and audit age. Do not mark a sampled subset as a completed full audit. User-removed content is not retained or restored merely for auditing; authorized historical metadata can carry a tombstone.

## 3. Audit all records without rereading every PDF

The full early sweep compares each D0/D1 record with the current evidence-supported related/closest set and its contribution facets. Recompute inexpensive similarity, discovery-channel and rank/promotion diagnostics; inspect missing evidence, original inclusion predictions and subsequent decisions. Record which reference-set revision was used.

The reference set is a **provisional comparison target**, not ground truth. Preserve separate background, related and closest roles. A paper absent from that set is unjudged until evidence establishes otherwise. User-confirmed corrections and independently supported source comparisons carry more weight than automatic admission. Multiple generated summaries of the same underlying evidence do not create independent labels.

Route cases to deeper audit when there is a material mismatch, uncertainty, inconsistent evidence, changed source, or a likely missed neighbor. Also select stratified/random controls from rejected, low-ranked and unadvanced papers. Start with a maximum of 100 substantive re-evaluations per early audit, reserving at least 25 for those controls. The counts are ceilings within a separate audit budget; unresolved records remain visible rather than being classified as failures automatically.

For audit cases, retrieve original passages and locally reassess the actual problem, mechanism, contribution and conditions. Record whether D0 found the work through an appropriate channel, whether D1 would have promoted it, and what downstream reading revealed. A same-keyword distractor and a genuine methodological match must remain distinct even if both share authors.

Auditing the retrieved pool cannot expose all literature missing from D0. Include a bounded independent discovery probe using a different channel/query mix and references or baselines of supported close works. These probe candidates enter D0 normally; finding them does not bypass assessment. Report pool recall and probe discoveries separately, without claiming exhaustive literature recall.

Monthly audits apply an evidence/consistency check to every D2/D3 record. Inspect whether selected passages were sufficient, baseline protocols actually matched, decisive limitations were missed, and D3 added useful information beyond D2. Reuse unchanged validated artifacts when the audit criteria permit; rejudge changed, conflicting or weak dossiers with the reasoning model, plus a stratified control sample. Record reused and freshly judged coverage separately. Budget an initial 50 deeper rejudgments, with at least 10 controls, and carry excess flagged work forward explicitly.

Routine unchanged discovery refreshes still require zero generative calls. An explicitly due learning audit is separate work and may deliberately re-evaluate unchanged evidence within its own budget.

## 4. What the system can learn

| Stage | Adjustable policy                                                                                                 | Evidence driving adjustment                                                                                             |
| ----- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| D0    | Query expansions, channel quotas, facet weights, graph-neighborhood exploration and author-channel caps           | Which channels discover useful neighbors, independent-probe misses, duplicate/redundant retrieval and neglected facets. |
| D1    | Problem/method/contribution feature weights, reranking configuration, extraction prompts and promotion thresholds | False dismissals, unnecessary promotions, source-supported contribution differences and missing-data handling.          |
| D2    | Passage retrieval/reranking, citation-context windows, baseline linking and uncertainty triggers                  | Important evidence found later, incorrectly compared experiments, unsupported relationships and avoidable extra reads.  |
| D3    | Dossier schema, comparison prompts, source coverage checks, stopping rules and effort allocation                  | Whether deep reading resolves uncertainty, corrects a decision or produces reusable supported findings.                 |

Initial learning updates **retrieval/ranking configurations and validated prompt versions**, not the language model's weights. Model fine-tuning is a later experiment requiring a separate curated dataset and evaluation. A stronger reasoning model helps diagnose errors and propose changes, but does not directly rewrite production code or its own acceptance tests.

Keep learning collection-specific first. Never automatically promote discovered papers to focal seeds, change the research question, reintroduce explicitly removed keywords, remove explicit exclusions, overwrite human judgments, weaken privacy rules, raise cloud caps or equate popularity with closeness. Cross-collection transfer requires separate evidence that the change generalizes. A changed user focus is a new learning context, not proof the earlier policy was wrong.

## 5. Promotion gates and rollback

Every candidate policy is a versioned proposal evaluated against the current policy using identical frozen inputs. Preserve the features available at original discovery time; later evidence may inform labels but must not leak into the historical retriever's inputs. Separate tuning examples from held-out evaluation by focal topic/time, and group paper versions together.

Measure early-stage recovery of judged closest works, precision/yield of D1 promotions, independent-probe misses, facet coverage, latency and cost. For D2/D3 measure supported comparison accuracy, missed decisive evidence, useful uncertainty resolution, dossier utility and cost per useful assessment. Store unknowns separately from negatives and report coverage of judgments. Stratified controls provide a check on selection bias; improvement among advanced papers alone is insufficient.

Before automatic promotion, require an initial minimum of 50 resolved evaluation pairs, including 10 supported closest relationships, and enough coverage to evaluate affected strata. Where evidence is insufficient or contradictory, collect more judgments and retain the current policy. Audit-model judgments remain provisional unless supported by validated source evidence; human corrections take precedence. Report performance on human-reviewed examples separately when available.

Promote only when held-out gains are supported by a paired uncertainty analysis and the change passes core-algorithm recall, grounding, privacy and bias gates without a material regression in an affected group. Start with bounded updates: nonnegative normalized weights, at most 10% of total weight mass redistributed per cycle, fixed budget maxima and a preserved exploration floor. Prompt or model changes require the same evaluation gates as ranking changes.

Run successful proposals in shadow mode before activating them for a limited set of future decisions. Monitor those decisions and automatically restore the prior configuration on a verified regression. Configuration rollback preserves papers, evidence and decision history. Findings can queue reassessment, but cannot silently delete membership or replace its historical admission reason. A policy can remain unchanged after an audit; each run is not required to invent an improvement.

## 6. Reasoning model and workload scheduling

Register `early_stage_audit` and `deep_stage_audit` tasks with **LM-R01**. Give these tasks a stronger reasoning configuration than ordinary D1 screening: use the installed local reader with thinking enabled, bounded evidence packets and evaluation-tested output limits. A separately configured audit model may replace it after demonstrating better judgments and fitting the workstation. Schedule model switching in batches under the same GPU controller.

Cloud remains off by default. If enabled through the router, a stronger cloud reasoning model may judge selected consequential disagreements using minimized eligible evidence. Audit tasks must satisfy the existing privacy, approval and installation-wide budget controls; being an audit does not grant unlimited cloud access. An initial ceiling of two cloud judgments per audit is further constrained by existing daily/monthly limits. F44 conversations remain local-only regardless of audit settings.

Default scheduling proposal: use a configurable 02:00–06:00 workstation-local window and start only after 15 minutes without interactive VANI work. Require no interactive jobs, no overdue higher-priority ingestion/refresh work, low measured GPU activity and sufficient GPU/system-memory headroom. Check resource load from other applications as well as VANI; the clock alone is not an idle signal.

Assign audits the lowest queue priority. Yield between bounded work units as soon as foreground demand appears. Persist partial progress; cancel/checkpoint a long local generation through the router when necessary, without treating a partial answer as validated. If a cloud request has already been dispatched, preserve its accounting and avoid duplicate dispatch on resume. Expose due/deferred/running/paused/complete status and a manual audit control. A manual audit still observes resource and spend limits.

Start with a two GPU-hour allowance per early audit and six GPU-hours per monthly audit, consumed across eligible windows as needed. These are provisional resource budgets, not performance predictions. Keep audit tokens/time separate from normal D2/D3 quotas, while enforcing a shared installation-wide resource/spending ceiling. Prioritize monthly deep-evidence corrections when both audits are due, then let the early audit use that revised evidence set. Persistent starvation produces a visible deferred reason, not an automatic increase in priority over user work.

## 7. Durable outputs and acceptance

Store an `audit_run` with cadence, snapshots, coverage, budget, checkpoints and completion state; an `audit_item` for every covered record; source-backed `audit_judgment` records with provenance and uncertainty; and a `policy_revision` with proposed changes, evaluation split/results, shadow outcomes, activation and rollback lineage. Record sampling probabilities, model/prompt versions and dependencies. Preserve the historical meaning of scores after a policy update.

Each collection gets a readable learning report: papers checked, fresh versus reused judgments, likely misses, unnecessary promotions, unjudged cases, proposal details, held-out results and whether any policy changed. Users can ask the local collection model why a policy changed or why a previous candidate was overlooked, using these stored records.

Acceptance requires:

- All retained D0/D1 items enter each three-day snapshot; all retained D2/D3 items enter each monthly snapshot. Partial sweeps never report full completion.
- A deliberately rejected close paper can be recovered through the control/probe path; a same-topic distractor does not become a negative solely because it is absent from the final set.
- Weak self-generated labels, future-data leakage, insufficient sample size or a regression prevent automatic policy promotion.
- Learned changes preserve explicit seeds, exclusions, human corrections, privacy, cost caps and historical membership reasons.
- Restart, repeated manual triggers and overlapping cadences produce one resumable logical audit and no duplicate paid requests.
- Interactive demand pauses audit work; external GPU use prevents unsafe admission; deferred work and coverage remain visible.
- A successful improvement is versioned and activated through shadow/canary evaluation; a regression restores the prior configuration without losing evidence.

Implement instrumentation and broad budgets first, then read-only audit reports, offline proposal evaluation, shadow learning, and finally gated automatic adaptation. Verify with frozen synthetic and researcher-labeled collections, a controllable clock/queue, failure/restart tests, provider spies and real workstation scheduling measurements. The planned feature must pass these gates before it can autonomously alter live policies.
