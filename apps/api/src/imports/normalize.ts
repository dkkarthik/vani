import { MetadataFields, metadataWarnings } from "@vani/shared";
export const plain = (value: unknown) =>
  String(value ?? "")
    .replace(/<\/?[A-Za-z][^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const names = (value: any) =>
  (Array.isArray(value) ? value : []).map((name: any) => ({
    given: plain(name.given),
    family:
      plain(
        name.literal ||
          [name["non-dropping-particle"], name.family]
            .filter(Boolean)
            .join(" "),
      ) || "Unknown",
    ...(name.ORCID ? { orcid: String(name.ORCID) } : {}),
  }));
const date = (value: any) =>
  Array.isArray(value?.["date-parts"]?.[0])
    ? value["date-parts"][0]
        .map((n: number, i: number) =>
          i ? String(n).padStart(2, "0") : String(n),
        )
        .join("-")
    : "";
export function fromCsl(item: any): {
  metadata: MetadataFields;
  warnings: string[];
} {
  if (!item || typeof item !== "object" || Array.isArray(item))
    throw new Error("Expected a CSL-JSON record object.");
  const metadata = MetadataFields.parse({
    title: plain(item.title),
    abstract: plain(item.abstract),
    authors: names(item.author),
    editors: names(item.editor),
    year: item.issued?.["date-parts"]?.[0]?.[0] ?? null,
    doi: item.DOI || null,
    venue: plain(item["container-title"]),
    publisher: plain(item.publisher),
    publicationPlace: plain(item["publisher-place"]),
    publicationDate: date(item.issued),
    onlineDate: date(item["published-online"]),
    printDate: date(item["published-print"]),
    volume: plain(item.volume),
    issue: plain(item.issue),
    pages: plain(item.page),
    articleNumber: plain(item["article-number"] || item.number),
    edition: plain(item.edition),
    isbn: plain(item.ISBN),
    issn: plain(item.ISSN),
    language: plain(item.language),
    url: plain(item.URL),
    publicationType: plain(item.type) || "document",
    manifestationType:
      item.type === "preprint" ? "preprint" : "version_of_record",
  });
  const supported = new Set([
    "title",
    "abstract",
    "author",
    "editor",
    "issued",
    "DOI",
    "container-title",
    "publisher",
    "publisher-place",
    "published-online",
    "published-print",
    "volume",
    "issue",
    "page",
    "article-number",
    "number",
    "edition",
    "ISBN",
    "ISSN",
    "language",
    "URL",
    "type",
    "id",
    "citation-key",
    "note",
    "file",
    "attachments",
    "_graph",
  ]);
  const unknown = Object.keys(item).filter((key) => !supported.has(key));
  return {
    metadata,
    warnings: [
      ...metadataWarnings(metadata),
      ...unknown.map(
        (key) =>
          `Field “${key}” retained in the original/source payload; not mapped to a native field.`,
      ),
    ],
  };
}
