import { afterEach, expect, it, vi } from "vitest";
import { resolveCaptureDoi } from "./capture-resolve.js";
afterEach(() => vi.unstubAllGlobals());
it("resolves exact DOI metadata and retains only safe PDF download links", async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        message: {
          title: ["Paper title"],
          author: [{ given: "Grace", family: "Lee" }],
          published: { "date-parts": [[2024, 2, 3]] },
          link: [
            {
              "content-type": "application/pdf",
              URL: "https://publisher.test/full.pdf",
            },
            { "content-type": "application/pdf", URL: "javascript:alert(1)" },
          ],
        },
      }),
    ),
  );
  vi.stubGlobal("fetch", fetch);
  const resolved = await resolveCaptureDoi("10.1234/example");
  expect(fetch.mock.calls[0]?.[0]).toBe(
    "https://api.crossref.org/works/10.1234%2Fexample",
  );
  expect(resolved.metadata).toMatchObject({
    title: "Paper title",
    doi: "10.1234/example",
    year: 2024,
    extractionMethod: "crossref_doi",
  });
  expect(resolved.pdfUrls).toEqual(["https://publisher.test/full.pdf"]);
});
it("explains identifiers missing from Crossref without creating a fake record", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("", { status: 404 })),
  );
  await expect(resolveCaptureDoi("10.1234/missing")).rejects.toThrow(
    "not found in Crossref",
  );
});
