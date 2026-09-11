import { v7 as uuid } from "uuid";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, transaction } from "./db.js";
import { Repository } from "./repository.js";
import { collectionFocus, keywordMatch } from "./collection-focus.js";
import { discoverCollection, type Candidate } from "./connectors.js";
import { runDiscovery } from "./knowledge/discovery.js";
import {
  feedbackFor,
  retainCandidateSource,
  captureDigest,
} from "./planning/monitor.js";
import { queueEnrichment } from "./ingestion/enrichment.js";
import { manualCollection } from "./research/organization.js";
import { fail } from "./metadata.js";
import { config } from "./config.js";
export function deepQueries(keywords: string[]) {
  const queries = [keywords.join(" ")];
  const size = Math.max(1, Math.ceil(keywords.length / 3));
  for (let i = 0; i < keywords.length; i += size)
    queries.push(keywords.slice(i, i + size).join(" "));
  return [...new Set(queries.filter(Boolean))].slice(0, 4);
}
export async function enqueueDeepRefresh(id: string) {
  await manualCollection(pool, id);
  return transaction(async (db) => {
    await db.query("SELECT id FROM collection WHERE id=$1 FOR UPDATE", [id]);
    const active = (
      await db.query(
        "SELECT * FROM collection_refresh WHERE collection_id=$1 AND status IN ('queued','running')",
        [id],
      )
    ).rows[0];
    if (active) return active;
    const focus = await collectionFocus(id);
    if (!focus.keywords.length)
      fail(409, "Add collection keywords before running a deep refresh.");
    const collection = (
      await db.query("SELECT discovery FROM collection WHERE id=$1", [id])
    ).rows[0];
    return (
      await db.query(
        "INSERT INTO collection_refresh(id,collection_id,snapshot) VALUES($1,$2,$3) RETURNING *",
        [
          uuid(),
          id,
          JSON.stringify({ ...focus, discovery: collection.discovery }),
        ],
      )
    ).rows[0];
  });
}
async function stillCurrent(db: any, job: any) {
  return Boolean(
    (
      await db.query(
        "SELECT id FROM collection WHERE id=$1 AND deleted_at IS NULL AND keyword_version=$2 AND discovery IS NOT DISTINCT FROM $3::jsonb",
        [
          job.collection_id,
          job.snapshot.version,
          JSON.stringify(job.snapshot.discovery),
        ],
      )
    ).rowCount,
  );
}
async function processRefresh(job: any, repo: Repository) {
  const warnings: string[] = [];
  let added = 0,
    scanned = 0;
  try {
    if (!(await stillCurrent(pool, job))) throw Error("SUPERSEDED");
    await captureDigest(job.collection_id);
    await pool.query(
      "UPDATE collection_refresh SET status='running',phase='searching',updated_at=now() WHERE id=$1",
      [job.id],
    );
    const candidates: any[] = [];
    let successful = 0;
    // Two at a time keeps provider traffic bounded while covering more than the daily query.
    const queries = deepQueries(job.snapshot.keywords);
    for (let i = 0; i < queries.length; i += 2) {
      const results = await Promise.allSettled(
        queries
          .slice(i, i + 2)
          .map((q) => discoverCollection(q, config.openAlexEmail)),
      );
      results.forEach((r, index) => {
        if (r.status === "fulfilled") {
          successful++;
          warnings.push(...r.value.warnings);
          candidates.push(
            ...r.value.items.map((c) => ({
              ...c,
              searchQuery: queries[i + index],
            })),
          );
        } else warnings.push(String(r.reason));
      });
    }
    const seeds = (
      await pool.query(
        `SELECT w.id FROM work w JOIN collection_membership cm ON cm.work_id=w.id WHERE cm.collection_id=$1 AND w.deleted_at IS NULL AND w.merged_into IS NULL AND w.access_class NOT IN ('private','user_uploaded') AND (w.doi IS NOT NULL OR EXISTS(SELECT 1 FROM source_record s WHERE s.work_id=w.id AND s.connector='openalex')) ORDER BY (w.id=ANY($2::uuid[])) DESC,cm.created_at,w.id LIMIT 5`,
        [job.collection_id, job.snapshot.discovery?.workIds ?? []],
      )
    ).rows;
    if (seeds.length) {
      try {
        const expansion = await runDiscovery({
          query: "",
          seeds: seeds.map((s) => s.id),
          direction: "both",
          sources: ["openalex"],
          excludeTerms: [],
          excludeIds: [],
          collectionId: job.collection_id,
        });
        if (expansion.coverage.some((c: any) => c.state === "ok")) successful++;
        candidates.push(
          ...expansion.items.map((c: any) => ({
            ...c,
            searchQuery: "Seed references and citing papers",
          })),
        );
        for (const c of expansion.coverage)
          if (c.state !== "ok")
            warnings.push(c.source + ": " + (c.message ?? c.state));
      } catch (e) {
        warnings.push("Seed expansion: " + String(e));
      }
    }
    if (!successful)
      throw Error("All search sources failed. " + warnings.join("; "));
    const unique = new Map<string, any>();
    for (const c of candidates) {
      const key = c.doi?.toLowerCase() || c.externalId || c.title.toLowerCase();
      if (!unique.has(key)) unique.set(key, c);
    }
    scanned = unique.size;
    const filtered = await feedbackFor(
      [...unique.values()],
      "collection:" + job.collection_id,
    );
    const eligible = filtered.items
      .map((c: any) => ({
        c,
        match: keywordMatch(job.snapshot.keywords, c.title, c.abstract),
      }))
      .filter((x: any) => x.match.score >= 0.35)
      .sort((a: any, b: any) => b.match.score - a.match.score);
    if (eligible.length > 200)
      warnings.push(
        "Import limit reached: reviewed the top 200 matching candidates.",
      );
    await pool.query(
      "UPDATE collection_refresh SET phase='importing',scanned=$2,updated_at=now() WHERE id=$1",
      [job.id, scanned],
    );
    for (const { c, match } of eligible.slice(0, 200)) {
      if (!(await stillCurrent(pool, job))) throw Error("SUPERSEDED");
      const work = await repo.createWork(c as Candidate);
      await retainCandidateSource(work.id, c);
      const inserted = await transaction(async (db) => {
        await db.query("SELECT id FROM collection WHERE id=$1 FOR SHARE", [
          job.collection_id,
        ]);
        if (!(await stillCurrent(db, job))) throw Error("SUPERSEDED");
        const reason = {
          kind: "automatic",
          text: `Deep refresh via ${c.connector}: matched ${match.matched.join(", ")} (${match.matched.length}/${job.snapshot.keywords.length} keywords; minimum 35%).`,
          keywords: job.snapshot.keywords,
          matched: match.matched,
          score: match.score,
          query: c.searchQuery,
          evidence: match.evidence,
          provider: c.connector,
          refreshId: job.id,
        };
        const result = await db.query(
          "INSERT INTO collection_membership(collection_id,work_id,inclusion_reason) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING work_id",
          [job.collection_id, work.id, JSON.stringify(reason)],
        );
        if (result.rowCount)
          await db.query(
            "UPDATE collection_refresh SET added=added+1,updated_at=now() WHERE id=$1",
            [job.id],
          );
        return result.rowCount;
      });
      added += inserted ?? 0;
      await queueEnrichment(work.id);
    }
    if (!(await stillCurrent(pool, job))) throw Error("SUPERSEDED");
    await captureDigest(job.collection_id);
    await pool.query(
      "UPDATE collection_refresh SET status=$2,phase='finished',warnings=$3,scanned=$4,updated_at=now() WHERE id=$1",
      [
        job.id,
        warnings.length ? "partial" : "completed",
        JSON.stringify([...new Set(warnings)]),
        scanned,
      ],
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await pool.query(
      "UPDATE collection_refresh SET status=$2,phase='finished',error=$3,warnings=$4,scanned=$5,updated_at=now() WHERE id=$1",
      [
        job.id,
        message === "SUPERSEDED" ? "superseded" : "failed",
        message === "SUPERSEDED"
          ? "Collection keywords or focus changed. Press Deep refresh to search with the new settings."
          : message,
        JSON.stringify(warnings),
        scanned,
      ],
    );
  }
  return added;
}
export async function runDeepRefresh(repo = new Repository()) {
  const db = await pool.connect();
  try {
    if (
      !(await db.query("SELECT pg_try_advisory_lock(73421903) locked")).rows[0]
        .locked
    )
      return;
    // A running row without a lock holder is a recoverable interrupted job.
    const jobs = (
      await db.query(
        "SELECT * FROM collection_refresh WHERE status IN ('queued','running') ORDER BY created_at LIMIT 20",
      )
    ).rows;
    for (const job of jobs) await processRefresh(job, repo);
  } finally {
    await db.query("SELECT pg_advisory_unlock(73421903)");
    db.release();
  }
}
export async function registerDeepRefresh(
  app: FastifyInstance,
  repo: Repository,
) {
  app.post("/api/v1/collections/:id/deep-refresh", async (r, reply) => {
    const job = await enqueueDeepRefresh(
      z
        .string()
        .uuid()
        .parse((r.params as any).id),
    );
    void runDeepRefresh(repo).catch((e) => app.log.error(e));
    return reply.code(202).send(job);
  });
  app.get("/api/v1/collections/:id/deep-refresh", async (r) => {
    const id = z
      .string()
      .uuid()
      .parse((r.params as any).id);
    await manualCollection(pool, id);
    return {
      job:
        (
          await pool.query(
            "SELECT * FROM collection_refresh WHERE collection_id=$1 ORDER BY created_at DESC LIMIT 1",
            [id],
          )
        ).rows[0] ?? null,
    };
  });
}
