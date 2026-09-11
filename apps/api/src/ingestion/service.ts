import { v7 as uuid } from "uuid";
import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, transaction } from "../db.js";
import { Repository } from "../repository.js";
import { manualCollection } from "../research/organization.js";
import { resolveCaptureDoi } from "../capture-resolve.js";
import { cleanDoi } from "../lib/citations.js";
import { downloadPaper, isPdf, pageMetadata } from "./download.js";
import { queueEnrichment, storePdf } from "./enrichment.js";

export async function addIngestedPaper(
  collectionId: string,
  input: {
    link?: string;
    bytes?: Buffer;
    filename?: string;
    title?: string;
    seed?: boolean;
  },
  repo = new Repository(),
) {
  await manualCollection(pool, collectionId);
  let bytes = input.bytes,
    metadata: any = {},
    pdfUrls: string[] = [],
    source = input.link ?? "",
    filename = input.filename ?? "paper.pdf";
  if (bytes && (!isPdf(bytes) || bytes.length > 50 * 1024 * 1024))
    throw Object.assign(Error("Supply a PDF no larger than 50 MB."), {
      statusCode: 415,
    });
  if (input.link) {
    const doi = cleanDoi(input.link);
    const arxiv = doi?.match(
      /^10\.48550\/arxiv\.(\d{4}\.\d{4,5}(?:v\d+)?)$/i,
    )?.[1];
    if (!arxiv && doi && /^10\.\d{4,9}\/[^\s<>]+$/i.test(doi)) {
      const resolved = await resolveCaptureDoi(doi);
      metadata = resolved.metadata;
      pdfUrls = resolved.pdfUrls;
      source = resolved.sourceUrl;
    } else {
      const page = await downloadPaper(
        arxiv ? "https://arxiv.org/abs/" + arxiv : input.link,
      );
      source = page.url;
      if (isPdf(page.bytes)) {
        bytes = page.bytes;
        filename = decodeURIComponent(
          new URL(source).pathname.split("/").at(-1) || "paper.pdf",
        );
      } else {
        metadata = pageMetadata(page.bytes.toString("utf8"), source);
        pdfUrls = metadata.pdfUrls;
        const arxivId =
          new URL(source).hostname === "arxiv.org"
            ? new URL(source).pathname.match(
                /\/(?:abs|pdf)\/(\d{4}\.\d{4,5}(?:v\d+)?)/,
              )?.[1]
            : null;
        if (arxivId) {
          metadata.doi ||= "10.48550/arxiv." + arxivId;
          pdfUrls.unshift("https://arxiv.org/pdf/" + arxivId);
        }
      }
    }
  }
  if (!bytes && !metadata.title)
    throw Object.assign(Error("Supply a PDF or a paper link."), {
      statusCode: 400,
    });
  const hash = bytes
    ? createHash("sha256").update(bytes).digest("hex")
    : undefined;
  const duplicate = hash
    ? (
        await pool.query(
          "SELECT canonical_work(a.work_id) id FROM attachment a JOIN work w ON w.id=canonical_work(a.work_id) WHERE a.object_hash=$1 AND w.deleted_at IS NULL LIMIT 1",
          [hash],
        )
      ).rows[0]
    : null;
  const work = duplicate
    ? await repo.getWork(duplicate.id)
    : await repo.createWork({
        ...metadata,
        doi: /^10\.\d{4,9}\//i.test(metadata.doi ?? "")
          ? cleanDoi(metadata.doi)
          : null,
        title:
          input.title?.trim() ||
          metadata.title ||
          filename.replace(/\.pdf$/i, "").replace(/[_-]/g, " "),
        accessClass: input.bytes ? "user_uploaded" : "metadata_only",
        connector: "collection-ingestion",
        externalId: source || "sha256:" + hash,
        sourcePayload: { sourceUrl: source, pdfUrls, uploadHash: hash },
        deduplicateByTitle: false,
      });
  if (!work) throw Error("Paper could not be created.");
  const provenance = { sourceUrl: source, pdfUrls, uploadHash: hash, metadata };
  await pool.query(
    "INSERT INTO source_record(id,work_id,connector,external_id,payload,payload_hash) VALUES($1,$2,'collection-ingestion',$3,$4,$5) ON CONFLICT DO NOTHING",
    [
      uuid(),
      work.id,
      source || "sha256:" + hash,
      JSON.stringify(provenance),
      createHash("sha256").update(JSON.stringify(provenance)).digest("hex"),
    ],
  );
  if (bytes) await storePdf(work.id, bytes, filename);
  let seedApplied = Boolean(input.seed),
    seedWarning = "";
  await transaction(async (db) => {
    const row = (
      await db.query(
        "SELECT discovery FROM collection WHERE id=$1 AND deleted_at IS NULL FOR UPDATE",
        [collectionId],
      )
    ).rows[0];
    if (!row) throw Error("Collection no longer exists.");
    await db.query(
      "INSERT INTO collection_membership(collection_id,work_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [collectionId, work.id],
    );
    if (input.seed) {
      const current = row.discovery ?? {
        mode: "papers",
        topic: "",
        workIds: [],
        enabled: false,
        hour: 7,
        timezone: "America/New_York",
      };
      const ids = [...new Set([...(current.workIds ?? []), work.id])];
      if (ids.length > 10) {
        seedApplied = false;
        seedWarning =
          "Paper added; the ten-seed limit is full. Replace a seed in Edit discovery to use this paper.";
        return;
      }
      await db.query(
        "UPDATE collection SET discovery=$2,updated_at=now() WHERE id=$1",
        [
          collectionId,
          JSON.stringify({ ...current, mode: "papers", workIds: ids }),
        ],
      );
    }
  });
  await queueEnrichment(work.id, true);
  if (bytes)
    await pool.query(
      "UPDATE paper_enrichment SET pdf_status='saved',pdf_error='' WHERE work_id=$1",
      [work.id],
    );
  return {
    work,
    localPdf: Boolean(bytes),
    queued: true,
    seed: seedApplied,
    seedWarning,
  };
}
export async function registerIngestion(
  app: FastifyInstance,
  repo: Repository,
) {
  app.post("/api/v1/collections/:id/ingest", async (r) => {
    const id = z
      .string()
      .uuid()
      .parse((r.params as any).id);
    if (r.isMultipart()) {
      const file = await r.file({
        limits: { fileSize: 50 * 1024 * 1024, files: 1 },
      });
      if (!file)
        throw Object.assign(Error("Select a PDF."), { statusCode: 400 });
      const bytes = await file.toBuffer();
      const field = (name: string) => {
        const f = file.fields[name];
        return f && "value" in f ? String(f.value) : "";
      };
      return addIngestedPaper(
        id,
        {
          bytes,
          filename: file.filename,
          title: field("title").slice(0, 2000),
          seed: field("seed") === "true",
        },
        repo,
      );
    }
    return addIngestedPaper(
      id,
      z
        .object({
          link: z.string().trim().min(1).max(4096),
          title: z.string().max(2000).optional(),
          seed: z.boolean().default(false),
        })
        .parse(r.body),
      repo,
    );
  });
  app.post("/api/v1/works/:id/enrichment/retry", async (r) => {
    const id = z
      .string()
      .uuid()
      .parse((r.params as any).id);
    if (!(await repo.getWork(id)))
      throw Object.assign(Error("Paper not found."), { statusCode: 404 });
    await queueEnrichment(id, true);
    return { queued: true };
  });
}
