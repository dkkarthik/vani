import { expect, it } from "vitest";
import { fitLinearSvm, shortlist, shortlistWords } from "./shortlist.js";
import type { Document } from "./ranker.js";

it("converges to the analytical balanced two-point SVM optimum", () => {
  const fit = fitLinearSvm([[[0, 1]], [[0, -1]]], [1, -1], [1, 1], 1);
  expect(fit.converged).toBe(true);
  expect(fit.weights[0]).toBeCloseTo(0.8, 5);
  expect(fit.bias).toBeCloseTo(0, 5);
  expect(fit.residual).toBeLessThan(1e-6);
});
it("matches an independent SciPy minimization of an asymmetric weighted primal", () => {
  // Reference: scipy.optimize.minimize(BFGS), analytical gradient, gtol=1e-11.
  const fit = fitLinearSvm(
    [
      [[0, 1]],
      [[1, 1]],
      [
        [0, 0.5],
        [1, 0.5],
      ],
    ],
    [1, -1, -1],
    [0.8, 0.2, 0.4],
    2,
  );
  expect(fit.converged).toBe(true);
  expect(fit.weights[0]).toBeCloseTo(0.4978540772532173, 5);
  expect(fit.weights[1]).toBeCloseTo(-0.5407725321888368, 5);
  expect(fit.bias).toBeCloseTo(-0.04291845493561952, 5);
});

const docs: Document[] = [
  {
    id: "seed",
    title: "Adaptive spatial meshes for navigation",
    abstract:
      "Sparse graph construction encodes occupancy using mesh refinement and spatial discretization.",
    seed: true,
  },
  {
    id: "method",
    title: "Adaptive spatial mesh refinement",
    abstract: "Sparse graph construction from occupancy grids for navigation.",
  },
  {
    id: "application",
    title: "Social robot navigation in crowds",
    abstract:
      "Robot navigation with human motion prediction and collision avoidance.",
  },
  {
    id: "offtopic",
    title: "Adaptive graph construction for molecule classification",
    abstract: "Learn graph representations for drug discovery.",
  },
  {
    id: "background",
    title: "Climate economics",
    abstract: "Economic growth and global climate policies.",
  },
  {
    id: "background2",
    title: "Protein folding",
    abstract: "Molecular structures from experimental observations.",
  },
];
const options = {
  enabled: true,
  limit: 5,
  focus: "Adaptive spatial representations meshes graph construction",
  requiredTerms: ["mesh", "occupancy", "grid"],
};
const ids = docs.filter((d) => !d.seed).map((d) => d.id);

it("shortlists discriminative method matches and records why broad matches failed", () => {
  const result = shortlist(docs, ids, options);
  expect(result.metadata.status).toBe("ready");
  expect(result.items.filter((i) => i.selected).map((i) => i.id)).toEqual([
    "method",
  ]);
  expect(result.items.find((i) => i.id === "offtopic")?.reason).toBe(
    "context_mismatch",
  );
  expect(result.items.find((i) => i.id === "method")?.matchedContext).toContain(
    "mesh",
  );
  expect(result.items.find((i) => i.id === "method")?.nearest?.id).toBe("seed");
  expect(result.metadata.selected).toBeLessThan(options.limit);
  const reversed = shortlist([...docs].reverse(), ids, options);
  expect(reversed.items).toEqual(result.items);
  expect(reversed.model).toEqual(result.model);
});

it("learns explicit rejections and lets positive feedback override lexical gates", () => {
  const rejected = shortlist(
    docs.map((d) => (d.id === "method" ? { ...d, label: "down" } : d)),
    ids,
    options,
  );
  expect(rejected.items.find((i) => i.id === "method")?.reason).toBe(
    "negative_feedback",
  );
  expect(rejected.items.some((i) => i.selected)).toBe(false);
  const approved = shortlist(
    docs.map((d) => (d.id === "offtopic" ? { ...d, label: "up" } : d)),
    ids,
    options,
  );
  expect(approved.items.find((i) => i.id === "offtopic")?.selected).toBe(true);
  const cleared = shortlist(docs, ids, options);
  expect(cleared.items.find((i) => i.id === "offtopic")?.selected).toBe(false);
});

it("does not fabricate a shortlist without a positive example or usable overlap", () => {
  const result = shortlist(
    docs.filter((d) => !d.seed),
    ids,
    options,
  );
  expect(result.metadata.status).toBe("needs_positive_examples");
  expect(result.items.some((i) => i.selected)).toBe(false);
  const unrelated = shortlist(docs, ["background", "background2"], {
    ...options,
    focus: "",
    requiredTerms: [],
  });
  expect(unrelated.items.every((i) => i.reason === "no_positive_overlap")).toBe(
    true,
  );
});

it("removes numerical extraction artifacts and matches English plural variants", () => {
  expect(
    shortlistWords("Meshes representations GRAPHS 1 2 20 the café"),
  ).toEqual(["mesh", "representation", "graph", "cafe"]);
});
it("excludes empty positive vectors instead of treating them as background negatives", () => {
  const r = shortlist(
    [...docs, { id: "empty-liked", title: "123 the", label: "up" }],
    [...ids, "empty-liked"],
    options,
  );
  expect(r.metadata.unusable).toBe(1);
  expect(r.metadata.trainingSamples).toBe(docs.length);
  expect(r.metadata.positive).toBe(1);
  expect(r.items.find((i) => i.id === "empty-liked")?.reason).toBe(
    "no_features",
  );
});
it("prunes ubiquitous and rare features but retains explicitly requested focus terms", () => {
  const corpus: Document[] = Array.from({ length: 101 }, (_, i) => ({
    id: String(i),
    seed: i === 0,
    title: "ubiquitous token",
    abstract:
      i < 5 ? "specificmethod" : i < 7 ? "rareword" : "routine background",
  }));
  const r = shortlist(corpus, ["1"], {
    enabled: true,
    limit: 5,
    focus: "ubiquitous",
  });
  expect(r.metadata.minDf).toBe(5);
  expect(r.metadata.maxDf).toBe(0.1);
  expect(r.model.vocabulary).toContain("specificmethod");
  expect(r.model.vocabulary).toContain("ubiquitous");
  expect(r.model.vocabulary).not.toContain("token");
  expect(r.model.vocabulary).not.toContain("rareword");
});
