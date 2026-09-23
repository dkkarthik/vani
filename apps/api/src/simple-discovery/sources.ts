import { XMLParser } from "fast-xml-parser";
import { openAlexCandidate } from "../knowledge/discovery.js";
import { cleanDoi } from "../lib/citations.js";
import type { Candidate } from "../connectors.js";
import { config } from "../config.js";
export type Task = {
  source: "openalex" | "crossref" | "arxiv";
  query: string;
  kind: "query" | "feed";
  page: number;
  state: "pending" | "complete" | "limited" | "failed";
  found: number;
  error?: string;
  retryAt?: string;
};
export class ProviderError extends Error {
  constructor(
    message: string,
    public retryAt?: string,
  ) {
    super(message);
  }
}
const text = (x: unknown) =>
  String(x ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const array = (x: any) => (x === undefined ? [] : Array.isArray(x) ? x : [x]);
export function arxivRecords(xml: string): Candidate[] {
  const feed = new XMLParser({
    ignoreAttributes: false,
    processEntities: false,
  }).parse(xml).feed;
  if (feed === undefined || feed === null)
    throw Error("arXiv returned an invalid Atom feed.");
  if (array(feed.entry).some((e: any) => String(e.id).includes("/errors")))
    throw Error("arXiv rejected the search query.");
  return array(feed.entry)
    .filter((e: any) => e.id && e.title)
    .map((e: any) => {
      const id = String(e.id)
        .replace(/^https?:\/\/arxiv.org\/abs\//, "")
        .replace(/v\d+$/, "");
      return {
        title: text(e.title),
        abstract: text(e.summary),
        authors: array(e.author).map((a: any) => ({
          given: "",
          family: text(a.name),
        })),
        year: Number(String(e.published).slice(0, 4)) || null,
        publicationDate: String(e.published).slice(0, 10),
        doi: cleanDoi(e["arxiv:doi"]),
        url: "https://arxiv.org/abs/" + id,
        venue: "arXiv",
        manifestationType: "preprint",
        accessClass: "open_access",
        connector: "arxiv",
        externalId: id,
        sourcePayload: {
          arxivId: id,
          updated: e.updated,
          pdfUrl: "https://arxiv.org/pdf/" + id,
        },
      };
    });
}
export function buildUrl(task: Task): URL {
  const start = task.page * 100;
  if (task.source === "arxiv") {
    const u = new URL("https://export.arxiv.org/api/query");
    // Treat researcher queries as literal words, never injected query syntax.
    const query =
      task.kind === "feed"
        ? task.query
            .split(",")
            .map((c) => "cat:" + c)
            .join(" OR ")
        : (task.query.match(/[\p{L}\p{N}_-]+/gu) ?? [])
            .map((w) => "all:" + w)
            .join(" AND ");
    u.search = new URLSearchParams({
      search_query: query,
      start: String(start),
      max_results: "100",
      sortBy: task.kind === "feed" ? "lastUpdatedDate" : "relevance",
      sortOrder: "descending",
    }).toString();
    return u;
  }
  if (task.source === "openalex") {
    const u = new URL("https://api.openalex.org/works");
    u.searchParams.set("search", task.query);
    u.searchParams.set("per-page", "100");
    u.searchParams.set("page", String(task.page + 1));
    if (config.openAlexEmail)
      u.searchParams.set("mailto", config.openAlexEmail);
    return u;
  }
  const u = new URL("https://api.crossref.org/works");
  u.searchParams.set("query.bibliographic", task.query);
  u.searchParams.set("rows", "100");
  u.searchParams.set("offset", String(start));
  return u;
}
export async function fetchBatch(task: Task): Promise<Candidate[]> {
  const url = buildUrl(task),
    headers: Record<string, string> = {
      "User-Agent": "VANI/1.0 (local literature discovery)",
    };
  if (task.source === "openalex" && process.env.OPENALEX_API_KEY)
    headers.Authorization = "Bearer " + process.env.OPENALEX_API_KEY;
  const response = await fetch(url, {
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    let retryAt: string | undefined;
    if (response.status === 429 || response.status === 503) {
      const raw = response.headers.get("retry-after"),
        seconds = raw ? Number(raw) : NaN,
        date = raw ? Date.parse(raw) : NaN;
      retryAt = new Date(
        Math.max(
          Date.now() + 30000,
          Number.isFinite(seconds)
            ? Date.now() + seconds * 1000
            : Number.isFinite(date)
              ? date
              : Date.now() + 300000,
        ),
      ).toISOString();
    }
    throw new ProviderError(
      `${task.source} HTTP ${response.status}${retryAt ? "; retry after " + retryAt : ""}`,
      retryAt,
    );
  }
  const reader = response.body?.getReader();
  if (!reader) throw Error("Empty source response");
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    size += r.value.length;
    if (size > 8_000_000) {
      await reader.cancel();
      throw Error("Source response exceeded 8 MB.");
    }
    parts.push(r.value);
  }
  const raw = Buffer.concat(parts).toString("utf8");
  if (task.source === "arxiv") return arxivRecords(raw);
  const data = JSON.parse(raw);
  if (task.source === "openalex") {
    if (!Array.isArray(data.results)) throw Error("Invalid OpenAlex results");
    return data.results.map((p: any) => ({
      ...openAlexCandidate(p),
      url: p.primary_location?.landing_page_url || p.id,
    }));
  }
  if (!Array.isArray(data.message?.items))
    throw Error("Invalid Crossref results");
  return data.message.items.map((p: any) => ({
    title: text(p.title?.[0]) || "Untitled",
    abstract: text(p.abstract),
    doi: cleanDoi(p.DOI),
    url: p.URL,
    authors: (p.author ?? []).map((a: any) => ({
      given: a.given ?? "",
      family: a.family ?? "",
    })),
    year: p.published?.["date-parts"]?.[0]?.[0] ?? null,
    venue: text(p["container-title"]?.[0]),
    connector: "crossref",
    externalId: p.DOI || p.URL,
    sourcePayload: { DOI: p.DOI, URL: p.URL },
    accessClass: "metadata_only",
  }));
}
