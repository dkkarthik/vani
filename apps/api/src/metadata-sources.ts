import { XMLParser } from "fast-xml-parser";
import { MetadataFields, normalizeDoi } from "@vani/shared";
import { fromCsl, plain } from "./imports/normalize.js";
export interface SourceAssertion {
  source: string;
  externalId: string;
  sourceUrl: string;
  metadata: MetadataFields;
  raw: unknown;
  authoritative: boolean;
}
async function get(url: string) {
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(12000),
    headers: { "User-Agent": "VANI/0.1 (user-requested bibliographic lookup)" },
  });
  if (!response.ok)
    throw Object.assign(
      new Error(
        `Metadata provider returned HTTP ${response.status}. Retry or enter the record manually.`,
      ),
      { statusCode: 422, providerStatus: response.status },
    );
  const reader = response.body?.getReader();
  if (!reader)
    throw Object.assign(
      new Error("Metadata provider returned an empty response."),
      { statusCode: 422 },
    );
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 2_000_000) {
      await reader.cancel();
      throw Object.assign(
        new Error("Metadata response exceeded the 2 MB limit."),
        { statusCode: 422 },
      );
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
let lastArxiv = 0;
let arxivGate = Promise.resolve();
export function parseIdentifier(input: string): {
  kind: "doi" | "arxiv";
  id: string;
} {
  const doi = normalizeDoi(input);
  if (/^10\.\d{4,9}\/[^\s<>]+$/.test(doi)) return { kind: "doi", id: doi };
  const arxiv = input
    .trim()
    .replace(/^(?:arxiv:\s*|https?:\/\/arxiv\.org\/(?:abs|pdf)\/)/i, "")
    .replace(/\.pdf$/, "");
  if (/^(?:\d{4}\.\d{4,5}|[a-z.-]+\/\d{7})(?:v\d+)?$/i.test(arxiv))
    return { kind: "arxiv", id: arxiv };
  throw Object.assign(
    new Error(
      "Supported identifiers are a DOI or arXiv ID/URL. This identifier was not imported.",
    ),
    { statusCode: 422 },
  );
}
export async function resolveMetadata(
  identifier: string,
): Promise<SourceAssertion> {
  const parsed = parseIdentifier(identifier);
  if (parsed.kind === "arxiv") {
    let release!: () => void;
    const before = arxivGate;
    arxivGate = new Promise((resolve) => {
      release = resolve;
    });
    await before;
    try {
      const wait = Math.max(0, 3000 - (Date.now() - lastArxiv));
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      lastArxiv = Date.now();
      const raw = await get(
        `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(parsed.id)}`,
      );
      const xml = new XMLParser({
        ignoreAttributes: false,
        processEntities: false,
      }).parse(raw);
      const entry = [xml.feed?.entry]
        .flat()
        .find((item) => item?.id && !String(item.id).includes("/errors"));
      if (!entry)
        throw Object.assign(new Error("arXiv record not found."), {
          statusCode: 422,
        });
      const sourceUrl = String(entry.id).replace(/^http:/, "https:");
      const metadata = MetadataFields.parse({
        title: plain(entry.title),
        abstract: plain(entry.summary),
        authors: [entry.author]
          .flat()
          .filter(Boolean)
          .map((author: any) => ({ given: "", family: plain(author.name) })),
        year: Number(String(entry.published).slice(0, 4)) || null,
        publicationDate: String(entry.published).slice(0, 10),
        publicationType: "preprint",
        manifestationType: "preprint",
        venue: "arXiv",
        url: sourceUrl,
        doi: null,
      });
      return {
        source: "arxiv",
        externalId: parsed.id,
        sourceUrl,
        metadata,
        raw,
        authoritative: true,
      };
    } finally {
      release();
    }
  }
  try {
    const raw = JSON.parse(
      await get(
        `https://api.crossref.org/works/${encodeURIComponent(parsed.id)}`,
      ),
    );
    const item = raw.message;
    const metadata = fromCsl({
      ...item,
      title: item.title?.[0],
      "container-title": item["container-title"]?.[0],
      issued: item.issued ?? item.published,
      DOI: item.DOI,
      type:
        (
          {
            "journal-article": "article-journal",
            "proceedings-article": "paper-conference",
            "book-chapter": "chapter",
            "posted-content": "preprint",
          } as Record<string, string>
        )[item.type] ?? item.type,
      ISBN: item.ISBN?.join(" "),
      ISSN: item.ISSN?.join(" "),
    }).metadata;
    if (metadata.doi !== parsed.id)
      throw Object.assign(new Error("Provider returned a different DOI."), {
        statusCode: 422,
      });
    return {
      source: "crossref",
      externalId: parsed.id,
      sourceUrl: `https://doi.org/${parsed.id.split("/").map(encodeURIComponent).join("/")}`,
      metadata,
      raw,
      authoritative: true,
    };
  } catch (error) {
    if ((error as any).providerStatus !== 404) throw error;
    const raw = JSON.parse(
      await get(
        `https://api.datacite.org/dois/${encodeURIComponent(parsed.id)}`,
      ),
    );
    const item = raw.data.attributes;
    const metadata = MetadataFields.parse({
      title: plain(item.titles?.[0]?.title),
      authors: (item.creators ?? []).map((author: any) => ({
        given: plain(author.givenName),
        family: plain(author.familyName || author.name),
      })),
      doi: item.doi,
      year: Number(item.publicationYear) || null,
      publisher: plain(item.publisher?.name ?? item.publisher),
      publicationType:
        plain(
          item.types?.citeproc || item.types?.resourceTypeGeneral,
        ).toLowerCase() || "document",
      url: plain(item.url),
      abstract: plain(
        item.descriptions?.find(
          (description: any) => description.descriptionType === "Abstract",
        )?.description,
      ),
    });
    if (metadata.doi !== parsed.id)
      throw Object.assign(new Error("Provider returned a different DOI."), {
        statusCode: 422,
      });
    return {
      source: "datacite",
      externalId: parsed.id,
      sourceUrl: `https://doi.org/${parsed.id.split("/").map(encodeURIComponent).join("/")}`,
      metadata,
      raw,
      authoritative: true,
    };
  }
}
