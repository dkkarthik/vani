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
