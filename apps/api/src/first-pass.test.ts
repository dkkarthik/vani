import { beforeEach, expect, it, vi } from "vitest";
import { Work } from "@vani/shared";
vi.mock("./db.js", () => ({ query: async () => ({ rows: [] }) }));
import { firstPass } from "./first-pass.js";
const work = Work.parse({
  id: "paper1",
  title: "Active robotic mapping",
  abstract:
    "We introduce uncertainty-aware planning for active robotic mapping.",
  year: 2026,
  doi: null,
  citationKey: "a-26",
  authors: [],
  verificationStatus: "partial",
  createdAt: "2026-09-01",
  updatedAt: "2026-09-01",
});
const generated = {
  category: "System prototype",
  context: "Robotic mapping",
  correctness: "Assumptions need verification",
  contributions: "Uncertainty-aware planning",
  clarity: "Abstract is concise",
  novelty: "The first ever robot!",
  comparedWorkIds: [],
  evidence: [{ workId: work.id, section: "abstract", quote: work.abstract }],
  coverage: [
    "title",
    "abstract",
    "introduction",
    "headings",
    "conclusions",
    "references",
  ],
  limitations: [],
};
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          message: { content: JSON.stringify(generated) },
          choices: [{ message: { content: JSON.stringify(generated) } }],
        }),
      }),
  );
});
it("never labels abstract-only evidence as a complete first pass", async () => {
  const report = await firstPass(work, []);
  expect(report.status).toBe("abstract_only");
  expect(report.coverage).toEqual(["title", "abstract"]);
  expect(report.novelty).toContain("Insufficient evidence");
});
it("rejects invented supporting excerpts", async () => {
  vi.mocked(fetch).mockResolvedValue({
    ok: true,
    json: async () => ({
      message: {
        content: JSON.stringify({
          ...generated,
          evidence: [
            {
              workId: work.id,
              section: "abstract",
              quote: "This sentence is fabricated.",
            },
          ],
        }),
      },
    }),
  } as Response);
  expect((await firstPass(work, [])).status).toBe("needs_model");
});
it("does not call a model when evidence is absent", async () => {
  expect((await firstPass({ ...work, abstract: "" }, [])).status).toBe(
    "needs_evidence",
  );
  expect(fetch).not.toHaveBeenCalled();
});
it("records model failure without inventing a review", async () => {
  vi.mocked(fetch).mockRejectedValue(new Error("offline"));
  const result = await firstPass(work, []);
  expect(result.status).toBe("needs_model");
  expect(result.evidence).toEqual([]);
});
