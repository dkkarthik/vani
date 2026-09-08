import { describe, expect, it } from "vitest";
import {
  extractMetadata,
  normalizeDoi,
  readPage,
  safeUrl,
  type PageSnapshot,
} from "./extract";
const snapshot = (patch: Partial<PageSnapshot> = {}): PageSnapshot => ({
  url: "https://publisher.test/article/1",
  title: "Page title",
  heading: "",
  canonical: "",
  meta: {},
  jsonLd: [],
  links: [],
  ...patch,
});
describe("academic page extraction", () => {
  it("reads colon-separated PRISM fields", () => {
    const paper = extractMetadata(
      snapshot({
        meta: {
          "prism:title": ["PRISM paper"],
          "prism:doi": ["10.1234/prism"],
          "prism:publicationdate": ["2024-01-01"],
          "prism:publicationname": ["Research Journal"],
        },
      }),
    );
    expect(paper.metadata).toMatchObject({
      title: "PRISM paper",
      doi: "10.1234/prism",
      year: 2024,
      venue: "Research Journal",
      extractionMethod: "prism",
    });
  });
  it("prefers Highwire metadata and preserves ordered international authors", () => {
    const paper = extractMetadata(
      snapshot({
        meta: {
          citation_title: ["Evidence & models"],
          citation_author: ["de la Cruz, Ana", "王小明"],
          citation_doi: ["https://doi.org/10.1234/ABC"],
          citation_publication_date: ["2025/04/12"],
          citation_pdf_url: ["/paper.pdf"],
          citation_journal_title: ["Journal of Research"],
        },
      }),
    );
    expect(paper.metadata).toMatchObject({
      title: "Evidence & models",
      doi: "10.1234/abc",
      year: 2025,
      venue: "Journal of Research",
      extractionMethod: "highwire",
      authors: [
        { family: "de la Cruz", given: "Ana" },
        { family: "王小明", given: "" },
      ],
    });
    expect(paper.pdfUrls).toEqual(["https://publisher.test/paper.pdf"]);
  });
  it("reads Schema.org graphs and Dublin Core metadata", () => {
    const schema = extractMetadata(
      snapshot({
        jsonLd: [
          {
            "@graph": [
              {
                "@type": "ScholarlyArticle",
                headline: "A connected literature",
                identifier: { value: "10.4321/Paper" },
                datePublished: "2024-01-12",
                author: { givenName: "Grace", familyName: "Lee" },
                encoding: {
                  encodingFormat: "application/pdf",
                  contentUrl: "/full.pdf",
                },
              },
            ],
          },
        ],
      }),
    );
    expect(schema.metadata).toMatchObject({
      title: "A connected literature",
      doi: "10.4321/paper",
      year: 2024,
      authors: [{ given: "Grace", family: "Lee" }],
    });
    const dc = extractMetadata(
      snapshot({
        meta: { "dc.title": ["DC record"], "dc.creator": ["Lee, Grace"] },
      }),
    );
    expect(dc.metadata.extractionMethod).toBe("dublin_core");
  });
  it("finds arXiv and OpenReview PDFs without inventing a DOI", () => {
    expect(
      extractMetadata(snapshot({ url: "https://arxiv.org/abs/2401.12345v2" }))
        .pdfUrls,
    ).toEqual(["https://arxiv.org/pdf/2401.12345v2"]);
    const paper = extractMetadata(
      snapshot({ url: "https://openreview.net/forum?id=abc_123" }),
    );
    expect(paper.pdfUrls).toEqual(["https://openreview.net/pdf?id=abc_123"]);
    expect(paper.metadata.doi).toBeNull();
  });
  it("keeps signed PDF URLs for downloading while removing secrets from stored URLs", () => {
    const url =
      "https://publisher.test/paper.pdf?id=42&token=secret&utm_source=email#page=2";
    expect(safeUrl(url)).toBe("https://publisher.test/paper.pdf?id=42");
    expect(extractMetadata(snapshot({ url })).pdfUrls[0]).toBe(url);
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("https://user:secret@example.test/")).toBeNull();
    expect(() =>
      extractMetadata(snapshot({ url: "chrome://extensions" })),
    ).toThrow("Open an academic");
  });
  it("does not treat an arbitrary cited DOI in the page body as the article DOI", () => {
    document.head.innerHTML =
      '<title>Generic page</title><meta name="citation_title" content="Page paper"><script type="application/ld+json">{broken</script>';
    document.body.innerHTML =
      '<p>Reference: 10.1234/unrelated</p><a href="/paper.pdf">PDF</a>';
    const page = readPage();
    const paper = extractMetadata({
      ...page,
      url: "https://publisher.test/paper",
    });
    expect(paper.metadata.doi).toBeNull();
    expect(paper.metadata.title).toBe("Page paper");
    expect(paper.pdfUrls).toContain("https://publisher.test/paper.pdf");
    expect(normalizeDoi("not a DOI")).toBeNull();
  });
  it("marks sparse pages for review and ignores unsafe PDF links", () => {
    const page = extractMetadata(
      snapshot({
        links: [{ href: "javascript:alert(1)", text: "PDF", type: "" }],
      }),
    );
    expect(page.warnings).toHaveLength(1);
    expect(page.pdfUrls).toEqual([]);
  });
});
