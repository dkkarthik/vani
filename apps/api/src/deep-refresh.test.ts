import { it, expect } from "vitest";
import { deepQueries } from "./deep-refresh.js";
it("deep queries cover the full focus and bounded narrower alternatives", () => {
  expect(deepQueries(["robotic", "mapping"])).toEqual([
    "robotic mapping",
    "robotic",
    "mapping",
  ]);
  expect(deepQueries(["mapping"])).toEqual(["mapping"]);
  expect(
    deepQueries(Array.from({ length: 30 }, (_, i) => "term" + i)),
  ).toHaveLength(4);
});
