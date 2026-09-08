import type { CaptureMetadata } from "@vani/shared";

export interface PageSnapshot {
  url: string;
  title: string;
  heading: string;
  meta: Record<string, string[]>;
  canonical: string;
  jsonLd: unknown[];
  links: Array<{ href: string; text: string; type: string }>;
}
export interface ExtractedPage {
  sourceUrl: string;
  canonicalUrl: string;
  metadata: CaptureMetadata;
  pdfUrls: string[];
  warnings: string[];
}

// Self-contained: Chrome serializes this function into the clicked tab's isolated world.
export function readPage(): PageSnapshot {
  const meta: Record<string, string[]> = {};
  for (const element of Array.from(document.querySelectorAll("meta")).slice(
    0,
    1500,
  )) {
    const key = (
      element.getAttribute("name") ||
      element.getAttribute("property") ||
      ""
    ).toLowerCase();
    const value = element.getAttribute("content")?.trim();
    if (
      key &&
      value &&
      /^(citation_|dc[.:]|dcterms[.:]|prism[.:]|og:|description$)/.test(key)
    ) {
      (meta[key] ??= []).push(value.slice(0, 30000));
    }
  }
  const jsonLd: unknown[] = [];
  for (const element of Array.from(
    document.querySelectorAll('script[type="application/ld+json"]'),
  ).slice(0, 20)) {
    if ((element.textContent?.length ?? 0) > 150000) continue;
    try {
      jsonLd.push(JSON.parse(element.textContent || "null"));
    } catch {
      /* Broken publisher markup is common. */
    }
  }
  const links = Array.from(
    document.querySelectorAll<HTMLAnchorElement>(
      'a[href], link[type="application/pdf"]',
    ),
  )
    .filter(
      (element) =>
        element.getAttribute("type") === "application/pdf" ||
        /(?:\.pdf(?:[?#]|$)|\/pdf(?:\/|\?|$))/i.test(
          element.getAttribute("href") || "",
        ) ||
        /^(?:download|view|full.text)?\s*(?:article\s*)?pdf(?:\s*\(.*\))?$/i.test(
          element.textContent?.trim() || "",
        ),
    )
    .slice(0, 20)
    .map((element) => ({
      href: element.getAttribute("href") || "",
      text: (element.textContent || "").trim().slice(0, 100),
      type: element.getAttribute("type") || "",
    }));
  return {
    url: location.href,
    title: document.title.slice(0, 2000),
    heading:
      document.querySelector("h1")?.textContent?.trim().slice(0, 2000) || "",
    canonical:
      document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ||
      "",
    meta,
    jsonLd,
    links,
  };
}

export function safeUrl(value: string, base?: string): string | null {
  try {
    const url = new URL(value, base);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (
        /^(utm_.+|fbclid|gclid|access_token|auth_token|token|session|sessionid|jsessionid|signature|x-amz-.+)$/i.test(
          key,
        )
      )
        url.searchParams.delete(key);
    }
    return url.href.length <= 4096 ? url.href : null;
  } catch {
    return null;
  }
}

export function normalizeDoi(value: string): string | null {
  let doi = value
    .trim()
    .replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, "");
  try {
    doi = decodeURIComponent(doi);
  } catch {
    /* Keep the original if malformed. */
  }
  return /^10\.\d{4,9}\/[^\s<>]+$/i.test(doi) ? doi.toLowerCase() : null;
}

export function parseAuthors(values: string[]): CaptureMetadata["authors"] {
  return values
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 300)
    .map((value) => {
      // Only invert explicit "family, given" names. Preserve other scripts/compound names intact.
      const comma = value.indexOf(",");
      return comma > 0
        ? {
            family: value.slice(0, comma).trim().slice(0, 500),
            given: value
              .slice(comma + 1)
              .trim()
              .slice(0, 300),
          }
        : { family: value.slice(0, 500), given: "" };
    });
}

export function extractMetadata(page: PageSnapshot): ExtractedPage {
  const sourceUrl = safeUrl(page.url);
  if (!sourceUrl)
    throw new Error(
      "Open an academic article or an HTTP/HTTPS PDF, then click VANI again.",
    );
  const first = (...keys: string[]) =>
    keys.flatMap((key) => page.meta[key] ?? []).find(Boolean) ?? "";
  const all = (...keys: string[]) =>
    keys.map((key) => page.meta[key]).find((values) => values?.length) ?? [];
  const objects: Record<string, any>[] = [];
  const visit = (value: unknown, depth = 0) => {
    if (!value || depth > 5 || objects.length > 100) return;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 100)) visit(item, depth + 1);
    } else if (typeof value === "object") {
      objects.push(value as Record<string, any>);
      visit((value as any)["@graph"], depth + 1);
      visit((value as any).mainEntity, depth + 1);
    }
  };
  page.jsonLd.forEach((value) => visit(value));
  const article =
    objects.find((value) =>
      [value["@type"]]
        .flat()
        .some((type) =>
          /^(ScholarlyArticle|Article|MedicalScholarlyArticle|CreativeWork|Report|Thesis|Book)$/.test(
            String(type),
          ),
        ),
    ) ?? {};
  const plain = (value: unknown, max = 30000): string =>
    typeof value === "string"
      ? value
          .replace(/<[^>]*>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, max)
      : "";
  const title = plain(
    first(
      "citation_title",
      "dc.title",
      "dc:title",
      "prism.title",
      "prism:title",
    ) ||
      article.headline ||
      article.name ||
      first("og:title") ||
      page.heading ||
      page.title,
    2000,
  );
  const canonicalUrl = safeUrl(page.canonical, page.url) ?? sourceUrl;
  const identities = [
    first(
      "citation_doi",
      "dc.identifier",
      "dc:identifier",
      "prism.doi",
      "prism:doi",
    ),
    article.doi,
    ...[article.identifier]
      .flat()
      .map((value) => (typeof value === "object" ? value?.value : value)),
    canonicalUrl,
    sourceUrl,
  ];
  const doi =
    identities
      .filter((value) => typeof value === "string")
      .map(normalizeDoi)
      .find(Boolean) ?? null;
  const publicationDate = plain(
    first(
      "citation_publication_date",
      "citation_date",
      "dc.date",
      "dc:date",
      "prism.publicationdate",
      "prism:publicationdate",
    ) || article.datePublished,
    50,
  );
  const authorValues = all("citation_author", "dc.creator", "dc:creator");
  const authors = authorValues.length
    ? parseAuthors(authorValues)
    : [article.author]
        .flat()
        .filter(Boolean)
        .slice(0, 300)
        .map((author) => {
          if (typeof author === "string") return parseAuthors([author])[0]!;
          return author.familyName
            ? {
                family: plain(author.familyName, 500),
                given: plain(author.givenName, 300),
              }
            : parseAuthors([plain(author.name, 500)])[0];
        })
        .filter((author): author is CaptureMetadata["authors"][number] =>
          Boolean(author?.family),
        );
  const pdfUrls: string[] = [];
  const addPdf = (value: unknown) => {
    if (typeof value !== "string" || !value.trim()) return;
    // Keep signed download URLs intact for fetching, but never use them as canonical identity.
    try {
      const url = new URL(value, page.url);
      if (
        ["http:", "https:"].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        url.href.length <= 4096 &&
        !pdfUrls.includes(url.href)
      )
        pdfUrls.push(url.href);
    } catch {
      /* Ignore invalid links. */
    }
  };
  if (/\.pdf(?:[?#]|$)|\/pdf(?:\/|\?|$)/i.test(page.url)) addPdf(page.url);
  all("citation_pdf_url", "wkhealth_pdf_url").forEach(addPdf);
  [article.encoding]
    .flat()
    .filter(Boolean)
    .forEach((encoding) => {
      if (/pdf/i.test(encoding.encodingFormat || encoding.fileFormat || ""))
        addPdf(encoding.contentUrl);
    });
  const current = new URL(page.url);
  if (
    /(^|\.)arxiv\.org$/.test(current.hostname) &&
    /^\/(abs|html)\//.test(current.pathname)
  )
    addPdf(
      `https://arxiv.org${current.pathname.replace(/^\/(abs|html)\//, "/pdf/")}`,
    );
  if (
    /(^|\.)openreview\.net$/.test(current.hostname) &&
    current.pathname === "/forum" &&
    current.searchParams.get("id")
  )
    addPdf(
      `https://openreview.net/pdf?id=${encodeURIComponent(current.searchParams.get("id")!)}`,
    );
  page.links.forEach((link) => addPdf(link.href));
  const scholarly = Boolean(
    first(
      "citation_title",
      "dc.title",
      "dc:title",
      "prism.title",
      "prism:title",
    ) ||
    article["@type"] ||
    doi,
  );
  const yearMatch = publicationDate.match(/\b(?:1\d{3}|2\d{3})\b/);
  return {
    sourceUrl,
    canonicalUrl,
    pdfUrls: pdfUrls.slice(0, 5),
    warnings: scholarly
      ? []
      : [
          "Limited metadata on this page. Check the title and details before saving.",
        ],
    metadata: {
      title: title || "Untitled paper",
      abstract: plain(
        first("citation_abstract", "dc.description", "dc:description") ||
          article.abstract ||
          article.description ||
          first("description", "og:description"),
      ),
      authors,
      doi,
      year: yearMatch ? Number(yearMatch[0]) : null,
      venue: plain(
        first(
          "citation_journal_title",
          "citation_conference_title",
          "prism.publicationname",
          "prism:publicationname",
        ) || article.isPartOf?.name,
        1000,
      ),
      publisher: plain(
        first("citation_publisher", "dc.publisher", "dc:publisher") ||
          article.publisher?.name,
        1000,
      ),
      publicationDate,
      volume: plain(first("citation_volume") || article.volumeNumber, 100),
      issue: plain(first("citation_issue") || article.issueNumber, 100),
      pages:
        [first("citation_firstpage"), first("citation_lastpage")]
          .filter(Boolean)
          .join("-")
          .slice(0, 100) || plain(article.pagination, 100),
      extractionMethod: first("citation_title")
        ? "highwire"
        : first("dc.title", "dc:title")
          ? "dublin_core"
          : first("prism.title", "prism:title")
            ? "prism"
            : article["@type"]
              ? "schema_org"
              : "page_fallback",
    },
  };
}
