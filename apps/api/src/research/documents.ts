import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { v7 as uuid } from "uuid";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AnnotationInput, ResearchId as Id, Tags } from "@vani/shared";
import { pool } from "../db.js";
import { fail } from "../metadata.js";
const execute = promisify(execFile);
export async function attachment(id: string) {
  const row = (
    await pool.query(
      "SELECT a.*,o.storage_path,o.byte_size,canonical_work(a.work_id) AS canonical_id FROM attachment a JOIN object_store o ON o.hash_sha256=a.object_hash JOIN work w ON w.id=canonical_work(a.work_id) WHERE a.id=$1 AND w.deleted_at IS NULL",
      [id],
    )
  ).rows[0];
  if (!row) fail(404, "Document not found.");
  return row;
}
export async function indexDocument(id: string) {
  const file = await attachment(id);
  const connection = await pool.connect();
  try {
    const locked = (
      await connection.query(
        "SELECT pg_try_advisory_lock(hashtext('document:'||$1)) AS locked",
        [file.object_hash],
      )
    ).rows[0].locked;
    if (!locked) return { state: "running" };
    try {
      const bytes = await readFile(file.storage_path);
      if (bytes.length > 100 * 1024 * 1024)
        fail(413, "Document exceeds the 100 MB indexing limit.");
      if (createHash("sha256").update(bytes).digest("hex") !== file.object_hash)
        fail(
          409,
          "Original PDF hash no longer matches. Restore the original file.",
        );
      const info = (
        await execute("pdfinfo", [file.storage_path], {
          timeout: 60000,
          maxBuffer: 1000000,
        })
      ).stdout;
      if (/^Encrypted:\s+yes/im.test(info))
        throw new Error(
          "Encrypted PDF: use the original download or supply an unlocked version.",
        );
      const count = Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
      if (!count) throw new Error("Could not determine PDF page count.");
      const result = await execute(
        "pdftotext",
        [
          "-layout",
          "-enc",
          "UTF-8",
          "-f",
          "1",
          "-l",
          String(Math.min(count, 2000)),
          file.storage_path,
          "-",
        ],
        { timeout: 60000, maxBuffer: 20 * 1024 * 1024 },
      );
      const texts = result.stdout.split("\f");
      if (texts.at(-1)?.trim() === "") texts.pop();
      const pages = Array.from(
        { length: Math.min(count, 2000) },
        (_, index) => ({ page: index + 1, text: texts[index] ?? "" }),
      );
      const nonempty = pages.filter((page) => page.text.trim()).length;
      const state = !nonempty
        ? "no_text"
        : nonempty < count
          ? "partial"
          : "ready";
      const error =
        count > 2000
          ? "Index covers the first 2,000 pages."
          : nonempty < count
            ? "Some pages have no extractable text; OCR may be needed."
            : "";
      await pool.query(
        "INSERT INTO document_index(object_hash,state,pages,page_count,error) VALUES($1,$2,$3,$4,$5) ON CONFLICT(object_hash) DO UPDATE SET state=$2,pages=$3,page_count=$4,error=$5,indexed_at=now()",
        [file.object_hash, state, JSON.stringify(pages), count, error],
      );
      return { state, pageCount: count, indexedPages: nonempty, error };
    } catch (error) {
      const message =
        (error as any).code === "ENOENT"
          ? "Poppler pdfinfo/pdftotext is missing on the API server."
          : (error as Error).message;
      await pool.query(
        "INSERT INTO document_index(object_hash,state,error) VALUES($1,'error',$2) ON CONFLICT(object_hash) DO UPDATE SET state='error',error=$2,indexed_at=now()",
        [file.object_hash, message],
      );
      return { state: "error", error: message };
    }
  } finally {
    await connection.query(
      "SELECT pg_advisory_unlock(hashtext('document:'||$1))",
      [file.object_hash],
    );
    connection.release();
  }
}
export const normalizedQuote = (text: string) =>
  text.replace(/\s+/g, " ").trim();
export function anchorStatus(selector: any, hash: string, index: any) {
  if (selector.hash !== hash)
    return {
      status: "uncertain",
      reason: "Document hash differs from the saved anchor.",
    };
  if (!index || index.state === "error")
    return {
      status: "uncertain",
      reason: "Text/page index unavailable; verify the source manually.",
    };
  if (selector.page < 1 || selector.page > index.page_count)
    return {
      status: "unavailable",
      reason: "Saved page is outside this document.",
    };
  if (
    selector.quote &&
    !normalizedQuote(
      index.pages.find((page: any) => page.page === selector.page)?.text ?? "",
    ).includes(normalizedQuote(selector.quote))
  )
    return {
      status: "uncertain",
      reason: "Saved quotation could not be confirmed on this page.",
    };
  return {
    status: "exact",
    reason: selector.quote
      ? "Quotation and immutable document match."
      : "Spatial anchor matches the immutable document.",
  };
}
export async function passage(id: string) {
  const row = (
    await pool.query(
      "SELECT a.*,at.filename,at.object_hash,o.storage_path,canonical_work(at.work_id) AS work_id,w.title,w.citation_key FROM annotation a JOIN attachment at ON at.id=a.attachment_id JOIN object_store o ON o.hash_sha256=at.object_hash JOIN work w ON w.id=canonical_work(at.work_id) WHERE a.id=$1 AND w.deleted_at IS NULL",
      [id],
    )
  ).rows[0];
  if (!row) fail(404, "Passage not found.");
  if (row.deleted_at)
    fail(
      410,
      "This annotation was deleted. The original document remains available from the paper.",
    );
  const index = (
    await pool.query("SELECT * FROM document_index WHERE object_hash=$1", [
      row.object_hash,
    ])
  ).rows[0];
  let anchor = anchorStatus(row.selector, row.object_hash, index);
  try {
    const bytes = await readFile(row.storage_path);
    if (createHash("sha256").update(bytes).digest("hex") !== row.object_hash)
      anchor = {
        status: "uncertain",
        reason: "Stored file bytes do not match the saved document hash.",
      };
  } catch {
    anchor = {
      status: "unavailable",
      reason: "The original document file is unavailable.",
    };
  }
  const { storage_path: storagePath, ...result } = row;
  void storagePath;
  return { ...result, anchor, url: `/passages/${id}` };
}
export async function registerDocuments(app: FastifyInstance) {
  app.get("/api/v1/attachments/:id/document", async (request) => {
    const id = Id.parse((request.params as any).id),
      file = await attachment(id);
    return {
      attachment: file,
      index:
        (
          await pool.query(
            "SELECT * FROM document_index WHERE object_hash=$1",
            [file.object_hash],
          )
        ).rows[0] ?? null,
      position:
        (
          await pool.query(
            "SELECT * FROM reading_position WHERE attachment_id=$1",
            [id],
          )
        ).rows[0] ?? null,
      annotations: (
        await pool.query(
          "SELECT * FROM annotation WHERE attachment_id=$1 AND deleted_at IS NULL ORDER BY created_at",
          [id],
        )
      ).rows,
    };
  });
  app.post("/api/v1/attachments/:id/index", (r) =>
    indexDocument(Id.parse((r.params as any).id)),
  );
  app.put("/api/v1/attachments/:id/position", async (r) => {
    const id = Id.parse((r.params as any).id);
    await attachment(id);
    const data = z
      .object({
        page: z.number().int().min(1).max(2000),
        zoom: z.number().min(0.5).max(3),
      })
      .parse(r.body);
    await pool.query(
      "INSERT INTO reading_position(attachment_id,page,zoom) VALUES($1,$2,$3) ON CONFLICT(attachment_id) DO UPDATE SET page=$2,zoom=$3,updated_at=now()",
      [id, data.page, data.zoom],
    );
    return { saved: true };
  });
  app.post("/api/v1/attachments/:id/annotations", async (r) => {
    const attachmentId = Id.parse((r.params as any).id),
      file = await attachment(attachmentId),
      data = AnnotationInput.parse(r.body);
    if (data.selector.hash !== file.object_hash)
      fail(409, "Annotation belongs to a different document hash.");
    const index = (
      await pool.query("SELECT * FROM document_index WHERE object_hash=$1", [
        file.object_hash,
      ])
    ).rows[0];
    if (!index?.page_count || data.selector.page > index.page_count)
      fail(409, "Index this document before saving a page annotation.");
    if (data.type === "highlight" && !data.selector.quote.trim())
      fail(400, "Select text before saving a highlight.");
    const id = uuid();
    await pool.query(
      "INSERT INTO annotation(id,attachment_id,annotation_type,body_markdown,color,tags,page_start,page_end,selector) VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8)",
      [
        id,
        attachmentId,
        data.type,
        data.body,
        data.color,
        JSON.stringify(data.tags),
        data.selector.page,
        JSON.stringify(data.selector),
      ],
    );
    return passage(id);
  });
  app.patch("/api/v1/annotations/:id", async (r) => {
    const id = Id.parse((r.params as any).id),
      data = z
        .object({
          revision: z.number().int().positive(),
          body: z.string().max(20000),
          tags: Tags,
          color: z
            .string()
            .regex(/^#[a-fA-F0-9]{6}$/)
            .optional(),
        })
        .parse(r.body);
    const result = await pool.query(
      "UPDATE annotation SET body_markdown=$2,tags=$3,color=COALESCE($4,color),version=version+1,updated_at=now() WHERE id=$1 AND version=$5 AND deleted_at IS NULL",
      [
        id,
        data.body,
        JSON.stringify(data.tags),
        data.color ?? null,
        data.revision,
      ],
    );
    if (!result.rowCount) fail(409, "Annotation changed. Reload it.");
    return passage(id);
  });
  app.delete("/api/v1/annotations/:id", async (r) => {
    const id = Id.parse((r.params as any).id),
      { revision } = z
        .object({ revision: z.number().int().positive() })
        .parse(r.body);
    const result = await pool.query(
      "UPDATE annotation SET deleted_at=now(),version=version+1,updated_at=now() WHERE id=$1 AND version=$2 AND deleted_at IS NULL",
      [id, revision],
    );
    if (!result.rowCount) fail(409, "Annotation changed. Reload it.");
    return { deleted: true };
  });
  app.get("/api/v1/passages/:id", (r) =>
    passage(Id.parse((r.params as any).id)),
  );
  app.post("/api/v1/passages/:id/note", async (r) => {
    const item = await passage(Id.parse((r.params as any).id)),
      id = uuid();
    await pool.query(
      "INSERT INTO note(id,title,markdown,work_id,note_type) VALUES($1,$2,$3,$4,'source')",
      [
        id,
        `Evidence — ${item.citation_key} p. ${item.page_start}`,
        `> ${item.selector.quote.replace(/\n/g, "\n> ")}\n\n${item.body_markdown}\n\n[Source: ${item.citation_key}, p. ${item.page_start}](/passages/${item.id})`,
        item.work_id,
      ],
    );
    return { id };
  });
  // Explicit annotation listing keeps the immutable version visible to API clients.
  app.get("/api/v1/attachments/:id/annotations", async (r) => {
    const id = Id.parse((r.params as any).id);
    await attachment(id);
    return {
      items: (
        await pool.query(
          "SELECT * FROM annotation WHERE attachment_id=$1 AND deleted_at IS NULL",
          [id],
        )
      ).rows,
    };
  });
}
