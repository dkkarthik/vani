import { it, expect } from "vitest";
import {
  Focus,
  pagerank,
  rankPapers,
  graphLayers,
  selectScreening,
  validateAssessment,
  nextAudit,
  Assessment,
} from "./algorithm.js";
import { pairedEvaluation } from "./evaluation.js";
import { boundedWeights, inWindow } from "./audits.js";
import { articleLeads } from "./articles.js";
it("preserves restart mass, dangling nodes and asymmetric citation direction", () => {
  const result = pagerank(
    ["a", "b", "c"],
    [{ from: "a", to: "b", weight: 1 }],
    { a: 1 },
  );
  expect(Object.values(result.scores).reduce((a, b) => a + b, 0)).toBeCloseTo(
    1,
    8,
  );
  expect(result.scores.b).toBeGreaterThan(0);
  expect(result.scores.c).toBe(0);
  expect(result.residual).toBeLessThan(1e-7);
  expect(
    pagerank(["a", "b"], [{ from: "a", to: "b", weight: 1 }], { b: 1 }).scores
      .a,
  ).toBe(0);
});
it("ranks an uncited semantic method match above a popular lexical mismatch", () => {
  const focus = Focus.parse({
    question: "uncertainty guided robot exploration",
  });
  const result = rankPapers(
    [
      {
        id: "match",
        title: "Learning where to look",
        abstract: "",
        references: [],
        authors: [],
        embedding: [1, 0],
      },
      {
        id: "popular",
        title: "robot exploration",
        abstract: "",
        references: [],
        authors: [],
        embedding: [0, 1],
      },
    ],
    [],
    focus,
    [1, 0],
  );
  expect(result[0]!.paper.id).toBe("match");
});
it("bounds graph neighborhoods, D0/D1 selection, and retains deterministic exploration", () => {
  const papers = Array.from({ length: 80 }, (_, i) => ({
    id: String(i),
    title: "",
    abstract: "",
    references: ["shared"],
    authors: [],
  }));
  const graph = graphLayers(papers, 4);
  expect(graph.coupling.length).toBe(320);
  expect(graph.omitted).toBeGreaterThan(0);
  const sample = selectScreening(
    Array.from({ length: 1000 }, (_, i) => i),
    100,
    "seed",
  );
  expect(sample).toHaveLength(100);
  expect(new Set(sample).size).toBe(100);
  expect(sample.slice(90).some((i) => i > 100)).toBe(true);
  expect(
    Focus.safeParse({ question: "robot control", budgets: { d0: 20001 } })
      .success,
  ).toBe(false);
});
it("requires evidence from both works for closest, while unknown comparability remains valid", () => {
  const a = Assessment.parse({
    contribution: "Shared mechanism",
    proximity: "closest",
    role: "extension",
    similarities: ["Mechanism"],
    differences: [],
    uncertainties: [],
    anchorId: "a",
    facetIds: ["f"],
    comparison: {
      status: "unknown",
      question: "robot control",
      dimensions: [],
    },
    evidence: [
      {
        sourceId: "c",
        quote: "We propose a shared mechanism.",
        supports: "mechanism",
      },
    ],
  });
  const sources = [
    {
      id: "c",
      workId: "c",
      text: "We propose a shared mechanism.",
      kind: "pdf",
    },
    {
      id: "a",
      workId: "a",
      text: "We develop the shared mechanism.",
      kind: "pdf",
    },
  ];
  expect(validateAssessment(a, sources, "c", ["a"], "D2", ["f"])).toBe(false);
  a.evidence.push({
    sourceId: "a",
    quote: sources[1]!.text,
    supports: "anchor method",
  });
  expect(validateAssessment(a, sources, "c", ["a"], "D2", ["f"])).toBe(true);
  expect(validateAssessment(a, sources, "c", ["a"], "D1b", ["f"])).toBe(false);
  a.evidence[0]!.quote = "A fabricated supporting quotation.";
  expect(validateAssessment(a, sources, "c", ["a"], "D3", ["f"])).toBe(false);
});
it("clamps monthly anniversaries and honors local quiet windows including DST", () => {
  expect(
    nextAudit(new Date("2028-01-31T04:00:00Z"), "deep").toISOString(),
  ).toBe("2028-02-29T04:00:00.000Z");
  expect(
    inWindow(new Date("2026-03-08T07:30:00Z"), "America/New_York", 2, 6),
  ).toBe(true);
});
it("does not promote on inadequate or non-improving evaluation; recognizes a paired improvement", () => {
  const old = { lexical: 0.9, semantic: 0.05, graph: 0, author: 0.05 },
    proposed = { lexical: 0, semantic: 1, graph: 0, author: 0 };
  const groups = Array.from({ length: 10 }, (_, g) =>
    Array.from({ length: 30 }, (_, i) => ({
      id: `${g}-${i}`,
      label: i < 10 ? "closest" : "out_of_scope",
      features: { lexical: i < 10 ? 0 : 1, semantic: i < 10 ? 1 : 0 },
    })),
  );
  expect(pairedEvaluation(groups, proposed, old).eligible).toBe(true);
  expect(pairedEvaluation(groups.slice(0, 1), proposed, old).eligible).toBe(
    false,
  );
  expect(pairedEvaluation(groups, old, old).eligible).toBe(false);
  const before = { lexical: 0.2, semantic: 0.5, graph: 0.25, author: 0.05 },
    after = boundedWeights(before, {
      lexical: 1,
      semantic: 0,
      graph: 0,
      author: 0,
    });
  expect(
    Object.keys(before).reduce(
      (s, k) =>
        s +
        Math.abs(
          before[k as keyof typeof before] - after[k as keyof typeof after],
        ),
      0,
    ) / 2,
  ).toBeCloseTo(0.1);
});
it("treats blog citations as primary-paper leads and ignores script markup", () => {
  const leads = articleLeads(
    '<script><a href="https://doi.org/10.1234/bad">bad</a></script><a href="https://arxiv.org/abs/2401.12345v2">Paper</a><a href="https://doi.org/10.1234/good">Paper</a>',
    "https://example.org/post",
  );
  expect(leads.dois).toEqual(["10.1234/good", "10.48550/arXiv.2401.12345"]);
});
it("allows broader local reading while bounding per-run budgets", () => {
  expect(Focus.parse({ question: "Robot navigation" }).budgets).toEqual({
    d0: 20000,
    d1: 2000,
    d2: 200,
    d3: 50,
  });
  expect(
    Focus.parse({
      question: "Robot navigation",
      budgets: { d2: 1000, d3: 250 },
    }).budgets.d2,
  ).toBe(1000);
  expect(
    Focus.safeParse({ question: "Robot navigation", budgets: { d2: 1001 } })
      .success,
  ).toBe(false);
  expect(
    Focus.safeParse({ question: "Robot navigation", budgets: { d3: 251 } })
      .success,
  ).toBe(false);
});
