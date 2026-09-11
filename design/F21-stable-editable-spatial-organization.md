# F21 — Stable editable spatial organization

Status: implemented and verified. This specification was written before implementation. See the [usage and verification guide](../docs/19-research-planning.md).

## Outcome and interactions

Arrange paper, note, passage and entity cards on a persistent board. Drag or numerically position cards, pin them, assign named groups and collapse groups without losing coordinates. Adding cards appends into vacant rows and never moves existing cards.

## Data and API design

research_board JSON state with stable card IDs, x/y, pinned, group; revision-checked PATCH. Maximum 100 cards and 30 groups; validate unique refs/IDs and finite bounded coordinates.

All new APIs live under `/api/v1/knowledge`; existing F01–F20 identities remain intact. Server validation checks references and optimistic revisions. Errors preserve the editor draft. This is a local single-user feature, not a synchronization or collaboration system.

## Acceptance criteria

Move/pin/group a card, save/reload, add another and confirm earlier coordinates remain unchanged. Collapsed groups preserve their members and keyboard controls offer equivalent movement.

## Verification plan

Use disposable PostgreSQL integration tests for persistence, invalid references, stale writes and repeat operations. Use controlled provider responses for model/discovery validation and browser tests for key editing/reload/navigation/export flows. Run workspace checks, commit only task changes and push to GitHub.

## Boundaries

No unrequested cloud processing, exhaustive literature-coverage claim, automatic correctness verification or inferred prerequisite is presented as fact. Source quotations, user interpretation and heuristic suggestions remain separately labeled. Limits and fallbacks appear in the UI and delivery guide.
