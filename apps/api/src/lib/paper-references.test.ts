import { expect, it } from "vitest";
import { bibliographicMetadata, paperReference } from "@vani/shared";
import { mergePaperMetadata } from "../simple-discovery/corpus.js";

it("formats every author, full publication details and a resolvable DOI", () => {
  const p = paperReference({
    title: "Adaptive maps",
    year: 2025,
    venue: "Journal of Robotics",
    volume: "12",
    issue: "3",
    pages: "41–57",
    authors: [
      { given: "Ada", family: "Lovelace" },
      ...Array.from({ length: 6 }, (_, n) => ({ family: `Researcher ${n}` })),
    ],
    doi: "https://doi.org/10.1234/maps",
  });
  expect(p.text).toBe(
    "Ada Lovelace; Researcher 0; Researcher 1; Researcher 2; Researcher 3; Researcher 4; Researcher 5 (2025). Adaptive maps. Journal of Robotics, 12(3), pp. 41–57.",
  );
  expect(p.identifiers).toEqual([
    { label: "doi:10.1234/maps", url: "https://doi.org/10.1234/maps" },
  ]);
  expect(p.missing).toEqual([]);
  expect(p.pdfLinks).toEqual([]);
});

it("marks missing metadata without inventing authors, venues or dates", () => {
  const p = paperReference({
    title: "An uploaded manuscript",
    authors: [],
    venue: "Unknown venue",
    publicationDate: "",
    createdAt: "2026-09-23",
  });
  expect(p.text).toBe("Authors unavailable (n.d.). An uploaded manuscript.");
  expect(p.missing).toEqual(["authors", "year", "venue"]);
  expect(p.recordUrl).toBeUndefined();
});

it("recovers OpenAlex biblio and explicit PDFs without treating OA landing pages as PDFs", () => {
  const p = paperReference({
    title: "Maps",
    sourcePayload: {
      publication_year: 2024,
      primary_location: { source: { display_name: "ICRA" } },
      authorships: [{ author: { display_name: "Team Robotics" } }],
      biblio: { first_page: "15", last_page: "22", volume: "4" },
      best_oa_location: { pdf_url: "https://example.org/maps.pdf" },
      locations: [{ pdf_url: "https://example.org/maps.pdf" }],
      open_access: { oa_url: "https://example.org/record/123" },
    },
  });
  expect(p.text).toBe("Team Robotics (2024). Maps. ICRA, 4, pp. 15–22.");
  expect(p.pdfLinks).toEqual([
    { url: "https://example.org/maps.pdf", kind: "source" },
  ]);
});

it("recovers Crossref article numbers and only PDF-typed links", () => {
  const p = paperReference({}, [
    {
      title: ["Mesh learning"],
      author: [{ name: "Mesh Consortium" }],
      published: { "date-parts": [[2023]] },
      "container-title": ["Transactions on Meshes"],
      "article-number": "e123",
      volume: "8",
      link: [
        {
          URL: "https://example.org/file?id=1",
          "content-type": "application/pdf",
        },
        { URL: "https://example.org/xml", "content-type": "text/xml" },
      ],
    },
  ]);
  expect(p.text).toBe(
    "Mesh Consortium (2023). Mesh learning. Transactions on Meshes, 8, Article e123.",
  );
  expect(p.pdfLinks).toEqual([
    { url: "https://example.org/file?id=1", kind: "source" },
  ]);
});

it("recognizes modern and legacy arXiv identifiers, including DOI-only records", () => {
  for (const [paper, id] of [
    [{ doi: "10.48550/arXiv.2401.12345" }, "2401.12345"],
    [{ url: "https://arxiv.org/abs/cs/0601001v2" }, "cs/0601001v2"],
    [{ connector: "arxiv", externalId: "hep-th/9901001" }, "hep-th/9901001"],
  ] as const) {
    const p = paperReference(paper);
    expect(p.identifiers).toContainEqual({
      label: `arXiv:${id}`,
      url: `https://arxiv.org/abs/${id}`,
    });
    expect(p.pdfLinks).toContainEqual({
      url: `https://arxiv.org/pdf/${id}`,
      kind: "source",
    });
  }
  expect(
    paperReference({ url: "https://arxiv.org.evil.test/abs/2401.12345" })
      .pdfLinks,
  ).toEqual([]);
});

it("rejects executable, relative and credential-bearing links; permits declared HTTP(S) PDFs", () => {
  const p = paperReference({
    url: "javascript:alert(1)",
    pdfUrls: [
      "javascript:alert(1)",
      "file:///private/paper.pdf",
      "//example.org/a.pdf",
      "https://user:secret@example.org/a.pdf",
      "https://example.org/a.pdf",
    ],
    doi: "not-a-doi",
  });
  expect(p.pdfLinks).toEqual([
    { url: "https://example.org/a.pdf", kind: "source" },
  ]);
  expect(p.recordUrl).toBeUndefined();
  expect(p.identifiers).toEqual([]);
});

it("preserves rich citation/PDF data through sparse source merges and preprint updates", () => {
  const old = {
    title: "Adaptive maps",
    year: 2025,
    venue: "ICRA",
    authors: [{ given: "Ada", family: "Researcher" }],
    doi: "10.1234/published",
    sourcePayload: {
      biblio: { first_page: "1", last_page: "8" },
      locations: [{ pdf_url: "https://example.org/paper.pdf" }],
    },
  };
  const merged = mergePaperMetadata(old, {
    title: "Adaptive maps",
    connector: "crossref",
    authors: [],
    doi: null,
    venue: "",
    sourcePayload: {},
  });
  expect(bibliographicMetadata(merged)).toMatchObject({
    authors: old.authors,
    venue: "ICRA",
    year: 2025,
    pages: "1–8",
    doi: old.doi,
    pdfUrls: ["https://example.org/paper.pdf"],
  });
  const preprint = mergePaperMetadata(merged, {
    title: "Adaptive maps",
    year: 2024,
    venue: "arXiv",
    manifestationType: "preprint",
    doi: "10.48550/arxiv.2401.12345",
    url: "https://arxiv.org/abs/2401.12345",
  });
  expect(preprint).toMatchObject({ year: 2025, venue: "ICRA", doi: old.doi });
  expect(paperReference(preprint).pdfLinks).toHaveLength(2);
  expect(paperReference(preprint).identifiers).toContainEqual({
    label: "arXiv:2401.12345",
    url: "https://arxiv.org/abs/2401.12345",
  });
});
