import { readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, it, expect, vi } from "vitest";
import { v7 as uuid } from "uuid";
import { buildApp } from "../app.js";
import { migrate } from "../cli/migrate.js";
import { pool } from "../db.js";
import { Repository } from "../repository.js";
import { configureCollection } from "../collection-discovery.js";
vi.mock("./download.js", async (original) => ({
  ...(await original<any>()),
  downloadPaper: vi.fn(),
}));
import { downloadPaper } from "./download.js";
import { addIngestedPaper } from "./service.js";
import { enrichPaper, queueEnrichment } from "./enrichment.js";
const enabled = process.env.VANI_INTEGRATION_TEST === "true",
  repo = new Repository();
let app: any, bytes: Buffer;
beforeAll(async () => {
  if (!enabled) return;
  await migrate();
  app = await buildApp();
  bytes = await readFile(
    new URL("../research/fixtures/reading.pdf", import.meta.url),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});
afterAll(async () => {
  if (enabled) {
    await app.close();
    await pool.end();
  }
});
it.skipIf(!enabled)(
  "uploads PDF through multipart, adds seeds without replacing members or schedule and deduplicates repeats",
  async () => {
    const col = await repo.createCollection({ name: "Ingestion " + uuid() }),
      old = await repo.createWork({ title: "Existing seed " + uuid() });
    await repo.addToCollection(col.id, [old.id]);
    await configureCollection(repo, col.id, {
      mode: "papers",
      topic: "robot learning",
      workIds: [old.id],
      timezone: "UTC",
      hour: 9,
      enabled: false,
    });
    const form = new FormData();
    form.append("seed", "true");
    form.append("title", "Uploaded demonstrations");
    form.append(
      "file",
      new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
      "learning.pdf",
    );
    const encoded = new Response(form),
      response = await app.inject({
        method: "POST",
        url: `/api/v1/collections/${col.id}/ingest`,
        headers: { "content-type": encoded.headers.get("content-type")! },
        payload: Buffer.from(await encoded.arrayBuffer()),
      });
    expect(response.statusCode, response.body).toBe(200);
    const result = response.json(),
      again = await addIngestedPaper(col.id, {
        bytes,
        filename: "same.pdf",
        seed: true,
      });
    expect(again.work.id).toBe(result.work.id);
    const c = (await repo.listCollections()).find((c) => c.id === col.id)!;
    expect(c.discovery?.workIds).toEqual([old.id, result.work.id]);
    expect(c.discovery?.hour).toBe(9);
    expect(c.discovery?.enabled).toBe(false);
    expect(c.discovery?.topic).toBe("robot learning");
    const doc = (
      await pool.query(
        "SELECT a.id,o.storage_path FROM attachment a JOIN object_store o ON o.hash_sha256=a.object_hash WHERE canonical_work(a.work_id)=$1",
        [result.work.id],
      )
    ).rows;
    expect(doc.length).toBeGreaterThan(0);
    expect(await readFile(doc[0].storage_path)).toEqual(bytes);
  },
);
it.skipIf(!enabled)(
  "ingests publisher links and downloads local PDFs before grounded contribution processing",
  async () => {
    const stamp = uuid(),
      col = await repo.createCollection({ name: "Link " + stamp });
    vi.mocked(downloadPaper)
      .mockResolvedValueOnce({
        bytes: Buffer.from(
          `<meta name="citation_title" content="Linked ${stamp}"><meta name="citation_abstract" content="We introduce a reliable learning method for robot control."><meta name="citation_pdf_url" content="/paper.pdf">`,
        ),
        url: "https://papers.example/" + stamp,
        type: "text/html",
      })
      .mockResolvedValue({
        bytes,
        url: "https://papers.example/paper.pdf",
        type: "application/pdf",
      });
    const result = await addIngestedPaper(col.id, {
      link: "https://papers.example/" + stamp,
      seed: true,
    });
    expect(result.localPdf).toBe(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw Error("local model offline");
      }),
    );
    await enrichPaper(result.work.id);
    const e = (
      await pool.query("SELECT * FROM paper_enrichment WHERE work_id=$1", [
        result.work.id,
      ])
    ).rows[0];
    expect(e.pdf_status).toBe("saved");
    expect(e.summary.status).toBe("extractive");
    expect(e.summary.text).toContain("We introduce");
    expect(e.summary.coverage).toContain("local PDF");
    expect(downloadPaper).toHaveBeenCalledTimes(2);
    await enrichPaper(result.work.id);
    expect(downloadPaper).toHaveBeenCalledTimes(2);
  },
);
it.skipIf(!enabled)(
  "unavailable PDFs preserve the paper and produce a labeled abstract summary with retry",
  async () => {
    const work = await repo.createWork({
      title: "Paywall " + uuid(),
      abstract:
        "We propose a sample-efficient method for reliable robot control.",
      connector: "test",
      externalId: uuid(),
      sourcePayload: { pdfUrls: ["https://papers.example/locked.pdf"] },
    });
    await queueEnrichment(work.id);
    vi.mocked(downloadPaper).mockRejectedValue(Error("HTTP 403"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw Error("offline");
      }),
    );
    await enrichPaper(work.id);
    const e = (
      await pool.query("SELECT * FROM paper_enrichment WHERE work_id=$1", [
        work.id,
      ])
    ).rows[0];
    expect(e.pdf_status).toBe("unavailable");
    expect(e.pdf_error).toContain("403");
    expect(e.summary.coverage).toBe("abstract only");
    expect(e.summary.text).toContain("We propose");
    const r = await app.inject({
      method: "POST",
      url: `/api/v1/works/${work.id}/enrichment/retry`,
      payload: {},
    });
    expect(r.statusCode).toBe(200);
    expect(
      (
        await pool.query(
          "SELECT status FROM paper_enrichment WHERE work_id=$1",
          [work.id],
        )
      ).rows[0].status,
    ).toBe("queued");
  },
);
it.skipIf(!enabled)(
  "seed focus synthesis uses local PDF excerpts and preserves an explicit focus override",
  async () => {
    const col = await repo.createCollection({ name: "Local focus " + uuid() }),
      result = await addIngestedPaper(col.id, {
        bytes,
        filename: "seed.pdf",
        seed: true,
      });
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            topic: "Demonstration learning for reliable control",
          }),
        },
      }),
    }));
    vi.stubGlobal("fetch", fetch);
    const seed = await configureCollection(repo, col.id, {
      mode: "papers",
      topic: "",
      workIds: [result.work.id],
      timezone: "UTC",
      hour: 8,
      enabled: false,
    });
    expect(seed.topic).toContain("Demonstration");
    expect(JSON.stringify(fetch.mock.calls)).not.toContain("api.openai.com");
    expect(JSON.stringify(fetch.mock.calls)).toContain(
      "Robots learn from demonstrations",
    );
    const config = await configureCollection(repo, col.id, {
      ...seed,
      topic: "My precise focus",
    });
    expect(config.topic).toBe("My precise focus");
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);
it.skipIf(!enabled)(
  "rejects invalid PDF uploads and saved-search destinations",
  async () => {
    const col = await repo.createCollection({
      name: "Invalid upload " + uuid(),
    });
    await expect(
      addIngestedPaper(col.id, {
        bytes: Buffer.from("<html>no PDF</html>"),
        filename: "bad.pdf",
      }),
    ).rejects.toThrow("Supply a PDF");
    await pool.query(
      "UPDATE collection SET collection_type='saved_search',search_rule='{}'::jsonb WHERE id=$1",
      [col.id],
    );
    await expect(
      addIngestedPaper(col.id, { bytes, filename: "valid.pdf" }),
    ).rejects.toThrow();
  },
);
it.skipIf(!enabled)(
  "valid local synthesis retains a source excerpt and rejects fabricated evidence",
  async () => {
    const quote =
      "We propose a new representation that improves transfer between robots.";
    const w = await repo.createWork({
      title: "Summary " + uuid(),
      abstract: quote,
    });
    await queueEnrichment(w.id);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          message: {
            content: JSON.stringify({
              text: "The primary contribution is a representation for transferring learned behavior between robots.",
              sourceLabel: "abstract",
              quote,
            }),
          },
        }),
      })),
    );
    await enrichPaper(w.id);
    let e = (
      await pool.query(
        "SELECT summary FROM paper_enrichment WHERE work_id=$1",
        [w.id],
      )
    ).rows[0];
    expect(e.summary.status).toBe("summarized");
    expect(e.summary.evidence[0].quote).toBe(quote);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          message: {
            content: JSON.stringify({
              text: "An unsupported claim about general intelligence.",
              sourceLabel: "abstract",
              quote: "Fabricated evidence not present in any source.",
            }),
          },
        }),
      })),
    );
    await enrichPaper(w.id);
    e = (
      await pool.query(
        "SELECT summary FROM paper_enrichment WHERE work_id=$1",
        [w.id],
      )
    ).rows[0];
    expect(e.summary.status).toBe("extractive");
    expect(e.summary.text).toBe(quote);
  },
);
it.skipIf(!enabled)(
  "the durable worker processes a queued paper in a paused collection",
  async () => {
    const { runEnrichment } = await import("./enrichment.js");
    const work = await repo.createWork({
        title: "Queued worker " + uuid(),
        abstract:
          "We introduce a representation for robust transfer across robots.",
      }),
      col = await repo.createCollection({ name: "Paused worker " + uuid() });
    await repo.addToCollection(col.id, [work.id]);
    await queueEnrichment(work.id);
    await pool.query(
      "UPDATE paper_enrichment SET next_attempt_at='1970-01-01' WHERE work_id=$1",
      [work.id],
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw Error("local model offline");
      }),
    );
    await runEnrichment();
    const state = (
      await pool.query("SELECT * FROM paper_enrichment WHERE work_id=$1", [
        work.id,
      ])
    ).rows[0];
    expect(state.status).toBe("complete");
    expect(state.summary.text).toContain("We introduce");
    expect(state.attempts).toBe(1);
  },
);
it.skipIf(!enabled)(
  "a full seed set still accepts a new collection member without discarding seeds",
  async () => {
    const col = await repo.createCollection({ name: "Full seeds " + uuid() }),
      ids: string[] = [];
    for (let i = 0; i < 10; i++)
      ids.push((await repo.createWork({ title: "Seed " + uuid() })).id);
    await configureCollection(repo, col.id, {
      mode: "papers",
      topic: "Learning",
      workIds: ids,
      timezone: "UTC",
      hour: 6,
      enabled: false,
    });
    const payload = Buffer.concat([
      bytes,
      Buffer.from("\n% unique " + uuid() + "\n"),
    ]);
    const result = await addIngestedPaper(col.id, {
      bytes: payload,
      filename: "extra.pdf",
      seed: true,
    });
    expect(result.seed).toBe(false);
    expect(result.seedWarning).toContain("ten-seed");
    expect((await repo.listWorks({ collectionId: col.id })).length).toBe(11);
    expect(
      (await repo.listCollections()).find((c) => c.id === col.id)?.discovery
        ?.workIds,
    ).toEqual(ids);
  },
);
