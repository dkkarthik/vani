import { escalationPacket, escalate } from "./escalation.js";
import { importArticle } from "./articles.js";
import {
  freezeHoldout,
  labelHoldout,
  evaluateAndPromote,
} from "./evaluation.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { v7 as uuid } from "uuid";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pool, transaction } from "../db.js";
import { config } from "../config.js";
import {
  configureModelPersistence,
  modelIdentity,
  modelLoad,
  markInteractive,
} from "../models/router.js";
import { Focus } from "./algorithm.js";
import {
  getFocus,
  saveFocus,
  enqueueCore,
  acceptCandidate,
} from "./service.js";
import { enqueueAudit } from "./audits.js";
const Id = z.string().uuid();
export async function systemHealth() {
  const check = async (fn: () => Promise<unknown>) => {
    try {
      return { state: "ready", detail: await fn() };
    } catch {
      return {
        state: "unavailable",
        detail: "Run scripts/setup-ubuntu.sh --check for remediation.",
      };
    }
  };
  const [database, pdf, reader, embedding, gpu] = await Promise.all([
    check(async () => {
      const r = await pool.query(
        "SELECT version(),(SELECT extversion FROM pg_extension WHERE extname='vector') vector",
      );
      if (!r.rows[0].vector) throw Error();
      return r.rows[0];
    }),
    check(async () => {
      await promisify(execFile)("pdftotext", ["-v"], { timeout: 3000 });
      return "Poppler available";
    }),
    check(() => modelIdentity()),
    check(() =>
      modelIdentity(process.env.OLLAMA_EMBED_MODEL ?? "qwen3-embedding:0.6b"),
    ),
    check(async () => {
      const r = await promisify(execFile)(
        "nvidia-smi",
        [
          "--query-gpu=name,memory.total,memory.used,utilization.gpu",
          "--format=csv,noheader",
        ],
        { timeout: 3000 },
      );
      return r.stdout.trim();
    }),
  ]);
  return {
    schemaVersion: 1,
    version: "1.0.0",
    database,
    pdf,
    reader,
    embedding,
    gpu,
    models: {
      reader: config.ollamaModel,
      embedding: process.env.OLLAMA_EMBED_MODEL ?? "qwen3-embedding:0.6b",
      context: 16384,
      concurrency: 1,
    },
    routing: {
      mode:
        process.env.VANI_CLOUD_MODE === "approved"
          ? "explicit approval only"
          : "local-only",
      conversation: "local-only",
    },
    queue: modelLoad(),
  };
}
export function bindModelPersistence() {
  configureModelPersistence(
    async (e) => {
      await pool.query(
        "INSERT INTO model_invocation(id,task,collection_id,provider,model,digest,status,reason,input_tokens,output_tokens,duration_ms) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        [
          e.id,
          e.task,
          e.collectionId ?? null,
          e.provider,
          e.model,
          e.digest ?? null,
          e.status,
          e.reason,
          e.inputTokens,
          e.outputTokens,
          e.durationMs,
        ],
      );
    },
    async (id, task, collectionId, reservation, packetHash) => {
      await transaction(async (db) => {
        await db.query("SELECT pg_advisory_xact_lock(73421913)");
        const budget = Number(process.env.VANI_CLOUD_DAILY_TOKENS ?? 0);
        if (!Number.isFinite(budget) || budget <= 0)
          throw Error("Cloud token budget is disabled.");
        const approval = (
          await db.query(
            "SELECT * FROM model_approval WHERE id=$1 AND task=$2 AND collection_id=$3 AND consumed_at IS NULL AND expires_at>now() FOR UPDATE",
            [id, task, collectionId],
          )
        ).rows[0];
        if (
          !approval ||
          approval.packet_hash !== packetHash ||
          approval.max_tokens < reservation
        )
          throw Error("Approval is absent, expired or already used.");
        const reserved = Number(
          (
            await db.query(
              "SELECT COALESCE(sum(max_tokens),0) total FROM model_approval WHERE consumed_at>=date_trunc('day',now())",
            )
          ).rows[0].total,
        );
        const monthly = Number(process.env.VANI_CLOUD_MONTHLY_TOKENS ?? 0);
        const usedMonth = Number(
          (
            await db.query(
              "SELECT COALESCE(sum(max_tokens),0) total FROM model_approval WHERE consumed_at>=date_trunc('month',now())",
            )
          ).rows[0].total,
        );
        if (
          !Number.isFinite(monthly) ||
          monthly <= 0 ||
          usedMonth + approval.max_tokens > monthly
        )
          throw Error("Monthly cloud token budget exceeded.");
        if (reserved + approval.max_tokens > budget)
          throw Error("Daily cloud token budget exceeded.");
        await db.query(
          "UPDATE model_approval SET consumed_at=now() WHERE id=$1",
          [id],
        );
      });
    },
    async (signal) => {
      const db = await pool.connect();
      let locked = false;
      try {
        while (!locked) {
          signal.throwIfAborted();
          locked = (
            await db.query("SELECT pg_try_advisory_lock(73421914) locked")
          ).rows[0].locked;
          if (!locked)
            await new Promise<void>((resolve, reject) => {
              const cancel = () => {
                clearTimeout(timer);
                reject(new Error("Model lease cancelled"));
              };
              const timer = setTimeout(() => {
                signal.removeEventListener("abort", cancel);
                resolve();
              }, 100);
              signal.addEventListener("abort", cancel, { once: true });
            });
        }
        return async () => {
          try {
            await db.query("SELECT pg_advisory_unlock(73421914)");
          } finally {
            db.release();
          }
        };
      } catch (e) {
        db.release();
        throw e;
      }
    },
  );
}
export async function registerCore(app: FastifyInstance) {
  app.addHook("onRequest", async (request) => {
    if (request.method !== "GET" && !request.url.includes("/core/audits"))
      markInteractive();
  });
  app.get("/api/v1/system/health", systemHealth);
  app.get("/api/v1/system/invocations", async () => ({
    items: (
      await pool.query(
        "SELECT * FROM model_invocation ORDER BY created_at DESC LIMIT 100",
      )
    ).rows,
  }));
  app.get("/api/v1/collections/:id/core", async (r) => {
    const id = Id.parse((r.params as any).id),
      focus = await getFocus(id),
      offset = z.coerce
        .number()
        .int()
        .min(0)
        .max(20000)
        .default(0)
        .parse((r.query as any).offset);
    const runs = (
      await pool.query(
        "SELECT * FROM core_run WHERE collection_id=$1 ORDER BY created_at DESC LIMIT 5",
        [id],
      )
    ).rows;
    const candidates = (
      await pool.query(
        "SELECT id,identity,work_id,paper->>'title' title,stage,state,proximity,role,features-'embedding' features,assessment,feedback,paths,focus_version,created_at FROM core_candidate WHERE collection_id=$1 ORDER BY (features->>'score')::float DESC NULLS LAST,id LIMIT 50 OFFSET $2",
        [id, offset],
      )
    ).rows;
    const counts = (
      await pool.query(
        "SELECT stage,state,count(*)::int count FROM core_candidate WHERE collection_id=$1 GROUP BY stage,state",
        [id],
      )
    ).rows;
    const audits = (
      await pool.query(
        "SELECT * FROM core_audit WHERE collection_id=$1 ORDER BY created_at DESC LIMIT 10",
        [id],
      )
    ).rows;
    const policies = (
      await pool.query(
        "SELECT * FROM core_policy WHERE collection_id=$1 ORDER BY created_at DESC LIMIT 10",
        [id],
      )
    ).rows;
    return { focus, runs, candidates, counts, audits, policies };
  });
  app.post("/api/v1/collections/:id/core/articles", async (r) =>
    importArticle(
      Id.parse((r.params as any).id),
      z.object({ url: z.string().url().max(2000) }).parse(r.body).url,
    ),
  );
  app.put("/api/v1/collections/:id/core/focus", async (r) => {
    const d = z
      .object({ version: z.number().int(), profile: Focus })
      .parse(r.body);
    return saveFocus(Id.parse((r.params as any).id), d.version, d.profile);
  });
  app.post("/api/v1/collections/:id/core/refresh", async (r, reply) =>
    reply.code(202).send(await enqueueCore(Id.parse((r.params as any).id))),
  );
  app.post("/api/v1/collections/:id/core/audits", async (r, reply) => {
    const d = z.object({ kind: z.enum(["early", "deep"]) }).parse(r.body);
    return reply
      .code(202)
      .send(await enqueueAudit(Id.parse((r.params as any).id), d.kind));
  });
  app.get("/api/v1/core/candidates/:id", async (r) => {
    const id = Id.parse((r.params as any).id),
      c = (
        await pool.query(
          "SELECT *,features-'embedding' features FROM core_candidate WHERE id=$1",
          [id],
        )
      ).rows[0];
    if (!c)
      throw Object.assign(Error("Candidate not found."), { statusCode: 404 });
    const history = (
        await pool.query(
          "SELECT * FROM core_assessment WHERE candidate_id=$1 ORDER BY created_at DESC",
          [id],
        )
      ).rows,
      artifacts = (
        await pool.query("SELECT * FROM core_artifact WHERE candidate_id=$1", [
          id,
        ])
      ).rows;
    return { ...c, history, artifacts };
  });
  app.get("/api/v1/core/candidates/:id/escalation", async (r) => {
    const p = await escalationPacket(Id.parse((r.params as any).id));
    return {
      packetHash: p.packetHash,
      reservedTokens: p.reservedTokens,
      evidence: p.evidence,
      model: config.openAiModel,
    };
  });
  app.post("/api/v1/core/candidates/:id/escalation", async (r) => {
    const d = z
      .object({
        packetHash: z.string().length(64),
        reason: z.string().min(20).max(2000),
      })
      .parse(r.body);
    return escalate(Id.parse((r.params as any).id), d.packetHash, d.reason);
  });
  app.post("/api/v1/core/candidates/:id/accept", async (r) =>
    acceptCandidate(Id.parse((r.params as any).id)),
  );
  app.post("/api/v1/core/candidates/:id/read", async (r) => {
    const id = Id.parse((r.params as any).id),
      { depth } = z.object({ depth: z.enum(["D2", "D3"]) }).parse(r.body);
    const c = (
      await pool.query("SELECT * FROM core_candidate WHERE id=$1", [id])
    ).rows[0];
    if (!c)
      throw Object.assign(Error("Candidate not found."), { statusCode: 404 });
    const run = await enqueueCore(c.collection_id);
    await pool.query(
      "UPDATE core_candidate SET stage=$2,state='pending',run_id=$3,focus_version=$4,assessment=assessment||'{\"explicitReadingOverride\":true}'::jsonb WHERE id=$1",
      [id, depth, run.id, run.focus_version],
    );
    return { status: "queued" };
  });
  app.post("/api/v1/core/candidates/:id/feedback", async (r) => {
    const id = Id.parse((r.params as any).id),
      d = z
        .object({
          label: z.enum([
            "closest",
            "related",
            "background",
            "out_of_scope",
            "wrong_role",
            "incompatible_protocol",
            "duplicate",
            "already_known",
            "low_priority",
          ]),
          reason: z.string().min(2).max(2000),
        })
        .parse(r.body);
    const judgment = { ...d, origin: "human", at: new Date().toISOString() };
    const c = await transaction(async (db) => {
      const row = (
        await db.query(
          "UPDATE core_candidate SET feedback=$2,updated_at=now() WHERE id=$1 RETURNING id",
          [id, JSON.stringify(judgment)],
        )
      ).rows[0];
      if (row)
        await db.query(
          "INSERT INTO core_feedback_history(id,candidate_id,judgment) VALUES($1,$2,$3)",
          [uuid(), id, JSON.stringify(judgment)],
        );
      return row;
    });
    if (!c)
      throw Object.assign(Error("Candidate not found."), { statusCode: 404 });
    return c;
  });
  app.post("/api/v1/core/candidates/:id/artifacts", async (r) => {
    const id = Id.parse((r.params as any).id),
      d = z
        .object({
          kind: z.enum([
            "repository",
            "dataset",
            "checkpoint",
            "project",
            "article",
          ]),
          identity: z.string().url().max(2000),
          predicate: z.enum([
            "describes",
            "implements",
            "trained_on",
            "evaluated_on",
            "extends",
            "discovered_via",
          ]),
          quote: z.string().min(12).max(2000),
          sourceUrl: z.string().url().max(2000),
        })
        .parse(r.body);
    return (
      (
        await pool.query(
          "INSERT INTO core_artifact(id,candidate_id,kind,identity,predicate,source,evidence_family) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING *",
          [
            uuid(),
            id,
            d.kind,
            d.identity,
            d.predicate,
            JSON.stringify({
              url: d.sourceUrl,
              quote: d.quote,
              origin: "human",
              at: new Date().toISOString(),
            }),
            d.sourceUrl,
          ],
        )
      ).rows[0] ?? { status: "existing" }
    );
  });
  app.post("/api/v1/core/policies/:id/holdouts", async (r) =>
    freezeHoldout(Id.parse((r.params as any).id), r.body),
  );
  app.post("/api/v1/core/holdouts/:id/labels", async (r) =>
    labelHoldout(Id.parse((r.params as any).id), r.body),
  );
  app.post("/api/v1/core/policies/:id/evaluate", async (r) =>
    evaluateAndPromote(Id.parse((r.params as any).id)),
  );
  app.post("/api/v1/core/policies/:id/rollback", async (r) =>
    transaction(async (db) => {
      const p = (
        await db.query(
          "UPDATE core_policy SET status='rolled_back' WHERE id=$1 AND status='active' RETURNING *",
          [Id.parse((r.params as any).id)],
        )
      ).rows[0];
      if (!p)
        throw Object.assign(Error("Active policy not found."), {
          statusCode: 404,
        });
      if (p.parent_id)
        await db.query("UPDATE core_policy SET status='active' WHERE id=$1", [
          p.parent_id,
        ]);
      return { status: "rolled_back" };
    }),
  );
}
