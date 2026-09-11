import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, afterEach, expect, it, vi } from "vitest";
import { v7 as uuid } from "uuid";
import type { FastifyInstance } from "fastify";
import { BoardState } from "@vani/shared";
import { buildApp } from "../app.js";
import { migrate } from "../cli/migrate.js";
import { pool } from "../db.js";
import { Repository } from "../repository.js";
import { ObjectStore } from "../object-store.js";
import { indexDocument } from "../research/documents.js";
import { feedbackFor, feedbackContext } from "./monitor.js";
const enabled = process.env.VANI_INTEGRATION_TEST === "true";
let app: FastifyInstance, w: any, b: any, col: any, p1: string, p2: string;
const repo = new Repository();
async function call(method: any, path: string, payload?: any, status = 200) {
  const r = await app.inject({ method, url: "/api/v1" + path, payload });
  expect(r.statusCode, r.body).toBe(status);
  return r.json();
}
beforeAll(async () => {
  if (!enabled) return;
  await migrate();
  app = await buildApp();
  w = await repo.createWork({
    title: "Planning learning " + uuid(),
    abstract:
      "We introduce demonstration learning. Small samples limit generalization.",
    year: 2024,
  });
  b = await repo.createWork({
    title: "Planning baseline " + uuid(),
    abstract: "Prior demonstrations learn a robotic policy.",
    year: 2020,
  });
  col = await repo.createCollection({ name: "Planning " + uuid() });
  await repo.addToCollection(col.id, [w.id, b.id]);
  await pool.query(
    `INSERT INTO typed_relationship(id,source_work_id,target_work_id,predicate,confidence,verification_status,evidence) VALUES($1,$2,$3,'cites',1,'verified',$4)`,
    [
      uuid(),
      w.id,
      b.id,
      JSON.stringify([
        { origin: "structured_data", exactText: "Source reference fixture" },
      ]),
    ],
  );
  const file = await new ObjectStore().put(
      await readFile(
        new URL("../research/fixtures/reading.pdf", import.meta.url),
      ),
      "application/pdf",
    ),
    attachment = uuid();
  await pool.query(
    "INSERT INTO attachment(id,work_id,object_hash,filename) VALUES($1,$2,$3,$4)",
    [attachment, w.id, file.hash, "reading.pdf"],
  );
  await indexDocument(attachment);
  for (const [id, quote] of [
    [(p1 = uuid()), "Robots learn from demonstrations."],
    [(p2 = uuid()), "Evidence connects robust learning to reliable control."],
  ])
    await pool.query(
      "INSERT INTO annotation(id,attachment_id,annotation_type,page_start,selector) VALUES($1,$2,'highlight',1,$3)",
      [
        id,
        attachment,
        JSON.stringify({
          hash: file.hash,
          page: 1,
          quote,
          rects: [{ x: 0.1, y: 0.1, width: 0.5, height: 0.1 }],
        }),
      ],
    );
});
afterAll(async () => {
  if (enabled) {
    await app.close();
    await pool.end();
  }
});
afterEach(() => vi.unstubAllGlobals());
function state() {
  return BoardState.parse({
    question: "demonstration learning",
    cards: [
      {
        id: uuid(),
        ref: { kind: "work", id: w.id },
        x: 120,
        y: 80,
        pinned: true,
      },
      { id: uuid(), ref: { kind: "work", id: b.id }, x: 460, y: 80 },
    ],
  });
}
it.skipIf(!enabled)(
  "F21 spatial persistence retains pinned coordinates and groups on append with stale-write protection",
  async () => {
    const s = state(),
      group = { id: uuid(), name: "Background", collapsed: true };
    s.groups = [group];
    s.cards[0]!.groupId = group.id;
    const board = await call("POST", "/knowledge/boards", {
      title: "Map",
      state: s,
    });
    const note = await call("POST", "/knowledge/notes", { title: "Card note" });
    s.cards.push({
      id: uuid(),
      ref: { kind: "note", id: note.id },
      x: 20,
      y: 300,
      pinned: false,
      groupId: null,
      explanation: "Intent",
    });
    await call("PATCH", "/knowledge/boards/" + board.id, {
      title: "Map",
      state: s,
      version: 1,
    });
    await call(
      "PATCH",
      "/knowledge/boards/" + board.id,
      { title: "Stale", state: s, version: 1 },
      409,
    );
    const loaded = await call("GET", "/knowledge/boards/" + board.id);
    expect(loaded.state.cards[0].x).toBe(120);
    expect(loaded.state.groups[0].collapsed).toBe(true);
  },
);
it.skipIf(!enabled)(
  "F22 reading suggestions explain indexed background and retain editable order",
  async () => {
    const s = state(),
      suggest = await call("POST", "/knowledge/boards/path-suggestions", s);
    const background = suggest.items.find(
      (p: any) => p.cardId === s.cards[1]!.id,
    );
    expect(background.role).toBe("background");
    expect(background.rationale).toContain("not a proven prerequisite");
    s.path = suggest.items.reverse().map((p: any) => ({
      cardId: p.cardId,
      role: p.role,
      rationale: "My reason: " + p.rationale,
      complete: false,
    }));
    const board = await call("POST", "/knowledge/boards", {
      title: "Reading path",
      state: s,
    });
    expect(
      (await call("GET", "/knowledge/boards/" + board.id)).state.path[0]
        .rationale,
    ).toContain("My reason");
  },
);
it.skipIf(!enabled)(
  "F23 one-hop focus finds local neighbors outside the global map cap and saves view history",
  async () => {
    const r = await call("POST", "/knowledge/boards/neighbors", {
      ref: { kind: "work", id: w.id },
      existing: [w.id],
    });
    expect(r.items.some((x: any) => x.ref.id === b.id)).toBe(true);
    const s = state();
    s.history = [s.filters];
    s.filters = {
      ...s.filters,
      view: "timeline",
      visible: [s.cards[0]!.id],
      yearFrom: 2022,
    };
    const board = await call("POST", "/knowledge/boards", {
      title: "Focus",
      state: s,
    });
    const loaded = await call("GET", "/knowledge/boards/" + board.id);
    expect(loaded.state.filters.visible).toEqual([s.cards[0]!.id]);
    expect(loaded.state.history[0].view).toBe("spatial");
  },
);
it.skipIf(!enabled)(
  "F24 JSON round-trip preserves editable state and SVG is safe and readable",
  async () => {
    const s = state(),
      board = await call("POST", "/knowledge/boards", {
        title: "Map <script>",
        state: s,
      }),
      json = await call(
        "GET",
        `/knowledge/boards/${board.id}/export?format=json`,
      );
    expect(json.edges.length).toBeGreaterThan(0);
    const restored = await call("POST", "/knowledge/boards/import", json);
    expect(restored.id).not.toBe(board.id);
    expect(restored.state).toEqual(s);
    const svg = await app.inject({
      method: "GET",
      url: `/api/v1/knowledge/boards/${board.id}/export?format=svg`,
    });
    expect(svg.statusCode).toBe(200);
    expect(svg.body).toContain("&lt;script&gt;");
    expect(svg.body).toContain("indexed citation");
  },
);
it.skipIf(!enabled)(
  "F25 editable first passes show actual PDF or abstract coverage and history",
  async () => {
    const report = await call("POST", "/knowledge/insights/first-pass", {
      workId: w.id,
    });
    expect(report.coverage[0].includedPages).toBe(2);
    expect(
      report.sections.some(
        (s: any) => s.label === "Limitations" && s.kind === "unavailable",
      ),
    ).toBe(true);
    const abstract = await call("POST", "/knowledge/insights/first-pass", {
      workId: b.id,
    });
    expect(abstract.coverage[0].completeDocument).toBe(false);
    report.sections.push({
      id: uuid(),
      label: "My context",
      kind: "interpretation",
      text: "Read with caution",
      citations: [],
    });
    await call("PATCH", "/knowledge/insights/" + report.id, {
      version: 1,
      title: report.title,
      sections: report.sections,
    });
    const latest = await call("GET", "/knowledge/insights/" + report.id);
    expect(latest.history).toHaveLength(1);
    await call(
      "PATCH",
      "/knowledge/insights/" + report.id,
      { version: 1, title: "Stale", sections: [] },
      409,
    );
  },
);
it.skipIf(!enabled)(
  "F26 grounded scope excludes other papers and rejects fabricated model evidence locally",
  async () => {
    const result = await call("POST", "/knowledge/insights/ask", {
      workIds: [b.id],
      question: "robotic policy",
    });
    expect(result.sources.every((s: any) => s.workId === b.id)).toBe(true);
    expect(result.sections[0].citations.length).toBeGreaterThan(0);
    const absent = await call("POST", "/knowledge/insights/ask", {
      workIds: [b.id],
      question: "quantum astrophotography pastry",
    });
    expect(absent.context.status).toBe("insufficient_evidence");
    const fetch = vi.fn(
      async (input: any) => (
        void input,
        {
          ok: true,
          json: async () => ({
            message: {
              content: JSON.stringify({
                sections: [
                  {
                    id: uuid(),
                    label: "Fake",
                    kind: "synthesis",
                    text: "Invented",
                    citations: [{ sourceId: uuid(), quote: "Invented" }],
                  },
                ],
              }),
            },
          }),
        }
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const model = await call("POST", "/knowledge/insights/ask", {
      workIds: [b.id],
      question: "robotic policy",
      useModel: true,
    });
    expect(model.provider).toBe("extractive-local-fallback");
    expect(String(fetch.mock.calls[0]?.[0])).not.toContain("api.openai.com");
    const source = await call(
      "GET",
      `/knowledge/insights/${result.id}/sources/${result.sources[0].id}`,
    );
    expect(source.source.text).toContain("robotic policy");
  },
);
it.skipIf(!enabled)(
  "F27 human judgment requires rationale and subsequent edits clear confirmation",
  async () => {
    const report = await call("POST", "/knowledge/insights/inspection", {
      passageIds: [p1, p2],
    });
    await call(
      "PATCH",
      "/knowledge/insights/" + report.id,
      {
        version: 1,
        title: report.title,
        sections: report.sections,
        judgment: "incomparable",
        confirm: true,
      },
      400,
    );
    report.sections.find((s: any) => s.label === "Judgment rationale").text =
      "Different conditions prevent comparison.";
    const saved = await call("PATCH", "/knowledge/insights/" + report.id, {
      version: 1,
      title: report.title,
      sections: report.sections,
      judgment: "incomparable",
      confirm: true,
    });
    expect(saved.confirmed).toBe(true);
    const edit = await call("PATCH", "/knowledge/insights/" + report.id, {
      version: 2,
      title: report.title,
      sections: report.sections,
      judgment: "mixed",
    });
    expect(edit.confirmed).toBe(false);
  },
);
it.skipIf(!enabled)(
  "F28 additions retain explicit baseline, topic and argument context without global novelty claims",
  async () => {
    const n = await call("POST", "/knowledge/notes", {
        title: "Generalization topic",
        noteType: "topic",
        markdown: "Demonstration learning needs broader populations.",
      }),
      a = await call("POST", "/arguments", {
        title: "Generalization argument",
        description: "Populations may differ.",
      });
    const report = await call("POST", "/knowledge/insights/addition", {
      workId: w.id,
      baselineIds: [w.id, b.id],
      noteIds: [n.id],
      argumentIds: [a.id],
    });
    expect(report.context.baselineIds).toEqual([b.id]);
    expect(report.context.arguments[0].id).toBe(a.id);
    expect(report.sources.some((s: any) => s.noteId === n.id)).toBe(true);
    expect(
      report.sections.find((s: any) => s.label === "Terms to investigate").text,
    ).toContain("not evidence of field-wide novelty");
  },
);
it.skipIf(!enabled)(
  "F29 feedback suppresses unchanged candidates, resurfaces material changes and supports restore/defer",
  async () => {
    const c = {
        resultId: uuid(),
        title: "Feedback " + uuid(),
        abstract: "Initial evidence",
        year: 2026,
        doi: "10.7777/" + uuid(),
        externalId: "provider-id",
        connector: "openalex",
        sourcePayload: { cited_by_count: 1 },
      },
      run = uuid(),
      input = { query: "topic", seeds: [], collectionId: col.id };
    await pool.query("INSERT INTO discovery_run VALUES($1,$2,$3,$4,now())", [
      run,
      JSON.stringify(input),
      JSON.stringify([c]),
      "{}",
    ]);
    await call("POST", "/knowledge/feedback", {
      runId: run,
      resultId: c.resultId,
      state: "dismissed",
      reason: "Wrong population",
      version: 0,
    });
    const key = feedbackContext("topic", [], col.id);
    expect((await feedbackFor([c], key)).suppressed).toBe(1);
    expect(
      (await feedbackFor([{ ...c, abstract: "Corrected evidence" }], key))
        .items[0].feedback.materialChanged,
    ).toBe(true);
    const f = (await call("GET", "/knowledge/feedback")).items.find(
      (f: any) => f.identity_key === c.doi,
    );
    await call("POST", `/knowledge/feedback/${f.id}/restore`, { version: 1 });
    expect((await feedbackFor([c], key)).items).toHaveLength(1);
    await call("POST", "/knowledge/feedback", {
      runId: run,
      resultId: c.resultId,
      state: "deferred",
      reason: "Read next week",
      version: 2,
      deferUntil: new Date(Date.now() + 86400000).toISOString(),
    });
    expect((await feedbackFor([c], key)).suppressed).toBe(1);
    await pool.query(
      "UPDATE discovery_feedback SET defer_until=now()-interval '1 hour' WHERE id=$1",
      [f.id],
    );
    expect((await feedbackFor([c], key)).items).toHaveLength(1);
  },
);
it.skipIf(!enabled)(
  "F30 digests record new/corrected/retracted/connected events once and support pause/acknowledge",
  async () => {
    expect(
      (await call("POST", `/knowledge/digests/${col.id}/capture`)).baseline,
    ).toBe(true);
    await pool.query("UPDATE work SET title=title||' corrected' WHERE id=$1", [
      w.id,
    ]);
    const n = await repo.createWork({ title: "New monitored " + uuid() });
    await repo.addToCollection(col.id, [n.id]);
    await pool.query(
      "INSERT INTO version_link(id,source_id,target_id,relation,reason,source_url) VALUES($1,$2,$3,'retracts','User-recorded notice','https://example.org/notice')",
      [uuid(), b.id, w.id],
    );
    await call("POST", "/knowledge/edges", {
      source: { kind: "work", id: n.id },
      target: { kind: "work", id: w.id },
      predicate: "compares_against",
      rationale: "New context",
    });
    const result = await call("POST", `/knowledge/digests/${col.id}/capture`);
    expect(result.added).toBe(4);
    expect(
      (await call("POST", `/knowledge/digests/${col.id}/capture`)).added,
    ).toBe(0);
    const digest = await call("GET", "/knowledge/digests/" + col.id);
    expect(new Set(digest.items.map((e: any) => e.kind))).toEqual(
      new Set(["new", "corrected", "retracted", "connected"]),
    );
    await call("POST", `/knowledge/digests/${col.id}/control`, {
      action: "acknowledge",
      ids: digest.items.map((e: any) => e.id),
    });
    expect(
      (await call("GET", "/knowledge/digests/" + col.id)).items.every(
        (e: any) => e.seen_at,
      ),
    ).toBe(true);
    await pool.query("UPDATE collection SET discovery=$2 WHERE id=$1", [
      col.id,
      JSON.stringify({
        mode: "topic",
        topic: "learning",
        enabled: true,
        timezone: "UTC",
        hour: 8,
        workIds: [],
      }),
    ]);
    await call("POST", `/knowledge/digests/${col.id}/control`, {
      action: "pause",
    });
    expect(
      (await call("GET", "/knowledge/digests/" + col.id)).collection.discovery
        .enabled,
    ).toBe(false);
  },
);
it.skipIf(!enabled)(
  "F30 rechecks older indexed works for provider retraction updates without overwriting canonical metadata",
  async () => {
    const { refreshWatchedSources } = await import("./monitor.js");
    const paper = await repo.createWork({
        title: "Older canonical " + uuid(),
        doi: "10.1122/" + uuid(),
        year: 2000,
      }),
      collection = await repo.createCollection({
        name: "Old-source monitor " + uuid(),
      });
    await repo.addToCollection(collection.id, [paper.id]);
    await call("POST", `/knowledge/digests/${collection.id}/capture`);
    const providerId = "https://openalex.org/W" + Date.now();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          id: providerId,
          title: "Provider title correction",
          is_retracted: true,
          publication_year: 2000,
        }),
      })),
    );
    expect((await refreshWatchedSources(collection.id)).checked).toBe(1);
    await call("POST", `/knowledge/digests/${collection.id}/capture`);
    const events = (await call("GET", "/knowledge/digests/" + collection.id))
      .items;
    expect(events.some((e: any) => e.kind === "retracted")).toBe(true);
    expect((await repo.getWork(paper.id))!.title).toBe(paper.title);
    await refreshWatchedSources(collection.id);
    expect(
      (await call("POST", `/knowledge/digests/${collection.id}/capture`)).added,
    ).toBe(0);
  },
);
