# Broader local comparisons and deep reading

Increase D2 defaults from 40 to 200 and D3 from 10 to 50 per run, with editable
limits of 1,000 and 250. D0 remains 20,000 and D1 remains 2,000. The existing D1b
allocation scales with D2 (four times its budget, capped by D1). Keep relevance,
source evidence, local routing, retry limits and inference serialization unchanged.
These ceilings are not promises that every slot will be filled.

Expose D2/D3 numeric controls in the focus editor and show saved collection budgets.
Use the existing explicit save/version workflow. Migration 015 upgrades each budget
only when equal to its old default. Retain custom smaller values and focus history.
As with a focus edit, supersede active runs, mark candidates stale, and invalidate
active experimental policies for affected collections. Keep assessment and feedback
history. The next manual or scheduled refresh reranks under the expanded budgets;
no migration starts work or changes daily schedule. Existing run snapshots remain
immutable. Reassessment can take longer and a run can span several days.

Verify defaults and limits, editor persistence, and migration behavior against
PostgreSQL for default and customized profiles, including active run/history state.
