import { v7 as uuid } from "uuid";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { LibraryRule, ResearchId as Id } from "@vani/shared";
import { pool } from "../db.js";
import { fail } from "../metadata.js";
import { libraryWhere } from "./organization.js";
import { anchorStatus, passage } from "./documents.js";
export async function registerEvidence(app: FastifyInstance) {
  app.post("/api/v1/evidence", async (r) => {
    const f = z
      .object({
        topic: z.string().max(500).default(""),
        collectionId: Id.optional(),
        tag: z.string().max(80).default(""),
        type: z.enum(["highlight", "comment", "area"]).optional(),
        workId: Id.optional(),
        argumentId: Id.optional(),
        offset: z.number().int().min(0).default(0),
      })
      .parse(r.body ?? {});
    const { where, values } = await libraryWhere(
      LibraryRule.parse({}),
      f.collectionId,
    );
    const add = (v: unknown) => {
      values.push(v);
      return "$" + values.length;
    };
    where.push("a.deleted_at IS NULL");
    if (f.topic) {
      const p = add("%" + f.topic + "%");
      where.push(
        `(a.body_markdown ILIKE ${p} OR a.selector->>'quote' ILIKE ${p})`,
      );
    }
    if (f.tag)
      where.push(
        `(a.tags ? ${add(f.tag.toLowerCase())} OR ${add(f.tag.toLowerCase())}=ANY(w.tags))`,
      );
    if (f.type) where.push(`a.annotation_type=${add(f.type)}`);
    if (f.workId) where.push(`w.id=canonical_work(${add(f.workId)})`);
    if (f.argumentId)
      where.push(
        `EXISTS(SELECT 1 FROM argument_evidence ae WHERE ae.annotation_id=a.id AND ae.argument_id=${add(f.argumentId)})`,
      );
    const from =
      "FROM annotation a JOIN attachment at ON at.id=a.attachment_id JOIN work w ON w.id=canonical_work(at.work_id) LEFT JOIN document_index di ON di.object_hash=at.object_hash";
    const total = (
      await pool.query(
        `SELECT count(*)::int total ${from} WHERE ${where.join(" AND ")}`,
        values,
      )
    ).rows[0].total;
    const rows = (
      await pool.query(
        `SELECT a.*,at.filename,at.object_hash,w.id AS work_id,w.title,w.citation_key,di.state,di.pages,di.page_count,(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',ar.id,'title',ar.title,'rationale',ae.rationale)),'[]') FROM argument_evidence ae JOIN argument ar ON ar.id=ae.argument_id WHERE ae.annotation_id=a.id) AS arguments ${from} WHERE ${where.join(" AND ")} ORDER BY a.created_at DESC,a.id LIMIT 100 OFFSET $${values.length + 1}`,
        [...values, f.offset],
      )
    ).rows;
    return {
      items: rows.map((row) => {
        const { pages, ...item } = row;
        return {
          ...item,
          anchor: anchorStatus(row.selector, row.object_hash, {
            state: row.state,
            pages,
            page_count: row.page_count,
          }),
        };
      }),
      total,
      offset: f.offset,
    };
  });
  app.get("/api/v1/arguments", async () => ({
    items: (
      await pool.query(
        "SELECT ar.*,count(a.id)::int AS evidence_count FROM argument ar LEFT JOIN argument_evidence ae ON ae.argument_id=ar.id LEFT JOIN annotation a ON a.id=ae.annotation_id AND a.deleted_at IS NULL GROUP BY ar.id ORDER BY ar.created_at DESC",
      )
    ).rows,
  }));
  app.post("/api/v1/arguments", async (r) => {
    const data = z
      .object({
        title: z.string().trim().min(1).max(300),
        description: z.string().max(10000).default(""),
      })
      .parse(r.body);
    const id = uuid();
    await pool.query(
      "INSERT INTO argument(id,title,description) VALUES($1,$2,$3)",
      [id, data.title, data.description],
    );
    return { id };
  });
  app.put("/api/v1/arguments/:id/evidence/:annotationId", async (r) => {
    const { id, annotationId } = z
        .object({ id: Id, annotationId: Id })
        .parse(r.params),
      { rationale } = z
        .object({ rationale: z.string().max(5000).default("") })
        .parse(r.body ?? {});
    await passage(annotationId);
    if (
      !(await pool.query("SELECT id FROM argument WHERE id=$1", [id])).rowCount
    )
      fail(404, "Argument not found.");
    await pool.query(
      "INSERT INTO argument_evidence(argument_id,annotation_id,rationale) VALUES($1,$2,$3) ON CONFLICT(argument_id,annotation_id) DO UPDATE SET rationale=$3",
      [id, annotationId, rationale],
    );
    return { saved: true };
  });
  app.delete("/api/v1/arguments/:id/evidence/:annotationId", async (r) => {
    const { id, annotationId } = z
      .object({ id: Id, annotationId: Id })
      .parse(r.params);
    await pool.query(
      "DELETE FROM argument_evidence WHERE argument_id=$1 AND annotation_id=$2",
      [id, annotationId],
    );
    return { removed: true };
  });
}
