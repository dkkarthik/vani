import { expect, it } from "vitest";
import { v7 as uuid } from "uuid";
import { BoardState } from "@vani/shared";
import { validateSections } from "./insights.js";
import { boardSvg, visibleCards } from "./boards.js";
import { materialFingerprint, candidateIdentity } from "./monitor.js";
it("rejects broken board references and preserves undated filtered records", () => {
  const id = uuid(),
    ref = { kind: "work", id: uuid() };
  expect(
    BoardState.safeParse({ cards: [{ id, ref, x: -1, y: 0 }] }).success,
  ).toBe(false);
  expect(
    BoardState.safeParse({
      cards: [],
      path: [{ cardId: id, role: "background", rationale: "why" }],
    }).success,
  ).toBe(false);
  const state = BoardState.parse({
    cards: [{ id, ref, x: 0, y: 0 }],
    filters: { yearFrom: 2020 },
  });
  expect(visibleCards(state, [{ id, year: null }])).toHaveLength(1);
  expect(visibleCards(state, [{ id, year: 2010 }])).toHaveLength(0);
});
it("validates exact quotations and rejects fabricated or out-of-snapshot citations", () => {
  const id = uuid(),
    source = {
      id,
      kind: "abstract",
      label: "Paper",
      text: "Known evidence.",
      url: "/read/x",
    },
    s: any = {
      id: uuid(),
      label: "Finding",
      kind: "quotation",
      text: "Known evidence.",
      citations: [{ sourceId: id, quote: "Known evidence." }],
    };
  expect(validateSections([s], [source])).toBe(true);
  expect(validateSections([{ ...s, text: "Invented" }], [source])).toBe(false);
  expect(
    validateSections(
      [{ ...s, citations: [{ sourceId: uuid(), quote: "Known evidence." }] }],
      [source],
    ),
  ).toBe(false);
});
it("exports escaped SVG and excludes immaterial discovery counters from fingerprints", () => {
  const id = uuid(),
    state = BoardState.parse({
      cards: [{ id, ref: { kind: "work", id: uuid() }, x: 0, y: 0 }],
    });
  const svg = boardSvg({
    title: "<script>&",
    state,
    cards: [
      {
        ...state.cards[0],
        source: { kind: "work", id, label: '<image onload="bad">' },
        year: 2024,
      },
    ],
  });
  expect(svg).toContain("&lt;script&gt;");
  expect(svg).not.toContain("<script>");
  const c = {
    title: "Title",
    abstract: "Text",
    doi: "https://doi.org/10.1234/x",
    sourcePayload: { cited_by_count: 3 },
  };
  expect(candidateIdentity(c)).toBe("10.1234/x");
  expect(materialFingerprint(c)).toBe(
    materialFingerprint({ ...c, sourcePayload: { cited_by_count: 4 } }),
  );
  expect(materialFingerprint(c)).not.toBe(
    materialFingerprint({ ...c, abstract: "Corrected text" }),
  );
});
