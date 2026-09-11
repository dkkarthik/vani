import { expect, it } from "vitest";
import { Outline } from "@vani/shared";
import { ruleMatches } from "./connections.js";
import { sharedReferences } from "./layers.js";
import { normalizeSeed } from "./discovery.js";
import { rasterType } from "./notes.js";
it("matches explicit relation cues and suppresses negated or unrelated text", () => {
  expect(
    ruleMatches(
      "We use Contrastive Learning to train. We compare against Contrastive Learning.",
      ["Contrastive Learning"],
    ).map((r) => r.predicate),
  ).toEqual(["uses_method", "compares_against"]);
  expect(
    ruleMatches(
      "We do not use Contrastive Learning. Contrastive Learning is interesting.",
      ["Contrastive Learning"],
    ),
  ).toEqual([]);
});
it("computes overlap on sets, with empty coverage producing no score", () => {
  expect(sharedReferences(["a", "a", "b"], ["b", "c"])).toEqual({
    shared: ["b"],
    score: 1 / 3,
  });
  expect(sharedReferences([], []).score).toBe(0);
});
it("constrains seed syntax instead of accepting arbitrary URLs", () => {
  expect(normalizeSeed("https://openalex.org/W123")).toBe("W123");
  expect(normalizeSeed("https://doi.org/10.1234/abc")).toBe(
    "https://doi.org/10.1234/abc",
  );
  expect(normalizeSeed("https://localhost/private")).toBeNull();
});
it("rejects duplicate outline IDs and detects supported image signatures", () => {
  const id = "019a0a00-0000-7000-8000-000000000001",
    b = { id, kind: "claim", text: "Claim" };
  expect(Outline.safeParse([b, b]).success).toBe(false);
  expect(rasterType(Buffer.from('<svg onload="alert(1)">'))).toBeNull();
  expect(rasterType(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(
    "image/png",
  );
});
