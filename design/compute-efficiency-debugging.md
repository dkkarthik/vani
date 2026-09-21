# Evidence-driven compute control and failure debugging

## Problem

Quasar produced roughly 60 D2 calls/hour but only two accepted comparisons. Failed
papers were retried three times and re-enabled by every refresh, even when inputs
were unchanged. Invocation `complete` meant valid JSON, not valid scientific
evidence. Broad retrieval ceilings accidentally became expensive reading targets.

## Implementation specification

1. Keep strict evidence validation. Return every failing rule with a stable code
   and JSON field path (unknown source/anchor/facet, quote mismatch, missing
   candidate/anchor evidence, relationship reference). Never repair a quote by
   pretending a paraphrase is verbatim.
2. Persist a local attempt record before generation: candidate/run/stage, model
   digest, prompt/schema version, exact bounded evidence packet, input fingerprint,
   raw response (bounded), parsed output, validation issues, invocation identity,
   token count, latency and outcome. Interrupted attempts are visible. Full text
   stays local and is fetched only on explicit diagnostic detail/export requests.
3. Fingerprint actual model inputs, model digest, limits, schema and prompt version.
   A rejected deterministic result or two failed calls exhaust that fingerprint
   across refreshes. Changed evidence, focus, model or prompt permits a new trial.
   Operator-requested targeted re-read may explicitly bypass this gate once;
   ordinary refresh and daily scheduling cannot. Legacy exhausted attempts remain
   quarantined until deliberate re-read or changed paper/focus; no mass retry on
   upgrade. Successful existing assessments remain reusable.
4. Batch control: pause after five consecutive rejected/failed attempts, or at least
   eight failures in the last ten attempts; also bound each stage to a measured
   wave (default D1=40, D2=10, D3=3 model calls). These are incremental compute
   budgets, distinct from broad retrieval/ranking ceilings. Scheduler and ordinary
   refresh do not resume a protected pause. Explicit next-wave action starts a new
   measurement window without deleting failure history or resetting fingerprints.
5. Collection UI: display attempts, accepted assessments, validity rate, model
   minutes, tokens, issue counts and cost per accepted assessment by stage; expose
   pause/resume-wave and wave budgets. Candidate detail shows attempt diagnostics.
   A passed JSON invocation is never presented as a passed comparison.
6. Replay CLI: export selected attempt packets to private local files over the
   existing SSH channel; offline revalidate without model calls; optionally rerun a
   bounded packet set against the isolated local model using original/concise
   non-thinking profiles. Record paired validity, issue deltas, latency and tokens.
   Never mutate production or auto-promote a cheaper profile based on validity
   alone. Researcher labels and a held-out relevance set are required to lower
   retrieval/reading ceilings without sacrificing useful-paper recall.
7. Retention: full packets retained for the latest 20 attempts per candidate, while
   compact attempt metadata and durable fingerprint gates remain; raw output capped at
   65,536 characters with truncation flag; packet inputs are bounded by existing reader
   packing. Full packets are excluded from normal collection responses and logs.

## Verification and rollout

Unit tests exercise validation codes, gate fingerprints and circuit decisions.
Database integrations exercise persistence, refresh stability, changed inputs,
explicit override and protected pause/resume. Quasar uses isolated regression and
small real-model replay before production update. Pause the currently wasteful
reading job during investigation, leave collection data intact, and keep it paused
through deployment until an explicit measured wave is requested. Record baseline
and paired replay outcomes; distinguish evidence validity from scientific quality.
