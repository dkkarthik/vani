import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { DiscoverySeed } from "@vani/shared";
import { migrate } from "./cli/migrate.js";
import { pool, query } from "./db.js";
import { Repository } from "./repository.js";
import {
  acknowledgeMembers,
  collectionMembers,
  configureCollection,
  runDueCollections,
} from "./collection-discovery.js";

// Opt-in only: point DATABASE_URL at an isolated disposable PostgreSQL database.
const enabled = process.env.VANI_INTEGRATION_TEST === "true";
beforeAll(async () => {
  if (enabled) await migrate();
});
afterAll(async () => {
  vi.unstubAllGlobals();
  if (enabled) await pool.end();
});
it.skipIf(!enabled)(
  "migrates, discovers twice without duplicates, reviews, and tracks per-collection newness",
  async () => {
    const repository = new Repository();
    const collection = await repository.createCollection({
      name: "Integration: active mapping",
    });
    const other = await repository.createCollection({
      name: "Integration: another collection",
    });
    await configureCollection(
      repository,
      collection.id,
      DiscoverySeed.parse({ mode: "topic", topic: "active robotic mapping" }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).includes("api.openalex.org"))
          return {
            ok: true,
            json: async () => ({
              results: [
                {
                  id: "https://openalex.org/test-active-mapping",
                  title: "Active robotic mapping",
                  publication_year: 2026,
                  abstract_inverted_index: {
                    Active: [0],
                    robotic: [1],
                    mapping: [2],
                    uses: [3],
                    uncertainty: [4],
                  },
                  authorships: [],
                },
              ],
            }),
          };
        if (String(url).includes("api.crossref.org"))
          return { ok: true, json: async () => ({ message: { items: [] } }) };
        const body = JSON.parse(String(init?.body));
        const evidence = JSON.parse(body.messages[1].content)[0];
        const result = JSON.stringify({
          category: "Prototype",
          context: "Mapping",
          correctness: "Not verified",
          contributions: "Uses uncertainty",
          clarity: "Concise abstract",
          novelty: "Insufficient comparison evidence",
          comparedWorkIds: [],
          evidence: [
            {
              workId: evidence.id,
              section: "abstract",
              quote: evidence.abstract,
            },
          ],
          coverage: ["title", "abstract"],
          limitations: [],
        });
        return {
          ok: true,
          json: async () => ({
            message: { content: result },
            choices: [{ message: { content: result } }],
          }),
        };
      }),
    );
    await runDueCollections(repository);
    let members = await collectionMembers(repository, collection.id);
    expect(members.items).toHaveLength(1);
    expect(members.items[0]?.isNew).toBe(true);
    expect(members.items[0]?.firstPass?.status).toBe("abstract_only");
    const id = members.items[0]!.id;
    await repository.addToCollection(other.id, [id]);
    await acknowledgeMembers(collection.id, [id]);
    expect(
      (await collectionMembers(repository, collection.id)).items[0]?.isNew,
    ).toBe(false);
    expect(
      (await collectionMembers(repository, other.id)).items[0]?.isNew,
    ).toBe(true);
    await query("UPDATE collection SET next_discovery_at=now() WHERE id=$1", [
      collection.id,
    ]);
    await runDueCollections(repository);
    members = await collectionMembers(repository, collection.id);
    expect(members.items).toHaveLength(1);
    expect(members.items[0]?.isNew).toBe(false);
    const saved = (await repository.listCollections()).find(
      (item) => item.id === collection.id,
    )!;
    expect(saved.lastDiscoveryAt).toBeTruthy();
    expect(saved.nextDiscoveryAt).toBeTruthy();
    expect(saved.discoveryError).toBeNull();
  },
);
