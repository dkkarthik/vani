import { afterEach, expect, it, vi } from "vitest";
import { resolveMetadata } from "./metadata-sources.js";
afterEach(() => vi.unstubAllGlobals());
it("resolves exact Crossref metadata with provenance and rejects wrong DOI responses", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({
          message: {
            DOI: "10.1234/abc",
            title: ["Paper"],
            author: [{ given: "Ana", family: "García" }],
            issued: { "date-parts": [[2024, 2, 29]] },
            "container-title": ["Journal"],
            type: "journal-article",
          },
        }),
      ),
    );
  vi.stubGlobal("fetch", fetch);
  expect(await resolveMetadata("https://doi.org/10.1234/ABC")).toMatchObject({
    source: "crossref",
    authoritative: true,
    metadata: {
      title: "Paper",
      publicationDate: "2024-02-29",
      publicationType: "article-journal",
    },
  });
  fetch.mockResolvedValue(
    new Response(
      JSON.stringify({ message: { DOI: "10.1234/wrong", title: ["Other"] } }),
    ),
  );
  await expect(resolveMetadata("10.1234/abc")).rejects.toThrow("different DOI");
});
it("falls back only on Crossref 404 and preserves DataCite dataset type", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response("", { status: 404 }))
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            attributes: {
              doi: "10.1234/data",
              titles: [{ title: "Dataset" }],
              creators: [{ name: "Institute" }],
              publicationYear: 2024,
              publisher: "Archive",
              types: { citeproc: "dataset" },
            },
          },
        }),
      ),
    );
  vi.stubGlobal("fetch", fetch);
  expect(await resolveMetadata("10.1234/data")).toMatchObject({
    source: "datacite",
    metadata: {
      publicationType: "dataset",
      authors: [{ family: "Institute" }],
    },
  });
  expect(fetch.mock.calls[1]![0]).toBe(
    "https://api.datacite.org/dois/10.1234%2Fdata",
  );
});
it("keeps a preprint separate from its related published DOI", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          "<feed><entry><id>http://arxiv.org/abs/2401.01234v2</id><title>Preprint</title><summary>Abstract</summary><published>2024-01-02T00:00:00Z</published><author><name>Ana García</name></author><arxiv:doi>10.1234/published</arxiv:doi></entry></feed>",
        ),
      ),
  );
  expect(await resolveMetadata("2401.01234v2")).toMatchObject({
    source: "arxiv",
    metadata: {
      doi: null,
      manifestationType: "preprint",
      url: "https://arxiv.org/abs/2401.01234v2",
    },
  });
});
it("does not follow arbitrary URLs or hide provider failures", async () => {
  const fetch = vi.fn().mockRejectedValue(new Error("Offline"));
  vi.stubGlobal("fetch", fetch);
  await expect(resolveMetadata("http://127.0.0.1/private")).rejects.toThrow(
    "Supported identifiers",
  );
  expect(fetch).not.toHaveBeenCalled();
  await expect(resolveMetadata("10.1234/abc")).rejects.toThrow("Offline");
});
