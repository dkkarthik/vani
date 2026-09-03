# VANI 0.1 UX Specification

## 1. Navigation

Primary navigation:

```text
Inbox
Collections
Discover
Map
Read
Ask VANI
Updates
Library
Settings
```

The active collection and scope remain visible in the top context bar. A user can move between list, map, reader, and Ask VANI without losing selection.

## 2. Collection workspace

```text
┌ Collections ───────┬ Terrain Representation ──────────────────────┐
│ Thesis             │ 84 papers  •  6 new  •  updated 2h ago       │
│ ├ Foundations      ├───────────────────────────────────────────────┤
│ ├ Benchmarks       │ Search/filter                  Add papers     │
│ └ Terrain Rep.     │                                               │
│                    │ □ Title       Year  Status  Why here  Verify  │
│                    │ □ CLEAR       2026  Read    Seed      ✓       │
│                    │ □ ...                                         │
└────────────────────┴───────────────────────────────────────────────┘
```

Required actions:

- create, rename, nest, snapshot, and trash collections;
- set status, priority, and rationale;
- select papers and open map, comparison, Ask VANI, or export;
- show unresolved metadata conflicts and missing PDFs;
- display preferred manifestation without hiding other versions.

## 3. Discover

The seed composer accepts ideas, keywords, identifiers, papers, and negative examples.

```text
Seed: [long-horizon navigation terrain abstractions          ]
      [+ paper] [+ idea] [+ exclude paper]

Sources: OpenAlex ✓  Semantic Scholar ✓  DBLP ✓  arXiv ✓
Mode: Similarity first ▾       Collection: Terrain Representation
```

Each result shows:

- title, authors, venue, year, and verification state;
- short explanation;
- decomposed signals;
- access status;
- accept, defer, dismiss, and inspect actions;
- version/duplicate warning.

## 4. Map

```text
┌ Filters ─────────┬──────────────────────────────┬ Details ────────┐
│ Relation types   │                              │ Selected paper  │
│ ☑ Similarity     │       ○──────○               │ Summary         │
│ ☑ Cites          │      /  cluster \            │ Versions        │
│ ☑ Baseline       │  ○──○────●────○──○           │ Relationships   │
│ ☑ Dataset        │      \        /              │ Reviews         │
│ ☐ Reviews        │       ○──────○               │ Notes/PDF       │
│                  │                              │ Ask about this  │
└──────────────────┴──────────────────────────────┴─────────────────┘
```

Interaction rules:

- hover node: compact identity and relevance;
- click node: persistent detail panel;
- hover edge: predicate, direction, confidence, and evidence preview;
- click edge: complete evidence and correction controls;
- double-click cluster: zoom into cluster;
- back/forward: restore graph camera, filters, and selection;
- update: retain existing coordinates and animate new nodes unobtrusively;
- keyboard/list mode: provide equivalent navigation.

Semantic zoom levels:

1. research areas and clusters;
2. representative papers and named concepts;
3. individual papers and typed edges;
4. claims, passages, reviews, and notes.

## 5. Reader

```text
┌ Paper outline ───┬ PDF / reflowed text ────────┬ Evidence pane ──┐
│ Abstract         │                              │ Annotations     │
│ Introduction     │ selected passage            │ Paper card      │
│ Method           │                              │ Citations       │
│ Experiments      │                              │ Reviews         │
│ References       │                              │ Ask VANI        │
└──────────────────┴──────────────────────────────┴─────────────────┘
```

Required reader behavior:

- clear manifestation label and document hash/version;
- page and outline navigation;
- search and citation previews;
- highlight, underline, note, area/image annotation;
- drag annotation to a note;
- add selected evidence to a synthesis matrix;
- open cited paper without losing reading position;
- show review critiques relevant to the current section when available.

## 6. Reviews and discussion

Display a version-aware timeline:

```text
Submission v1 → Reviews → Rebuttal → Meta-review → Decision → Revision v2
```

Views:

- complete thread;
- strengths;
- concerns by category;
- reviewer disagreement;
- author responses;
- resolved/unresolved concern proposals;
- manuscript diff.

Never present a single red/green paper-quality badge.

## 7. Ask VANI

```text
┌ Scope ────────────────────────────────────────────────────────────┐
│ Terrain Representation / 84 papers                               │
│ PDFs ✓  Reviews ✓  My notes ✓  External web off                 │
└───────────────────────────────────────────────────────────────────┘

What is the innovation of CLEAR over the closest alternatives?

Primary innovation ... [1]

Important qualification ... [2][3]

Evidence strength: high for representation; moderate for runtime.

[Show comparison table] [Show on map] [Save as synthesis note]
```

Citation interaction:

- hover previews source and exact passage;
- click opens reader/review at the anchor;
- a badge distinguishes paper, review, user note, or inferred evidence;
- unsupported and inferred claims are visibly labeled;
- “why this answer?” opens scope, retrieval, and validation details.

## 8. Citation verification

Metadata panel:

```text
Citation status: Verified with minor differences

Field       Canonical            IEEE       Crossref   DBLP
Title       CLEAR: ...           ✓          ✓          punctuation
Authors     6 authors             ✓          ✓          initials
Pages       11394–11401           ✓          ✓          —

Citation key: meshram-ral26   [frozen]
```

The user can inspect raw source values, choose an assertion, add a correction, or refresh sources.

## 9. Export

Collection export modal:

- format and encoding;
- recursive descendants;
- preferred manifestation rule;
- verification threshold;
- optional fields;
- citation-key preview;
- blocking errors and warnings;
- downloadable bibliography and manifest.

The UI must explain exactly which records were omitted or substituted.

## 10. Updates

Organize changes by consequence:

```text
Needs attention
  1 retraction • 2 citation conflicts • 3 changed reviews

Likely relevant
  6 new papers • 4 new baseline relationships

Background changes
  12 citation-count updates • 9 metadata enrichments
```

Users can accept changes individually or in safe batches. Metadata source changes do not automatically overwrite user corrections.

## 11. Empty, loading, and failure states

- Empty collections explain how to seed without forcing a tutorial.
- Long-running work shows stage, progress, and safe navigation away.
- Partial connector failure returns usable results and names the unavailable source.
- Insufficient Ask VANI evidence is a normal answer state.
- Graph truncation is visible and offers filters rather than silently omitting nodes.
- A missing PDF does not block metadata and collection workflows.

## 12. Accessibility and responsiveness

The desktop web interface targets widths of 1280 px and above first, but remains usable at tablet widths. The graph always has list/table equivalents. Focus state, keyboard shortcuts, accessible labels, reduced-motion mode, and non-color encodings are release requirements.

