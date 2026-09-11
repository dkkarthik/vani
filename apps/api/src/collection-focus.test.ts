import { it, expect } from "vitest";
import { defaultKeywords, keywordMatch } from "./collection-focus.js";
it("derives unique substantive keywords including acronyms", () =>
  expect(defaultKeywords("AI and robotic mapping for robotic control")).toEqual(
    ["ai", "robotic", "mapping", "control"],
  ));
it("matches whole normalized keywords and phrases with evidence", () => {
  const match = keywordMatch(
    ["robot", "active mapping"],
    "Robotic systems",
    "We study active mapping.",
  );
  expect(match.matched).toEqual(["active mapping"]);
  expect(match.score).toBe(0.5);
  expect(match.evidence[0]?.quote).toBe("We study active mapping.");
});
it("removing a keyword removes its ability to admit candidates", () => {
  expect(keywordMatch(["robotic", "mapping"], "Robotic systems").score).toBe(
    0.5,
  );
  expect(keywordMatch(["mapping"], "Robotic systems").score).toBe(0);
  expect(keywordMatch([], "Mapping").score).toBe(0);
});
