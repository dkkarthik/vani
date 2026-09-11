import { expect, it, vi, afterEach } from "vitest";
import { MetadataFields, Rectangle, Tags } from "@vani/shared";
import { cleanupValues } from "./cleanup.js";
import { anchorStatus } from "./documents.js";
import {
  rankChunks,
  lexicalScore,
  cosine,
  embeddingKey,
  embed,
  type Chunk,
} from "./search.js";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("normalizes tags and names without changing order or identity", () => {
  const fields = MetadataFields.parse({
    title: "Paper",
    authors: [
      { given: "Ana  María", family: "de  Souza" },
      { given: "J.", family: "Smith" },
    ],
  });
  expect(
    cleanupValues(fields, ["robotics", "robots"], {
      type: "merge_tag",
      from: "ROBOTS",
      to: "Robotics",
    }).tags,
  ).toEqual(["robotics"]);
  expect(
    cleanupValues(fields, [], { type: "normalize_names" }).fields.authors.map(
      (a) => a.family,
    ),
  ).toEqual(["de Souza", "Smith"]);
  expect(() =>
    cleanupValues(fields, [], { type: "field", field: "year", value: 999 }),
  ).toThrow();
  expect(Tags.parse(["Test", " test "])).toEqual(["test"]);
});
it("validates page geometry and reports anchor uncertainty rather than relocating", () => {
  expect(
    Rectangle.safeParse({ x: 0.9, y: 0.1, width: 0.3, height: 0.1 }).success,
  ).toBe(false);
  const selector = { hash: "abc", page: 1, quote: "Robots learn", rects: [] };
  const index = {
    state: "ready",
    page_count: 1,
    pages: [{ page: 1, text: "Robots\nlearn from examples." }],
  };
  expect(anchorStatus(selector, "abc", index).status).toBe("exact");
  expect(anchorStatus(selector, "different", index).status).toBe("uncertain");
  expect(anchorStatus({ ...selector, page: 2 }, "abc", index).status).toBe(
    "unavailable",
  );
  expect(
    anchorStatus({ ...selector, quote: "Missing quotation" }, "abc", index)
      .status,
  ).toBe("uncertain");
});
it("ranks exact phrases and real semantic similarities without invented semantic scores", () => {
  const chunks: Chunk[] = [
    {
      id: "a",
      workId: "a",
      title: "a",
      key: "a",
      kind: "page",
      text: "Robots learn from demonstrations",
      url: "/a",
    },
    {
      id: "b",
      workId: "b",
      title: "b",
      key: "b",
      kind: "note",
      text: "Teaching machines by showing examples",
      url: "/b",
    },
  ];
  expect(lexicalScore("learn robots", "robots learn", true)).toBe(0);
  expect(rankChunks(chunks, "robots learn", true).map((c) => c.id)).toEqual([
    "a",
  ]);
  expect(rankChunks(chunks, "robots", false)[0]!.semantic).toBeNull();
  const vectors = new Map([
    [embeddingKey(chunks[0]!.text), [0, 1]],
    [embeddingKey(chunks[1]!.text), [1, 0]],
  ]);
  expect(rankChunks(chunks, "imitation", false, vectors, [1, 0])[0]!.id).toBe(
    "b",
  );
  expect(cosine([1, 0], [1, 0])).toBe(1);
  expect(cosine([0, 0], [1, 0])).toBe(0);
  expect(embeddingKey("changed")).not.toBe(embeddingKey("original"));
});
it("uses configured embedding vectors and rejects malformed provider output", async () => {
  vi.stubEnv("VANI_EMBED_MODEL", "fixture-model");
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        embeddings: [
          [1, 0],
          [0, 1],
        ],
      }),
    ),
  );
  vi.stubGlobal("fetch", fetch);
  expect(await embed(["one", "two"])).toEqual([
    [1, 0],
    [0, 1],
  ]);
  expect(JSON.parse(fetch.mock.calls[0]![1].body).input).toEqual([
    "one",
    "two",
  ]);
  fetch.mockResolvedValue(
    new Response(JSON.stringify({ embeddings: [["bad"]] })),
  );
  await expect(embed(["one"])).rejects.toThrow("invalid vectors");
});
