import { v7 as uuid } from "uuid";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { ResearchId as Id } from "@vani/shared";
import { pool, transaction } from "../db.js";
import { fail } from "../metadata.js";
import { activeWork } from "./organization.js";
const Pair = z
  .object({ sourceId: Id, targetId: Id })
  .refine((p) => p.sourceId !== p.targetId, "Choose two different records.");
export async function mergePreview(
  sourceId: string,
  targetId: string,
  client: PoolClient | typeof pool = pool,
) {
  const source = await activeWork(client, sourceId),
    target = await activeWork(client, targetId);
  const conflicts: string[] = [];
  if (
    source.doi &&
    target.doi &&
    source.doi.toLowerCase() !== target.doi.toLowerCase()
  )
    conflicts.push("Different DOIs: link versions instead of merging.");
  const kinds = [source.manifestation_type, target.manifestation_type];
  if (kinds[0] !== kinds[1] && kinds.every((kind) => kind !== "unknown"))
    conflicts.push(
      "Different manifestation types: link versions instead of merging.",
    );
  const counts = async (id: string) =>
    (
      await client.query(
        "SELECT (SELECT count(*) FROM attachment WHERE canonical_work(work_id)=$1)::int attachments,(SELECT count(*) FROM note WHERE canonical_work(work_id)=$1)::int notes,(SELECT count(*) FROM collection_membership WHERE canonical_work(work_id)=$1)::int memberships",
        [id],
      )
    ).rows[0];
  return {
    source,
    target,
    sourceCounts: await counts(sourceId),
    sourceMemberships: (
      await client.query(
        "SELECT cm.*,c.name FROM collection_membership cm JOIN collection c ON c.id=cm.collection_id WHERE canonical_work(cm.work_id)=$1",
        [sourceId],
      )
    ).rows,
    targetMemberships: (
      await client.query(
        "SELECT cm.*,c.name FROM collection_membership cm JOIN collection c ON c.id=cm.collection_id WHERE canonical_work(cm.work_id)=$1",
        [targetId],
      )
    ).rows,
    targetCounts: await counts(targetId),
    conflicts,
    policy:
      "Target metadata wins. Original citation keys, research objects and conflicting project states remain preserved on the alias record.",
  };
}
export async function mergeWorks(
  sourceId: string,
  targetId: string,
  sourceRevision: number,
  targetRevision: number,
) {
  return transaction(async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('vani-browser-capture'))",
    );
    const prior = (
      await client.query(
        "SELECT snapshot FROM identity_review WHERE source_id=$1 AND target_id=$2 AND action='merge'",
        [sourceId, targetId],
      )
    ).rows[0];
    if (prior) return { id: targetId, repeated: true };
    await client.query(
      "SELECT id FROM work WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
      [[sourceId, targetId]],
    );
    const preview = await mergePreview(sourceId, targetId, client);
    if (
      preview.source.version !== sourceRevision ||
      preview.target.version !== targetRevision
    )
      fail(409, "A record changed after preview. Review a new merge preview.");
    if (preview.conflicts.length) fail(409, preview.conflicts.join(" "));
    await client.query(
      "INSERT INTO identity_review(id,source_id,target_id,action,snapshot) VALUES($1,$2,$3,$4,$5)",
      [uuid(), sourceId, targetId, "merge", JSON.stringify(preview)],
    );
    await client.query(
      "INSERT INTO collection_membership(collection_id,work_id,status,priority,rationale,ordinal,seen_at) SELECT collection_id,$2,status,priority,rationale,ordinal,seen_at FROM collection_membership WHERE canonical_work(work_id)=$1 ON CONFLICT DO NOTHING",
      [sourceId, targetId],
    );
    const relations = (
      await client.query(
        "SELECT * FROM typed_relationship WHERE canonical_work(source_work_id)=$1 OR canonical_work(target_work_id)=$1",
        [sourceId],
      )
    ).rows;
    for (const relation of relations) {
      const source =
          relation.source_work_id === sourceId
            ? targetId
            : relation.source_work_id,
        target =
          relation.target_work_id === sourceId
            ? targetId
            : relation.target_work_id;
      if (source === target) continue;
      await client.query(
        "INSERT INTO typed_relationship(id,source_work_id,target_work_id,predicate,confidence,verification_status,evidence) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING",
        [
          uuid(),
          source,
          target,
          relation.predicate,
          relation.confidence,
          relation.verification_status,
          JSON.stringify(relation.evidence),
        ],
      );
    }
    await client.query(
      "UPDATE work SET tags=ARRAY(SELECT DISTINCT unnest(tags||$2::text[])),version=version+1,updated_at=now() WHERE id=$1",
      [targetId, preview.source.tags],
    );
    await client.query(
      "UPDATE work SET merged_into=$2,version=version+1,updated_at=now() WHERE id=$1",
      [sourceId, targetId],
    );
    return { id: targetId, repeated: false };
  });
}
export async function registerIdentity(app: FastifyInstance) {
  app.get("/api/v1/identity/history", async () => ({
    items: (
      await pool.query(
        "SELECT * FROM identity_review ORDER BY created_at DESC LIMIT 50",
      )
    ).rows,
  }));
  app.get("/api/v1/identity/candidates", async () => ({
    items: (
      await pool.query(`SELECT a.id AS source_id,b.id AS target_id,a.title AS source_title,b.title AS target_title,a.citation_key AS source_key,b.citation_key AS target_key,similarity(a.normalized_title,b.normalized_title) AS similarity,EXISTS(SELECT 1 FROM attachment x JOIN attachment y ON x.object_hash=y.object_hash WHERE x.work_id=a.id AND y.work_id=b.id) AS shared_pdf
 FROM work a JOIN work b ON a.id<b.id WHERE a.deleted_at IS NULL AND b.deleted_at IS NULL AND a.merged_into IS NULL AND b.merged_into IS NULL
 AND (similarity(a.normalized_title,b.normalized_title)>0.65 OR EXISTS(SELECT 1 FROM attachment x JOIN attachment y ON x.object_hash=y.object_hash WHERE x.work_id=a.id AND y.work_id=b.id))
 AND NOT EXISTS(SELECT 1 FROM identity_review r WHERE r.action='dismiss' AND ((r.source_id=a.id AND r.target_id=b.id) OR (r.source_id=b.id AND r.target_id=a.id))) ORDER BY shared_pdf DESC,similarity DESC,a.id LIMIT 100`)
    ).rows,
    limit: 100,
  }));
  app.post("/api/v1/identity/preview", (request) => {
    const p = Pair.parse(request.body);
    return mergePreview(p.sourceId, p.targetId);
  });
  app.post("/api/v1/identity/merge", (request) => {
    const p = z
      .object({
        sourceId: Id,
        targetId: Id,
        sourceRevision: z.number().int(),
        targetRevision: z.number().int(),
      })
      .refine((p) => p.sourceId !== p.targetId)
      .parse(request.body);
    return mergeWorks(
      p.sourceId,
      p.targetId,
      p.sourceRevision,
      p.targetRevision,
    );
  });
  app.post("/api/v1/identity/dismiss", async (request) => {
    const p = Pair.parse(request.body);
    await activeWork(pool, p.sourceId);
    await activeWork(pool, p.targetId);
    await pool.query(
      "INSERT INTO identity_review(id,source_id,target_id,action,snapshot) VALUES($1,$2,$3,'dismiss','{}') ON CONFLICT DO NOTHING",
      [uuid(), p.sourceId, p.targetId],
    );
    return { dismissed: true };
  });
  app.get("/api/v1/identity/resolve", async (request) => {
    const { key } = z
      .object({ key: z.string().min(1).max(300) })
      .parse(request.query);
    const row = (
      await pool.query(
        "SELECT canonical_work(id) AS id,citation_key FROM work WHERE citation_key=$1 AND deleted_at IS NULL",
        [key],
      )
    ).rows[0];
    if (!row) fail(404, "Citation key not found.");
    return row;
  });
  app.get("/api/v1/works/:id/versions", async (request) => {
    const id = Id.parse((request.params as any).id);
    return {
      items: (
        await pool.query(
          "SELECT v.*,a.title AS source_title,b.title AS target_title FROM version_link v JOIN work a ON a.id=v.source_id JOIN work b ON b.id=v.target_id WHERE canonical_work(v.source_id)=canonical_work($1) OR canonical_work(v.target_id)=canonical_work($1) ORDER BY v.created_at DESC",
          [id],
        )
      ).rows,
      aliases: (
        await pool.query(
          "SELECT id,citation_key,title FROM work WHERE canonical_work(id)=canonical_work($1) AND id<>canonical_work($1)",
          [id],
        )
      ).rows,
    };
  });
  app.post("/api/v1/works/:id/versions", async (request) => {
    const sourceId = Id.parse((request.params as any).id);
    const input = z
      .object({
        targetId: Id,
        relation: z.enum(["preprint_of", "version_of", "corrects", "retracts"]),
        reason: z.string().trim().min(1).max(5000),
        sourceUrl: z
          .union([z.literal(""), z.url().refine((v) => /^https?:\/\//.test(v))])
          .default(""),
      })
      .parse(request.body);
    if (sourceId === input.targetId) fail(400, "Choose a different record.");
    await activeWork(pool, sourceId);
    await activeWork(pool, input.targetId);
    await pool.query(
      "INSERT INTO version_link(id,source_id,target_id,relation,reason,source_url) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(source_id,target_id,relation) DO UPDATE SET reason=$5,source_url=$6",
      [
        uuid(),
        sourceId,
        input.targetId,
        input.relation,
        input.reason,
        input.sourceUrl,
      ],
    );
    return { saved: true };
  });
}
