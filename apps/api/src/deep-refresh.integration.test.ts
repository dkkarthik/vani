import { beforeAll, afterAll, beforeEach, it, expect, vi } from "vitest";
import { v7 as uuid } from "uuid";
import { pool } from "./db.js";
import { migrate } from "./cli/migrate.js";
import { Repository } from "./repository.js";
import {
  configureCollection,
  collectionMembers,
} from "./collection-discovery.js";
const mock = vi.hoisted(() => ({ discover: vi.fn(), expand: vi.fn() }));
vi.mock("./connectors.js", async (original) => ({
  ...(await original<any>()),
  discoverCollection: mock.discover,
}));
vi.mock("./knowledge/discovery.js", async (original) => ({
  ...(await original<any>()),
  runDiscovery: mock.expand,
}));
import { candidateIdentity, materialFingerprint } from "./planning/monitor.js";
import { enqueueDeepRefresh, runDeepRefresh } from "./deep-refresh.js";
const enabled = process.env.VANI_INTEGRATION_TEST === "true",
  repo = new Repository();
beforeAll(async () => {
  if (enabled) await migrate();
});
beforeEach(() => {
  vi.resetAllMocks();
  mock.expand.mockResolvedValue({ items: [], coverage: [{ state: "ok" }] });
  mock.discover.mockResolvedValue({ items: [], warnings: [] });
});
afterAll(async () => {
  if (enabled) await pool.end();
});
async function collection() {
  const c = await repo.createCollection({ name: "Deep refresh " + uuid() });
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
  return (
    await pool.query("SELECT * FROM collection_refresh WHERE id=$1", [id])
  ).rows[0];
}
it.skipIf(!enabled)(
  "manual deep search updates a paused collection without changing its daily schedule",
  async () => {
    const c = await collection(),
      before = (
        await pool.query(
          "SELECT discovery,next_discovery_at FROM collection WHERE id=$1",
          [c.id],
        )
      ).rows[0],
      key = uuid();
    mock.discover.mockResolvedValue({
      items: [
        {
          title: "Robotic mapping " + key,
          abstract: "Mapping robots through uncertainty.",
          year: 1990,
          connector: "fixture",
          externalId: key,
          sourcePayload: {},
        },
        {
          title: "Medieval pottery " + key,
          connector: "fixture",
          externalId: key + "x",
          sourcePayload: {},
        },
      ],
      warnings: [],
    });
    const job = await enqueueDeepRefresh(c.id);
    expect((await enqueueDeepRefresh(c.id)).id).toBe(job.id);
    await runDeepRefresh(repo);
    const done = await state(job.id);
    expect(done.status).toBe("completed");
    expect(done.added).toBe(1);
    expect(done.scanned).toBe(2);
    expect(mock.discover.mock.calls.map((c) => c[0])).toEqual([
      "robotic mapping",
      "robotic",
      "mapping",
    ]);
    expect(mock.discover.mock.calls.every((c) => c.length === 2)).toBe(true);
    const members = await collectionMembers(repo, c.id);
    expect(members.items[0]?.inclusionReason?.text).toContain("Deep refresh");
    expect(members.items[0]?.enrichment?.status).toBe("queued");
    expect(
      (
        await pool.query(
          "SELECT discovery,next_discovery_at FROM collection WHERE id=$1",
          [c.id],
        )
      ).rows[0],
    ).toEqual(before);
    const again = await enqueueDeepRefresh(c.id);
    await runDeepRefresh(repo);
    expect((await state(again.id)).added).toBe(0);
  },
);
it.skipIf(!enabled)("rejects a deep refresh without keywords", async () => {
  const c = await collection();
  await pool.query(
    "UPDATE collection SET keywords=ARRAY[]::text[] WHERE id=$1",
    [c.id],
  );
  await expect(enqueueDeepRefresh(c.id)).rejects.toMatchObject({
    statusCode: 409,
  });
});
it.skipIf(!enabled)(
  "an edit during provider search supersedes results before admission",
  async () => {
    const c = await collection();
    mock.discover.mockImplementation(async () => {
      await pool.query(
        "UPDATE collection SET keywords=ARRAY['navigation'],keyword_version=keyword_version+1 WHERE id=$1",
        [c.id],
      );
      return {
        items: [
          {
            title: "Robotic mapping " + uuid(),
            connector: "fixture",
            externalId: uuid(),
            sourcePayload: {},
          },
        ],
        warnings: [],
      };
    });
    const job = await enqueueDeepRefresh(c.id);
    await runDeepRefresh(repo);
    expect((await state(job.id)).status).toBe("superseded");
    expect(await repo.listWorks({ collectionId: c.id })).toHaveLength(0);
  },
);
it.skipIf(!enabled)(
  "provider outage is a failed job and a later refresh can retry",
  async () => {
    const c = await collection();
    mock.discover.mockRejectedValue(Error("providers offline"));
    const job = await enqueueDeepRefresh(c.id);
    await runDeepRefresh(repo);
    expect((await state(job.id)).status).toBe("failed");
    mock.discover.mockResolvedValue({ items: [], warnings: [] });
    const retry = await enqueueDeepRefresh(c.id);
    await runDeepRefresh(repo);
    expect((await state(retry.id)).status).toBe("completed");
  },
);
it.skipIf(!enabled)(
  "recovers an interrupted job and preserves provider warnings",
  async () => {
    const c = await collection(),
      job = await enqueueDeepRefresh(c.id);
    await pool.query(
      "UPDATE collection_refresh SET status='running',phase='searching' WHERE id=$1",
      [job.id],
    );
    mock.discover.mockResolvedValue({
      items: [],
      warnings: ["Crossref unavailable; OpenAlex returned results"],
    });
    await runDeepRefresh(repo);
    expect((await state(job.id)).status).toBe("partial");
    expect((await state(job.id)).warnings).toHaveLength(1);
  },
);
it.skipIf(!enabled)(
  "expands public seeds and applies collection feedback to candidates",
  async () => {
    const c = await collection(),
      w = await repo.createWork({
        title: "Public seed " + uuid(),
        doi: "10.1234/" + uuid(),
      });
    await repo.addToCollection(c.id, [w.id]);
    const dismissed = {
      title: "Robotic mapping " + uuid(),
      connector: "fixture",
      externalId: uuid(),
      sourcePayload: {},
    };
    await pool.query(
      "INSERT INTO discovery_feedback(id,context_key,identity_key,fingerprint,state,reason) VALUES($1,$2,$3,$4,'dismissed','Off topic')",
      [
        uuid(),
        "collection:" + c.id,
        candidateIdentity(dismissed),
        materialFingerprint(dismissed),
      ],
    );
    mock.discover.mockResolvedValue({ items: [dismissed], warnings: [] });
    const job = await enqueueDeepRefresh(c.id);
    await runDeepRefresh(repo);
    expect(await repo.listWorks({ collectionId: c.id })).toHaveLength(1);
    expect(mock.expand).toHaveBeenCalledWith(
      expect.objectContaining({
        seeds: [w.id],
        direction: "both",
        collectionId: c.id,
      }),
    );
    expect((await state(job.id)).status).toBe("completed");
  },
);
