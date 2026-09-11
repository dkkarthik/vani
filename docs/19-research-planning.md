# Research planning (F21–F30)

These features extend the existing local VANI application. Open **Research** for maps, reading reports, discovery feedback and collection changes. **Ask VANI** now opens the explicit evidence-corpus question workflow.

## Upgrade

Run `npm install`, `npm run db:migrate`, then restart the API and web application. Migration `008_research_maps_insights.sql` adds maps, report snapshots, recommendation decisions and collection digests without rewriting existing papers or PDFs.

## Maps and reading paths

Create a map, add saved papers, notes, passages or entities, then drag cards or enter their X/Y coordinates. Pinning prevents accidental dragging. Topic groups can be collapsed; adding a card preserves every existing position. Remove a card to remove its associated reading step without deleting the source object.

Set a research question, focus a card, inspect one-hop expansion candidates, and explicitly add useful neighbors. Spatial, chronological and list views share the saved card set. Year and relationship-layer filters narrow the view; Back view restores the last filter state. Undated cards remain visible. Citation edges have solid lines; other relationships have dashed lines and a textual explanation.

Suggest reading steps produces editable background, comparison and next-step leads using indexed citations, associations and question-term overlap. These are heuristics, not established prerequisites. Add desired steps, edit their rationale and role, reorder them, mark them complete, and resume the first unfinished step.

**Save map and path** persists the draft. JSON and SVG exports use the saved revision. JSON contains editable positions, groups, filters, history, path, source labels and a scoped edge projection. Import creates a separate map and validates that its referenced objects exist in the current library; it does not copy PDFs or create relationship facts from the exported edge projection. SVG is a standalone figure with escaped text, stored positions and visible relationships. Collapsed cards are omitted from the figure.

Limits: 100 cards, 30 groups, 100 path steps, 20 previous filter states, and coordinates from 0 to 5000. Neighborhood expansion is bounded. Server revision checks reject stale writes; unsaved drafts remain available on errors. There is no concurrent editing or cross-device synchronization.

## Reading and synthesis

Choose a workflow and create a durable report:

- **First pass:** extracts a contribution passage, an editable context section and explicitly unassessed limitations. Actual PDF/abstract coverage accompanies the report.
- **Ask:** select the exact paper corpus and optional notes, then ask a question. Extractive mode returns relevant quoted evidence or insufficient evidence. The optional local model can draft a synthesis using those source snapshots.
- **Inspection:** select two saved passages, inspect their claims, methods, populations and conditions, and record supports/challenges/mixed/incomparable/unresolved. Confirmation requires a nonempty judgment rationale and an explicit user confirmation. Later edits without confirmation clear the previous confirmation.
- **Addition:** compare a target paper with explicitly selected baseline papers, notes and arguments. Shared excerpts and distinctive terms are investigation leads relative to the loaded baseline, not claims of worldwide novelty or a verified research gap.

Reports distinguish quotation, synthesis, inference, interpretation and unavailable information. Source citations retain the exact excerpt, object identity, page and recorded document hash when present. Click a citation to inspect its immutable snapshot and open the original source location. A source may now be changed or unavailable; the snapshot remains readable. Hash status refers to the recorded attachment identity, not a fresh disk-integrity scan.

Editable reports retain revision history. Quotation edits must still equal a cited excerpt; synthesis and inference require valid citations. These checks prevent nonexistent citations and altered quotations, but cannot establish that a model's interpretation logically follows from a source. Review interpretations yourself.

Evidence limits are explicit: at most 20 papers per answer; addition uses one target and up to 19 baseline papers. Each work contributes its abstract, up to 50 pages from its latest indexed attachment, and up to 30 saved annotations. Sources are capped at 6,000 characters each and 120,000 characters overall. Full-document coverage is reported only when indexing is ready and all pages fit. Context notes and argument selections are also bounded.

The model option uses the configured **local Ollama** path even if a cloud model is otherwise configured. Invalid model evidence or an unavailable local provider falls back to labeled local extraction. Extractive mode requires no model. The legacy conversation API remains available for compatibility; the new Ask screen uses snapshot-backed reports.

## Discovery feedback

Explorer results offer accept, dismiss and defer actions with a reason. Select an optional collection feedback context before exploring; otherwise decisions belong to the normalized query and seed context. Acceptance records relevance; importing the paper remains a separate action.

An unchanged accepted or dismissed candidate is suppressed on later runs in that context. A deferred candidate returns after its date expires. Material changes in title, abstract, year, DOI or recorded correction/retraction fields allow another review; citation-count changes alone do not. **Discovery feedback** shows the latest 200 decisions, their history and a restore action. This implementation applies transparent rules, not a trained personalized ranking model.

## Living collection digests

Configure a manual collection's topic and daily schedule in Collections. The existing local worker must be running. It captures a baseline before discovery, imports selected source candidates, rechecks up to 20 older public indexed works through OpenAlex, then captures changes. Older checks rotate by oldest source retrieval and can find recorded corrections/retractions outside the new-publication search window. They skip private and uploaded-only works. Provider payloads are retained as provenance and do not silently replace user-corrected canonical metadata.

**Collection changes** supports pause, resume, retry, manual capture of stored changes and acknowledgement. A manual capture compares stored records; it does not fetch providers. Retry queues the existing local worker. Provider errors appear separately. The first snapshot establishes a quiet baseline; later new papers, changed metadata, recorded retractions and newly connected work create before/after events. Repeated unchanged captures create no new events.

Snapshots cover up to 1,000 member works and 2,000 connections directly touching those works; the UI shows coverage. The latest 200 events are displayed. Monitoring depends on indexed provider data and cannot guarantee exhaustive or immediate retraction detection. Pausing stops scheduled refresh, while an explicit manual capture remains available. No external notifications or Codex automation are created.

## Specifications

| Feature | Design specification                                                                    |
| ------- | --------------------------------------------------------------------------------------- |
| F21     | [Stable spatial organization](../design/F21-stable-editable-spatial-organization.md)    |
| F22     | [Editable reading paths](../design/F22-guided-editable-reading-paths.md)                |
| F23     | [Focused graph, timeline and list](../design/F23-focused-graph-timeline-list.md)        |
| F24     | [Saved and exportable maps](../design/F24-saved-exportable-maps.md)                     |
| F25     | [Structured first-pass reading](../design/F25-structured-first-pass-reading.md)         |
| F26     | [Grounded collection questions](../design/F26-grounded-collection-questions.md)         |
| F27     | [Support and disagreement inspection](../design/F27-support-disagreement-inspection.md) |
| F28     | [New-paper additions](../design/F28-explain-new-paper-additions.md)                     |
| F29     | [Discovery feedback](../design/F29-discovery-feedback.md)                               |
| F30     | [Living collection digests](../design/F30-living-collection-change-digests.md)          |

## API and verification

New routes live under `/api/v1/knowledge`: `/boards`, `/boards/:id`, `/boards/import`, `/boards/:id/export`, `/boards/neighbors`, `/boards/path-suggestions`, `/map-edges`, `/insights`, `/insights/:id`, `/insights/:id/sources/:sourceId`, `/insights/first-pass`, `/insights/ask`, `/insights/inspection`, `/insights/addition`, `/feedback`, `/feedback/:id/restore`, `/digests/:collectionId`, `/digests/:collectionId/capture`, and `/digests/:collectionId/control`. Shared map validation lives in `packages/shared/src/maps.ts`.

Run `npm run check` and `npm run lint`. Against a disposable PostgreSQL database and object directory, set `DATABASE_URL`, `VANI_DATA_DIR` and `VANI_INTEGRATION_TEST=true`, then run:

```bash
npm run test -w @vani/api -- --fileParallelism=false
NODE_ENV=test npm run planning:smoke
```

The browser harness requires Playwright Chromium; `VANI_SMOKE_CHROMIUM` can point to an installed test browser. It writes screenshots to `/tmp/vani-planning-smoke` by default. Provider calls in verification are controlled fixtures. Integration tests cover all ten features, stale writes, exact source scope, invalid model citations, restore/deferral, older source updates and quiet repeat digests.
