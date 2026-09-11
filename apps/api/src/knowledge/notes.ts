import { createReadStream } from "node:fs";
import { v7 as uuid } from "uuid";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { KId as Id, NoteInput, ReadingState } from "@vani/shared";
import { pool, transaction } from "../db.js";
import { fail } from "../metadata.js";
import { ObjectStore } from "../object-store.js";
import { manualCollection } from "../research/organization.js";
import { displayRef, noteRecord, resolveRef } from "./common.js";
export function rasterType(bytes: Buffer) {
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
  if (
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  return null;
}
async function validateNote(data: z.infer<typeof NoteInput>) {
  if (data.workId) await resolveRef({ kind: "work", id: data.workId });
  if (
    data.collectionId &&
    !(
      await pool.query(
        "SELECT id FROM collection WHERE id=$1 AND deleted_at IS NULL",
        [data.collectionId],
      )
    ).rowCount
  )
    fail(404, "Collection not found.");
  if (
    data.argumentId &&
    !(
      await pool.query("SELECT id FROM argument WHERE id=$1", [data.argumentId])
    ).rowCount
  )
    fail(404, "Argument not found.");
}
export async function registerNotes(app: FastifyInstance) {
  app.get("/api/v1/knowledge/notes", async (r) => {
    const { type, q, offset } = z
      .object({
        type: z.string().optional(),
        q: z.string().max(500).default(""),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .parse(r.query);
    const where =
      "deleted_at IS NULL AND ($1::text IS NULL OR note_type=$1) AND (title ILIKE $2 OR markdown ILIKE $2)";
    return {
      items: (
        await pool.query(
          `SELECT * FROM note WHERE ${where} ORDER BY updated_at DESC,id LIMIT 100 OFFSET $3`,
          [type ?? null, "%" + q + "%", offset],
        )
      ).rows,
      total: (
        await pool.query(
          `SELECT count(*)::int total FROM note WHERE ${where}`,
          [type ?? null, "%" + q + "%"],
        )
      ).rows[0].total,
    };
  });
  app.post("/api/v1/knowledge/notes", async (r) => {
    const d = NoteInput.parse(r.body);
    await validateNote(d);
    const id = uuid();
    await pool.query(
      "INSERT INTO note(id,title,markdown,note_type,work_id,collection_id,argument_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        id,
        d.title,
        d.markdown,
        d.noteType,
        d.workId,
        d.collectionId,
        d.argumentId,
      ],
    );
    return noteRecord(id);
  });
  app.get("/api/v1/knowledge/notes/:id", async (r) => {
    const id = Id.parse((r.params as any).id),
      note = await noteRecord(id);
    const references = await Promise.all(
      (
        await pool.query("SELECT * FROM note_reference WHERE note_id=$1", [id])
      ).rows.map(async (p) => ({
        ...p,
        passage: await displayRef({ kind: "passage", id: p.passage_id }),
      })),
    );
    const links = await Promise.all(
      (
        await pool.query(
          "SELECT * FROM note_link WHERE source_id=$1 OR target_id=$1",
          [id],
        )
      ).rows.map(async (l) => ({
        ...l,
        direction: l.source_id === id ? "outgoing" : "incoming",
        note: await displayRef({
          kind: "note",
          id: l.source_id === id ? l.target_id : l.source_id,
        }),
      })),
    );
    return { ...note, references, links };
  });
  app.patch("/api/v1/knowledge/notes/:id", async (r) => {
    const id = Id.parse((r.params as any).id),
      d = NoteInput.extend({ version: z.number().int().positive() }).parse(
        r.body,
      );
    await validateNote(d);
    await noteRecord(id);
    const result = await pool.query(
      "UPDATE note SET title=$2,markdown=$3,note_type=$4,work_id=$5,collection_id=$6,argument_id=$7,version=version+1,updated_at=now() WHERE id=$1 AND version=$8 RETURNING *",
      [
        id,
        d.title,
        d.markdown,
        d.noteType,
        d.workId,
        d.collectionId,
        d.argumentId,
        d.version,
      ],
    );
    if (!result.rowCount) fail(409, "Note changed. Reload before saving.");
    return result.rows[0];
  });
  app.post("/api/v1/knowledge/note-images", async (r, reply) => {
    const file = await r.file({
      limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    });
    if (!file) fail(400, "Choose an image.");
    const bytes = await file!.toBuffer(),
      mime = rasterType(bytes);
    if (!mime || mime !== file!.mimetype)
      fail(415, "Use a PNG, JPEG or WebP image with matching file type.");
    const stored = await new ObjectStore().put(bytes, mime!);
    await pool.query(
      "INSERT INTO note_asset(object_hash,filename) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [stored.hash, file!.filename],
    );
    return reply
      .code(201)
      .send({
        url: `/api/v1/knowledge/note-images/${stored.hash}`,
        hash: stored.hash,
      });
  });
  app.get("/api/v1/knowledge/note-images/:hash", async (r, reply) => {
    const hash = z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .parse((r.params as any).hash),
      row = (
        await pool.query(
          "SELECT o.* FROM note_asset a JOIN object_store o ON o.hash_sha256=a.object_hash WHERE a.object_hash=$1",
          [hash],
        )
      ).rows[0];
    if (!row) fail(404, "Image unavailable.");
    return reply
      .type(row.mime_type)
      .header("X-Content-Type-Options", "nosniff")
      .send(createReadStream(row.storage_path));
  });
  app.put("/api/v1/knowledge/notes/:id/references/:passageId", async (r) => {
    const { id, passageId } = z
        .object({ id: Id, passageId: Id })
        .parse(r.params),
      d = z
        .object({
          kind: z.enum(["quote", "figure", "table"]),
          label: z.string().max(300).default(""),
        })
        .parse(r.body);
    await noteRecord(id);
    await resolveRef({ kind: "passage", id: passageId });
    await pool.query(
      "INSERT INTO note_reference(note_id,passage_id,kind,label) VALUES($1,$2,$3,$4) ON CONFLICT(note_id,passage_id) DO UPDATE SET kind=$3,label=$4",
      [id, passageId, d.kind, d.label],
    );
    return { saved: true };
  });
  app.delete("/api/v1/knowledge/notes/:id/references/:passageId", async (r) => {
    const { id, passageId } = z
      .object({ id: Id, passageId: Id })
      .parse(r.params);
    await pool.query(
      "DELETE FROM note_reference WHERE note_id=$1 AND passage_id=$2",
      [id, passageId],
    );
    return { removed: true };
  });
  app.put("/api/v1/knowledge/notes/:id/links/:targetId", async (r) => {
    const { id, targetId } = z.object({ id: Id, targetId: Id }).parse(r.params),
      { rationale } = z
        .object({ rationale: z.string().max(5000).default("") })
        .parse(r.body ?? {});
    if (id === targetId) fail(400, "Choose another note.");
    await noteRecord(id);
    await noteRecord(targetId);
    await pool.query(
      "INSERT INTO note_link VALUES($1,$2,$3) ON CONFLICT(source_id,target_id) DO UPDATE SET rationale=$3",
      [id, targetId, rationale],
    );
    return { saved: true };
  });
  app.delete("/api/v1/knowledge/notes/:id/links/:targetId", async (r) => {
    const { id, targetId } = z.object({ id: Id, targetId: Id }).parse(r.params);
    await pool.query(
      "DELETE FROM note_link WHERE source_id=$1 AND target_id=$2",
      [id, targetId],
    );
    return { removed: true };
  });
  app.get("/api/v1/knowledge/reading", async (r) => {
    const { collectionId } = z.object({ collectionId: Id }).parse(r.query);
    await manualCollection(pool, collectionId);
    return {
      items: (
        await pool.query(
          `SELECT m.*,w.title,w.citation_key,(SELECT max(rp.updated_at) FROM reading_position rp JOIN attachment a ON a.id=rp.attachment_id WHERE canonical_work(a.work_id)=w.id) last_read FROM collection_membership m JOIN work w ON w.id=m.work_id WHERE m.collection_id=$1 AND w.merged_into IS NULL AND w.deleted_at IS NULL ORDER BY m.queued DESC,m.priority DESC,m.ordinal,w.title LIMIT 500`,
          [collectionId],
        )
      ).rows,
      limit: 500,
    };
  });
  app.patch("/api/v1/knowledge/reading/:collectionId/:workId", async (r) => {
    const p = z.object({ collectionId: Id, workId: Id }).parse(r.params),
      d = z
        .object({
          version: z.number().int().positive(),
          question: z.string().max(5000),
          rationale: z.string().max(5000),
          priority: z.number().int().min(0).max(5),
          status: ReadingState,
          queued: z.boolean(),
          ordinal: z.number().int().min(0).max(100000),
        })
        .parse(r.body);
    return transaction(async (db) => {
      await manualCollection(db, p.collectionId);
      const work = await resolveRef({ kind: "work", id: p.workId }, db);
      const result = await db.query(
        `UPDATE collection_membership SET question=$3,rationale=$4,priority=$5,status=$6,queued=$7,ordinal=$8,reading_revision=reading_revision+1,updated_at=now() WHERE collection_id=$1 AND work_id=$2 AND reading_revision=$9 RETURNING *`,
        [
          p.collectionId,
          work.id,
          d.question,
          d.rationale,
          d.priority,
          d.status,
          d.queued,
          d.ordinal,
          d.version,
        ],
      );
      if (!result.rowCount)
        fail(409, "Membership changed or is unavailable. Reload the planner.");
      return result.rows[0];
    });
  });
}
