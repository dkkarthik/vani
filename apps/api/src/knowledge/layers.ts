import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { KId as Id, LibraryRule } from "@vani/shared";
import { pool } from "../db.js";
import { libraryWhere } from "../research/organization.js";
import { embeddingKey, cosine } from "../research/search.js";
import { displayRef } from "./common.js";
import { edgeView } from "./connections.js";
export function sharedReferences(a: string[], b: string[]) {
  const aa = new Set(a),
    bb = new Set(b),
    shared = [...aa].filter((x) => bb.has(x));
  return { shared, score: shared.length / (new Set([...aa, ...bb]).size || 1) };
}
export async function layers(collectionId?: string) {
  const scope = await libraryWhere(LibraryRule.parse({}), collectionId);
  const works = (
    await pool.query(
      `SELECT w.id,w.title,w.citation_key,concat_ws(' ',w.title,w.abstract,w.doi,w.year,w.citation_key,(SELECT string_agg(alias.citation_key,' ') FROM work alias WHERE canonical_work(alias.id)=w.id),v.canonical_name,w.source_metadata::text,(SELECT string_agg(p.display_name,' ') FROM authorship a JOIN person p ON p.id=a.person_id WHERE a.work_id=w.id)) AS text FROM work w LEFT JOIN venue v ON v.id=w.venue_id WHERE ${scope.where.join(" AND ")} ORDER BY w.id LIMIT 101`,
      scope.values,
    )
  ).rows;
  const limited = works.slice(0, 100),
    ids = limited.map((w) => w.id),
    edges: any[] = [];
  const sources = (
    await pool.query(
      `SELECT DISTINCT ON(canonical_work(work_id)) canonical_work(work_id) work_id,external_id,payload,retrieved_at FROM source_record WHERE canonical_work(work_id)=ANY($1::uuid[]) AND connector='openalex' ORDER BY canonical_work(work_id),retrieved_at DESC`,
      [ids],
    )
  ).rows;
  const external = new Map(sources.map((s) => [s.external_id, s.work_id]));
  for (const s of sources)
    for (const ref of s.payload.referenced_works ?? []) {
      const target = external.get(ref);
      if (target && target !== s.work_id)
        edges.push({
          id: `citation:${s.work_id}:${target}`,
          source: { kind: "work", id: s.work_id },
          target: { kind: "work", id: target },
          predicate: "cites",
          layer: "citation",
          origin: "OpenAlex structured reference",
          score: null,
          explanation:
            "The source record lists the target in referenced_works. This establishes an indexed citation, not agreement.",
          evidence: {
            sourceUrl: s.external_id,
            referencedId: ref,
            retrievedAt: s.retrieved_at,
          },
        });
    }
  for (let i = 0; i < sources.length; i++)
    for (let j = i + 1; j < sources.length; j++) {
      const a = sources[i]!,
        b = sources[j]!,
        overlap = sharedReferences(
          a.payload.referenced_works ?? [],
          b.payload.referenced_works ?? [],
        );
      if (overlap.shared.length)
        edges.push({
          id: `bib:${a.work_id}:${b.work_id}`,
          source: { kind: "work", id: a.work_id },
          target: { kind: "work", id: b.work_id },
          predicate: "bibliographic_coupling",
          layer: "bibliographic",
          origin: "computed",
          score: overlap.score,
          explanation:
            "Jaccard = shared references / union of known references. Undirected overlap; not a direct citation.",
          evidence: {
            sharedReferences: overlap.shared,
            sourceUrls: [a.external_id, b.external_id],
          },
        });
    }
  const model = process.env.VANI_EMBED_MODEL ?? "",
    keys = limited.map((w) => embeddingKey(w.text.slice(0, 2000), model));
  const vectors = new Map(
    (
      await pool.query(
        "SELECT cache_key,embedding FROM semantic_chunk WHERE model=$1 AND cache_key=ANY($2::text[])",
        [model, keys],
      )
    ).rows.map((v) => [v.cache_key, v.embedding]),
  );
  for (let i = 0; i < limited.length; i++)
    for (let j = i + 1; j < limited.length; j++) {
      const a = vectors.get(keys[i]!),
        b = vectors.get(keys[j]!);
      if (!a || !b) continue;
      const score = cosine(a, b);
      if (score < 0.5) continue;
      edges.push({
        id: `semantic:${ids[i]}:${ids[j]}`,
        source: { kind: "work", id: ids[i] },
        target: { kind: "work", id: ids[j] },
        predicate: "semantically_similar",
        layer: "semantic",
        origin: "computed",
        score,
        explanation:
          "Cosine similarity of first 2,000 metadata characters; threshold 0.5. Undirected association, not an evidence claim.",
        evidence: {
          model,
          cacheKeys: [keys[i], keys[j]],
          previews: [
            limited[i]!.text.slice(0, 400),
            limited[j]!.text.slice(0, 400),
          ],
        },
      });
    }
  const legacy = (
    await pool.query(
      `SELECT *,canonical_work(source_work_id) s,canonical_work(target_work_id) t FROM typed_relationship WHERE canonical_work(source_work_id)=ANY($1::uuid[]) AND canonical_work(target_work_id)=ANY($1::uuid[]) AND verification_status<>'rejected' ORDER BY id LIMIT 1000`,
      [ids],
    )
  ).rows;
  for (const e of legacy) {
    if (
      e.s === e.t ||
      edges.some(
        (x) =>
          x.source.id === e.s &&
          x.target.id === e.t &&
          x.predicate === e.predicate,
      )
    )
      continue;
    const verifiedCitation =
      e.predicate === "cites" &&
      e.evidence.some((p: any) => p.origin === "structured_data");
    edges.push({
      id: e.id,
      source: { kind: "work", id: e.s },
      target: { kind: "work", id: e.t },
      predicate: e.predicate,
      layer: verifiedCitation ? "citation" : "evidence",
      origin: verifiedCitation
        ? "provider reference"
        : `legacy assertion (${e.verification_status})`,
      score: null,
      explanation: verifiedCitation
        ? "Indexed reference; inspect provider evidence."
        : "Stored assertion; original confidence is not a measured similarity or independently verified fact.",
      evidence: e.evidence,
    });
  }
  const authored = (
    await pool.query(
      "SELECT * FROM knowledge_edge WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 1000",
    )
  ).rows;
  for (const e of authored) {
    const view = await edgeView(e);
    if (collectionId) {
      const belongs = async (ref: any) =>
        ref.kind === "work"
          ? ids.includes(ref.id)
          : ref.kind === "passage"
            ? (
                await pool.query(
                  "SELECT 1 FROM annotation a JOIN attachment at ON at.id=a.attachment_id WHERE a.id=$1 AND canonical_work(at.work_id)=ANY($2::uuid[])",
                  [ref.id, ids],
                )
              ).rowCount
            : ref.kind === "note"
              ? (
                  await pool.query(
                    "SELECT 1 FROM note WHERE id=$1 AND (collection_id=$2 OR canonical_work(work_id)=ANY($3::uuid[]))",
                    [ref.id, collectionId, ids],
                  )
                ).rowCount
              : false;
      if (!(await belongs(view.source)) && !(await belongs(view.target)))
        continue;
    }
    edges.push({
      ...view,
      layer: ["read_before", "relates_to", "explains"].includes(e.predicate)
        ? "personal"
        : "evidence",
      score: null,
      explanation: e.rationale,
      evidence: { ...e.provenance, passages: view.passages },
    });
  }
  // Canonicalized source/target labels apply equally to visual and list views.
  const total = edges.length;
  const ordered = edges
    .sort((a, b) => a.layer.localeCompare(b.layer) || a.id.localeCompare(b.id))
    .slice(0, 2000);
  const resolved = await Promise.all(
    ordered.map(async (e) => ({
      ...e,
      source: await displayRef(e.source),
      target: await displayRef(e.target),
    })),
  );
  return {
    edges: resolved,
    coverage: {
      works: limited.length,
      workLimit: 100,
      edgeLimit: 2000,
      truncated: works.length > 100 || total > 2000,
      referenceRecords: sources.length,
      semanticVectors: vectors.size,
      model: model || null,
      semanticStatus: model
        ? vectors.size
          ? "Cached vectors only; index missing metadata from Search."
          : "No current metadata vectors; index from Search."
        : "No embedding model configured.",
      note: "Only loaded sources and indexed metadata are represented. An absent edge is not evidence of absence.",
    },
  };
}
export async function registerLayers(app: FastifyInstance) {
  app.post("/api/v1/knowledge/layers", async (r) => {
    const { collectionId } = z
      .object({ collectionId: Id.optional() })
      .parse(r.body ?? {});
    return layers(collectionId);
  });
}
