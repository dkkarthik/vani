import { afterEach, expect, it, vi } from "vitest";
import { request } from "./api";
afterEach(() => vi.unstubAllGlobals());
it.each([
  { error: { message: "Public queries are missing." } },
  { error: "Conflict", message: "Public queries are missing." },
  { error: "Public queries are missing." },
])("preserves actionable API errors: %j", async (body) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(body, { status: 409 })),
  );
  await expect(request("/collections/id/deep-refresh")).rejects.toMatchObject({
    message: "Public queries are missing.",
    status: 409,
  });
});
it.each(["/collections/id/deep-refresh", "/collections/id/core/refresh"])(
  "explains an otherwise bare conflict from %s",
  async (path) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "conflict" }, { status: 409 })),
    );
    await expect(request(path)).rejects.toThrow("logs/api.log");
  },
);
it("handles a non-JSON conflict without losing its status", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("Conflict", { status: 409 })),
  );
  await expect(request("/collections/id/deep-refresh")).rejects.toMatchObject({
    message: expect.stringContaining("Public search queries"),
    status: 409,
  });
});
it("does not attribute unrelated conflicts to discovery", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () => new Response(null, { status: 409, statusText: "Conflict" }),
    ),
  );
  await expect(request("/works/id")).rejects.toMatchObject({
    message: "Conflict",
  });
});
