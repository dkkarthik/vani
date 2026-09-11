# Collection keywords and paper inclusion reasons

Select a manual collection. **Collection keywords**, above the upload/link panel, shows the terms used for automatic discovery. Click a keyword's × button to remove it or enter another keyword or phrase with **Add keyword**.

Until you edit them, keywords are derived from the collection's focused topic. Once edited, your list is preserved across focus edits and seed additions. Search queries use that list, and automatic admission requires matches for at least 35% of its keywords in a paper's title or abstract. Matching is case-insensitive and uses whole words/phrases, not semantic inference or stemming.

Removing a keyword means it no longer attracts papers or contributes to their admission score. It does not ban papers that mention it: a paper can still match the remaining keywords. Existing collection members are retained. Removing every keyword pauses automatic discovery; add keywords and enable discovery to resume. Keyword edits affect the next search and reject results from a search using an older keyword revision. Conflicting edits return an error instead of overwriting another change.

Each paper displays **Why this paper**. Automatically discovered papers retain their original query, matched keywords, provider, score and source snippets under **Original discovery evidence**. Uploads, paper links, seed selection, browser capture and manual imports instead identify the user's addition action. Re-importing a member preserves its first recorded reason. Current keyword overlap is displayed separately, so a historical discovery reason does not silently change when you edit the collection.

Existing papers added before this feature may have no recorded reason. VANI explicitly says so; current keyword overlap is not presented as evidence of how the paper was originally selected. Reasons are collection-specific. A canonical merge copies membership reasons when creating a new target membership and retains existing target membership history.

Restart the API to apply migration `010_collection_keywords.sql`. No external service or model is needed. The [design specification](../design/collection-keywords-and-inclusion-reasons.md) describes persistence and admission behavior. Verification includes keyword matching tests, database checks for edits, pause behavior, stale search results and per-collection reasons, plus `ingestion:smoke` browser coverage for visible controls and upload/link explanations.
