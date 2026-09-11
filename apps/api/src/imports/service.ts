import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createReadStream } from "node:fs";
import { v7 as uuid } from "uuid";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import {
  MetadataFields,
  MetadataPatch,
  type ImportFile,
  type ImportItem,
  type ImportSession,
} from "@vani/shared";
import { pool, query, transaction } from "../db.js";
import { ObjectStore } from "../object-store.js";
import { Repository } from "../repository.js";
import {
  recordAssertion,
  hash,
  fail,
  MetadataRepository,
} from "../metadata.js";
import { parseIdentifier, resolveMetadata } from "../metadata-sources.js";
import { emptyItem, parseBibliography, type ParsedItem } from "./parse.js";
const execute = promisify(execFile);
const Id = z.string().uuid();
const MAX_TOTAL = 200 * 1024 * 1024;
export class ImportRepository {
  constructor(
    private repository = new Repository(),
    private objects = new ObjectStore(),
  ) {}
  async get(id: string, client?: PoolClient): Promise<ImportSession> {
    const connection = client ?? pool;
    const session = (
      await connection.query("SELECT * FROM import_session WHERE id=$1", [id])
    ).rows[0];
    if (!session) fail(404, "Import session not found.");
    const rows = (
      await connection.query(
        "SELECT * FROM import_item WHERE session_id=$1 ORDER BY ordinal",
        [id],
      )
    ).rows;
    return {
      id: session.id,
      collectionId: session.collection_id,
      state: session.state,
      revision: session.revision,
      files: session.files,
      warnings: session.warnings,
      createdAt: session.created_at.toISOString(),
      updatedAt: session.updated_at.toISOString(),
      items: rows.map((row) => ({
        ...row.data,
        id: row.id,
        ordinal: row.ordinal,
        included: row.included,
        status: row.status,
        error: row.error,
        workId: row.work_id,
      })),
    };
  }
  async match(
    item: Pick<ImportItem, "metadata" | "fingerprint" | "attachments">,
    client: PoolClient,
  ) {
    const hashes = item.attachments.map((file) => file.hash);
    const found = await client.query(
      `SELECT DISTINCT root.id,root.title,root.doi FROM work w JOIN work root ON root.id=canonical_work(w.id) LEFT JOIN import_identity i ON i.work_id=w.id LEFT JOIN attachment a ON a.work_id=w.id WHERE w.deleted_at IS NULL AND (lower(w.doi)=$1 OR i.fingerprint=$2 OR a.object_hash=ANY($3::text[]))`,
      [item.metadata?.doi ?? null, item.fingerprint, hashes],
    );
    if (found.rows.length > 1)
      fail(
        409,
        "This row matches multiple existing papers by DOI/source/PDF. Resolve the identity conflict before importing.",
      );
    if (
      found.rows[0]?.doi &&
      item.metadata?.doi &&
      found.rows[0].doi.toLowerCase() !== item.metadata.doi
    )
      fail(
        409,
        `PDF/source already belongs to a different DOI: /read/${found.rows[0].id}.`,
      );
    return found.rows[0] ?? null;
  }
  async prepare(
    collectionId: string,
    uploads: Array<{ name: string; bytes: Buffer }>,
    identifiers: string,
    online: boolean,
  ) {
    if (
      !(
        await query(
          "SELECT id FROM collection WHERE id=$1 AND deleted_at IS NULL AND collection_type='manual'",
          [collectionId],
        )
      ).rowCount
    )
      fail(404, "Choose an existing collection.");
    if (identifiers.trim())
      uploads.push({
        name: "identifiers.txt",
        bytes: Buffer.from(identifiers),
      });
    if (!uploads.length || uploads.length > 100)
      fail(400, "Choose between 1 and 100 files/text inputs.");
    if (uploads.reduce((sum, file) => sum + file.bytes.length, 0) > MAX_TOTAL)
      fail(413, "Upload exceeds the 200 MB session limit.");
    const files: ImportFile[] = [],
      items: Array<ParsedItem & { fileId: string }> = [],
      pdfs: Array<{
        file: ImportFile;
        metadata: MetadataFields;
        warnings: string[];
      }> = [];
    for (const upload of uploads) {
      const pdf = /\.pdf$/i.test(upload.name);
      const max = pdf ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
      if (upload.bytes.length > max)
        fail(413, `${upload.name} exceeds its ${pdf ? 50 : 10} MB file limit.`);
      const stored = await this.objects.put(
        upload.bytes,
        pdf ? "application/pdf" : "application/octet-stream",
      );
      const file = {
        id: uuid(),
        name: upload.name,
        hash: stored.hash,
        type: pdf ? "pdf" : upload.name.split(".").at(-1) || "unknown",
        size: upload.bytes.length,
      };
      files.push(file);
      try {
        if (pdf) {
          if (!upload.bytes.subarray(0, 1024).includes(Buffer.from("%PDF-")))
            throw new Error("This file has no PDF signature.");
          let stdout: string;
          try {
            stdout = (
              await execute("pdfinfo", [stored.path], {
                timeout: 10000,
                maxBuffer: 200000,
              })
            ).stdout;
          } catch (error) {
            throw new Error(
              (error as any).code === "ENOENT"
                ? "Install Poppler (pdfinfo) on the VANI server to validate PDFs."
                : "PDF is invalid, encrypted, or could not be inspected. Original retained; no paper was created.",
            );
          }
          if (/^Encrypted:\s+yes/im.test(stdout))
            throw new Error(
              "Encrypted PDFs are not imported. Supply an unlocked copy you are authorized to use.",
            );
          const title =
            stdout.match(/^Title:\s*(.+)$/m)?.[1]?.trim() ||
            upload.name.replace(/\.pdf$/i, "");
          const author = stdout.match(/^Author:\s*(.+)$/m)?.[1]?.trim();
          pdfs.push({
            file,
            metadata: MetadataFields.parse({
              title,
              authors: author ? [{ family: author, given: "" }] : [],
              publicationType: "document",
              manifestationType: "unknown",
            }),
            warnings: [
              "PDF metadata is provisional. Review title, authors, and publication details. Embedded annotations remain in the original PDF, not native VANI annotation objects.",
            ],
          });
        } else {
          const text = new TextDecoder("utf-8", { fatal: true }).decode(
            upload.bytes,
          );
          for (const parsed of parseBibliography(upload.name, text))
            items.push({ ...parsed, fileId: file.id });
        }
      } catch (error) {
        const row = emptyItem(upload.name);
        row.error =
          error instanceof Error ? error.message : "Could not parse input.";
        row.included = false;
        row.raw = { filename: upload.name };
        items.push({ ...row, fileId: file.id });
      }
    }
    if (items.length + pdfs.length > 500)
      fail(
        413,
        "Session exceeds 500 records. Split the inputs into smaller batches.",
      );
    for (const item of items) {
      if (item.identifier && !item.error) {
        if (online) {
          try {
            const source = await resolveMetadata(item.identifier);
            Object.assign(item, {
              metadata: source.metadata,
              raw: source.raw,
              source: source.source,
              sourceUrl: source.sourceUrl,
              externalId: source.externalId,
              authoritative: source.authoritative,
            });
          } catch (error) {
            item.error = (error as Error).message;
            item.included = false;
          }
        } else {
          const parsed = parseIdentifier(item.identifier);
          item.metadata = MetadataFields.parse({
            title: item.identifier,
            doi: parsed.kind === "doi" ? parsed.id : null,
            url:
              parsed.kind === "arxiv"
                ? `https://arxiv.org/abs/${parsed.id}`
                : "",
            publicationType: parsed.kind === "arxiv" ? "preprint" : "document",
            manifestationType: parsed.kind === "arxiv" ? "preprint" : "unknown",
          });
          item.warnings.push(
            "Identifier was not resolved online. Supply a real title and publication details before confirmation.",
          );
        }
      }
      for (const reference of item.references) {
        const matches = pdfs.filter(
          (pdf) =>
            pdf.file.name.split(/[\\/]/).at(-1)?.toLowerCase() ===
            reference.toLowerCase(),
        );
        if (matches.length === 1) {
          item.attachments.push(matches[0]!.file);
          item.warnings.push(
            "Embedded PDF annotations remain in the original; they are not native VANI annotations.",
          );
        } else
          item.warnings.push(
            `${matches.length ? "Ambiguous" : "Missing"} attachment: ${reference}. Select the intended PDF explicitly; external paths are not read.`,
          );
      }
    }
    const used = new Set(
      items.flatMap((item) => item.attachments.map((file) => file.id)),
    );
    for (const pdf of pdfs) {
      if (used.has(pdf.file.id)) continue;
      items.push({
        ...emptyItem(pdf.file.name),
        fileId: pdf.file.id,
        metadata: pdf.metadata,
        raw: { filename: pdf.file.name, sha256: pdf.file.hash },
        source: "import_pdf",
        externalId: pdf.file.hash,
        fingerprint: hash({ pdf: pdf.file.hash }),
        attachments: [pdf.file],
        warnings: pdf.warnings,
      });
    }
    if (items.length > 500)
      fail(
        413,
        "Session exceeds 500 records. Split the inputs into smaller batches.",
      );
    const id = uuid();
    await transaction(async (client) => {
      await client.query(
        "INSERT INTO import_session(id,collection_id,files,warnings) VALUES($1,$2,$3,$4)",
        [
          id,
          collectionId,
          JSON.stringify(files),
          JSON.stringify([
            "Only selected rows are committed. Existing matches retain their canonical metadata and citation keys. Unsupported data remains available in originals and the report.",
          ]),
        ],
      );
      for (const [ordinal, item] of items.entries()) {
        if (item.metadata && !item.error) {
          try {
            const match = await this.match(item, client);
            item.matchId = match?.id ?? null;
            item.matchTitle = match?.title ?? null;
          } catch (error) {
            item.error = (error as Error).message;
            item.included = false;
          }
        }
        await client.query(
          "INSERT INTO import_item(id,session_id,ordinal,data,included,error) VALUES($1,$2,$3,$4,$5,$6)",
          [
            uuid(),
            id,
            ordinal,
            JSON.stringify({ ...item, sourceMetadata: item.metadata }),
            item.included,
            item.error,
          ],
        );
      }
    });
    return this.get(id);
  }
  async edit(
    id: string,
    revision: number,
    edits: Array<{
      id: string;
      included?: boolean;
      metadata?: Partial<MetadataFields>;
    }>,
  ) {
    await transaction(async (client) => {
      const session = (
        await client.query(
          "SELECT state,revision FROM import_session WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (!session) fail(404, "Import session not found.");
      if (session.state !== "preview" || session.revision !== revision)
        fail(
          409,
          "Import preview changed or was already confirmed. Reload its report.",
        );
      for (const edit of edits) {
        const row = (
          await client.query(
            "SELECT * FROM import_item WHERE id=$1 AND session_id=$2",
            [edit.id, id],
          )
        ).rows[0];
        if (!row) fail(404, "Import row not found.");
        const data = row.data;
        if (edit.metadata) {
          if (!data.metadata)
            fail(
              400,
              "Re-upload an unparseable row after fixing its source file.",
            );
          data.metadata = MetadataFields.parse({
            ...data.metadata,
            ...edit.metadata,
          });
        }
        const match = data.metadata ? await this.match(data, client) : null;
        data.matchId = match?.id ?? null;
        data.matchTitle = match?.title ?? null;
        if (edit.included && row.error)
          fail(400, "Fix or exclude rows with errors.");
        await client.query(
          "UPDATE import_item SET data=$2,included=$3 WHERE id=$1",
          [edit.id, JSON.stringify(data), edit.included ?? row.included],
        );
      }
      await client.query(
        "UPDATE import_session SET revision=revision+1,updated_at=now() WHERE id=$1",
        [id],
      );
    });
    return this.get(id);
  }
  async commit(id: string, revision: number) {
    const runner = await pool.connect();
    let locked = false;
    try {
      if (
        !(
          await runner.query(
            "SELECT pg_try_advisory_lock(hashtext('vani-import:'||$1)) AS locked",
            [id],
          )
        ).rows[0].locked
      )
        return this.get(id);
      locked = true;
      const session = await transaction(async (client) => {
        await client.query(
          "SELECT id FROM import_session WHERE id=$1 FOR UPDATE",
          [id],
        );
        const current = await this.get(id, client);
        if (current.state === "complete") return current;
        if (current.state === "preview" && current.revision !== revision)
          fail(409, "Preview changed. Reload it before confirmation.");
        await client.query(
          "UPDATE import_session SET state='running',revision=revision+1,updated_at=now() WHERE id=$1",
          [id],
        );
        return current;
      });
      if (session.state === "complete") return session;
      for (const item of session.items) {
        if (["created", "reused"].includes(item.status)) continue;
        if (!item.included) {
          await runner.query(
            "UPDATE import_item SET status='skipped' WHERE id=$1",
            [item.id],
          );
          continue;
        }
        try {
          await transaction(async (client) => {
            await client.query(
              "SELECT pg_advisory_xact_lock(hashtext('vani-browser-capture'))",
            );
            const current = (
              await client.query(
                "SELECT status FROM import_item WHERE id=$1 FOR UPDATE",
                [item.id],
              )
            ).rows[0];
            if (["created", "reused"].includes(current.status)) return;
            if (
              !(
                await client.query(
                  "SELECT id FROM collection WHERE id=$1 AND deleted_at IS NULL AND collection_type='manual' FOR KEY SHARE",
                  [session.collectionId],
                )
              ).rowCount
            )
              fail(404, "The destination collection no longer exists.");
            if (!item.metadata) fail(400, "Missing parsed metadata.");
            const fields = MetadataFields.parse(item.metadata);
            const match = await this.match(item, client);
            const work = match
              ? await this.repository.getWork(match.id, client)
              : await this.repository.createWork(
                  {
                    ...fields,
                    connector: "bulk_import",
                    externalId: item.fingerprint,
                    sourcePayload: item.raw,
                    deduplicateByTitle: false,
                    verificationStatus: "unverified",
                  },
                  client,
                );
            if (!work) fail(404, "Matched paper no longer exists.");
            await client.query(
              "INSERT INTO import_identity(fingerprint,work_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
              [item.fingerprint, work.id],
            );
            await client.query(
              "INSERT INTO collection_membership(collection_id,work_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
              [session.collectionId, work.id],
            );
            if (match)
              await new MetadataRepository(this.repository).baseline(
                work.id,
                client,
              );
            await recordAssertion(client, work.id, {
              source: item.source,
              externalId: item.externalId,
              sourceUrl: item.sourceUrl,
              metadata: item.sourceMetadata ?? fields,
              raw: item.raw,
              authoritative: item.authoritative,
            });
            if (!match && item.sourceMetadata) {
              const changed = Object.keys(fields).filter(
                (key) =>
                  JSON.stringify(fields[key as keyof MetadataFields]) !==
                  JSON.stringify(
                    item.sourceMetadata![key as keyof MetadataFields],
                  ),
              );
              await client.query(
                "UPDATE work SET metadata_locks=$2 WHERE id=$1",
                [work.id, JSON.stringify(changed)],
              );
              for (const field of changed)
                await client.query(
                  "INSERT INTO metadata_decision(id,work_id,field,before_value,after_value,origin,reason,revision) VALUES($1,$2,$3,$4,$5,'user','Corrected during import preview',1)",
                  [
                    uuid(),
                    work.id,
                    field,
                    JSON.stringify(
                      item.sourceMetadata[field as keyof MetadataFields],
                    ),
                    JSON.stringify(fields[field as keyof MetadataFields]),
                  ],
                );
            }
            for (const note of item.notes) {
              const exists = (
                await client.query(
                  "SELECT 1 FROM imported_note WHERE work_id=$1 AND content_hash=$2",
                  [work.id, hash(note)],
                )
              ).rowCount;
              if (exists) continue;
              const noteId = uuid();
              await client.query(
                "INSERT INTO note(id,work_id,title,markdown,note_type) VALUES($1,$2,$3,$4,'source')",
                [noteId, work.id, `Imported note — ${work.citationKey}`, note],
              );
              await client.query(
                "INSERT INTO imported_note(work_id,content_hash,note_id) VALUES($1,$2,$3)",
                [work.id, hash(note), noteId],
              );
            }
            await client.query(
              "SELECT pg_advisory_xact_lock(hashtext('vani-browser-pdf:'||$1))",
              [work.id],
            );
            for (const file of item.attachments) {
              await client.query(
                "INSERT INTO attachment(id,work_id,object_hash,filename) SELECT $1,$2,$3,$4 WHERE NOT EXISTS(SELECT 1 FROM attachment WHERE work_id=$2 AND object_hash=$3)",
                [uuid(), work.id, file.hash, file.name],
              );
            }
            await client.query(
              "UPDATE import_item SET status=$2,work_id=$3,error=$4 WHERE id=$1",
              [item.id, match ? "reused" : "created", work.id, ""],
            );
          });
        } catch (error) {
          await runner.query(
            "UPDATE import_item SET status='failed',error=$2 WHERE id=$1",
            [
              item.id,
              error instanceof Error ? error.message : "Import failed.",
            ],
          );
        }
      }
      await runner.query(
        "UPDATE import_session SET state=CASE WHEN EXISTS(SELECT 1 FROM import_item WHERE session_id=$1 AND status='failed') THEN 'partial' ELSE 'complete' END,updated_at=now() WHERE id=$1",
        [id],
      );
      return this.get(id);
    } finally {
      if (locked)
        await runner.query(
          "SELECT pg_advisory_unlock(hashtext('vani-import:'||$1))",
          [id],
        );
      runner.release();
    }
  }
}
export async function registerImportRoutes(
  app: FastifyInstance,
  repository: Repository,
) {
  const imports = new ImportRepository(repository);
  app.get("/api/v1/imports", async () => ({
    items: (
      await query(
        "SELECT id,state,revision,created_at,updated_at FROM import_session ORDER BY created_at DESC LIMIT 50",
      )
    ).rows,
  }));
  app.post("/api/v1/imports", async (request, reply) => {
    const fields: Record<string, string> = {};
    const uploads: Array<{ name: string; bytes: Buffer }> = [];
    let total = 0;
    for await (const part of request.parts({
      limits: {
        files: 100,
        fileSize: 50 * 1024 * 1024,
        fields: 4,
        fieldSize: 1024 * 1024,
        parts: 104,
      },
    })) {
      if (part.type === "file") {
        const bytes = await part.toBuffer();
        total += bytes.length;
        if (total > MAX_TOTAL) fail(413, "Upload exceeds 200 MB.");
        uploads.push({
          name: part.filename.split(/[\\/]/).at(-1)!.slice(0, 250),
          bytes,
        });
      } else fields[part.fieldname] = String(part.value);
    }
    return reply
      .code(201)
      .send(
        await imports.prepare(
          Id.parse(fields.collectionId),
          uploads,
          fields.identifiers || "",
          fields.online === "true",
        ),
      );
  });
  app.get("/api/v1/imports/:id", (request) =>
    imports.get(Id.parse((request.params as any).id)),
  );
  app.patch("/api/v1/imports/:id", (request) => {
    const input = z
      .object({
        revision: z.number().int().positive(),
        items: z
          .array(
            z.object({
              id: Id,
              included: z.boolean().optional(),
              metadata: MetadataPatch.optional(),
            }),
          )
          .max(500),
      })
      .parse(request.body);
    return imports.edit(
      Id.parse((request.params as any).id),
      input.revision,
      input.items,
    );
  });
  app.post("/api/v1/imports/:id/commit", (request) => {
    const input = z
      .object({ revision: z.number().int().positive() })
      .parse(request.body);
    return imports.commit(Id.parse((request.params as any).id), input.revision);
  });
  app.get("/api/v1/imports/:id/files/:fileId", async (request, reply) => {
    const { id, fileId } = z
      .object({ id: Id, fileId: Id })
      .parse(request.params);
    const session = await imports.get(id);
    const file = session.files.find((file) => file.id === fileId);
    if (!file) fail(404, "Import file not found.");
    const object = (
      await query(
        "SELECT storage_path FROM object_store WHERE hash_sha256=$1",
        [file.hash],
      )
    ).rows[0];
    if (!object) fail(404, "Original file unavailable.");
    return reply
      .type(
        file.type === "pdf" ? "application/pdf" : "application/octet-stream",
      )
      .header(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      )
      .send(createReadStream(object.storage_path));
  });
}
