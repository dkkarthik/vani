import { CaptureMetadata } from "@vani/shared";

export async function resolveCaptureDoi(doi: string) {
  // The destination is fixed; supplied identifiers never become arbitrary fetch URLs.
  const response = await fetch(
    `https://api.crossref.org/works/${encodeURIComponent(doi)}`,
    {
      redirect: "error",
      headers: { "User-Agent": "VANI/0.1 (user-requested DOI lookup)" },
      signal: AbortSignal.timeout(12000),
    },
  );
  if (!response.ok)
    throw Object.assign(
      new Error(
        response.status === 404
          ? "DOI not found in Crossref. Open its publisher page and capture that page instead."
          : "Crossref is unavailable. Try again or capture the publisher page.",
      ),
      { statusCode: 422 },
    );
  const { message: item } = (await response.json()) as {
    message: Record<string, any>;
  };
  const plain = (value: unknown, max: number) =>
    typeof value === "string"
      ? value
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, max)
      : "";
  const metadata = CaptureMetadata.parse({
    title: plain(item.title?.[0], 2000),
    abstract: plain(item.abstract, 30000),
    doi,
    authors: (item.author ?? []).slice(0, 300).map((author: any) => ({
      given: plain(author.given, 300),
      family: plain(author.family || author.name || "Unknown", 500),
    })),
    year: item.published?.["date-parts"]?.[0]?.[0] ?? null,
    publicationDate: item.published?.["date-parts"]?.[0]?.join("-") ?? "",
    venue: plain(item["container-title"]?.[0], 1000),
    publisher: plain(item.publisher, 1000),
    volume: plain(item.volume, 100),
    issue: plain(item.issue, 100),
    pages: plain(item.page, 100),
    extractionMethod: "crossref_doi",
  });
  const pdfUrls = (item.link ?? [])
    .filter((link: any) => link["content-type"] === "application/pdf")
    .map((link: any) => link.URL)
    .filter((value: unknown): value is string => {
      if (typeof value !== "string" || value.length > 4096) return false;
      try {
        const url = new URL(value);
        return url.protocol === "https:" && !url.username && !url.password;
      } catch {
        return false;
      }
    })
    .slice(0, 5);
  const sourceUrl = `https://doi.org/${doi.split("/").map(encodeURIComponent).join("/")}`;
  return {
    sourceUrl,
    canonicalUrl: sourceUrl,
    metadata,
    pdfUrls,
    warnings: ["Details retrieved from Crossref. Review them before saving."],
  };
}
