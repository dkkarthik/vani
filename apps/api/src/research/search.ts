import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ResearchId as Id, LibraryRule } from "@vani/shared";
import { pool } from "../db.js";
import { config } from "../config.js";
import { libraryWhere } from "./organization.js";
import { fail } from "../metadata.js";
import { indexDocument } from "./documents.js";
export type Chunk = {
  id: string;
  workId: string | null;
  title: string;
  key: string;
  kind: "metadata" | "page" | "note" | "annotation";
  text: string;
  page?: number;
  url: string;
};
const model = () => process.env.VANI_EMBED_MODEL ?? "";
export const embeddingKey = (text: string, m = model()) =>
  createHash("sha256")
    .update(m + "\0" + text)
    .digest("hex");
export function cosine(a: number[], b: number[]) {
  if (a.length !== b.length || !a.length) return 0;
  const norm = Math.sqrt(
    a.reduce((s, v) => s + v * v, 0) * b.reduce((s, v) => s + v * v, 0),
  );
  return norm ? a.reduce((s, v, i) => s + v * b[i]!, 0) / norm : 0;
}
const tokens = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
export function lexicalScore(text: string, query: string, exact = false) {
  const normalized = text.toLowerCase().replace(/\s+/g, " "),
    q = query.toLowerCase().replace(/\s+/g, " ").trim();
  if (exact) return normalized.includes(q) ? 1 : 0;
  const terms = [...new Set(tokens(q))],
    words = tokens(text);
  if (!terms.length) return 0;
  return (
    terms.reduce(
      (s, t) => s + Math.log1p(words.filter((w) => w === t).length),
      0,
    ) /
      Math.sqrt(Math.max(1, words.length)) +
    (normalized.includes(q) ? 0.5 : 0)
  );
}
export function rankChunks(
  chunks: Chunk[],
  query: string,
  exact: boolean,
  vectors: Map<string, number[]> = new Map(),
  queryVector?: number[],
) {
  const lexical = chunks
    .map((c) => ({ id: c.id, score: lexicalScore(c.text, query, exact) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);
  const semantic = queryVector
    ? chunks
        .map((c) => ({
          id: c.id,
          score: cosine(vectors.get(embeddingKey(c.text)) ?? [], queryVector),
        }))
        .filter((c) => c.score > 0.15)
        .sort((a, b) => b.score - a.score)
    : [];
  const lr = new Map(
      lexical.map((c, i) => [c.id, { rank: i + 1, score: c.score }]),
    ),
    sr = new Map(
      semantic.map((c, i) => [c.id, { rank: i + 1, score: c.score }]),
    );
  return chunks
    .filter((c) => lr.has(c.id) || sr.has(c.id))
    .map((c) => ({
      ...c,
      lexical: lr.get(c.id)?.score ?? 0,
      semantic: sr.get(c.id)?.score ?? null,
      score:
        (lr.has(c.id) ? 1 / (60 + lr.get(c.id)!.rank) : 0) +
        (sr.has(c.id) ? 1 / (60 + sr.get(c.id)!.rank) : 0),
    }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
export async function embed(texts: string[]) {
  if (!model())
    throw new Error("No local embedding model configured (VANI_EMBED_MODEL).");
  const result = await fetch(`${config.ollamaBaseUrl}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: model(), input: texts, truncate: true }),
    signal: AbortSignal.timeout(30000),
  });
  if (!result.ok)
    throw new Error(`Local embedding service returned HTTP ${result.status}.`);
  const data = (await result.json()) as any;
  if (
    !Array.isArray(data.embeddings) ||
    data.embeddings.length !== texts.length ||
    data.embeddings.some(
      (v: any) =>
        !Array.isArray(v) ||
        !v.length ||
        v.length > 8192 ||
        v.some((n: any) => typeof n !== "number" || !Number.isFinite(n)),
    )
  )
    throw new Error("Embedding service returned invalid vectors.");
  return data.embeddings as number[][];
}
export async function corpus(
  rule = LibraryRule.parse({}),
  collectionId?: string,
) {
  const { where, values } = await libraryWhere(rule, collectionId);
  const scope = where.join(" AND ");
  const works = (
    await pool.query(
      `SELECT w.id,w.title,w.citation_key,concat_ws(' ',w.title,w.abstract,w.doi,w.year,w.citation_key,(SELECT string_agg(alias.citation_key,' ') FROM work alias WHERE canonical_work(alias.id)=w.id),v.canonical_name,w.source_metadata::text,(SELECT string_agg(p.display_name,' ') FROM authorship a JOIN person p ON p.id=a.person_id WHERE a.work_id=w.id)) AS text FROM work w LEFT JOIN venue v ON v.id=w.venue_id WHERE ${scope} ORDER BY w.id LIMIT 3001`,
      values,
    )
  ).rows;
  const pages = (
    await pool.query(
      `SELECT w.id,w.title,w.citation_key,a.id AS attachment_id,p.value FROM attachment a JOIN work w ON w.id=canonical_work(a.work_id) JOIN document_index d ON d.object_hash=a.object_hash CROSS JOIN LATERAL jsonb_array_elements(d.pages) p WHERE ${scope} AND d.state IN ('ready','partial') ORDER BY w.id,a.id,(p.value->>'page')::int LIMIT 3001`,
      values,
    )
  ).rows;
  const notes = (
    await pool.query(
      `SELECT n.id,w.id AS work_id,n.title,w.citation_key,n.markdown FROM note n JOIN work w ON w.id=canonical_work(n.work_id) WHERE ${scope} AND n.deleted_at IS NULL ORDER BY n.id LIMIT 3001`,
      values,
    )
  ).rows;
  const annotations = (
    await pool.query(
      `SELECT a.id,w.id AS work_id,w.title,w.citation_key,a.page_start,concat_ws(' ',a.selector->>'quote',a.body_markdown,a.tags::text) AS text FROM annotation a JOIN attachment at ON at.id=a.attachment_id JOIN work w ON w.id=canonical_work(at.work_id) WHERE ${scope} AND a.deleted_at IS NULL ORDER BY a.id LIMIT 3001`,
      values,
    )
  ).rows;
  const looseNotes =
    !rule.tag && !rule.yearFrom && !rule.yearTo && !rule.status && !rule.unfiled
      ? (
          await pool.query(
            "SELECT id,title,markdown FROM note WHERE work_id IS NULL AND deleted_at IS NULL AND ($1::uuid IS NULL OR collection_id=$1) ORDER BY id LIMIT 3001",
            [collectionId ?? null],
          )
        ).rows
      : [];
  const chunks: Chunk[] = [];
  const add = (c: Chunk) => {
    for (let offset = 0; offset < c.text.length; offset += 1600) {
      if (chunks.length >= 12000) break;
      chunks.push({
        ...c,
        id: c.id + ":" + offset,
        text: c.text.slice(offset, offset + 2000),
      });
    }
  };
  works
    .slice(0, 3000)
    .forEach((w) =>
      add({
        id: "w:" + w.id,
        workId: w.id,
        title: w.title,
        key: w.citation_key,
        kind: "metadata",
        text: w.text,
        url: "/read/" + w.id,
      }),
    );
  pages
    .slice(0, 3000)
    .forEach((p) =>
      add({
        id: "p:" + p.attachment_id + ":" + p.value.page,
        workId: p.id,
        title: p.title,
        key: p.citation_key,
        kind: "page",
        text: p.value.text,
        page: p.value.page,
        url: `/read/${p.id}?attachment=${p.attachment_id}&page=${p.value.page}`,
      }),
    );
  notes
    .slice(0, 3000)
    .forEach((n) =>
      add({
        id: "n:" + n.id,
        workId: n.work_id,
        title: n.title,
        key: n.citation_key,
        kind: "note",
        text: n.title + "\n" + n.markdown,
        url: "/notes/" + n.id,
      }),
    );
  looseNotes
    .slice(0, 3000)
    .forEach((n) =>
      add({
        id: "n:" + n.id,
        workId: null,
        title: n.title,
        key: "Note",
        kind: "note",
        text: n.title + "\n" + n.markdown,
        url: "/notes/" + n.id,
      }),
    );
  annotations
    .slice(0, 3000)
    .forEach((a) =>
      add({
        id: "a:" + a.id,
        workId: a.work_id,
        title: a.title,
        key: a.citation_key,
        kind: "annotation",
        text: a.text,
        page: a.page_start,
        url: "/passages/" + a.id,
      }),
    );
  return {
    chunks,
    truncated:
      [works, pages, notes, annotations, looseNotes].some(
        (rows) => rows.length > 3000,
      ) || chunks.length >= 12000,
  };
}
async function cached(chunks: Chunk[]) {
  const rows = (
    await pool.query(
      "SELECT cache_key,embedding FROM semantic_chunk WHERE model=$1 AND cache_key=ANY($2::text[])",
      [model(), chunks.map((c) => embeddingKey(c.text))],
    )
  ).rows;
  return new Map<string, number[]>(rows.map((r) => [r.cache_key, r.embedding]));
}
export async function coverage() {
  const docs = (
    await pool.query(
      "SELECT a.id,a.filename,w.title,d.state,d.error,d.page_count,d.indexed_at FROM attachment a JOIN work w ON w.id=canonical_work(a.work_id) LEFT JOIN document_index d ON d.object_hash=a.object_hash WHERE w.deleted_at IS NULL ORDER BY a.created_at DESC LIMIT 500",
    )
  ).rows;
  const total = (await pool.query("SELECT count(*)::int total FROM attachment"))
    .rows[0].total;
  return {
    documents: docs,
    totalDocuments: total,
    displayedDocuments: docs.length,
    embeddingModel: model() || null,
    localEndpoint: config.ollamaBaseUrl,
  };
}
export async function registerSearch(app: FastifyInstance) {
  app.get("/api/v1/search-coverage", coverage);
  app.post("/api/v1/search-index", async (r) => {
    const { attachmentIds } = z
      .object({ attachmentIds: z.array(Id).min(1).max(10) })
      .parse(r.body);
    const results = [];
    for (const id of attachmentIds) {
      try {
        results.push({ id, ...(await indexDocument(id)) });
      } catch (error) {
        results.push({ id, state: "error", error: (error as Error).message });
      }
    }
    return { items: results };
  });
  app.post("/api/v1/semantic-index", async () => {
    const { chunks, truncated } = await corpus(),
      cache = await cached(chunks);
    const missing = chunks.filter((c) => !cache.has(embeddingKey(c.text))),
      batch = missing.slice(0, 100);
    let indexed = 0,
      error = "";
    try {
      for (let i = 0; i < batch.length; i += 10) {
        const group = batch.slice(i, i + 10),
          vectors = await embed(group.map((c) => c.text));
        for (let j = 0; j < group.length; j++) {
          await pool.query(
            "INSERT INTO semantic_chunk(cache_key,model,embedding) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
            [embeddingKey(group[j]!.text), model(), JSON.stringify(vectors[j])],
          );
          indexed++;
        }
      }
    } catch (e) {
      error = (e as Error).message;
    }
    return {
      indexed,
      remaining: missing.length - indexed,
      total: chunks.length,
      truncated,
      error,
      model: model() || null,
    };
  });
  app.post("/api/v1/evidence-search", async (r) => {
    const input = z
      .object({
        query: z.string().trim().min(1).max(500),
        mode: z.enum(["exact", "lexical", "hybrid"]).default("lexical"),
        kind: z.enum(["metadata", "page", "note", "annotation"]).optional(),
        collectionId: Id.optional(),
        rule: LibraryRule.default(LibraryRule.parse({})),
      })
      .parse(r.body);
    const data = await corpus(input.rule, input.collectionId);
    const chunks = data.chunks.filter(
      (c) => !input.kind || c.kind === input.kind,
    );
    const cache = input.mode === "hybrid" ? await cached(chunks) : new Map();
    let vector: number[] | undefined,
      warning = "";
    if (input.mode === "hybrid") {
      try {
        vector = (await embed([input.query]))[0];
        if (!cache.size)
          warning = "No semantic chunks indexed yet; showing lexical results.";
      } catch (e) {
        warning = (e as Error).message + " Showing lexical results.";
      }
    }
    const ranked = rankChunks(
      chunks,
      input.query,
      input.mode === "exact",
      cache,
      vector,
    );
    return {
      items: ranked.slice(0, 100),
      total: ranked.length,
      coverage: {
        chunks: chunks.length,
        semanticChunks: chunks.filter((c) => cache.has(embeddingKey(c.text)))
          .length,
        truncated: data.truncated,
      },
      mode:
        vector && cache.size
          ? "hybrid"
          : input.mode === "exact"
            ? "exact"
            : "lexical",
      warning,
    };
  });
  app.get("/api/v1/notes/:id", async (r) => {
    const id = Id.parse((r.params as any).id);
    const row = (
      await pool.query(
        "SELECT * FROM note WHERE id=$1 AND deleted_at IS NULL",
        [id],
      )
    ).rows[0];
    if (!row) fail(404, "Note not found.");
    return row;
  });
}
