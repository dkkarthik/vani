import { v7 as uuid } from "uuid";
import { transaction } from "../db.js";
import { cleanDoi } from "../lib/citations.js";
import { bibliographicMetadata } from "@vani/shared";

export function mergePaperMetadata(old: any, incoming: any) {
  const previous = bibliographicMetadata(old),
    next = bibliographicMetadata(incoming);
  const isPreprint = (p: any) =>
    p.manifestationType === "preprint" || /^arxiv$/i.test(p.venue ?? "");
  const keepPublished =
    old && previous.venue && !isPreprint(old) && isPreprint(incoming);
  const primary = keepPublished ? previous : next,
    fallback = keepPublished ? next : previous;
  const paper = { ...old, ...incoming };
  for (const key of [
    "title",
    "year",
    "venue",
    "doi",
    "volume",
    "issue",
    "pages",
    "articleNumber",
    "publisher",
    "arxivId",
  ] as const)
    paper[key] = primary[key] || fallback[key];
  paper.authors = primary.authors.length ? primary.authors : fallback.authors;
  if (paper.title === "Untitled" && fallback.title !== "Untitled")
    paper.title = fallback.title;
  paper.pdfUrls = [...new Set([...previous.pdfUrls, ...next.pdfUrls])];
  paper.abstract =
    (incoming.abstract ?? "").length >= (old?.abstract ?? "").length
      ? incoming.abstract
      : old.abstract;
  paper.url =
    incoming.url ||
    old?.url ||
    (paper.doi ? "https://doi.org/" + paper.doi : "");
  if (keepPublished) paper.manifestationType = old.manifestationType;
  return paper;
}
export function aliases(p: any): string[] {
  const out: string[] = [];
  const doi = cleanDoi(p.doi);
  if (doi) out.push("doi:" + doi.toLowerCase());
  const raw = String(p.url ?? "") + " " + String(p.doi ?? "");
  const linked = raw.match(
    /(?:arxiv\.org\/(?:abs|pdf)\/|10\.48550\/arxiv\.)((?:\d{4}\.\d{4,5}|[a-z.-]+\/\d{7}))(?:v\d+)?/i,
  )?.[1];
  const native =
    p.connector === "arxiv"
      ? String(p.sourcePayload?.arxivId ?? p.externalId ?? "").replace(
          /v\d+$/,
          "",
        )
      : "";
  const arxiv =
    linked ||
    (/^(?:\d{4}\.\d{4,5}|[a-z.-]+\/\d{7})$/i.test(native) ? native : null);
  if (arxiv) out.push("arxiv:" + arxiv.toLowerCase());
  const title = String(p.title ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
  if (title.length >= 24) out.push("title:" + title + ":" + (p.year ?? ""));
  if (p.connector && p.externalId) out.push(p.connector + ":" + p.externalId);
  return out;
}
export function isPublicPaper(p: any) {
  return (
    ["openalex", "crossref", "arxiv"].includes(p.connector) &&
    !["private", "user_uploaded"].includes(p.accessClass) &&
    !!p.title &&
    !!p.externalId
  );
}
export async function storePaper(p: any, source: any) {
  if (!isPublicPaper(p)) return null;
  const keys = aliases(p);
  if (!keys.length) return null;
  return transaction(async (db) => {
    // Corpus writes are small and serialized; alias ownership cannot race across sources.
    await db.query("SELECT pg_advisory_xact_lock(73421930)");
    const matches = (
      await db.query(
        "SELECT DISTINCT paper_id FROM simple_paper_alias WHERE identity=ANY($1::text[])",
        [keys],
      )
    ).rows;
    const id = matches[0]?.paper_id ?? uuid();
    // A later record bridging previously separate identities keeps both rows intact and joins
    // only to an established owner. The ranker deduplicates conservative scientific identities.
    const old = (
      await db.query("SELECT paper,sources FROM simple_paper WHERE id=$1", [id])
    ).rows[0];
    const paper = mergePaperMetadata(old?.paper, p);
    const provenance = {
      source: p.connector,
      externalId: p.externalId,
      query: source.query ?? "",
      kind: source.kind ?? "query",
    };
    await db.query(
      "INSERT INTO simple_paper(id,paper,sources) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET paper=excluded.paper,sources=(SELECT jsonb_agg(DISTINCT x) FROM jsonb_array_elements(simple_paper.sources||excluded.sources) x),updated_at=now()",
      [id, JSON.stringify(paper), JSON.stringify([provenance])],
    );
    for (const key of keys)
      await db.query(
        "INSERT INTO simple_paper_alias(identity,paper_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [key, id],
      );
    return id;
  });
}
