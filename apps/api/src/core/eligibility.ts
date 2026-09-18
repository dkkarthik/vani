import { hash, lexical, type FocusProfile } from "./algorithm.js";
const norm = (s: string) =>
  String(s ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
const doi = (p: any) =>
  String(p.doi ?? "")
    .toLowerCase()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "")
    .trim();
const arxiv = (p: any) =>
  [
    p.doi,
    p.url,
    p.externalId,
    p.sourcePayload?.ids?.arxiv,
    ...(p.sourcePayload?.locations ?? []).flatMap((l: any) => [
      l.landing_page_url,
      l.pdf_url,
    ]),
  ]
    .filter(Boolean)
    .map(String)
    .join(" ")
    .match(
      /(?:arxiv\.org\/(?:abs|pdf)\/|arxiv\.)(\d{4}\.\d{4,5})(?:v\d+)?/i,
    )?.[1];
const authors = (p: any): string[] =>
  (p.authors ?? [])
    .map((a: any) =>
      norm(
        typeof a === "string"
          ? a
          : [a.given, a.family, a.name].filter(Boolean).join(" "),
      ),
    )
    .filter(Boolean);
export function sameScientificWork(a: any, b: any) {
  if (doi(a) && doi(a) === doi(b)) return true;
  if (arxiv(a) && arxiv(a) === arxiv(b)) return true;
  const title = norm(a.title);
  if (title.length < 24 || title !== norm(b.title)) return false;
  if (a.year && b.year && Math.abs(a.year - b.year) > 2) return false;
  const aa = authors(a),
    bb = authors(b);
  if (aa.length && bb.length && !aa.some((x) => bb.includes(x))) return false;
  if (!doi(a) || !doi(b)) return true;
  return (
    aa.some((x) => bb.includes(x)) ||
    (norm(a.abstract).length > 120 && norm(a.abstract) === norm(b.abstract))
  );
}
export function supplementary(p: any) {
  return (
    /\/mm\d+(?:$|\/)/i.test(doi(p)) ||
    /(?:_supp\d*[-_]|\.(?:mp4|mov|avi|docx|zip)(?:$|\s))/i.test(
      p.title ?? "",
    ) ||
    /^(?:supplementary (?:material|video|data)|supporting information)\s+(?:for|to|:)/i.test(
      p.title ?? "",
    )
  );
}
export function eligibleCandidates(rows: any[], members: any[]) {
  const excluded = new Map<string, { reason: string; matchId?: string }>();
  const representatives: any[] = [];
  const keys = (p: any) =>
    [
      doi(p) && "doi:" + doi(p),
      arxiv(p) && "arxiv:" + arxiv(p),
      norm(p.title) && "title:" + norm(p.title),
    ].filter(Boolean) as string[];
  const memberIndex = new Map<string, any[]>(),
    representativeIndex = new Map<string, any[]>();
  const index = (map: Map<string, any[]>, p: any, value: any) => {
    for (const key of keys(p)) map.set(key, [...(map.get(key) ?? []), value]);
  };
  for (const member of members) index(memberIndex, member, member);
  const memberIds = new Map(members.map((m) => [m.id, m]));
  // Prefer records with an abstract and public full-text locations, with stable tie breaking.
  const quality = (r: any) =>
    Math.min((r.paper.abstract ?? "").length, 2000) +
    (r.paper.sourcePayload?.best_oa_location?.pdf_url ? 500 : 0);
  for (const row of [...rows].sort(
    (a, b) => quality(b) - quality(a) || a.id.localeCompare(b.id),
  )) {
    const member =
      memberIds.get(row.work_id) ??
      keys(row.paper)
        .flatMap((k) => memberIndex.get(k) ?? [])
        .find((m) => sameScientificWork(row.paper, m));
    const representative = keys(row.paper)
      .flatMap((k) => representativeIndex.get(k) ?? [])
      .find((r) => sameScientificWork(row.paper, r.paper));
    if (member)
      excluded.set(row.id, { reason: "existing_member", matchId: member.id });
    else if (supplementary(row.paper))
      excluded.set(row.id, { reason: "supplementary_artifact" });
    else if (representative)
      excluded.set(row.id, {
        reason: "alternate_version",
        matchId: representative.id,
      });
    else {
      representatives.push(row);
      index(representativeIndex, row.paper, row);
    }
  }
  return { representatives, excluded };
}
export function diverseScreening<
  T extends {
    paper: { id: string; title: string; abstract: string };
    score: number;
  },
>(ranked: T[], limit: number, focus: FocusProfile, seed: string) {
  const selected = new Map<string, { item: T; reason: string }>();
  const add = (item: T | undefined, reason: string) => {
    if (item && selected.size < limit && !selected.has(item.paper.id))
      selected.set(item.paper.id, { item, reason });
  };
  const top = Math.max(1, Math.floor(limit * 0.6));
  ranked.slice(0, top).forEach((r) => add(r, "overall_rank"));
  for (const facet of focus.facets.filter((f) =>
    ["problem", "method", "contribution"].includes(f.kind),
  )) {
    const byFacet = ranked
      .filter((r) => !selected.has(r.paper.id))
      .map((r) => ({
        r,
        match: lexical(facet.text, r.paper.title + " " + r.paper.abstract),
      }))
      .sort((a, b) => b.match - a.match || b.r.score - a.r.score);
    if (byFacet[0]?.match) add(byFacet[0].r, "facet:" + facet.id);
  }
  const exploration = Math.min(
    Math.max(1, Math.floor(limit * 0.1)),
    limit - selected.size,
  );
  ranked
    .filter((r) => !selected.has(r.paper.id))
    .sort((a, b) =>
      hash([seed, a.paper.id]).localeCompare(hash([seed, b.paper.id])),
    )
    .slice(0, exploration)
    .forEach((r) => add(r, "exploration"));
  ranked.forEach((r) => add(r, "overall_rank"));
  return [...selected.values()];
}
