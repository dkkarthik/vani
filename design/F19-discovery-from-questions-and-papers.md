# F19 — Discovery from questions and papers

Status: Implemented. This specification was written before implementation.

See [Connected research guide](../docs/18-connected-research.md) for setup, limits and validation.

## Intended outcome

Search a question/topic and multiple DOI/OpenAlex/local-paper seeds, expand references and citing works, exclude terms/identifiers and see provider coverage and failures.

## Interaction design

Discovery explorer accepts optional topic and <=5 seeds, direction (seed only/references/citing/both), source checkboxes, exclusions and optional destination collection. Results explain provider/seed/direction, mark existing library items and let users import deliberately. Provider failure appears alongside partial results.

## Persistence and API

POST /knowledge/discovery uses existing Crossref/OpenAlex adapters plus OpenAlex single-work/filtered-neighbor endpoints with fixed hosts/timeouts. Store run input/results/coverage and imported direct citation evidence; POST /knowledge/discovery/:runId/import chooses result IDs. References limited20 and citing20 per seed; no exhaustive claim. OPENALEX_API_KEY optional, surfaced errors. No background subscription added.

## Acceptance and verification

Mock providers verify DOI/multi-seed resolution, reference and citing direction, exclusions, partial outages and coverage. Repeated import resolves existing works and retains only genuine provider-sourced citation edges. Invalid seed never causes arbitrary URL fetch.

Use integration tests against disposable PostgreSQL for persistence, validation and concurrency. Use browser workflows for editing, navigation and reload. Preserve F01–F10 data and stable source IDs. All mutations report errors without discarding the draft. Lists expose their bounds; this remains a local single-user workspace.

## Delivery boundaries

No cloud synchronization, collaborative editing or model download is introduced. External discovery runs only when requested. Source text, user interpretation, computed association and reviewed suggestion retain separate provenance. See the implementation guide for operational limits and validation results.
