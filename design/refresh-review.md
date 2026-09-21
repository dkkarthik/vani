# Deep refresh review and researcher feedback

## Goal

Every refresh has a durable, collection-scoped record of candidate decisions. Researchers can inspect the funnel, revisit discarded papers, give a quick relevance judgment, explain it, and refine subsequent searches without paying for another model call for every click.

## Run history

Migration 018 snapshots each candidate per run and records meaningful state transitions. Moving a candidate into a later run must not rewrite the earlier run. Retrieval paths belong to the run in which retrieval occurred; retained candidates are explicitly distinguished. Snapshots retain paper metadata, ranking features (excluding vectors), assessment, errors, and feedback at decision time. Existing records are backfilled as partial history, never reconstructed as complete historical traces.

The UI offers paginated run history, stage-visited and outcome filters, title search, per-stage counts, and a paper timeline. Outcomes distinguish relevance rejection, structural exclusion, budget deferral, missing evidence, failure, acceptance, and pending review. Source/query paths, ranking scores, model assessments, and validation diagnostics remain inspectable. An empty run and a paused/failed run are visible, including source coverage and errors.

## Feedback

Thumbs up means related; thumbs down means out of scope for this collection. Either can be saved without an explanation. An optional explanation can be saved with the judgment; clear removes its current effect while retaining audit history. Feedback from a historic run targets that collection's canonical candidate, with the originating run recorded. Feedback never silently admits a paper, bypasses evidence checks, restarts a paused run, or invokes a cloud model.

On subsequent ranking, exact judgments receive a bounded score adjustment; related papers receive a smaller adjustment based on text overlap with up to 100 recent labeled examples. Baseline score, adjustment, and influencing candidate IDs are retained. Explanations enter a bounded local D1 comparison context as researcher preferences, never as evidence. Negative feedback must not suppress an entire research area; structural eligibility and coverage exploration remain intact. Existing gated policy audits continue independently.

## Search refinement

The review UI loads the saved public queries and accepts an explicit revised query list. A local-only, on-demand model can propose revised queries from recent feedback, paper titles, explanations, and the current focus. The proposal is editable and has no effect until Apply. Applying uses the existing optimistic-version focus save, preserving all other focus settings. Explain that approved queries are public discovery inputs. No private feedback is sent to scholarly sources automatically. No automatic rerun; use Deep refresh after applying.

## Verification

Test immutable run history across refreshes, per-run discovery paths, meaningful transition capture, legacy partial history, scope checks, feedback save/clear and provenance, bounded ranking influence, local proposal routing, pagination/filtering, UI feedback and query editing, and all existing regression checks. Run database integration checks in the isolated quasar environment. Record limitations and deployment revision in the operator docs.
