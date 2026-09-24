# Sort recommendations by metadata ranking

Add a Sort by control alongside the recommendation view selector. Choices: current view ranking (the existing default), metadata ranking highest first, and metadata ranking lowest first. Metadata ranking is the stored broad discovery score, not a probability or the separate Sanity second-pass score.

Apply sorting on the API before pagination, within the selected view. Sorting must not change shortlist membership, feedback, saved papers, or start a rerank. Missing scores go last in either direction; paper ID breaks ties deterministically. Validate the sort parameter against a fixed enum and preserve existing behavior when omitted.

Changing sort returns to page one and uses a separate query-cache key. When sorting by metadata, show the metadata score prominently; retain the separate Sanity explanations. Verify opposite sort directions across multiple pages and verify the UI sends the selected sort and resets pagination. Run relevant checks, commit and push on the experiment branch.
