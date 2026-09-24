# Stable recommendation review and sorting

## Findings

The current metadata-descending API response and visible GoLF list are descending numerically. Scores are signed classifier margins: -0.39 is greater than -0.45. Three-decimal display hides small differences, and sort state was lost on reload. More seriously, feedback increments the label revision and enqueues reranking; until that finishes, the shortlist endpoint returns no current items. Rendering that intermediate empty list collapses the page, moving the reader to the bottom. Saving also removes the acted-on card and changes page geometry.

## Required behavior

- Persist the chosen sort per collection in this browser; label signed score ordering clearly and show six decimal places for metadata scores. Server-side sorting before pagination remains authoritative; do not convert scores to absolute values or probabilities.
- Freeze the current review page before a feedback/save request. Preserve card order, scores, expanded details, typed notes, keyboard focus and scroll position. On success, update the acted-on card's saved/feedback state in place. On error retain the page and expose the error.
- Continue polling and learning in the background. Offer an explicit Show updated ranking action when a fresh ranking is ready. While pending, explain that the current review order is being retained. Applying the new ranking resets to page one and intentionally takes the reader to the recommendation controls.
- Switching view, sort or page explicitly ends the held review page. Never transfer held data across collections. Do not overwrite actual user feedback during verification; test mutations in a separate disposable collection/database.
- Regression tests cover a populated shortlist becoming temporarily empty during reranking, completed rankings changing order, successful save/feedback state updates, a failed action, persistent sort choice, and explicit application of a fresh ranking. Verify browser scroll/focus using an isolated test fixture.
