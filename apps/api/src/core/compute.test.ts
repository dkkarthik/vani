import { it, expect } from "vitest";
import { Assessment, assessmentIssues } from "./algorithm.js";
import { pauseReason, fingerprint, type ReadPacket } from "./compute.js";
it("reports specific evidence defects without accepting paraphrases", () => {
  const a = Assessment.parse({
    contribution: "test",
    proximity: "closest",
    role: "unknown",
    similarities: [],
    differences: [],
    uncertainties: [],
    anchorId: "bad",
    facetIds: ["bad"],
    comparison: { status: "unknown", question: "?", dimensions: [] },
    evidence: [
      { sourceId: "s", quote: "A paraphrased quotation.", supports: "claim" },
      { sourceId: "missing", quote: "A missing quotation.", supports: "claim" },
    ],
    relationships: [
      { predicate: "uses", targetId: "bad", sourceIds: ["uncited"] },
    ],
  });
  expect(
    assessmentIssues(
      a,
      [
        {
          id: "s",
          workId: "c",
          text: "The exact original quotation.",
          kind: "pdf",
        },
      ],
      "c",
      ["anchor"],
      "D2",
      ["facet"],
    ).map((i) => i.code),
  ).toEqual(
    expect.arrayContaining([
      "unknown_facet",
      "unknown_anchor",
      "quote_mismatch",
      "unknown_source",
      "missing_candidate_evidence",
      "missing_anchor_evidence",
      "unknown_relationship_target",
      "uncited_relationship_source",
    ]),
  );
});
it("pauses failed waves and bounds successful compute independently", () => {
  expect(pauseReason(Array(5).fill("rejected"), 5, 10)).toMatch(/consecutive/);
  expect(
    pauseReason(
      [
        "accepted",
        "rejected",
        "rejected",
        "rejected",
        "rejected",
        "accepted",
        "rejected",
        "rejected",
        "rejected",
        "rejected",
      ],
      10,
      40,
    ),
  ).toMatch(/eight/);
  expect(pauseReason(Array(10).fill("accepted"), 10, 10)).toMatch(/budget/);
  expect(pauseReason(["accepted", "rejected"], 2, 10)).toBeNull();
});
it("fingerprints model, prompt, limits and exact evidence", () => {
  const p = {
    version: "v1",
    input: { text: "paper" },
    digest: "a",
    limits: { thinking: true },
  } as unknown as ReadPacket;
  for (const variant of [
    { ...p, digest: "b" },
    { ...p, version: "v2" },
    { ...p, input: { text: "new paper" } },
    { ...p, limits: { ...p.limits, thinking: false } },
  ])
    expect(fingerprint(variant)).not.toBe(fingerprint(p));
  expect(fingerprint(structuredClone(p))).toBe(fingerprint(p));
});
