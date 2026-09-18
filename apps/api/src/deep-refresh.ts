import { enqueueCore, runCoreWorker } from "./core/service.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "./db.js";
import { Repository } from "./repository.js";
import { manualCollection } from "./research/organization.js";
export function deepQueries(keywords: string[]) {
  const queries = [keywords.join(" ")];
  const size = Math.max(1, Math.ceil(keywords.length / 3));
  for (let i = 0; i < keywords.length; i += size)
    queries.push(keywords.slice(i, i + size).join(" "));
  return [...new Set(queries.filter(Boolean))].slice(0, 4);
}
export async function enqueueDeepRefresh(id: string) {
  return enqueueCore(id);
}
export async function runDeepRefresh(repo = new Repository()) {
  void repo;
  await runCoreWorker();
}
export async function registerDeepRefresh(
  app: FastifyInstance,
  repo: Repository,
) {
  void repo;
  app.post("/api/v1/collections/:id/deep-refresh", async (r, reply) =>
    reply.code(202).send(
      await enqueueCore(
        z
          .string()
          .uuid()
          .parse((r.params as any).id),
      ),
    ),
  );
  app.get("/api/v1/collections/:id/deep-refresh", async (r) => {
    const id = z
      .string()
      .uuid()
      .parse((r.params as any).id);
    await manualCollection(pool, id);
    const row = (
      await pool.query(
        "SELECT * FROM core_run WHERE collection_id=$1 ORDER BY created_at DESC LIMIT 1",
        [id],
      )
    ).rows[0];
    const added = row
      ? Number(
          (
            await pool.query(
              "SELECT count(*) FROM collection_membership WHERE collection_id=$1 AND created_at>=$2",
              [id, row.created_at],
            )
          ).rows[0].count,
        )
      : 0;
    return {
      job: row
        ? {
            ...row,
            scanned: row.counters.discovered ?? 0,
            added,
            warnings: row.coverage
              .filter((c: any) => c.state !== "complete")
              .map((c: any) => `${c.source}: ${c.state}`),
          }
        : null,
    };
  });
}
