import { afterEach, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { v7 as uuid } from "uuid";
import { registerReview } from "./review.js";
import { generate } from "../models/router.js";
vi.mock("../db.js", () => ({
  pool: {
    query: vi.fn(async () => ({
      rows: [
        {
          id: "paper",
          title: "Sparse maps",
          feedback: { label: "related", reason: "Private explanation" },
        },
      ],
    })),
  },
}));
vi.mock("./service.js", () => ({
  getFocus: vi.fn(async () => ({
    version: 7,
    profile: { question: "Mapping", publicQueries: ["maps"] },
  })),
}));
vi.mock("../models/router.js", () => ({
  generate: vi.fn(async () => ({
    value: { queries: ["sparse maps"], explanation: "Explore compact maps" },
    provenance: { provider: "ollama" },
  })),
}));
afterEach(() => vi.clearAllMocks());
it("proposes locally with private feedback and returns an unapplied versioned preview", async () => {
  const app = Fastify();
  await registerReview(app);
  const id = uuid();
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/collections/${id}/core/query-proposal`,
    payload: {},
  });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({
    version: 7,
    queries: ["sparse maps"],
    feedbackIds: ["paper"],
  });
  expect(vi.mocked(generate).mock.calls[0]![3]).toEqual({
    task: "synthesis",
    collectionId: id,
    privateEvidence: true,
  });
  expect(vi.mocked(generate).mock.calls[0]![1]).toMatchObject({
    examples: [{ reason: "Private explanation" }],
  });
  await app.close();
});
