import { expect, it } from "vitest";
import { retryTime } from "./rate-limits.js";
const now = Date.parse("2026-09-18T12:00:00Z");
it("respects Retry-After seconds and dates", () => {
  expect(
    retryTime(new Headers({ "retry-after": "120" }), 0, now).getTime(),
  ).toBe(now + 120000);
  expect(
    retryTime(
      new Headers({ "retry-after": "Fri, 18 Sep 2026 12:05:00 GMT" }),
      0,
      now,
    ).getTime(),
  ).toBe(now + 300000);
});
it("waits for daily reset rather than retrying an exhausted quota", () => {
  expect(
    retryTime(
      new Headers({
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": "43200",
        "retry-after": "10",
      }),
      0,
      now,
    ).toISOString(),
  ).toBe("2026-09-19T00:00:00.000Z");
  expect(
    retryTime(
      new Headers({ "x-ratelimit-remaining": "0" }),
      0,
      now,
    ).toISOString(),
  ).toBe("2026-09-19T00:00:00.000Z");
});
it("backs off with a cap when retry headers are absent or malformed", () => {
  expect(retryTime(new Headers(), 0, now).getTime()).toBe(now + 30000);
  expect(
    retryTime(new Headers({ "retry-after": "invalid" }), 1, now).getTime(),
  ).toBe(now + 60000);
  expect(retryTime(new Headers(), 99, now).getTime()).toBe(now + 3600000);
});
