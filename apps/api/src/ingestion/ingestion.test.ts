import { describe, it, expect, vi } from "vitest";
vi.mock("node:dns/promises", () => ({
  resolve4: vi.fn(async () => ["127.0.0.1"]),
}));
import {
  downloadPaper,
  publicAddress,
  paperUrl,
  pageMetadata,
  isPdf,
} from "./download.js";
import { contributionExcerpt } from "./enrichment.js";
describe("paper ingestion boundaries", () => {
  it("rejects private, local and reserved destinations", async () => {
    for (const ip of [
      "127.0.0.1",
      "10.0.0.4",
      "172.16.0.2",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.1.1",
      "198.18.1.1",
      "224.0.0.1",
      "0.0.0.0",
      "::1",
    ])
      expect(publicAddress(ip)).toBe(false);
    expect(publicAddress("93.184.216.34")).toBe(true);
    await expect(downloadPaper("https://example.test/paper")).rejects.toThrow(
      "public internet",
    );
  });
  it("rejects credentials, non-web protocols and custom ports", () => {
    for (const url of [
      "file:///etc/passwd",
      "https://user:pass@example.org",
      "http://example.org:3000",
    ])
      expect(() => paperUrl(url)).toThrow();
  });
  it("reads citation tags independent of attribute order and resolves PDF links", () => {
    const m = pageMetadata(
      `<title>Fallback</title><meta content='A &amp; B' name='citation_title'><meta name="citation_author" content="Researcher"><meta name="citation_pdf_url" content="/paper.pdf"><meta name="citation_doi" content="10.1234/example">`,
      "https://example.org/paper",
    );
    expect(m.title).toBe("A & B");
    expect(m.pdfUrls).toEqual(["https://example.org/paper.pdf"]);
    expect(m.doi).toBe("10.1234/example");
    expect(isPdf(Buffer.from("<html>login</html>"))).toBe(false);
  });
  it("prefers the primary contribution over introductory background", () => {
    expect(
      contributionExcerpt(
        "Learning robots is a longstanding research area. We propose a robust learning method that improves control. Experiments evaluate accuracy.",
      ),
    ).toBe("We propose a robust learning method that improves control.");
  });
});
