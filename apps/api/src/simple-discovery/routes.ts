import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { v7 as uuid } from "uuid";
import { pool, transaction } from "../db.js";
import { Profile, Shortlist } from "./settings.js";
import { paperReferences } from "../lib/paper-references.js";
import {
  settings,
  saveSettings,
  enqueue,
  importRetained,
  savePaper,
} from "./service.js";
const Id = z.string().uuid();
export async function registerSimpleDiscovery(app: FastifyInstance) {
  app.get("/api/v1/collections/:id/recommendations", async (r) => {
    const id = Id.parse((r.params as any).id),
      cfg = await settings(id);
    const q = z
      .object({
        offset: z.coerce.number().int().min(0).default(0),
        view: z
          .enum(["recommended", "shortlist", "filtered", "saved", "dismissed"])
          .default("recommended"),
      })
      .parse(r.query);
    const run =
      (
        await pool.query(
          "SELECT * FROM simple_run WHERE collection_id=$1 ORDER BY created_at DESC LIMIT 1",
          [id],
        )
      ).rows[0] ?? null;
    const model =
      (
        await pool.query(
          "SELECT run_id,metadata,updated_at FROM simple_model WHERE collection_id=$1",
          [id],
        )
      ).rows[0] ?? null;
    const sourceRun = run?.tasks.length
      ? run
      : ((
          await pool.query(
            "SELECT * FROM simple_run WHERE collection_id=$1 AND jsonb_array_length(tasks)>0 ORDER BY created_at DESC LIMIT 1",
            [id],
          )
        ).rows[0] ?? null);
    const shortlistReady =
      cfg.profile.shortlist.enabled &&
      model?.metadata.shortlist?.status === "ready" &&
      model.metadata.settingsVersion === cfg.version &&
      model.metadata.labelVersion === cfg.label_version;
    const predicate =
      q.view === "saved"
        ? "r.work_id IS NOT NULL"
        : q.view === "dismissed"
          ? "r.feedback='down'"
          : "r.work_id IS NULL AND r.feedback IS DISTINCT FROM 'down' AND r.run_id=$2" +
            (q.view === "shortlist"
              ? " AND r.explanation#>>'{sanity,selected}'='true'"
              : q.view === "filtered"
                ? " AND r.explanation#>>'{sanity,selected}'='false'"
                : "");
    const rankedView = !["saved", "dismissed"].includes(q.view);
    const args = rankedView
      ? [
          id,
          ["shortlist", "filtered"].includes(q.view) && !shortlistReady
            ? null
            : (model?.run_id ?? null),
        ]
      : [id];
    const order = ["shortlist", "filtered"].includes(q.view)
      ? "(r.explanation#>>'{sanity,score}')::double precision DESC NULLS LAST,r.paper_id"
      : "r.score DESC NULLS LAST,r.paper_id";
    const total = (
      await pool.query(
        `SELECT count(*)::int n FROM simple_recommendation r WHERE r.collection_id=$1 AND ${predicate}`,
        args,
      )
    ).rows[0].n;
    const items = (
      await pool.query(
        `SELECT r.*,p.paper,p.sources FROM simple_recommendation r JOIN simple_paper p ON p.id=r.paper_id WHERE r.collection_id=$1 AND ${predicate} ORDER BY ${order} LIMIT 25 OFFSET $${args.length + 1}`,
        [...args, q.offset],
      )
    ).rows;
    const references = await paperReferences(
      items.map((row) => ({ paper: row.paper, workId: row.work_id })),
    );
    return {
      settings: cfg,
      run,
      sourceRun,
      model,
      items: items.map((row, index) => ({
        ...row,
        reference: references[index],
      })),
      total,
      shortlistReady,
      simpleOnly: process.env.VANI_SIMPLE_DISCOVERY_ONLY === "true",
    };
  });
  app.put("/api/v1/collections/:id/recommendations/settings", async (r) => {
    const d = z
      .object({ version: z.number().int().min(0), profile: Profile })
      .parse(r.body);
    return saveSettings(Id.parse((r.params as any).id), d.version, d.profile);
  });
  app.post(
    "/api/v1/collections/:id/recommendations/refine",
    async (r, reply) => {
      const id = Id.parse((r.params as any).id);
      const d = z
        .object({ version: z.number().int().min(0), shortlist: Shortlist })
        .parse(r.body);
      const cfg = await settings(id);
      if (!cfg.profile.enabled)
        throw Object.assign(Error("Enable simple discovery first."), {
          statusCode: 409,
        });
      await saveSettings(
        id,
        d.version,
        { ...cfg.profile, shortlist: d.shortlist },
        { requireIdle: true, preserveSchedule: true },
      );
      return reply.code(202).send(await enqueue(id, "rerank"));
    },
  );
  app.post(
    "/api/v1/collections/:id/recommendations/refresh",
    async (r, reply) => {
      const d = z
        .object({ mode: z.enum(["refresh", "rerank"]).default("refresh") })
        .parse(r.body ?? {});
      return reply
        .code(202)
        .send(await enqueue(Id.parse((r.params as any).id), d.mode));
    },
  );
  app.post(
    "/api/v1/collections/:id/recommendations/import-retained",
    async (r) => importRetained(Id.parse((r.params as any).id)),
  );
  app.post("/api/v1/collections/:id/recommendations/:paper/save", async (r) => {
    const p = z.object({ id: Id, paper: Id }).parse(r.params);
    const result = await savePaper(p.id, p.paper);
    const cfg = await settings(p.id);
    if (cfg.profile.enabled) await enqueue(p.id, "rerank");
    return result;
  });
  app.post(
    "/api/v1/collections/:id/recommendations/:paper/feedback",
    async (r) => {
      const p = z.object({ id: Id, paper: Id }).parse(r.params),
        d = z
          .object({
            label: z.enum(["up", "down", "clear"]),
            reason: z.string().max(2000).default(""),
          })
          .parse(r.body);
      await settings(p.id);
      await transaction(async (db) => {
        await db.query("SELECT id FROM collection WHERE id=$1 FOR UPDATE", [
          p.id,
        ]);
        const updated = await db.query(
          "UPDATE simple_recommendation SET feedback=$3,reason=$4,updated_at=now() WHERE collection_id=$1 AND paper_id=$2 RETURNING paper_id",
          [p.id, p.paper, d.label === "clear" ? null : d.label, d.reason],
        );
        if (!updated.rowCount)
          throw Object.assign(Error("Recommendation not found."), {
            statusCode: 404,
          });
        await db.query(
          "INSERT INTO simple_feedback(id,collection_id,paper_id,judgment) VALUES($1,$2,$3,$4)",
          [uuid(), p.id, p.paper, JSON.stringify(d)],
        );
        await db.query(
          "UPDATE simple_discovery_settings SET label_version=label_version+1 WHERE collection_id=$1",
          [p.id],
        );
      });
      const cfg = await settings(p.id);
      if (cfg.profile.enabled) await enqueue(p.id, "rerank");
      return { saved: true };
    },
  );
}
