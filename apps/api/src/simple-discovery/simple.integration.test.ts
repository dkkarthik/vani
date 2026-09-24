import { beforeAll, afterAll, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { v7 as uuid } from "uuid";
import { pool } from "../db.js";
import { migrate } from "../cli/migrate.js";
import { Repository } from "../repository.js";
import { Profile } from "./settings.js";
import {
  saveSettings,
  enqueue,
  runSimpleWorker,
  importRetained,
  scheduleSimple,
} from "./service.js";
import { storePaper } from "./corpus.js";
import { registerSimpleDiscovery } from "./routes.js";
const enabled = process.env.VANI_INTEGRATION_TEST === "true";
beforeAll(async () => {
  if (enabled) await migrate();
});
afterAll(async () => {
  vi.unstubAllGlobals();
  if (enabled) await pool.end();
});
async function fixture() {
  await pool.query(
    "UPDATE simple_run SET status='superseded' WHERE status IN ('queued','running')",
  );
  await pool.query("DELETE FROM simple_source_clock");
  const id = uuid(),
    repo = new Repository();
  await pool.query(
    "INSERT INTO collection(id,name) VALUES($1,'Private seed title NEVER SEND')",
    [id],
  );
  const seed = await repo.createWork({
    title: "Adaptive mesh refinement for sparse mapping",
    abstract: "Private seed abstract NEVER SEND",
    accessClass: "user_uploaded",
    deduplicateByTitle: false,
  });
  await pool.query(
    "INSERT INTO collection_membership(collection_id,work_id) VALUES($1,$2)",
    [id, seed.id],
  );
  await saveSettings(
    id,
    0,
    Profile.parse({
      enabled: true,
      publicQueries: ["adaptive mesh refinement"],
      sources: ["openalex", "crossref", "arxiv"],
      arxivCategories: [],
      pagesPerQuery: 1,
    }),
  );
  const app = Fastify();
  await registerSimpleDiscovery(app);
  return { id, seed, app };
}
it.skipIf(!enabled)(
  "publishes metadata despite provider failure, learns feedback, saves without PDFs/models, preserves deep modules",
  async () => {
    const { id, seed, app } = await fixture(),
      seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        const u = String(url);
        seen.push(u);
        if (u.includes("openalex"))
          return new Response("", {
            status: 429,
            headers: { "retry-after": "60" },
          });
        if (u.includes("crossref"))
          return Response.json({
            message: {
              items: [
                {
                  DOI: "10.9999/simple-fixture",
                  title: ["Sparse adaptive mesh representations"],
                  abstract: "Adaptive mesh refinement for spatial maps",
                  published: { "date-parts": [[2026]] },
                  author: [{ family: "Researcher" }],
                  URL: "https://doi.org/10.9999/simple-fixture",
                },
              ],
            },
          });
        if (u.includes("arxiv"))
          return new Response(
            "<feed><entry><id>http://arxiv.org/abs/2601.77777v1</id><title>Adaptive mesh refinement for mapping</title><summary>Sparse maps with adaptive meshes.</summary><published>2026-01-01</published></entry></feed>",
          );
        throw Error("Unexpected network or model call: " + u);
      }),
    );
    const run = await enqueue(id);
    expect((await enqueue(id)).id).toBe(run.id);
    for (let i = 0; i < 12; i++) await runSimpleWorker();
    let view = (
      await app.inject({ url: `/api/v1/collections/${id}/recommendations` })
    ).json();
    expect(view.run.status).toBe("partial");
    expect(view.items.length).toBeGreaterThanOrEqual(2);
    expect(view.model.metadata.algorithm).toBe("tfidf-linear-svm-v1");
    expect(view.run.tasks.find((t: any) => t.source === "openalex").state).toBe(
      "failed",
    );
    expect(seen).toHaveLength(3);
    expect(seen.join()).not.toContain("NEVER");
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM collection_membership WHERE collection_id=$1",
          [id],
        )
      ).rows[0].n,
    ).toBe(1);
    const paper = view.items[0].paper_id;
    const url = `/api/v1/collections/${id}/recommendations/${paper}`;
    expect(
      (
        await app.inject({
          method: "POST",
          url: url + "/feedback",
          payload: { label: "down", reason: "Different method" },
        })
      ).statusCode,
    ).toBe(200);
    for (let i = 0; i < 3; i++) await runSimpleWorker();
    view = (
      await app.inject({
        url: `/api/v1/collections/${id}/recommendations?view=dismissed`,
      })
    ).json();
    expect(view.items.some((r: any) => r.paper_id === paper)).toBe(true);
    expect(view.run.tasks).toEqual([]);
    expect(view.sourceRun.id).toBe(run.id);
    expect(view.sourceRun.status).toBe("partial");
    await app.inject({
      method: "POST",
      url: url + "/feedback",
      payload: { label: "clear" },
    });
    for (let i = 0; i < 3; i++) await runSimpleWorker();
    const saved = await app.inject({
      method: "POST",
      url: url + "/save",
      payload: {},
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().workId).not.toBe(seed.id);
    const again = await app.inject({
      method: "POST",
      url: url + "/save",
      payload: {},
    });
    expect(again.json().workId).toBe(saved.json().workId);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM collection_membership WHERE collection_id=$1",
          [id],
        )
      ).rows[0].n,
    ).toBe(2);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM core_run WHERE collection_id=$1",
          [id],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM paper_enrichment WHERE work_id=$1",
          [saved.json().workId],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(seen).toHaveLength(3);
    await app.close();
    vi.unstubAllGlobals();
  },
);
it.skipIf(!enabled)(
  "protects settings revisions and does not publish superseded jobs",
  async () => {
    const { id, app } = await fixture();
    const run = await enqueue(id, "rerank");
    await saveSettings(id, 1, Profile.parse({ enabled: false }));
    await expect(
      saveSettings(id, 1, Profile.parse({ enabled: true })),
    ).rejects.toThrow("changed");
    await runSimpleWorker();
    expect(
      (await pool.query("SELECT status FROM simple_run WHERE id=$1", [run.id]))
        .rows[0].status,
    ).toBe("superseded");
    expect(
      (
        await pool.query("SELECT 1 FROM simple_model WHERE collection_id=$1", [
          id,
        ])
      ).rowCount,
    ).toBe(0);
    await expect(enqueue(id)).rejects.toThrow("Enable");
    await app.close();
  },
);
it.skipIf(!enabled)(
  "schedules opted-in daily discovery without letting feedback delay the next source refresh",
  async () => {
    const { id, app } = await fixture();
    await saveSettings(id, 1, Profile.parse({ enabled: true, daily: true }));
    await scheduleSimple();
    const run = (
      await pool.query("SELECT * FROM simple_run WHERE collection_id=$1", [id])
    ).rows[0];
    expect(run.status).toBe("queued");
    expect(run.tasks[0].source).toBe("arxiv");
    const before = (
      await pool.query(
        "SELECT next_refresh_at FROM simple_discovery_settings WHERE collection_id=$1",
        [id],
      )
    ).rows[0].next_refresh_at;
    expect(before.getTime()).toBeGreaterThan(Date.now() + 23 * 3600000);
    await scheduleSimple();
    expect((await enqueue(id)).id).toBe(run.id);
    await pool.query("UPDATE simple_run SET status='completed' WHERE id=$1", [
      run.id,
    ]);
    await enqueue(id, "rerank");
    const after = (
      await pool.query(
        "SELECT next_refresh_at FROM simple_discovery_settings WHERE collection_id=$1",
        [id],
      )
    ).rows[0].next_refresh_at;
    expect(after).toEqual(before);
    await saveSettings(id, 2, Profile.parse({ enabled: false }));
    await app.close();
  },
);
it.skipIf(!enabled)(
  "runs a separate local shortlist, retains broad results, and recomputes after feedback",
  async () => {
    const { id, app } = await fixture();
    const method = await storePaper(
      {
        connector: "arxiv",
        externalId: "2601.88888",
        title: "Adaptive mesh refinement sparse mapping",
        abstract:
          "Adaptive mesh refinement graph construction with sparse mapping and occupancy grids.",
      },
      {},
    );
    const unrelated = await storePaper(
      {
        connector: "arxiv",
        externalId: "2601.88889",
        title: "Social robot navigation in human crowds",
        abstract:
          "Predicting human motion with reinforcement learning for robot navigation.",
      },
      {},
    );
    const network = vi.fn(() => {
      throw Error("Second pass must remain local");
    });
    vi.stubGlobal("fetch", network);
    await enqueue(id, "rerank");
    for (let i = 0; i < 3; i++) await runSimpleWorker();
    const base = `/api/v1/collections/${id}/recommendations`;
    const original = (await app.inject({ url: base })).json();
    expect(original.settings.profile.shortlist.enabled).toBe(false);
    const selection = {
      enabled: true,
      limit: 5,
      focus: "adaptive mesh refinement sparse mapping",
      requiredTerms: ["mesh"],
    };
    const started = await app.inject({
      method: "POST",
      url: base + "/refine",
      payload: { version: 1, shortlist: selection },
    });
    expect(started.statusCode).toBe(202);
    expect(
      (await app.inject({ url: base })).json().settings.next_refresh_at,
    ).toBe(original.settings.next_refresh_at);
    const blocked = await app.inject({
      method: "POST",
      url: base + "/refine",
      payload: { version: 2, shortlist: selection },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().message).toContain("Wait");
    for (let i = 0; i < 3; i++) await runSimpleWorker();
    let shortlist = (
      await app.inject({ url: base + "?view=shortlist" })
    ).json();
    const broad = (await app.inject({ url: base })).json();
    const filtered = (
      await app.inject({ url: base + "?view=filtered" })
    ).json();
    expect(broad.total).toBe(original.total);
    expect(shortlist.shortlistReady).toBe(true);
    expect(shortlist.items.some((x: any) => x.paper_id === method)).toBe(true);
    expect(shortlist.total + filtered.total).toBe(broad.total);
    expect(
      filtered.items.find((x: any) => x.paper_id === unrelated)?.explanation
        .sanity.reason,
    ).toBe("context_mismatch");
    const down = await app.inject({
      method: "POST",
      url: base + `/${method}/feedback`,
      payload: { label: "down", reason: "Different assumptions" },
    });
    expect(down.statusCode).toBe(200);
    expect(
      (await app.inject({ url: base + "?view=shortlist" })).json()
        .shortlistReady,
    ).toBe(false);
    for (let i = 0; i < 3; i++) await runSimpleWorker();
    shortlist = (await app.inject({ url: base + "?view=shortlist" })).json();
    expect(shortlist.items.some((x: any) => x.paper_id === method)).toBe(false);
    expect(shortlist.model.metadata.shortlist.negative).toBe(1);
    expect(network).not.toHaveBeenCalled();
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM core_run WHERE collection_id=$1",
          [id],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM collection_membership WHERE collection_id=$1",
          [id],
        )
      ).rows[0].n,
    ).toBe(1);
    vi.unstubAllGlobals();
    await app.close();
  },
);
it.skipIf(!enabled)(
  "deduplicates public records across providers and never imports private papers",
  async () => {
    const { id, app } = await fixture();
    const p = {
      title: "Stable distinct long paper title for deduplication",
      doi: "10.9999/duplicate",
      year: 2026,
      connector: "crossref",
      externalId: "10.9999/duplicate",
    };
    const a = await storePaper(p, { query: "mesh" }),
      b = await storePaper(
        {
          ...p,
          connector: "openalex",
          externalId: "https://openalex.org/W123",
          abstract: "Richer abstract",
        },
        { query: "grid" },
      );
    expect(a).toBe(b);
    expect(await storePaper({ ...p, accessClass: "private" }, {})).toBeNull();
    expect(
      (
        await pool.query("SELECT sources,paper FROM simple_paper WHERE id=$1", [
          a,
        ])
      ).rows[0].sources,
    ).toHaveLength(2);
    const legacyRun = uuid();
    await pool.query(
      "INSERT INTO core_run(id,collection_id,focus_version,snapshot,status) VALUES($1,$2,1,'{}','completed')",
      [legacyRun, id],
    );
    await pool.query(
      "INSERT INTO core_candidate(id,collection_id,identity,paper,source_hash,focus_version,run_id) VALUES($1,$2,$3,$4,$5,1,$6)",
      [
        uuid(),
        id,
        "private",
        JSON.stringify({ ...p, accessClass: "user_uploaded" }),
        "test",
        legacyRun,
      ],
    );
    expect(await importRetained(id)).toEqual({ imported: 0 });
    await app.close();
  },
);

it.skipIf(!enabled)(
  "sorts the whole shortlist by metadata before pagination, with stable ties and missing scores last",
  async () => {
    const { id, app } = await fixture();
    await saveSettings(
      id,
      1,
      Profile.parse({ enabled: true, shortlist: { enabled: true } }),
    );
    const run = uuid();
    await pool.query(
      "INSERT INTO simple_run(id,collection_id,settings_version,snapshot,status) VALUES($1,$2,2,'{}','complete')",
      [run, id],
    );
    await pool.query(
      "INSERT INTO simple_model(collection_id,run_id,metadata,model) VALUES($1,$2,$3,'{}')",
      [
        id,
        run,
        JSON.stringify({
          settingsVersion: 2,
          labelVersion: 0,
          shortlist: { status: "ready" },
        }),
      ],
    );
    const rows: Array<{ paper_id: string; score: number | null }> = [];
    for (let i = 0; i < 30; i++) {
      const paper = uuid(),
        score = i === 28 ? null : Math.floor(i / 2) - 7;
      await pool.query("INSERT INTO simple_paper(id,paper) VALUES($1,$2)", [
        paper,
        JSON.stringify({ title: `Sort fixture ${i}` }),
      ]);
      await pool.query(
        "INSERT INTO simple_recommendation(collection_id,paper_id,run_id,score,explanation) VALUES($1,$2,$3,$4,$5)",
        [
          id,
          paper,
          run,
          score,
          JSON.stringify({ sanity: { selected: i < 29, score: -i } }),
        ],
      );
      if (i < 29) rows.push({ paper_id: paper, score });
    }
    const base = `/api/v1/collections/${id}/recommendations?view=shortlist`;
    for (const sort of ["metadata_desc", "metadata_asc"]) {
      const first = (await app.inject(base + `&sort=${sort}`)).json();
      const second = (
        await app.inject(base + `&sort=${sort}&offset=25`)
      ).json();
      const expected = [...rows].sort((a, b) =>
        a.score == null
          ? 1
          : b.score == null
            ? -1
            : (sort === "metadata_asc"
                ? a.score - b.score
                : b.score - a.score) || a.paper_id.localeCompare(b.paper_id),
      );
      expect(first.total).toBe(29);
      expect(first.items).toHaveLength(25);
      expect(second.items).toHaveLength(4);
      expect([...first.items, ...second.items].map((r) => r.paper_id)).toEqual(
        expected.map((r) => r.paper_id),
      );
      expect(second.items.at(-1).score).toBeNull();
    }
    const original = (await app.inject(base)).json();
    expect(original.items[0].paper_id).toBe(rows[0]!.paper_id);
    expect(
      (await app.inject(base + "&sort=invalid")).statusCode,
    ).toBeGreaterThanOrEqual(400);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM simple_run WHERE collection_id=$1",
          [id],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM simple_feedback WHERE collection_id=$1",
          [id],
        )
      ).rows[0].n,
    ).toBe(0);
    await app.close();
  },
);
