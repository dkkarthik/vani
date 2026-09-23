import { it, expect } from "vitest";
import { rank } from "./ranker.js";
import { aliases, isPublicPaper } from "./corpus.js";
import {
  arxivRecords,
  buildUrl,
  fetchBatch,
  ProviderError,
} from "./sources.js";
import { vi, afterEach } from "vitest";
afterEach(() => vi.unstubAllGlobals());
it("learns a method preference, exposes actual contributions and is deterministic", () => {
  const docs = [
    {
      id: "seed",
      title: "Adaptive mesh refinement sparse spatial maps",
      abstract: "Hierarchical discretization of spatial representations.",
      seed: true,
    },
    { id: "a", title: "Sparse spatial maps with adaptive mesh refinement" },
    { id: "b", title: "Robot navigation through social crowds" },
    { id: "c", title: "Economic analysis of housing costs" },
    { id: "d", title: "Medical cancer treatments" },
  ];
  const a = rank(docs, "robot navigation");
  expect(a.metadata.algorithm).toBe("tfidf-linear-svm-v1");
  expect(a.items.find((x) => x.id === "a")!.score).toBeGreaterThan(
    a.items.find((x) => x.id === "b")!.score,
  );
  expect(
    a.items
      .find((x) => x.id === "a")!
      .terms.some((x) => x.term.includes("mesh")),
  ).toBe(true);
  expect(rank([...docs].reverse(), "robot navigation")).toEqual(a);
  const b = rank(
    docs.map((d) => (d.id === "a" ? { ...d, label: "down" as const } : d)),
    "robot navigation",
  );
  expect(b.items.find((x) => x.id === "a")!.score).toBeLessThan(
    a.items.find((x) => x.id === "a")!.score,
  );
  expect(b.metadata.negative).toBe(1);
});
it("uses a clearly labeled cosine fallback without positive examples", () => {
  const r = rank(
    [
      { id: "a", title: "Sparse maps" },
      { id: "b", title: "Social crowds" },
    ],
    "sparse maps",
  );
  expect(r.metadata.algorithm).toBe("tfidf-cosine-v1");
  expect(r.items[0]!.id).toBe("a");
  expect(r.items[0]!.score).toBeCloseTo(1);
});
it("deduplicates arXiv versions and DOI variants and excludes private seeds", () => {
  expect(
    aliases({
      title: "A long distinctive scientific paper title",
      year: 2026,
      url: "https://arxiv.org/abs/2601.12345v3",
      doi: "https://doi.org/10.1234/TEST",
    }),
  ).toContain("arxiv:2601.12345");
  expect(aliases({ doi: "10.1234/test" })).toContain("doi:10.1234/test");
  expect(aliases({ doi: "10.1234/2601.12345" })).not.toContain(
    "arxiv:2601.12345",
  );
  expect(
    isPublicPaper({
      connector: "arxiv",
      externalId: "2601.12345",
      title: "Private",
      accessClass: "user_uploaded",
    }),
  ).toBe(false);
});
it("parses versioned Atom metadata, handles empty feeds, and rejects provider error entries", () => {
  const xml =
    "<feed><entry><id>http://arxiv.org/abs/2601.12345v2</id><title>Sparse maps</title><summary>Adaptive grids.</summary><published>2026-01-01T00:00:00Z</published><author><name>A Researcher</name></author><arxiv:doi>10.1234/grid</arxiv:doi></entry></feed>";
  expect(arxivRecords(xml)[0]).toMatchObject({
    externalId: "2601.12345",
    doi: "10.1234/grid",
    abstract: "Adaptive grids.",
  });
  expect(arxivRecords("<feed/>")).toEqual([]);
  expect(() =>
    arxivRecords(
      "<feed><entry><id>http://arxiv.org/api/errors</id></entry></feed>",
    ),
  ).toThrow();
  const u = buildUrl({
    source: "arxiv",
    kind: "query",
    query: "adaptive mesh",
    page: 1,
    state: "pending",
    found: 0,
  });
  expect(u.searchParams.get("search_query")).toBe("all:adaptive AND all:mesh");
  expect(u.searchParams.get("start")).toBe("100");
});
it("reports source cooldowns without leaking credentials", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response("", { status: 429, headers: { "retry-after": "60" } }),
    ),
  );
  const e = await fetchBatch({
    source: "openalex",
    kind: "query",
    query: "mesh",
    page: 0,
    state: "pending",
    found: 0,
  }).catch((e) => e);
  expect(e).toBeInstanceOf(ProviderError);
  expect(new Date(e.retryAt).getTime()).toBeGreaterThan(Date.now() + 50000);
  expect(e.message).toContain("openalex HTTP 429");
});
