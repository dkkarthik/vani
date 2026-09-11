import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { pool } from "./db.js";
import { manualCollection } from "./research/organization.js";
import { fail } from "./metadata.js";
const stop = new Set(
  "a an the and or for of to in on with by from using based study paper approach research this that we our propose present introduce show results method work new pdf uploaded document abstract introduction conclusion references under into via".split(
    " ",
  ),
);
export function defaultKeywords(topic: string) {
  return [
    ...new Set(
      topic
        .toLowerCase()
        .match(/[\p{L}][\p{L}\p{N}-]{1,}/gu)
        ?.filter((w) => !stop.has(w)) ?? [],
    ),
  ].slice(0, 30);
}
const normalized = (text: string) =>
  " " +
  text
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim() +
  " ";
export function keywordMatch(keywords: string[], title: string, abstract = "") {
  const haystack = normalized(title + " " + abstract),
    matched = keywords.filter((k) => haystack.includes(normalized(k)));
  return {
    matched,
    score: keywords.length ? matched.length / keywords.length : 0,
    evidence: matched.slice(0, 8).map((keyword) => ({
      keyword,
      field: normalized(title).includes(normalized(keyword))
        ? "title"
        : "abstract",
      quote: normalized(title).includes(normalized(keyword))
        ? title
        : (abstract
            .split(/(?<=[.!?])\s+/)
            .find((s) => normalized(s).includes(normalized(keyword))) ??
          abstract),
    })),
  };
}
export async function collectionFocus(id: string) {
  const row = (
    await pool.query(
      "SELECT keywords,keyword_version,discovery FROM collection WHERE id=$1 AND deleted_at IS NULL",
      [id],
    )
  ).rows[0];
  if (!row) fail(404, "Collection not found.");
  return {
    keywords: row.keywords ?? defaultKeywords(row.discovery?.topic ?? ""),
    version: row.keyword_version,
    edited: row.keywords !== null,
  };
}
export async function registerCollectionFocus(app: FastifyInstance) {
  app.get("/api/v1/collections/:id/keywords", async (r) => {
    const id = z
      .string()
      .uuid()
      .parse((r.params as any).id);
    await manualCollection(pool, id);
    return collectionFocus(id);
  });
  app.patch("/api/v1/collections/:id/keywords", async (r) => {
    const id = z
        .string()
        .uuid()
        .parse((r.params as any).id),
      d = z
        .object({
          version: z.number().int().positive(),
          keywords: z
            .array(
              z
                .string()
                .trim()
                .min(2)
                .max(80)
                .regex(/[\p{L}\p{N}]/u),
            )
            .max(30),
        })
        .parse(r.body);
    await manualCollection(pool, id);
    const keywords = [
      ...new Set(
        d.keywords.map((k) =>
          k.toLowerCase().normalize("NFKC").replace(/\s+/g, " "),
        ),
      ),
    ];
    const result = await pool.query(
      `UPDATE collection SET keywords=$2,keyword_version=keyword_version+1,discovery=CASE WHEN cardinality($2::text[])=0 AND discovery IS NOT NULL THEN jsonb_set(discovery,'{enabled}','false') ELSE discovery END,next_discovery_at=CASE WHEN cardinality($2::text[])>0 THEN now() ELSE next_discovery_at END,updated_at=now() WHERE id=$1 AND keyword_version=$3 RETURNING id`,
      [id, keywords, d.version],
    );
    if (!result.rowCount)
      fail(
        409,
        "Keywords changed elsewhere. Reload the collection before editing again.",
      );
    return collectionFocus(id);
  });
}
