import { beforeAll, afterAll, beforeEach, it, expect, vi } from "vitest";
import { v7 as uuid } from "uuid";
import { pool } from "./db.js";
import { migrate } from "./cli/migrate.js";
import { Repository } from "./repository.js";
import { configureCollection } from "./collection-discovery.js";
import { enqueueDeepRefresh } from "./deep-refresh.js";
import {
  stageCandidate,
  acceptCandidate,
  getFocus,
  saveFocus,
  runCoreWorker,
} from "./core/service.js";
import { enqueueAudit } from "./core/audits.js";
import { Focus } from "./core/algorithm.js";
const enabled = process.env.VANI_INTEGRATION_TEST === "true",
  repo = new Repository();
beforeAll(async () => {
  if (enabled) await migrate();
});
beforeEach(async () => {
  if (enabled)
    await pool.query(
      "UPDATE core_run SET status='superseded' WHERE status IN ('queued','running','paused')",
    );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) =>
      Response.json(
        String(url).includes("crossref")
          ? { message: { items: [] } }
          : { results: [], meta: {} },
      ),
    ),
  );
});
afterAll(async () => {
  vi.unstubAllGlobals();
  if (enabled) await pool.end();
});
async function collection() {
  const c = await repo.createCollection({ name: "Core refresh " + uuid() });
  await configureCollection(repo, c.id, {
    mode: "topic",
    topic: "robotic mapping",
    workIds: [],
    timezone: "UTC",
    hour: 9,
    enabled: false,
  });
  return c;
}
async function state(id: string) {
  return (await pool.query("SELECT * FROM core_run WHERE id=$1", [id])).rows[0];
}
it.skipIf(!enabled)(
  "coalesces manual refreshes and preserves the daily schedule; membership requires admission",
  async () => {
    const c = await collection(),
      before = (
        await pool.query(
          "SELECT discovery,next_discovery_at FROM collection WHERE id=$1",
          [c.id],
        )
      ).rows[0],
      job = await enqueueDeepRefresh(c.id);
    expect((await enqueueDeepRefresh(c.id)).id).toBe(job.id);
    const paper = {
      title: "Mapping " + uuid(),
      abstract: "We introduce active uncertainty-aware mapping.",
      connector: "fixture",
      externalId: uuid(),
      sourcePayload: {},
    };
    const first = await stageCandidate(job, paper, { channel: "lexical" }),
      again = await stageCandidate(job, paper, { channel: "citation" });
    expect(first.id).toBe(again.id);
    expect(again.paths).toHaveLength(2);
    expect(await repo.listWorks({ collectionId: c.id })).toHaveLength(0);
    await acceptCandidate(first.id);
    await acceptCandidate(first.id);
    expect(await repo.listWorks({ collectionId: c.id })).toHaveLength(1);
    expect(
      (
        await pool.query(
          "SELECT discovery,next_discovery_at FROM collection WHERE id=$1",
          [c.id],
        )
      ).rows[0],
    ).toEqual(before);
  },
);
it.skipIf(!enabled)(
  "rejects discovery without public queries or anchors",
  async () => {
    const c = await collection();
    await pool.query(
      "UPDATE collection SET keywords=ARRAY[]::text[] WHERE id=$1",
      [c.id],
    );
    await expect(enqueueDeepRefresh(c.id)).rejects.toMatchObject({
      statusCode: 409,
    });
  },
);
it.skipIf(!enabled)(
  "supersedes in-flight results and prevents stale admission after a keyword change",
  async () => {
    const c = await collection(),
      job = await enqueueDeepRefresh(c.id),
      candidate = await stageCandidate(
        job,
        {
          title: "Robotic mapping",
          connector: "fixture",
          externalId: uuid(),
          sourcePayload: {},
        },
        { channel: "search" },
      );
    await pool.query(
      "UPDATE collection SET keywords=ARRAY['navigation'],keyword_version=keyword_version+1 WHERE id=$1",
      [c.id],
    );
    expect((await state(job.id)).status).toBe("superseded");
    await expect(acceptCandidate(candidate.id)).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(await repo.listWorks({ collectionId: c.id })).toHaveLength(0);
  },
);
it.skipIf(!enabled)(
  "retains failed source checkpoints and resumes the same job after an outage",
  async () => {
    const c = await collection(),
      job = await enqueueDeepRefresh(c.id);
    vi.mocked(fetch).mockRejectedValue(Error("providers offline"));
    for (let i = 0; i < 20 && (await state(job.id)).status !== "paused"; i++)
      await runCoreWorker();
    expect((await state(job.id)).status).toBe("paused");
    expect((await state(job.id)).coverage.length).toBeGreaterThan(0);
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ results: [], meta: {}, message: { items: [] } }),
    );
    expect((await enqueueDeepRefresh(c.id)).id).toBe(job.id);
    await runCoreWorker();
    expect((await state(job.id)).status).toBe("running");
  },
);
it.skipIf(!enabled)(
  "uses only explicit public anchors for expansion",
  async () => {
    const c = await collection(),
      w = await repo.createWork({
        title: "Public paper " + uuid(),
        doi: "10.1234/" + uuid(),
      });
    await repo.addToCollection(c.id, [w.id]);
    const focus = await getFocus(c.id);
    expect(focus.profile.anchors).toEqual([]);
    await saveFocus(
      c.id,
      focus.version,
      Focus.parse({ ...focus.profile, anchors: [{ workId: w.id }] }),
    );
    const job = await enqueueDeepRefresh(c.id);
    expect(
      job.frontier.some((t: any) => t.source === "anchor" && t.query === w.doi),
    ).toBe(true);
  },
);
it.skipIf(!enabled)(
  "early audits freeze all retained candidates, including those promoted to D3",
  async () => {
    const c = await collection(),
      job = await enqueueDeepRefresh(c.id),
      a = await stageCandidate(
        job,
        {
          title: "Candidate A",
          connector: "fixture",
          externalId: uuid(),
          sourcePayload: {},
        },
        { channel: "search" },
      ),
      b = await stageCandidate(
        job,
        {
          title: "Candidate B",
          connector: "fixture",
          externalId: uuid(),
          sourcePayload: {},
        },
        { channel: "search" },
      );
    await pool.query(
      "UPDATE core_candidate SET stage='D3',proximity='closest' WHERE id=$1",
      [b.id],
    );
    const audit = await enqueueAudit(c.id, "early");
    const items = (
      await pool.query("SELECT * FROM core_audit_item WHERE audit_id=$1", [
        audit.id,
      ])
    ).rows;
    expect(new Set(items.map((i) => i.candidate_id))).toEqual(
      new Set([a.id, b.id]),
    );
    await pool.query(
      "UPDATE core_candidate SET proximity='background' WHERE id=$1",
      [b.id],
    );
    expect(items.find((i) => i.candidate_id === b.id)!.snapshot.proximity).toBe(
      "closest",
    );
  },
);
