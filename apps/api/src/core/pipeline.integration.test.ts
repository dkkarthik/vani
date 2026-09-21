import { bindModelPersistence } from "./routes.js";
import { readFile } from "node:fs/promises";
import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { v7 as uuid } from "uuid";
import { pool } from "../db.js";
import { migrate } from "../cli/migrate.js";
import { Repository } from "../repository.js";
import { storePdf } from "../ingestion/enrichment.js";
import { config } from "../config.js";
import { resetModelIdentity } from "../models/router.js";
import {
  enqueueCore,
  stageCandidate,
  getFocus,
  saveFocus,
  runCoreWorker,
  resumeEvidence,
  acceptCandidate,
} from "./service.js";
import { Focus } from "./algorithm.js";
const enabled = process.env.VANI_INTEGRATION_TEST === "true",
  repo = new Repository();
beforeAll(async () => {
  if (enabled) await migrate();
});
afterAll(async () => {
  vi.unstubAllGlobals();
  if (enabled) await pool.end();
});
it.skipIf(!enabled)(
  "runs D0 through D3 locally, waits for a PDF, retains comparison evidence, and keeps admission explicit",
  async () => {
    await pool.query(
      "UPDATE core_run SET status='superseded' WHERE status IN ('queued','running','paused','awaiting_evidence')",
    );
    const collection = await repo.createCollection({
        name: "Full pipeline " + uuid(),
      }),
      anchor = await repo.createWork({
        title: "Robot demonstration learning " + uuid(),
        abstract: "We learn transferable policies from robot demonstrations.",
      });
    const bytes = await readFile(
      new URL("../research/fixtures/reading.pdf", import.meta.url),
    );
    await storePdf(anchor.id, bytes, "anchor.pdf");
    await repo.addToCollection(collection.id, [anchor.id]);
    const f = await getFocus(collection.id);
    await saveFocus(
      collection.id,
      f.version,
      Focus.parse({
        ...f.profile,
        question: "Learning robot policies from demonstrations",
        anchors: [{ workId: anchor.id }],
        publicQueries: ["robot demonstrations"],
        budgets: { d0: 10, d1: 10, d2: 2, d3: 1 },
      }),
    );
    bindModelPersistence();
    resetModelIdentity();
    let chatCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        const u = String(url);
        if (u.includes("crossref"))
          return Response.json({ message: { items: [] } });
        if (u.includes("openalex"))
          return Response.json({
            results: [
              {
                id: "https://openalex.org/W900010001",
                title: "Robot policies from demonstrations",
                abstract_inverted_index: {
                  We: [0],
                  learn: [1],
                  robot: [2],
                  policies: [3],
                  from: [4],
                  demonstrations: [5],
                },
                authorships: [],
                referenced_works: [],
              },
            ],
            meta: {},
          });
        if (u.endsWith("/api/tags"))
          return Response.json({
            models: [
              { name: config.ollamaModel, digest: "reader" },
              {
                name: process.env.OLLAMA_EMBED_MODEL ?? "qwen3-embedding:0.6b",
                digest: "embed",
              },
            ],
          });
        const body = JSON.parse(String(init?.body));
        if (u.endsWith("/api/embed"))
          return Response.json({ embeddings: body.input.map(() => [1, 0, 0]) });
        chatCount++;
        const packet = JSON.parse(body.messages[1].content);
        if (packet.paper)
          return Response.json({
            done: true,
            message: {
              content: JSON.stringify({
                contribution: "Learning robot policies from demonstrations",
                likelyRelated: true,
                reason: "Shared learning problem",
                quote: packet.paper.text,
                uncertainties: [],
              }),
            },
          });
        const candidate = packet.sources.find(
            (s: any) => s.workId === packet.candidateId,
          ),
          primary = packet.sources.find((s: any) => s.workId === anchor.id);
        return Response.json({
          done: true,
          message: {
            content: JSON.stringify({
              contribution: "Demonstration-based robot policy learning",
              proximity: "closest",
              role: "extension",
              similarities: ["Uses demonstration learning"],
              differences: ["Evaluation protocol unresolved"],
              uncertainties: ["Supplement not read"],
              anchorId: anchor.id,
              facetIds: [],
              comparison: {
                status: "unknown",
                question: "Same control evaluation?",
                dimensions: [
                  {
                    name: "control frequency",
                    candidate: "unknown",
                    anchor: "unknown",
                    status: "unknown",
                  },
                ],
              },
              evidence: [candidate, primary].map((s) => ({
                sourceId: s.id,
                quote: s.text.slice(0, 100),
                supports: "Shared mechanism",
              })),
              relationships: [
                {
                  predicate: "extends",
                  targetId: anchor.id,
                  sourceIds: [candidate.id, primary.id],
                },
              ],
            }),
          },
        });
      }),
    );
    const run = await enqueueCore(collection.id);
    let attached = false;
    for (let i = 0; i < 35; i++) {
      await runCoreWorker();
      const state = (
        await pool.query("SELECT * FROM core_run WHERE id=$1", [run.id])
      ).rows[0];
      expect(state.error ?? "", state.error).not.toMatch(/Error:/);
      const candidate = (
        await pool.query(
          "SELECT * FROM core_candidate WHERE run_id=$1 ORDER BY created_at LIMIT 1",
          [run.id],
        )
      ).rows[0];
      if (candidate?.work_id && !attached) {
        await storePdf(candidate.work_id, bytes, "candidate.pdf");
        attached = true;
        await resumeEvidence();
      }
      if (candidate?.stage === "D3" && candidate.state === "reviewed") break;
    }
    const c = (
      await pool.query(
        "SELECT * FROM core_candidate WHERE run_id=$1 ORDER BY created_at LIMIT 1",
        [run.id],
      )
    ).rows[0];
    expect(c.stage).toBe("D3");
    expect(c.state).toBe("reviewed");
    expect(c.proximity).toBe("closest");
    expect(c.assessment.comparison.status).toBe("unknown");
    expect(chatCount).toBeGreaterThanOrEqual(3);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM model_invocation WHERE collection_id=$1 AND provider='ollama'",
          [collection.id],
        )
      ).rows[0].n,
    ).toBeGreaterThanOrEqual(3);
    const history = (
      await pool.query("SELECT * FROM core_assessment WHERE candidate_id=$1", [
        c.id,
      ])
    ).rows;
    expect(history.map((h) => h.stage)).toEqual(
      expect.arrayContaining(["D1b", "D2", "D3"]),
    );
    expect(
      history.every(
        (h) => h.sources.length > 0 && h.provenance.provider === "ollama",
      ),
    ).toBe(true);
    expect(await repo.listWorks({ collectionId: collection.id })).toHaveLength(
      1,
    );
    await acceptCandidate(c.id);
    expect(
      (await repo.graph(collection.id)).edges.some(
        (e) => e.id.startsWith("core:") && e.predicate === "extends",
      ),
    ).toBe(true);
    expect(await repo.listWorks({ collectionId: collection.id })).toHaveLength(
      2,
    );
    const self = await stageCandidate(
      run,
      {
        title: anchor.title,
        connector: "fixture",
        externalId: uuid(),
        sourcePayload: {},
      },
      { channel: "test" },
    );
    await pool.query(
      "UPDATE core_candidate SET work_id=$2,stage='D2',state='pending' WHERE id=$1",
      [self.id, anchor.id],
    );
    await pool.query(
      "UPDATE core_run SET status='queued',phase='screening' WHERE id=$1",
      [run.id],
    );
    await runCoreWorker();
    expect(
      (
        await pool.query("SELECT state FROM core_candidate WHERE id=$1", [
          self.id,
        ])
      ).rows[0].state,
    ).toBe("anchor");
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(([u]) => String(u).includes("api.openai")),
    ).toBe(false);
  },
  20000,
);

it.skipIf(!enabled)(
  "prioritizes targeted readings and preserves bounded failures across refreshes",
  async () => {
    await pool.query(
      "UPDATE core_run SET status='superseded' WHERE status IN ('queued','running','paused','awaiting_evidence')",
    );
    const collection = await repo.createCollection({
      name: "Recovery " + uuid(),
    });
    const run = await enqueueCore(collection.id);
    const make = async (title: string) =>
      stageCandidate(
        run,
        {
          title,
          abstract: "We learn safe robot control from terrain observations.",
          connector: "fixture",
          externalId: uuid(),
          sourcePayload: {},
        },
        { channel: "fixture" },
      );
    const bad = await make("Failure prone robot learning"),
      good = await make("Successful robot learning"),
      deep = await make("Deep robot comparison");
    const work = await repo.createWork({ title: deep.paper.title });
    await storePdf(
      work.id,
      await readFile(
        new URL("../research/fixtures/reading.pdf", import.meta.url),
      ),
      "candidate.pdf",
    );
    await pool.query(
      "UPDATE core_candidate SET stage='D1a',features=jsonb_build_object('score',CASE WHEN id=$2 THEN 2 ELSE 1 END) WHERE run_id=$1",
      [run.id, bad.id],
    );
    await pool.query(
      "UPDATE core_candidate SET stage='D2',work_id=$2,features=jsonb_build_object('score',999) WHERE id=$1",
      [deep.id, work.id],
    );
    await pool.query("UPDATE core_run SET phase='screening' WHERE id=$1", [
      run.id,
    ]);
    resetModelIdentity();
    const order: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        if (String(url).endsWith("/api/tags"))
          return Response.json({
            models: [{ name: config.ollamaModel, digest: "reader" }],
          });
        const body = JSON.parse(String(init?.body)),
          packet = JSON.parse(body.messages[1].content);
        const key = packet.paper?.workId ?? "deep";
        order.push(key);
        if (key !== good.id)
          throw new DOMException("Local inference timed out", "TimeoutError");
        return Response.json({
          message: {
            content: JSON.stringify({
              contribution: "A grounded control method",
              likelyRelated: false,
              reason: "Different problem",
              quote: packet.paper.text,
              uncertainties: [],
            }),
          },
        });
      }),
    );
    await runCoreWorker(); // A targeted reading precedes more abstract screening.
    await runCoreWorker();
    let failed = (
      await pool.query("SELECT * FROM core_candidate WHERE id=$1", [bad.id])
    ).rows[0];
    expect(failed.attempts).toBe(1);
    expect(failed.state).toBe("pending");
    expect(failed.last_error).toContain("timed out");
    expect(new Date(failed.next_attempt_at).getTime()).toBeGreaterThan(
      Date.now(),
    );
    await enqueueCore(collection.id); // Daily/manual resume must not clear candidate backoff.
    expect(
      (
        await pool.query("SELECT attempts FROM core_candidate WHERE id=$1", [
          bad.id,
        ])
      ).rows[0].attempts,
    ).toBe(1);
    await runCoreWorker();
    await runCoreWorker();
    expect(order.slice(0, 3)).toEqual(["deep", bad.id, good.id]);
    expect(
      (await pool.query("SELECT status FROM core_run WHERE id=$1", [run.id]))
        .rows[0].status,
    ).toBe("running");
    for (let i = 0; i < 5; i++) {
      await pool.query(
        "UPDATE core_candidate SET next_attempt_at=now() WHERE run_id=$1",
        [run.id],
      );
      await runCoreWorker();
    }
    failed = (
      await pool.query("SELECT * FROM core_candidate WHERE id=$1", [bad.id])
    ).rows[0];
    expect(failed.state).toBe("failed");
    expect(failed.attempts).toBe(2);
    expect(failed.features.readingErrors).toHaveLength(2);
    expect(
      (await pool.query("SELECT status FROM core_run WHERE id=$1", [run.id]))
        .rows[0].status,
    ).toBe("completed_with_errors");
    const next = await enqueueCore(collection.id);
    expect(next.id).not.toBe(run.id);
    expect(
      (
        await pool.query(
          "SELECT attempts,state FROM core_candidate WHERE id=$1",
          [bad.id],
        )
      ).rows[0],
    ).toMatchObject({ attempts: 2, state: "pending" });
    const calls = order.length;
    await pool.query("UPDATE core_run SET phase='screening' WHERE id=$1", [
      next.id,
    ]);
    await runCoreWorker();
    await runCoreWorker();
    expect(order).toHaveLength(calls);
    expect(
      (
        await pool.query("SELECT state FROM core_candidate WHERE id=$1", [
          bad.id,
        ])
      ).rows[0].state,
    ).toBe("blocked");
    await pool.query("UPDATE core_run SET status='superseded' WHERE id=$1", [
      next.id,
    ]);
  },
  20000,
);

it.skipIf(!enabled)(
  "expands citations from a discovered public seed match without sending uploaded text online",
  async () => {
    await pool.query(
      "UPDATE core_run SET status='superseded' WHERE status IN ('queued','running','paused','awaiting_evidence')",
    );
    const col = await repo.createCollection({ name: "Public match " + uuid() });
    const anchor = await repo.createWork({
      title: "A private terrain controller manuscript " + uuid(),
      abstract: "Private research text",
      accessClass: "user_uploaded",
    });
    await repo.addToCollection(col.id, [anchor.id]);
    const f = await getFocus(col.id);
    await saveFocus(
      col.id,
      f.version,
      Focus.parse({
        ...f.profile,
        anchors: [{ workId: anchor.id }],
        publicQueries: ["legged terrain control"],
      }),
    );
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        calls.push(String(url));
        return Response.json({
          results: [
            {
              id: "https://openalex.org/W90009999",
              title: anchor.title,
              authorships: [],
              referenced_works: ["https://openalex.org/W90008888"],
            },
          ],
          meta: {},
        });
      }),
    );
    const run = await enqueueCore(col.id);
    await runCoreWorker();
    const saved = (
      await pool.query("SELECT * FROM core_run WHERE id=$1", [run.id])
    ).rows[0];
    expect(saved.frontier).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "references",
          filter: "openalex:W90008888",
        }),
        expect.objectContaining({
          source: "citing",
          filter: "cites:W90009999",
        }),
      ]),
    );
    expect(calls).toHaveLength(1);
    expect(decodeURIComponent(calls[0]!)).not.toContain(anchor.title);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM source_record WHERE work_id=$1 AND connector='openalex'",
          [anchor.id],
        )
      ).rows[0].n,
    ).toBe(1);
    await pool.query("UPDATE core_run SET status='superseded' WHERE id=$1", [
      run.id,
    ]);
  },
);
