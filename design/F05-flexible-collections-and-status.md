# F05 — Flexible collections and status

Status: implemented; validation recorded in the [usage guide](../docs/17-research-workspace.md). September 10, 2026.

## Outcome and behavior

Provide nested manual collections with rename/reparent, cycle prevention and multi-membership. Saved-search collections store a structured rule (text, tag, year range, reading state, unfiled); membership is evaluated live, not copied into a frozen list. The organization workspace displays these results and lets users save a new rule. Existing discovery/manual workflows remain available.

Canonical work tags are case-normalized for matching while retaining readable names. The unfiled inbox means no active manual collection membership (saved-search membership does not file a paper). Reading state, priority 0–5 and rationale are specific to each manual collection; removing a membership leaves the paper and other projects intact. Saved-search collections are read-only membership views and have no discovery schedule.

API under /organization: GET collections, POST/PATCH collections, GET works with filters, PUT/DELETE memberships, PUT tags. All writes validate active IDs; reparenting serializes cycle checks. Limit page results to 100 with offset and total; no silent claim that a page is the entire library. UI: /organize collections tab with rule controls, work selection, tagging and membership editing.

Acceptance: nested cycles rejected; one paper has independent project state in two collections; saved-search results change after tags/metadata change; unfiled updates after membership removal; deleting membership never deletes research data.

## Validation and delivery

Implement only after this specification exists. Use unit tests for rules and ranking, disposable PostgreSQL integration tests for persistence/concurrency, and browser smoke tests for the user flow. Preserve F01–F03 behavior, run repository checks, commit and push. Implementation details and any verified limitations belong in the usage guide.
