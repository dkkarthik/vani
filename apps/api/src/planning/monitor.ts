import { createHash } from "node:crypto";
import { z } from "zod";
import { v7 as uuid } from "uuid";
import type { FastifyInstance } from "fastify";
import { KId as Id } from "@vani/shared";
import { pool, transaction } from "../db.js";
import { fail } from "../metadata.js";
import { manualCollection } from "../research/organization.js";
const stable = (v: any): any =>
  v instanceof Date
    ? v.toISOString()
    : Array.isArray(v)
      ? v.map(stable)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, stable(v[k])]),
          )
        : v;
const hash = (x: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(stable(x)))
    .digest("hex");
export const feedbackContext = (
  query: string,
  seeds: string[] = [],
  collectionId?: string,
) =>
  collectionId
    ? "collection:" + collectionId
    : "query:" + hash([query.trim().toLowerCase(), [...seeds].sort()]);
export const candidateIdentity = (c: any) =>
  String(c.doi || c.externalId || c.title)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(?:dx\.)?doi.org\//, "");
export const materialFingerprint = (c: any) =>
  hash({
    title: c.title,
    abstract: c.abstract ?? "",
    year: c.year ?? null,
    doi: c.doi ?? null,
    retracted: Boolean(c.sourcePayload?.is_retracted),
    updates: c.sourcePayload?.["update-to"] ?? [],
  });
export async function feedbackFor(items: any[], contextKey: string) {
  const records = (
    await pool.query("SELECT * FROM discovery_feedback WHERE context_key=$1", [
      contextKey,
    ])
  ).rows;
  let suppressed = 0;
  const visible = [];
  for (const c of items) {
    const f = records.find((r) => r.identity_key === candidateIdentity(c)),
      unchanged = f?.fingerprint === materialFingerprint(c);
    const hide =
      unchanged &&
      (f.state === "accepted" ||
        f.state === "dismissed" ||
        (f.state === "deferred" && new Date(f.defer_until) > new Date()));
    if (hide) {
      suppressed++;
      continue;
    }
    visible.push({
      ...c,
      feedback: f ? { ...f, materialChanged: !unchanged } : null,
    });
  }
  return { items: visible, suppressed, contextKey };
}
export async function retainCandidateSource(workId: string, c: any) {
  if (!c.connector || !c.externalId) return;
  const payload = JSON.stringify(c.sourcePayload ?? {});
  await pool.query(
    "INSERT INTO source_record(id,work_id,connector,external_id,payload,payload_hash) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(connector,external_id,payload_hash) DO UPDATE SET retrieved_at=now()",
    [
      uuid(),
      workId,
      c.connector,
      c.externalId,
      payload,
      createHash("sha256").update(payload).digest("hex"),
    ],
  );
}
export async function captureDigest(collectionId: string) {
  return transaction(async (db) => {
    await manualCollection(db, collectionId);
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      "digest:" + collectionId,
    ]);
    const old = (
      await db.query(
        "SELECT * FROM collection_watch_snapshot WHERE collection_id=$1",
        [collectionId],
      )
    ).rows[0];
    const works = (
      await db.query(
        `SELECT w.id,w.title,w.abstract,w.year,w.doi,w.source_metadata,(SELECT payload FROM source_record WHERE canonical_work(work_id)=w.id ORDER BY retrieved_at DESC LIMIT 1) latest_source,(SELECT jsonb_agg(jsonb_build_object('relation',relation,'reason',reason,'url',source_url)) FROM version_link WHERE canonical_work(target_id)=w.id AND relation='retracts') retractions FROM work w JOIN collection_membership cm ON cm.work_id=w.id WHERE cm.collection_id=$1 AND w.merged_into IS NULL AND w.deleted_at IS NULL ORDER BY w.id LIMIT 1000`,
        [collectionId],
      )
    ).rows.map((w) => ({
      id: w.id,
      title: w.title,
      metadata: {
        title: w.title,
        abstract: w.abstract,
        year: w.year,
        doi: w.doi,
        sourceMetadata: w.source_metadata,
        providerTitle: w.latest_source?.title,
        providerAbstract:
          w.latest_source?.abstract_inverted_index ?? w.latest_source?.abstract,
      },
      retracted: Boolean(
        w.latest_source?.is_retracted || w.retractions?.length,
      ),
      retractions: w.retractions ?? [],
      origin: w.latest_source?.is_retracted
        ? "provider recorded"
        : "user recorded",
    }));
    const ids = works.map((w) => w.id);
    const edges = (
      await db.query(
        `SELECT id,predicate,source_work_id::text source,target_work_id::text target,verification_status FROM typed_relationship WHERE (canonical_work(source_work_id)=ANY($1::uuid[]) OR canonical_work(target_work_id)=ANY($1::uuid[])) AND verification_status<>'rejected' UNION ALL SELECT e.id,e.predicate,e.source::text,e.target::text,e.origin FROM knowledge_edge e WHERE e.deleted_at IS NULL AND ((e.source->>'kind'='work' AND canonical_work((e.source->>'id')::uuid)=ANY($1::uuid[])) OR (e.target->>'kind'='work' AND canonical_work((e.target->>'id')::uuid)=ANY($1::uuid[]))) ORDER BY id LIMIT 2000`,
        [ids],
      )
    ).rows;
    const snapshot = { works, edges };
    let added = 0;
    const event = async (kind: string, id: string, before: any, after: any) => {
      const payload = { id, before, after };
      const result = await db.query(
        "INSERT INTO collection_digest(id,collection_id,kind,fingerprint,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
        [
          uuid(),
          collectionId,
          kind,
          hash([old.updated_at, kind, payload]),
          JSON.stringify(payload),
        ],
      );
      added += result.rowCount ?? 0;
    };
    if (old) {
      for (const w of works) {
        const prior = old.snapshot.works.find((x: any) => x.id === w.id);
        if (!prior) await event("new", w.id, null, w);
        else {
          if (hash(prior.metadata) !== hash(w.metadata))
            await event("corrected", w.id, prior.metadata, w.metadata);
          if (w.retracted && !prior.retracted)
            await event("retracted", w.id, prior, w);
        }
      }
      for (const e of edges)
        if (!old.snapshot.edges.some((x: any) => x.id === e.id))
          await event("connected", e.id, null, e);
    }
    if (!old || hash(old.snapshot) !== hash(snapshot))
      await db.query(
        "INSERT INTO collection_watch_snapshot(collection_id,snapshot) VALUES($1,$2) ON CONFLICT(collection_id) DO UPDATE SET snapshot=$2,updated_at=now()",
        [collectionId, JSON.stringify(snapshot)],
      );
    return {
      added,
      baseline: !old,
      coverage: {
        works: works.length,
        edges: edges.length,
        workLimit: 1000,
        edgeLimit: 2000,
      },
      status: added ? "changed" : "unchanged",
    };
  });
}
export async function registerMonitor(app: FastifyInstance) {
  app.get("/api/v1/knowledge/feedback", async () => ({
    items: (
      await pool.query(
        "SELECT * FROM discovery_feedback ORDER BY updated_at DESC LIMIT 200",
      )
    ).rows,
    limit: 200,
  }));
  app.post("/api/v1/knowledge/feedback", async (r) => {
    const d = z
      .object({
        runId: Id,
        resultId: Id,
        state: z.enum(["accepted", "dismissed", "deferred"]),
        reason: z.string().trim().min(1).max(3000),
        deferUntil: z.string().datetime().optional(),
        version: z.number().int().min(0),
      })
      .parse(r.body);
    const run = (
        await pool.query("SELECT * FROM discovery_run WHERE id=$1", [d.runId])
      ).rows[0],
      candidate = run?.results.find((c: any) => c.resultId === d.resultId);
    if (!candidate) fail(404, "Candidate not in this discovery run.");
    if (
      d.state === "deferred" &&
      (!d.deferUntil || new Date(d.deferUntil) <= new Date())
    )
      fail(400, "Choose a future defer date.");
    const contextKey = feedbackContext(
      run.input.query,
      run.input.seeds,
      run.input.collectionId,
    );
    return transaction(async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        contextKey,
      ]);
      const old = (
        await db.query(
          "SELECT * FROM discovery_feedback WHERE context_key=$1 AND identity_key=$2",
          [contextKey, candidateIdentity(candidate)],
        )
      ).rows[0];
      if ((old?.version ?? 0) !== d.version)
        fail(409, "Feedback changed. Reload its current state.");
      const history = old
        ? [
            ...old.history,
            {
              state: old.state,
              reason: old.reason,
              fingerprint: old.fingerprint,
              at: old.updated_at,
            },
          ]
        : [];
      await db.query(
        "INSERT INTO discovery_feedback(id,context_key,identity_key,fingerprint,state,reason,defer_until,history) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(context_key,identity_key) DO UPDATE SET fingerprint=$4,state=$5,reason=$6,defer_until=$7,history=$8,version=discovery_feedback.version+1,updated_at=now()",
        [
          uuid(),
          contextKey,
          candidateIdentity(candidate),
          materialFingerprint(candidate),
          d.state,
          d.reason,
          d.deferUntil ?? null,
          JSON.stringify(history),
        ],
      );
      return { saved: true };
    });
  });
  app.post("/api/v1/knowledge/feedback/:id/restore", async (r) => {
    const id = Id.parse((r.params as any).id),
      { version } = z
        .object({ version: z.number().int().positive() })
        .parse(r.body);
    if (
      !(
        await pool.query(
          `UPDATE discovery_feedback SET state='restored',version=version+1,history=history||jsonb_build_array(jsonb_build_object('state',state,'reason',reason,'at',updated_at)),updated_at=now() WHERE id=$1 AND version=$2`,
          [id, version],
        )
      ).rowCount
    )
      fail(409, "Feedback changed. Reload before restoring.");
    return { restored: true };
  });
  app.get("/api/v1/knowledge/digests/:collectionId", async (r) => {
    const id = Id.parse((r.params as any).collectionId);
    await manualCollection(pool, id);
    return {
      items: (
        await pool.query(
          "SELECT * FROM collection_digest WHERE collection_id=$1 ORDER BY created_at DESC LIMIT 200",
          [id],
        )
      ).rows,
      snapshot:
        (
          await pool.query(
            "SELECT updated_at FROM collection_watch_snapshot WHERE collection_id=$1",
            [id],
          )
        ).rows[0] ?? null,
      collection: (
        await pool.query(
          "SELECT name,discovery,discovery_error,next_discovery_at,last_discovery_at FROM collection WHERE id=$1",
          [id],
        )
      ).rows[0],
      limit: 200,
    };
  });
  app.post("/api/v1/knowledge/digests/:collectionId/capture", async (r) =>
    captureDigest(Id.parse((r.params as any).collectionId)),
  );
  app.post("/api/v1/knowledge/digests/:collectionId/control", async (r) => {
    const id = Id.parse((r.params as any).collectionId),
      { action } = z
        .object({
          action: z.enum(["pause", "resume", "retry", "acknowledge"]),
          ids: z.array(Id).max(200).optional(),
        })
        .parse(r.body);
    await manualCollection(pool, id);
    if (action === "acknowledge") {
      const ids = z.object({ ids: z.array(Id).max(200) }).parse(r.body).ids;
      await pool.query(
        "UPDATE collection_digest SET seen_at=coalesce(seen_at,now()) WHERE collection_id=$1 AND id=ANY($2::uuid[])",
        [id, ids],
      );
    } else {
      const c = (
        await pool.query("SELECT discovery FROM collection WHERE id=$1", [id])
      ).rows[0];
      if (!c.discovery) fail(409, "Configure collection discovery first.");
      await pool.query(
        `UPDATE collection SET discovery=jsonb_set(discovery,'{enabled}',$2::jsonb),next_discovery_at=CASE WHEN $3='pause' THEN next_discovery_at ELSE now() END WHERE id=$1`,
        [id, action === "pause" ? "false" : "true", action],
      );
    }
    return { saved: true };
  });
}
// Check old indexed works independently of the new-publication search window.
export async function refreshWatchedSources(collectionId: string) {
  const rows = (
    await pool.query(
      `SELECT w.id,w.doi,(SELECT external_id FROM source_record WHERE canonical_work(work_id)=w.id AND connector='openalex' ORDER BY retrieved_at DESC LIMIT 1) external_id FROM work w JOIN collection_membership m ON m.work_id=w.id WHERE m.collection_id=$1 AND w.merged_into IS NULL AND w.deleted_at IS NULL AND w.access_class NOT IN ('private','user_uploaded') AND (w.doi IS NOT NULL OR EXISTS(SELECT 1 FROM source_record WHERE canonical_work(work_id)=w.id AND connector='openalex')) ORDER BY (SELECT max(retrieved_at) FROM source_record WHERE canonical_work(work_id)=w.id AND connector='openalex') NULLS FIRST,w.id LIMIT 20`,
      [collectionId],
    )
  ).rows;
  const warnings: string[] = [];
  for (let offset = 0; offset < rows.length; offset += 5)
    await Promise.all(
      rows.slice(offset, offset + 5).map(async (w) => {
        const external = String(w.external_id ?? "")
          .match(/(?:^|\/)W\d+$/)?.[0]
          ?.replace("/", "");
        const identifier =
          external ?? (w.doi ? "https://doi.org/" + w.doi : null);
        if (!identifier) return;
        try {
          const response = await fetch(
            "https://api.openalex.org/works/" + identifier,
            {
              headers: process.env.OPENALEX_API_KEY
                ? { Authorization: "Bearer " + process.env.OPENALEX_API_KEY }
                : {},
              signal: AbortSignal.timeout(12000),
            },
          );
          if (!response.ok) throw Error("HTTP " + response.status);
          const payload: any = await response.json();
          if (
            typeof payload.id !== "string" ||
            !payload.id.startsWith("https://openalex.org/W")
          )
            return;
          await retainCandidateSource(w.id, {
            connector: "openalex",
            externalId: payload.id,
            sourcePayload: payload,
          });
        } catch (e) {
          warnings.push(
            `Existing source check ${w.id}: ${e instanceof Error ? e.message : "unavailable"}`,
          );
        }
      }),
    );
  return { checked: rows.length, warnings };
}
