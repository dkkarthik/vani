# Seeded refresh reliability

Implement the failures observed in the first local seeded evaluation without using
reviewer labels that have not been supplied. Preserve raw retrieval and assessment
history; do not silently turn failures into negative relevance judgments.

## Seed preparation

Extract a title and abstract locally from uploaded PDFs before initial ranking.
Use Poppler logical reading order for prose, and first-page word geometry to
identify the title. Respect explicit user titles and publisher metadata; keep
unknown metadata empty and extraction warnings visible. Do not infer dates from
publisher template headers. Reindex existing PDF prose with a versioned extractor
when enrichment is retried. No OCR or external metadata service is required.

## Candidate eligibility and coverage

Before embedding or screening, exclude existing collection members/anchors,
supplementary-file records and confidently identified alternate versions from new
work selection. Retain records with a machine-readable reason and canonical
candidate pointer; never merge unrelated works based on fuzzy title similarity.
Exact normalized title with compatible authors/years or an explicit shared arXiv
identity may establish a version group. Missing-DOI copies can match a supplied
seed by its exact substantive title. Prefer rich abstract/full-text metadata as
the group's representative. Existing-member matching is separate from admission.
Keep all provider paths available and borrow citation metadata from a matched
public record without submitting uploaded text to providers.

Reserve screening slots across explicit problem/method/contribution facets,
retaining both global top matches and deterministic exploration. Store selection
reasons. Ranking scores are not calibrated probabilities.

## Reading and recovery

Complete ready D1 work before D2 and D3. A candidate timeout, invalid schema or
bad quotation must record an error, bounded retries and backoff on that candidate,
allowing peers and other collections to progress. Exhausted retries remain failed,
not irrelevant. Run-wide discovery/ranking failures stay visible as paused runs.
Persist retry state across restart; daily enqueue must not reset a live run.
Terminal candidate failures can be retried in a subsequent daily run. Report
selected, completed, excluded and failed counts separately.

Use task-specific configurable local inference timeouts. D2/D3 have larger budgets
than shallow screening; validation remains mandatory and cloud fallback remains
controlled by the existing router policy. Never bypass evidence checks to finish.

## Deployment and verification

Keep rootless Ubuntu/custom-root installation behavior. Document an update,
reindex/repair and daily enablement procedure for the 5090 desktop. Daily scheduling
must continue even when one collection fails to enqueue. Test metadata extraction,
column reading order, seed/version/supplement exclusion, facet selection, shallow
before-deep scheduling, failed-candidate isolation/retries and restart safety on an
isolated PostgreSQL database. Preserve the original private evaluation snapshot;
rerun with the same seeds and record any remaining model limitations honestly.
