export interface PaperReference {
  text: string;
  identifiers: Array<{ label: string; url: string }>;
  recordUrl?: string;
  pdfLinks: Array<{ url: string; kind: "local" | "source" }>;
  missing: string[];
}

const list = (value: unknown): any[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string =>
  typeof value === "string" || typeof value === "number"
    ? String(value).replace(/\s+/g, " ").trim()
    : "";
const first = (...values: unknown[]) => values.map(text).find(Boolean) ?? "";
const known = (value: unknown) =>
  /^(unknown(?: venue| author)?|untitled|misc)$/i.test(text(value))
    ? ""
    : text(value);

export function externalPaperUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^https?:\/\//i.test(value.trim())) return;
  try {
    const url = new URL(value.trim());
    if (
      ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    )
      return url.href;
  } catch {
    /* Not a usable URL. */
  }
}

function payloads(paper: any, extra: any[] = []) {
  return [
    paper,
    paper?.sourcePayload,
    ...extra.flatMap((p) => [p, p?.sourcePayload]),
  ].filter((p) => p && typeof p === "object" && !Array.isArray(p));
}
function doiValue(value: unknown) {
  const doi = text(value).replace(
    /^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i,
    "",
  );
  return /^10\.\d{4,9}\/\S+$/i.test(doi) ? doi : "";
}
const arxivPattern = /^(?:\d{4}\.\d{4,5}|[a-z][a-z.-]*\/\d{7})(?:v\d+)?$/i;
function arxivIdentifier(value: unknown): string {
  const raw = text(value);
  if (arxivPattern.test(raw)) return raw;
  const doi = doiValue(raw);
  if (/^10\.48550\/arxiv\./i.test(doi))
    return arxivIdentifier(doi.replace(/^10\.48550\/arxiv\./i, ""));
  const link = externalPaperUrl(raw);
  if (!link) return "";
  const url = new URL(link);
  if (
    !["arxiv.org", "www.arxiv.org", "export.arxiv.org"].includes(url.hostname)
  )
    return "";
  const id = url.pathname.replace(/^\/(?:abs|pdf)\//, "").replace(/\.pdf$/, "");
  return arxivPattern.test(id) ? id : "";
}

// Read retained source metadata as well as normalized fields, so older records benefit immediately.
export function bibliographicMetadata(paper: any, extra: any[] = []) {
  const sources = payloads(paper, extra);
  const field = (key: string) => first(...sources.map((p) => p[key]));
  const authorLists = sources.flatMap((p) => [
    list(p.authors),
    list(p.author).map((a) => ({
      given: a.given,
      family: a.family || a.name,
      orcid: a.ORCID,
    })),
    list(p.authorships).map((a) => ({
      family: a.author?.display_name,
      orcid: a.author?.orcid,
    })),
  ]);
  const authors =
    authorLists
      .map((items) =>
        items
          .map((a) => ({
            given: text(a?.given),
            family: known(a?.family),
            ...(a?.orcid ? { orcid: a.orcid } : {}),
          }))
          .filter((a) => a.given || a.family),
      )
      .find((items) => items.length) ?? [];
  const doi = sources.map((p) => doiValue(p.doi ?? p.DOI)).find(Boolean) ?? "";
  const arxivId =
    sources
      .flatMap((p) => [
        p.arxivId,
        p.connector === "arxiv" ? p.externalId : undefined,
        p.doi,
        p.DOI,
        p.url,
        p.URL,
        p.ids?.arxiv,
        p.primary_location?.landing_page_url,
        ...list(p.locations).map((l) => l.landing_page_url),
      ])
      .map(arxivIdentifier)
      .find(Boolean) ?? "";
  const year =
    sources
      .flatMap((p) => [
        p.year,
        p.publication_year,
        p.published?.["date-parts"]?.[0]?.[0],
      ])
      .map((v) => Number(v))
      .find((y) => Number.isInteger(y) && y > 0) ?? null;
  const venue =
    first(
      ...sources.flatMap((p) => [
        known(p.venue),
        p["container-title"]?.[0],
        p.primary_location?.source?.display_name,
      ]),
    ) || (arxivId ? "arXiv" : "");
  const pages = first(
    ...sources.flatMap((p) => {
      const start = text(p.biblio?.first_page),
        end = text(p.biblio?.last_page);
      return [
        p.pages,
        p.page,
        start ? (end && end !== start ? `${start}–${end}` : start) : "",
      ];
    }),
  );
  const pdfUrls = [
    ...new Set(
      sources
        .flatMap((p) => [
          ...list(p.pdfUrls),
          p.pdfUrl,
          p.best_oa_location?.pdf_url,
          p.primary_location?.pdf_url,
          ...list(p.locations).map((l) => l.pdf_url),
          ...list(p.link)
            .filter((l) =>
              /^application\/pdf(?:\s*;|$)/i.test(text(l["content-type"])),
            )
            .map((l) => l.URL),
          ...[p.url, p.URL].filter((u) => {
            const safe = externalPaperUrl(u);
            return safe && /\.pdf$/i.test(new URL(safe).pathname);
          }),
        ])
        .concat(arxivId ? [`https://arxiv.org/pdf/${arxivId}`] : [])
        .map(externalPaperUrl)
        .filter((u): u is string => Boolean(u)),
    ),
  ];
  return {
    title:
      first(
        ...sources.map((p) =>
          known(Array.isArray(p.title) ? p.title[0] : p.title),
        ),
      ) || "Untitled",
    authors,
    year,
    venue,
    doi,
    arxivId,
    pages,
    pdfUrls,
    volume: first(field("volume"), ...sources.map((p) => p.biblio?.volume)),
    issue: first(field("issue"), ...sources.map((p) => p.biblio?.issue)),
    articleNumber: first(field("articleNumber"), field("article-number")),
    publisher: field("publisher"),
    url: sources
      .flatMap((p) => [p.url, p.URL, p.primary_location?.landing_page_url])
      .map(externalPaperUrl)
      .find(Boolean),
  };
}

export function paperReference(paper: any, extra: any[] = []): PaperReference {
  const b = bibliographicMetadata(paper, extra);
  const authors =
    b.authors
      .map((a) => [a.given, a.family].filter(Boolean).join(" "))
      .join("; ") || "Authors unavailable";
  const sentence = (s: string) => (/[.!?]$/.test(s) ? s : s + ".");
  const publication = [
    b.venue || b.publisher,
    b.volume
      ? `${b.volume}${b.issue ? `(${b.issue})` : ""}`
      : b.issue
        ? `issue ${b.issue}`
        : "",
    b.pages
      ? `pp. ${b.pages}`
      : b.articleNumber
        ? `Article ${b.articleNumber}`
        : "",
  ]
    .filter(Boolean)
    .join(", ");
  const identifiers: PaperReference["identifiers"] = [];
  if (b.doi)
    identifiers.push({
      label: `doi:${b.doi}`,
      url:
        "https://doi.org/" + b.doi.split("/").map(encodeURIComponent).join("/"),
    });
  if (b.arxivId)
    identifiers.push({
      label: `arXiv:${b.arxivId}`,
      url: `https://arxiv.org/abs/${b.arxivId}`,
    });
  return {
    text: `${authors} (${b.year ?? "n.d."}). ${sentence(b.title)}${publication ? " " + sentence(publication) : ""}`,
    identifiers,
    recordUrl: identifiers[0]?.url ?? b.url,
    pdfLinks: b.pdfUrls.map((url) => ({ url, kind: "source" })),
    missing: [
      !b.authors.length && "authors",
      !b.year && "year",
      !b.venue && "venue",
      b.title === "Untitled" && "title",
    ].filter((v): v is string => Boolean(v)),
  };
}
