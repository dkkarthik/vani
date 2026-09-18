import { expect, it, vi } from "vitest";
import { buildApp } from "./app.js";
import { enqueueCore } from "./core/service.js";
vi.mock("./core/service.js", async (original) => ({
  ...(await original<typeof import("./core/service.js")>()),
  enqueueCore: vi.fn(),
}));
it("returns the actionable refresh conflict in the production API envelope", async () => {
  const message =
    "No public discovery inputs are available. Add Public search queries.";
  vi.mocked(enqueueCore).mockRejectedValueOnce(
    Object.assign(new Error(message), { statusCode: 409 }),
  );
  const app = await buildApp();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/collections/00000000-0000-4000-8000-000000000001/deep-refresh",
      payload: {},
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toBe(message);
  } finally {
    await app.close();
  }
});
