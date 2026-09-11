import { beforeEach, describe, expect, it, vi } from "vitest";
import { DiscoverySeed, Work } from "@vani/shared";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  clientQuery: vi.fn(),
  release: vi.fn(),
  discover: vi.fn(),
  synthesize: vi.fn(),
  firstPass: vi.fn(),
}));
vi.mock("./db.js", () => ({
  query: mocks.query,
  pool: {
    connect: async () => ({ query: mocks.clientQuery, release: mocks.release }),
  },
  transaction: async (fn: any) => fn({ query: mocks.query }),
}));
vi.mock("./planning/monitor.js",()=>({captureDigest:vi.fn(async()=>({added:0})),feedbackFor:vi.fn(async(items:any[])=>({items})),retainCandidateSource:vi.fn(async()=>{}),refreshWatchedSources:vi.fn(async()=>({warnings:[]}))}));
vi.mock("./connectors.js", () => ({ discoverCollection: mocks.discover }));
vi.mock("./first-pass.js", () => ({
  synthesize: mocks.synthesize,
  firstPass: mocks.firstPass,
}));
import {
  acknowledgeMembers,
  collectionMembers,
  configureCollection,
  nextMorning,
  relevance,
  runDueCollections,
} from "./collection-discovery.js";
import { Repository } from "./repository.js";

const work = Work.parse({
  id: "01991b76-55e1-7000-8000-000000000001",
  title: "Active robotic mapping",
  year: 2026,
  doi: null,
  citationKey: "a-26",
  authors: [],
  verificationStatus: "partial",
  createdAt: "2026-09-01",
  updatedAt: "2026-09-01",
});
const seed = DiscoverySeed.parse({
  mode: "topic",
  topic: "active robotic mapping",
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.query.mockResolvedValue({ rows: [] });
  mocks.clientQuery.mockResolvedValue({ rows: [] });
});
describe("morning schedules", () => {
  it("uses the next local morning", () =>
    expect(
      nextMorning(
        new Date("2026-09-04T10:59:59Z"),
        "America/New_York",
        7,
      ).toISOString(),
    ).toBe("2026-09-04T11:00:00.000Z"));
  it("handles spring DST", () =>
    expect(
      nextMorning(
        new Date("2026-03-07T12:00:00Z"),
        "America/New_York",
        7,
      ).toISOString(),
    ).toBe("2026-03-08T11:00:00.000Z"));
  it("handles autumn DST", () =>
    expect(
      nextMorning(
        new Date("2026-10-31T11:00:00Z"),
        "America/New_York",
        7,
      ).toISOString(),
    ).toBe("2026-11-01T12:00:00.000Z"));
  it("handles half-hour offsets", () =>
    expect(
      nextMorning(
        new Date("2026-09-04T00:00:00Z"),
        "Asia/Kolkata",
        7,
      ).toISOString(),
    ).toBe("2026-09-04T01:30:00.000Z"));
  it("validates seeds and timezones", () => {
    expect(
      DiscoverySeed.safeParse({ mode: "papers", workIds: [] }).success,
    ).toBe(false);
    expect(DiscoverySeed.safeParse({ ...seed, timezone: "bad" }).success).toBe(
      false,
    );
  });
});
describe("living collections", () => {
  it("synthesizes a focused topic and preserves seed identities", async () => {
    const repository = {
      listCollections: async () => [{ id: "c" }],
      getWork: async () => work,
    } as unknown as Repository;
    mocks.synthesize.mockResolvedValue({
      value: { topic: "Active mapping under uncertainty" },
      provider: "local",
    });
    const result = await configureCollection(repository, "c", {
      ...seed,
      mode: "papers",
      topic: "",
      workIds: [work.id],
    });
    expect(result.topic).toBe("Active mapping under uncertainty");
    expect(result.workIds).toEqual([work.id]);
    expect(
      mocks.query.mock.calls.some((call) =>
        call[0].includes("INSERT INTO collection_membership"),
      ),
    ).toBe(true);
  });
  it("does not silently guess a topic when synthesis fails", async () => {
    mocks.synthesize.mockRejectedValue(new Error("offline"));
    await expect(
      configureCollection(
        {
          listCollections: async () => [{ id: "c" }],
          getWork: async () => work,
        } as unknown as Repository,
        "c",
        { ...seed, mode: "papers", topic: "", workIds: [work.id] },
      ),
    ).rejects.toMatchObject({ statusCode: 422 });
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("acknowledges exact rendered memberships only", async () => {
    await acknowledgeMembers("c", [work.id]);
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("work_id=ANY"),
      ["c", [work.id]],
    );
  });
  it("returns collection-specific new status without clearing it on GET", async () => {
    mocks.query.mockResolvedValue({
      rows: [{ work_id: work.id, seen_at: null, status: "reading" }],
    });
    const result = await collectionMembers(
      { listWorks: async () => [work] } as unknown as Repository,
      "c",
    );
    expect(result.items[0]).toMatchObject({ isNew: true, status: "reading" });
    expect(
      mocks.query.mock.calls.every((call) => call[0].startsWith("SELECT")),
    ).toBe(true);
  });
  it("does not search when another worker owns the lock", async () => {
    mocks.clientQuery.mockResolvedValue({ rows: [{ locked: false }] });
    await runDueCollections(new Repository());
    expect(mocks.discover).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalled();
  });
  it("records source failures and schedules a retry rather than reporting success", async () => {
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [{ locked: true }] })
      .mockResolvedValueOnce({ rows: [{ id: "c", discovery: seed }] });
    mocks.discover.mockRejectedValue(new Error("Sources unavailable"));
    await runDueCollections(new Repository());
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("interval '1 hour'"),
      expect.arrayContaining(["c", "Error: Sources unavailable"]),
    );
    expect(
      mocks.query.mock.calls.some((call) =>
        call[0].includes("last_discovery_at=now()"),
      ),
    ).toBe(false);
  });
  it("filters unrelated results", () => {
    expect(
      relevance(
        "robotic active mapping",
        "Mapping with active robotic sensing",
      ),
    ).toBe(1);
    expect(relevance("robotic active mapping", "Clinical oncology")).toBe(0);
  });
});
