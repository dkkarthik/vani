import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { z } from "zod";
import { config } from "../config.js";
import {
  generate,
  embed,
  localEndpoint,
  localModel,
  resetModelIdentity,
  configureModelPersistence,
} from "./router.js";
const original = { ...config };
beforeEach(() => {
  resetModelIdentity();
  configureModelPersistence(undefined, undefined);
  config.openAiKey = "configured-but-not-authorized";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      if (String(url).endsWith("/api/tags"))
        return Response.json({
          models: [{ name: config.ollamaModel, digest: "test-digest" }],
        });
      return Response.json({
        done: true,
        message: { content: JSON.stringify({ text: "local" }) },
        prompt_eval_count: 10,
        eval_count: 2,
      });
    }),
  );
});
afterEach(() => {
  Object.assign(config, original);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("uses loopback and local model digest even when a cloud key is configured", async () => {
  const result = await generate(
    "Return text",
    { source: "paper" },
    z.object({ text: z.string() }),
  );
  expect(result.value.text).toBe("local");
  expect(result.provenance.digest).toBe("test-digest");
  expect(
    vi
      .mocked(fetch)
      .mock.calls.every(([url]) => String(url).startsWith("http://127.0.0.1")),
  ).toBe(true);
});
it("rejects remote endpoints, hosted identities, and unauthorized conversation escalation", async () => {
  expect(() => localEndpoint("http://192.168.1.2:11434")).toThrow();
  expect(() => localModel("qwen:cloud")).toThrow();
  await expect(
    generate("x", {}, z.object({}), {
      task: "collection_conversation",
      approvalId: "no",
    }),
  ).rejects.toThrow("not permitted");
  expect(fetch).not.toHaveBeenCalled();
  vi.mocked(fetch).mockResolvedValue(
    Response.json({
      models: [
        {
          name: config.ollamaModel,
          digest: "hosted",
          remote_host: "ollama.com",
        },
      ],
    }),
  );
  await expect(generate("x", {}, z.object({}))).rejects.toThrow(
    "missing or hosted",
  );
});
it("does not fall back to cloud after offline, malformed, or truncated responses", async () => {
  vi.mocked(fetch).mockRejectedValue(Error("offline"));
  await expect(generate("x", {}, z.object({}))).rejects.toThrow("offline");
  expect(vi.mocked(fetch).mock.calls).toHaveLength(1);
  resetModelIdentity();
  vi.mocked(fetch).mockImplementation(async (url) =>
    String(url).endsWith("/api/tags")
      ? Response.json({ models: [{ name: config.ollamaModel, digest: "d" }] })
      : Response.json({ done_reason: "length", message: { content: "{}" } }),
  );
  await expect(generate("x", {}, z.object({}))).rejects.toThrow("incomplete");
});
it("serializes generation and rejects oversize contexts without network access", async () => {
  await expect(
    generate("x", { text: "x".repeat(50000) }, z.object({})),
  ).rejects.toThrow("context budget");
  expect(fetch).not.toHaveBeenCalled();
  let active = 0,
    max = 0;
  vi.mocked(fetch).mockImplementation(async (url) => {
    if (String(url).endsWith("/api/tags"))
      return Response.json({
        models: [{ name: config.ollamaModel, digest: "d" }],
      });
    active++;
    max = Math.max(max, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return Response.json({ message: { content: "{}" }, done: true });
  });
  await Promise.all([
    generate("x", {}, z.object({})),
    generate("x", {}, z.object({})),
  ]);
  expect(max).toBe(1);
});
it("rejects malformed embedding dimensions", async () => {
  vi.stubEnv("OLLAMA_EMBED_MODEL", config.ollamaModel);
  vi.mocked(fetch).mockImplementation(async (url) =>
    String(url).endsWith("/api/tags")
      ? Response.json({ models: [{ name: config.ollamaModel, digest: "d" }] })
      : Response.json({ embeddings: [[1, 0], [1]] }),
  );
  await expect(embed(["a", "b"])).rejects.toThrow("shape");
});

it("sends the task schema to local structured generation and still validates the response", async () => {
  const schema = z.object({
    text: z.string(),
    uncertainties: z.array(z.string()).default([]),
  });
  await generate("Return text and uncertainties", { source: "paper" }, schema);
  const call = vi
    .mocked(fetch)
    .mock.calls.find(([url]) => String(url).endsWith("/api/chat"));
  const body = JSON.parse(String(call?.[1]?.body));
  expect(body.format.type).toBe("object");
  expect(body.format.properties.text.type).toBe("string");
  expect(body.format.required).toContain("text");
  expect(body.format.properties.uncertainties.type).toBe("array");
  vi.mocked(fetch).mockResolvedValue(
    Response.json({
      done: true,
      message: { content: JSON.stringify({ text: null }) },
    }),
  );
  await expect(generate("Return text", {}, schema)).rejects.toThrow();
});
it("retains raw output and consumed tokens when schema validation fails", async () => {
  const diagnostic = vi.fn();
  vi.mocked(fetch).mockImplementation(async (url) =>
    String(url).endsWith("/api/tags")
      ? Response.json({
          models: [{ name: config.ollamaModel, digest: "test" }],
        })
      : Response.json({
          done: true,
          prompt_eval_count: 40,
          eval_count: 25,
          message: { content: '{"wrong":"field"}' },
        }),
  );
  await expect(
    generate("x", {}, z.object({ required: z.string() }), {
      onDiagnostic: diagnostic,
    }),
  ).rejects.toThrow();
  expect(diagnostic).toHaveBeenCalledWith(
    '{"wrong":"field"}',
    expect.objectContaining({
      status: "failed",
      inputTokens: 40,
      outputTokens: 25,
    }),
  );
});
