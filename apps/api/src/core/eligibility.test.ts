import { it, expect } from "vitest";
import {
  eligibleCandidates,
  sameScientificWork,
  diverseScreening,
} from "./eligibility.js";
import { Focus } from "./algorithm.js";
it("removes seed copies, supplemental records and supported alternate versions before selection", () => {
  const title = "Terrain response for safe quadruped locomotion";
  const rows = [
    { id: "seed-copy", paper: { title, doi: "10.48550/arxiv.1234.56789" } },
    {
      id: "video",
      paper: { title: "An excellent paper_supp1-123.mp4", doi: "10.1/p/mm1" },
    },
    {
      id: "short",
      paper: {
        title: "Controller aware terrain adaptation for legged robots",
        doi: "10.1/journal",
        authors: [{ given: "A", family: "Researcher" }],
        year: 2025,
      },
    },
    {
      id: "rich",
      paper: {
        title: "Controller aware terrain adaptation for legged robots",
        doi: "10.48550/arxiv.2501.12345",
        authors: [{ given: "A", family: "Researcher" }],
        year: 2024,
        abstract: "A full abstract",
      },
    },
  ];
  const r = eligibleCandidates(rows, [{ id: "seed", title }]);
  expect(r.representatives.map((x) => x.id)).toEqual(["rich"]);
  expect(r.excluded.get("seed-copy")?.reason).toBe("existing_member");
  expect(r.excluded.get("short")?.matchId).toBe("rich");
  expect(r.excluded.get("video")?.reason).toBe("supplementary_artifact");
});
it("does not merge same-title works with conflicting authors or distant years", () => {
  const a = {
    title: "A scientific study with a sufficiently long title",
    doi: "10.1/a",
    authors: ["Alice Author"],
    year: 2020,
  };
  expect(
    sameScientificWork(a, { ...a, doi: "10.1/b", authors: ["Bob Author"] }),
  ).toBe(false);
  expect(sameScientificWork(a, { ...a, doi: "10.1/b", year: 2026 })).toBe(
    false,
  );
  expect(
    sameScientificWork(
      { doi: "10.48550/arxiv.2303.04781v1" },
      { doi: "10.48550/arxiv.2303.04781v2" },
    ),
  ).toBe(true);
});
it("reserves a facet slot for an otherwise low-ranked research strand", () => {
  const ranked = Array.from({ length: 20 }, (_, i) => ({
    paper: {
      id: String(i),
      title:
        i === 19
          ? "Policy curriculum terrain difficulty"
          : "Quadruped locomotion control",
      abstract: "",
    },
    score: 1 - i * 0.01,
  }));
  const focus = Focus.parse({
    question: "Legged control",
    facets: [
      {
        id: "curriculum",
        kind: "method",
        text: "Policy curriculum terrain difficulty",
      },
    ],
  });
  const r = diverseScreening(ranked, 10, focus, "run");
  expect(r).toHaveLength(10);
  expect(new Set(r.map((x) => x.item.paper.id)).size).toBe(10);
  expect(r.find((x) => x.item.paper.id === "19")?.reason).toBe(
    "facet:curriculum",
  );
});
