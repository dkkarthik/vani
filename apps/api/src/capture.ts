import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
  BrowserCaptureInput,
  MAX_CAPTURE_PDF_BYTES,
  type CaptureResult,
} from "@vani/shared";
import { config } from "./config.js";
import { query, transaction } from "./db.js";
import { cleanDoi } from "./lib/citations.js";
import { ObjectStore } from "./object-store.js";
import { Repository } from "./repository.js";
import { resolveCaptureDoi } from "./capture-resolve.js";

function fail(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode });
}
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export class CaptureAccess {
  constructor(private directory = config.dataDir) {}
  async token(create = false): Promise<string> {
    const path = join(this.directory, "capture-key");
    try {
      return (await readFile(path, "utf8")).trim();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (!create) return "";
    await mkdir(this.directory, { recursive: true });
    try {
      await writeFile(path, randomBytes(32).toString("hex"), {
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    return (await readFile(path, "utf8")).trim();
  }
  async revoke() {
    await unlink(join(this.directory, "capture-key")).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  async authorize(request: FastifyRequest) {
    const expected = await this.token();
    const supplied =
      request.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1] ??
      "";
    if (
      !/^[a-f0-9]{64}$/.test(expected) ||
      !supplied ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))
    ) {
      fail(
        401,
        "Connect the extension using a capture key from VANI Settings.",
      );
    }
  }
}

type CaptureRow = {
  id: string;
  work_id: string;
  collection_id: string;
  source_url: string;
  canonical_url: string;
  pdf_url: string | null;
  pdf_status: CaptureResult["pdfStatus"];
  pdf_message: string;
  attachment_id: string | null;
  duplicate: boolean;
  created_at: Date;
  title: string;
  citation_key: string;
  input_hash: string;
};
const resultOf = (row: CaptureRow): CaptureResult => ({
  id: row.id,
  workId: row.work_id,
  collectionId: row.collection_id,
  title: row.title,
  citationKey: row.citation_key,
  sourceUrl: row.source_url,
  canonicalUrl: row.canonical_url,
  pdfUrl: row.pdf_url,
  pdfStatus: row.pdf_status,
  pdfMessage: row.pdf_message,
  attachmentId: row.attachment_id,
  duplicate: row.duplicate,
  createdAt: row.created_at.toISOString(),
});
const select =
  "SELECT c.*, w.title, w.citation_key FROM browser_capture c JOIN work w ON w.id=c.work_id";

export class CaptureRepository {
  constructor(
    private repository = new Repository(),
    private objects = new ObjectStore(),
  ) {}
  async get(id: string) {
    const result = await query<CaptureRow>(`${select} WHERE c.id=$1`, [id]);
    return result.rows[0] ? resultOf(result.rows[0]) : null;
  }
  async forWork(workId: string) {
    return (
      await query<CaptureRow>(
        `${select} WHERE canonical_work(c.work_id)=canonical_work($1) ORDER BY c.created_at DESC LIMIT 50`,
        [workId],
      )
    ).rows.map(resultOf);
  }
  async save(input: BrowserCaptureInput) {
    await transaction(async (client) => {
      // Serialize extension imports, including citation-key allocation and same-source retries.
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('vani-browser-capture'))",
      );
      const previous = await client.query<{ input_hash: string }>(
        "SELECT input_hash FROM browser_capture WHERE id=$1",
        [input.id],
      );
      if (previous.rows[0]) {
        if (previous.rows[0].input_hash !== hash(input))
          fail(
            409,
            "This save ID was already used for different content. Start a new capture.",
          );
        return;
      }
      const collection = await client.query(
        "SELECT id FROM collection WHERE id=$1 AND deleted_at IS NULL AND collection_type='manual' FOR KEY SHARE",
        [input.collectionId],
      );
      if (!collection.rowCount)
        fail(
          404,
          "The selected collection no longer exists. Choose another collection.",
        );
      const doi = cleanDoi(input.metadata.doi);
      const existing = await client.query<{ id: string }>(
        `SELECT w.id FROM work w WHERE w.deleted_at IS NULL AND (
        lower(w.doi)=$1 OR
        EXISTS(SELECT 1 FROM source_record s WHERE s.work_id=w.id AND s.connector='browser' AND s.external_id=$2))`,
        [doi, input.canonicalUrl],
      );
      const work = await this.repository.createWork(
        {
          ...input.metadata,
          doi,
          verificationStatus: "unverified",
          accessClass: "metadata_only",
          manifestationType: /(^|\.)arxiv\.org$/.test(
            new URL(input.canonicalUrl).hostname,
          )
            ? "preprint"
            : "version_of_record",
          connector: "browser",
          deduplicateByTitle: false,
          externalId: input.canonicalUrl,
          sourcePayload: input,
        },
        client,
      );
      // Retain this source even when DOI/source deduplication reused an existing work.
      await client.query(
        `INSERT INTO source_record(id,work_id,connector,external_id,payload,payload_hash)
        VALUES($1,$2,'browser',$3,$4,$5) ON CONFLICT DO NOTHING`,
        [
          uuidv7(),
          work.id,
          input.canonicalUrl,
          JSON.stringify(input),
          hash(input),
        ],
      );
      await client.query(
        "INSERT INTO collection_membership(collection_id,work_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [input.collectionId, work.id],
      );
      await client.query(
        `INSERT INTO browser_capture(id,work_id,collection_id,source_url,canonical_url,metadata,input_hash,duplicate,pdf_url,pdf_status)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          input.id,
          work.id,
          input.collectionId,
          input.sourceUrl,
          input.canonicalUrl,
          JSON.stringify(input.metadata),
          hash(input),
          existing.rows.some((row) => row.id === work.id),
          input.pdfUrl,
          input.savePdf ? "pending" : "not_requested",
        ],
      );
    });
    return (await this.get(input.id))!;
  }
  async pdf(id: string, bytes: Buffer, filename: string) {
    if (
      !bytes.length ||
      bytes.length > MAX_CAPTURE_PDF_BYTES ||
      !bytes.subarray(0, 1024).includes(Buffer.from("%PDF-"))
    ) {
      fail(
        415,
        "The download is not a PDF, or exceeds the 50 MB capture limit. Metadata is still saved.",
      );
    }
    const capture = await this.get(id);
    if (!capture) fail(404, "Capture not found. Save the paper first.");
    const stored = await this.objects.put(bytes, "application/pdf");
    await transaction(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('vani-browser-pdf:' || $1))",
        [capture.workId],
      );
      const previous = await client.query<{ attachment_id: string | null }>(
        "SELECT attachment_id FROM browser_capture WHERE id=$1 FOR UPDATE",
        [id],
      );
      if (previous.rows[0]?.attachment_id) return;
      const duplicate = await client.query<{ id: string }>(
        "SELECT id FROM attachment WHERE work_id=$1 AND object_hash=$2 LIMIT 1",
        [capture.workId, stored.hash],
      );
      const attachmentId = duplicate.rows[0]?.id ?? uuidv7();
      if (!duplicate.rows[0]) {
        const safeFilename =
          filename.replace(/[^\p{L}\p{N} ._()-]/gu, "_").slice(0, 180) ||
          "paper.pdf";
        await client.query(
          "INSERT INTO attachment(id,work_id,object_hash,filename) VALUES($1,$2,$3,$4)",
          [attachmentId, capture.workId, stored.hash, safeFilename],
        );
      }
      await client.query(
        "UPDATE browser_capture SET attachment_id=$2,pdf_status='saved',pdf_message='',updated_at=now() WHERE id=$1",
        [id, attachmentId],
      );
      await client.query(
        "DELETE FROM paper_first_pass WHERE work_id=$1 AND report->>'status'<>'full_text'",
        [capture.workId],
      );
      await client.query(
        "UPDATE collection SET next_discovery_at=now() WHERE discovery->>'enabled'='true' AND id IN (SELECT collection_id FROM collection_membership WHERE work_id=$1)",
        [capture.workId],
      );
    });
    return (await this.get(id))!;
  }
  async pdfFailed(id: string, message: string) {
    await query(
      "UPDATE browser_capture SET pdf_status='failed',pdf_message=$2,updated_at=now() WHERE id=$1 AND attachment_id IS NULL",
      [id, message],
    );
    return (await this.get(id)) ?? fail(404, "Capture not found.");
  }
}

export async function registerCaptureRoutes(
  app: FastifyInstance,
  repository: Repository,
  captures = new CaptureRepository(repository),
  access = new CaptureAccess(),
) {
  // Pairing is available only through an explicit same-origin VANI UI action.
  const pairingOrigin = (request: FastifyRequest) => {
    const origin = request.headers.origin;
    let sameHost = false;
    try {
      const url = new URL(origin || "");
      sameHost =
        ["http:", "https:"].includes(url.protocol) &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
        url.host === request.headers.host;
    } catch {
      /* Reject missing or malformed origins. */
    }
    if (
      request.headers["x-vani-client"] !== "web" ||
      !origin ||
      (origin !== config.webOrigin && !sameHost)
    ) {
      fail(403, "Generate or revoke capture keys from VANI Settings.");
    }
  };
  app.post("/api/v1/capture-key", async (request, reply) => {
    pairingOrigin(request);
    return reply
      .header("Cache-Control", "no-store")
      .send({ token: await access.token(true) });
  });
  app.delete("/api/v1/capture-key", async (request, reply) => {
    pairingOrigin(request);
    await access.revoke();
    return reply.code(204).send();
  });
  app.get("/api/v1/works/:id/captures", async (request) => ({
    items: await captures.forWork(
      z
        .string()
        .uuid()
        .parse((request.params as { id: string }).id),
    ),
  }));

  await app.register(async (scoped) => {
    scoped.addHook("onRequest", async (request) => access.authorize(request));
    scoped.post("/api/v1/capture/resolve", async (request) => {
      const { doi } = z
        .object({
          doi: z
            .string()
            .max(300)
            .regex(/^10\.\d{4,9}\/[^\s<>]+$/i),
        })
        .parse(request.body);
      return resolveCaptureDoi(doi.toLowerCase());
    });
    scoped.get("/api/v1/capture/collections", async () => ({
      items: (await repository.listCollections()).filter(c=>c.collectionType!=="saved_search"),
    }));
    scoped.post("/api/v1/capture/collections", async (request, reply) =>
      reply
        .code(201)
        .send(
          await repository.createCollection(
            z
              .object({ name: z.string().trim().min(1).max(200) })
              .parse(request.body),
          ),
        ),
    );
    scoped.post("/api/v1/captures", async (request, reply) =>
      reply
        .code(201)
        .send(await captures.save(BrowserCaptureInput.parse(request.body))),
    );
    scoped.get(
      "/api/v1/captures/:id",
      async (request, reply) =>
        (await captures.get(
          z
            .string()
            .uuid()
            .parse((request.params as { id: string }).id),
        )) ??
        reply.code(404).send({ error: { message: "Capture not found." } }),
    );
    scoped.patch("/api/v1/captures/:id", async (request) => {
      const { message } = z
        .object({ message: z.string().min(1).max(1000) })
        .parse(request.body);
      return captures.pdfFailed(
        z
          .string()
          .uuid()
          .parse((request.params as { id: string }).id),
        message,
      );
    });
    scoped.post("/api/v1/captures/:id/pdf", async (request) => {
      const id = z
        .string()
        .uuid()
        .parse((request.params as { id: string }).id);
      const file = await request.file({
        limits: { fileSize: MAX_CAPTURE_PDF_BYTES, files: 1 },
      });
      if (!file) fail(400, "A PDF file is required.");
      return captures.pdf(id, await file.toBuffer(), file.filename);
    });
  });
}
