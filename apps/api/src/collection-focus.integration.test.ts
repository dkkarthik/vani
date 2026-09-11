import { beforeAll, afterAll, afterEach, it, expect, vi } from "vitest";
import { v7 as uuid } from "uuid";
import { buildApp } from "./app.js";
import { migrate } from "./cli/migrate.js";
import { pool } from "./db.js";
import { Repository } from "./repository.js";
import {
  configureCollection,
  collectionMembers,
  runDueCollections,
} from "./collection-discovery.js";
import { collectionFocus } from "./collection-focus.js";
const mock = vi.hoisted(() => ({ discover: vi.fn() }));
vi.mock("./connectors.js", async (original) => ({
  ...(await original<any>()),
  discoverCollection: mock.discover,
}));
vi.mock("./planning/monitor.js", async (original) => ({
  ...(await original<any>()),
  captureDigest: vi.fn(async () => ({ added: 0 })),
  refreshWatchedSources: vi.fn(async () => ({ warnings: [] })),
}));
const enabled = process.env.VANI_INTEGRATION_TEST === "true",
  repo = new Repository();
let app: any;
beforeAll(async () => {
  if (enabled) {
    await migrate();
    app = await buildApp();
  }
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  if (enabled) {
    await app.close();
    await pool.end();
  }
});
async function create(topic = "robotic mapping") {
  const col = await repo.createCollection({ name: "Keyword test " + uuid() });
  await configureCollection(repo, col.id, {
    mode: "topic",
    topic,
    workIds: [],
    timezone: "UTC",
    hour: 8,
    enabled: false,
  });
  return col;
}
async function edit(id: string, keywords: string[], version: number) {
  return app.inject({
    method: "PATCH",
    url: `/api/v1/collections/${id}/keywords`,
    payload: { keywords, version },
  });
}
it.skipIf(!enabled)(
  "keyword removals persist across focus changes and reject stale writes",
  async () => {
    const col = await create();
    expect((await collectionFocus(col.id)).keywords).toEqual([
      "robotic",
      "mapping",
    ]);
    const r = await edit(col.id, ["mapping"], 1);
    expect(r.statusCode, r.body).toBe(200);
    expect((await edit(col.id, ["robotic"], 1)).statusCode).toBe(409);
    await configureCollection(repo, col.id, {
      mode: "topic",
      topic: "robotic mapping navigation",
      workIds: [],
      timezone: "UTC",
      hour: 8,
      enabled: false,
    });
    expect((await collectionFocus(col.id)).keywords).toEqual(["mapping"]);
  },
);
it.skipIf(!enabled)(
  "removing all keywords pauses discovery and a focus save cannot restart empty keywords",
  async () => {
    const col = await create();
    await edit(col.id, [], 1);
    await configureCollection(repo, col.id, {
      mode: "topic",
      topic: "robotic mapping",
      workIds: [],
      timezone: "UTC",
      hour: 8,
      enabled: true,
    });
    expect(
      (await repo.listCollections()).find((c) => c.id === col.id)?.discovery
        ?.enabled,
    ).toBe(false);
  },
);
it.skipIf(!enabled)(
  "membership reasons are per collection and preserved on duplicate additions",
  async () => {
    const a = await create(),
      b = await create(),
      w = await repo.createWork({ title: "Robotic mapping " + uuid() });
    await repo.addToCollection(a.id, [w.id], {
      kind: "seed",
      text: "Chosen to anchor robotic mapping.",
    });
    await repo.addToCollection(b.id, [w.id]);
    await repo.addToCollection(a.id, [w.id], {
      kind: "manual",
      text: "Later addition",
    });
    expect(
      (await collectionMembers(repo, a.id)).items[0]?.inclusionReason?.text,
    ).toBe("Chosen to anchor robotic mapping.");
    expect(
      (await collectionMembers(repo, b.id)).items[0]?.inclusionReason?.kind,
    ).toBe("manual");
    await pool.query(
      "UPDATE collection_membership SET inclusion_reason=NULL WHERE collection_id=$1",
      [b.id],
    );
    expect(
      (await collectionMembers(repo, b.id)).items[0]?.inclusionReason?.kind,
    ).toBe("legacy");
  },
);
it.skipIf(!enabled)(
  "an in-flight search cannot admit a paper after its keyword revision changes",
  async () => {
    const col = await create(),
      w = await repo.createWork({ title: "Old robotic result " + uuid() });
    await configureCollection(repo, col.id, {
      mode: "topic",
      topic: "robotic mapping",
      workIds: [],
      timezone: "UTC",
      hour: 8,
      enabled: true,
    });
    const snapshot = (
      await pool.query("SELECT discovery FROM collection WHERE id=$1", [col.id])
    ).rows[0].discovery;
    await edit(col.id, ["mapping"], 1);
    await repo.addToCollection(
      col.id,
      [w.id],
      { kind: "automatic", text: "Old result" },
      1,
      JSON.stringify(snapshot),
    );
    expect((await repo.listWorks({ collectionId: col.id })).length).toBe(0);
    const current = await collectionFocus(col.id);
    await repo.addToCollection(
      col.id,
      [w.id],
      { kind: "automatic", text: "Current result" },
      current.version,
      JSON.stringify(snapshot),
    );
    expect((await repo.listWorks({ collectionId: col.id })).length).toBe(1);
    await pool.query(
      "UPDATE collection SET discovery=jsonb_set(discovery,'{enabled}','false') WHERE id=$1",
      [col.id],
    );
  },
);
it.skipIf(!enabled)(
  "automatic discovery uses the edited query and records actual matching evidence",
  async () => {
    const col = await create();
    await edit(col.id, ["mapping"], 1);
    await configureCollection(repo, col.id, {
      mode: "topic",
      topic: "robotic mapping",
      workIds: [],
      timezone: "UTC",
      hour: 8,
      enabled: true,
    });
    const stamp = uuid();
    mock.discover.mockResolvedValue({
      items: [
        {
          title: "Mapping robot environments " + stamp,
          abstract: "Mapping improves navigation.",
          connector: "test",
          externalId: stamp,
          sourcePayload: {},
        },
        {
          title: "Robotic grasping " + stamp,
          connector: "test",
          externalId: stamp + "other",
          sourcePayload: {},
        },
      ],
      warnings: [],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw Error("offline");
      }),
    );
    await runDueCollections(repo);
    const members = await collectionMembers(repo, col.id);
    expect(members.items).toHaveLength(1);
    expect(members.items[0]?.inclusionReason?.matched).toEqual(["mapping"]);
    expect(members.items[0]?.inclusionReason?.query).toBe("mapping");
    expect(members.items[0]?.inclusionReason?.evidence?.[0]?.quote).toContain(
      "Mapping",
    );
    expect(mock.discover.mock.calls.some(([q]) => q === "mapping")).toBe(true);
    await edit(col.id, ["navigation"], 2);
    const old = (await collectionMembers(repo, col.id)).items[0]!;
    expect(old.inclusionReason?.matched).toEqual(["mapping"]);
    expect(old.currentKeywordMatches).toEqual(["navigation"]);
  },
);
