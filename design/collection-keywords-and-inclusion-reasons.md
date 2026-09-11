# Collection keywords and inclusion reasons

Implemented and verified. Specification written before implementation. See the [usage guide](../docs/21-collection-keywords.md).

Collection pages show the keywords that drive automatic discovery, with add/remove controls. Initially derive useful terms from the collection focus. Once edited, the keyword list is authoritative and persists across focus edits and seed additions. Removing a keyword stops it contributing to future search queries and admission scores; it is not a ban on any paper mentioning that term. Removing all keywords pauses discovery. Existing members remain intact.

Store nullable collection keywords and an optimistic keyword revision. Legacy collections derive defaults on read until edited. A keyword update rejects stale revisions and queues a fresh search when enabled. In-flight searches must recheck the keyword revision before admitting a paper, so removed keywords cannot admit stale results.

Each membership records its original inclusion reason: manual/library addition, uploaded or linked paper, selected discovery result, seed, browser capture, or automatic keyword match. Automatic reasons retain the keyword/query snapshot, matched terms, lexical score, provider and evidence snippets. Reasons are explanations of the implemented selection rule, not claims of semantic validation. Do not overwrite the original reason on duplicate imports or retroactively invent reasons for legacy members. Show current keyword overlap separately from the historical admission reason. Preserve reasons during canonical merges.

Verify keyword persistence/removal, empty-list pause, stale edits, in-flight search changes, per-collection reasons, duplicate reason preservation, uploads/seeds and legacy unknown reasons. Browser-test visible controls and inclusion details. Run checks, commit and push.
