import { it, expect } from "vitest";
import { seedFocus } from "./seed-focus.js";
it("uses a meaningful single paper title as an editable search query", () =>
  expect(
    seedFocus([
      { title: "Active robotic mapping", abstract: "", localExcerpt: "" },
    ]),
  ).toBe("Active robotic mapping"));
it("uses indexed text when the upload title is only a filename", () =>
  expect(
    seedFocus([
      {
        title: "paper.pdf",
        abstract: "",
        localExcerpt:
          "Robotic control with demonstrations. Robust robotic control transfers across settings.",
      },
    ]),
  ).toContain("robotic"));
it("requires shared terms across multiple papers", () => {
  expect(
    seedFocus([
      { title: "Neural robotic control", abstract: "", localExcerpt: "" },
      { title: "Robotic control planning", abstract: "", localExcerpt: "" },
    ]),
  ).toBe("control robotic");
  expect(
    seedFocus([
      { title: "Neural robotic control", abstract: "", localExcerpt: "" },
      { title: "Medieval pottery excavation", abstract: "", localExcerpt: "" },
    ]),
  ).toBe("");
});
