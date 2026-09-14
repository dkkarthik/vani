# VANI 1.0 implementation contract

This release adopts the core algorithm, CA35 learning audits, LM-R01, F43/F44 and review amendments R1–R6. Existing libraries are migrated additively; saved membership and historical admission reasons are preserved. Experimental research variants (node-split graphs, model fine-tuning and cross-collection transfer) remain evaluation-gated experiments, as specified in the core design.

## Delivery

- Versioned focus and explicit anchors; candidate staging with replayable discovery provenance; lexical, local semantic and typed graph ranking; bounded D1a/D1b, D2 evidence comparisons and D3 dossiers; separate proximity, role, comparability, influence and depth.
- Persist source snapshots, candidate decisions, assessments, artifact links and policy versions. Source/focus changes invalidate dependent decisions. No model-only unsupported relationship may become a verified fact.
- Shared local-first inference with bounded context/output, one active GPU job, cancellation, task provenance and local embeddings. Conversations are always local-only, scoped server-side and grounded in original evidence.
- Three-day and monthly full-record audit sweeps, selective stronger-model reassessment, rejected controls, independent probes, quiet-window scheduling, evaluation-gated policy proposals and rollback. Model labels remain provisional; insufficient human judgments prevent automatic adaptation.
- Ubuntu dependency diagnostics/install/resume with safe configuration parsing, preserved credentials/data, backups before migrations, loopback services and explicit hardware acceptance results. Check and dry-run modes are read-only.
- Collection UI exposes focus, candidates, evidence, reading backlog and audits; Settings exposes system/model health.

## Verification

Pure algorithm fixtures cover graph directions, dangling nodes, no-citation semantic matches, missing evidence, protocol mismatch, source validation and deterministic budgets. Router tests verify local-only dispatch, hosted-model rejection, output limits and failures. Database integration tests cover migration, resume, stale focus, acceptance/history and scope. Installer fixture tests cover argument validation, read-only modes and paths containing spaces. Existing application checks remain required.

Actual Ubuntu/systemd installation and RTX 5090 throughput/residency must be tested on the target hardware. Local development verification cannot certify those results; the release guide records the distinction. Runtime readiness never implies empirical validation of ranking accuracy. Automatic admission/learning must remain gated by the documented evidence and evaluation requirements.

## Implemented release boundary

The executable behavior, API calibration contract, source limits and hardware acceptance checklist are documented in [VANI 1.0 operations](../docs/23-vani-1.0.md). This implementation uses the single-owner native Ubuntu deployment; it does not expose unauthenticated network services. The old container deployment remains a workspace-only path.

D3 is a broader bounded evidence dossier, not certification of complete-paper reading. Monthly audits rejudge deeper decisions, while automatic policy changes currently operate on retrieval weights. Changes to deep-reading prompts, model parameters, global literature recall and cross-collection transfer require additional empirical evaluation. The implementation does not represent those research gates as already passed.
