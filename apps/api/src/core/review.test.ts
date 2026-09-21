import { expect, it } from "vitest";
import { feedbackAdjustment } from "./review.js";
it("bounds feedback, favors exact judgments and ignores unrelated negative examples", () => {
  const paper = {
    id: "one",
    title: "Adaptive mesh refinement",
    abstract: "Sparse spatial representations",
  };
  expect(
    feedbackAdjustment(paper, [
      { id: "one", paper, feedback: { label: "related" } },
    ]).adjustment,
  ).toBe(0.2);
  expect(
    feedbackAdjustment(paper, [
      {
        id: "other",
        paper: { title: "Cancer drug treatments" },
        feedback: { label: "out_of_scope" },
      },
    ]).adjustment,
  ).toBe(0);
  expect(
    feedbackAdjustment(
      paper,
      Array.from({ length: 100 }, (_, i) => ({
        id: String(i),
        paper,
        feedback: { label: "related" },
      })),
    ).adjustment,
  ).toBe(0.2);
  expect(
    feedbackAdjustment(paper, [{ id: "one", paper, feedback: {} }]).adjustment,
  ).toBe(0);
});
