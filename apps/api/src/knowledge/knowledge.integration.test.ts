import { readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { v7 as uuid } from "uuid";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { migrate } from "../cli/migrate.js";
import { pool } from "../db.js";
import { Repository } from "../repository.js";
import { ObjectStore } from "../object-store.js";
import { corpus, embeddingKey } from "../research/search.js";
const enabled = process.env.VANI_INTEGRATION_TEST === "true";
let app: FastifyInstance,
  work: any,
  other: any,
  passageId: string,
  collection: any;
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
  work = await repo.createWork({
    title: "Connected research " + uuid(),
    abstract:
      "We use Atlas Method to learn. We compare against Atlas Method. Results improve reliability.",
    authors: [{ given: "Ana", family: "Smith" }],
  });
  other = await repo.createWork({
    title: "Comparison research " + uuid(),
    abstract: "A different population.",
  });
  collection = await repo.createCollection({
    name: "Connected project " + uuid(),
  });
  await repo.addToCollection(collection.id, [work.id, other.id]);
  const bytes = await readFile(
      new URL("../research/fixtures/reading.pdf", import.meta.url),
    ),
    object = await new ObjectStore().put(bytes, "application/pdf"),
    attachment = uuid();
  await pool.query(
    "INSERT INTO attachment(id,work_id,object_hash,filename) VALUES($1,$2,$3,$4)",
    [attachment, work.id, object.hash, "reading.pdf"],
  );
  passageId = uuid();
  await pool.query(
    "INSERT INTO annotation(id,attachment_id,annotation_type,page_start,selector) VALUES($1,$2,'highlight',1,$3)",
    [
      passageId,
      attachment,
      JSON.stringify({
        hash: object.hash,
        page: 1,
        quote: "Robots learn from demonstrations.",
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
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it.skipIf(!enabled)(
  "F11 rich note content and immutable source references persist; stale edits do not overwrite",
  async () => {
    const note = await call("POST", "/knowledge/notes", {
      title: "Figure notes",
      markdown: "My interpretation: $x^2$",
      workId: work.id,
    });
    await call("PUT", `/knowledge/notes/${note.id}/references/${passageId}`, {
      kind: "figure",
      label: "Figure 1",
    });
    await call("PATCH", `/knowledge/notes/${note.id}`, {
      title: "Edited figure note",
      markdown: "Meaning changes",
      workId: work.id,
      version: 1,
    });
    await call(
      "PATCH",
      `/knowledge/notes/${note.id}`,
      { title: "Stale", version: 1 },
      409,
    );
    const loaded = await call("GET", `/knowledge/notes/${note.id}`);
    expect(loaded.markdown).toBe("Meaning changes");
    expect(loaded.references[0].passage.quote).toBe(
      "Robots learn from demonstrations.",
    );
    expect(loaded.references[0].kind).toBe("figure");
  },
);
it.skipIf(!enabled)(
  "F12 project questions, queue and legacy status controls share concurrency revisions",
  async () => {
    const second = await repo.createCollection({
      name: "Second context " + uuid(),
    });
    await repo.addToCollection(second.id, [work.id]);
    const d = {
      version: 1,
      question: "Does it generalize?",
      rationale: "Saved for methods",
      priority: 5,
      status: "reading",
      queued: true,
      ordinal: 3,
    };
    await call("PATCH", `/knowledge/reading/${collection.id}/${work.id}`, d);
    const first = await call(
        "GET",
        "/knowledge/reading?collectionId=" + collection.id,
      ),
      otherProject = await call(
        "GET",
        "/knowledge/reading?collectionId=" + second.id,
      );
    expect(first.items.find((w: any) => w.work_id === work.id).question).toBe(
      d.question,
    );
    expect(otherProject.items[0].question).toBe("");
    await call("PUT", "/organization/memberships", {
      collectionId: collection.id,
      workIds: [work.id],
      status: "read",
      priority: 5,
      rationale: d.rationale,
    });
    await call(
      "PATCH",
      `/knowledge/reading/${collection.id}/${work.id}`,
      { ...d, version: 2 },
      409,
    );
    const saved = await call("POST", "/organization/collections", {
      name: "Smart",
      collectionType: "saved_search",
      rule: { text: "research" },
    });
    await call(
      "GET",
      "/knowledge/reading?collectionId=" + saved.id,
      undefined,
      409,
    );
  },
);
it.skipIf(!enabled)(
  "F13 note types and backlinks reuse current source content",
  async () => {
    const source = await call("POST", "/knowledge/notes", {
        title: "Source context",
        noteType: "source",
        workId: work.id,
      }),
      topic = await call("POST", "/knowledge/notes", {
        title: "Topic understanding",
        noteType: "topic",
      }),
      argument = await call("POST", "/arguments", { title: "Argument" });
    const synthesis = await call("POST", "/knowledge/notes", {
      title: "Synthesis",
      noteType: "argument",
      argumentId: argument.id,
    });
    await call("PUT", `/knowledge/notes/${topic.id}/links/${source.id}`, {
      rationale: "Background",
    });
    await call("PUT", `/knowledge/notes/${synthesis.id}/links/${source.id}`, {
      rationale: "Evidence",
    });
    const back = await call("GET", "/knowledge/notes/" + source.id);
    expect(back.links).toHaveLength(2);
    await call("PATCH", "/knowledge/notes/" + source.id, {
      title: "Revised source",
      noteType: "source",
      version: 1,
    });
    expect(
      (await call("GET", "/knowledge/notes/" + topic.id)).links[0].note.label,
    ).toBe("Revised source");
    await call(
      "PUT",
      `/knowledge/notes/${source.id}/links/${source.id}`,
      {},
      400,
    );
  },
);
it.skipIf(!enabled)(
  "F14 typed endpoints validate references and revision-checked edits preserve user origin",
  async () => {
    const n = await call("POST", "/knowledge/notes", {
        title: "Interpretation",
      }),
      d = {
        source: { kind: "passage", id: passageId },
        target: { kind: "note", id: n.id },
        predicate: "supports",
        rationale: "Direct evidence",
        passageIds: [passageId],
      },
      e = await call("POST", "/knowledge/edges", d);
    await call("PATCH", "/knowledge/edges/" + e.id, {
      ...d,
      rationale: "Qualified evidence",
      version: 1,
    });
    await call("PATCH", "/knowledge/edges/" + e.id, { ...d, version: 1 }, 409);
    const edge = (await call("GET", "/knowledge/edges")).items.find(
      (x: any) => x.id === e.id,
    );
    expect(edge.origin).toBe("user");
    expect(edge.source.url).toBe("/passages/" + passageId);
    await call(
      "POST",
      "/knowledge/edges",
      { ...d, target: { kind: "note", id: uuid() } },
      404,
    );
    await call("DELETE", "/knowledge/edges/" + e.id, { version: 1 }, 409);
    await call("DELETE", "/knowledge/edges/" + e.id, { version: 2 });
  },
);
it.skipIf(!enabled)(
  "F15 merge aliases retains endpoints and split moves only selected connections with audit",
  async () => {
    const a = await call("POST", "/knowledge/entities", {
        name: "Atlas Method",
        entityType: "method",
        aliases: ["AM"],
      }),
      b = await call("POST", "/knowledge/entities", {
        name: "Atlas learning",
        entityType: "method",
        aliases: ["Atlas"],
      }),
      c = await call("POST", "/knowledge/entities", {
        name: "Atlas data",
        entityType: "dataset",
        aliases: [],
      });
    const edge = await call("POST", "/knowledge/edges", {
      source: { kind: "work", id: work.id },
      target: { kind: "entity", id: a.id },
      predicate: "uses_method",
      rationale: "User method identification",
    });
    await call(
      "POST",
      "/knowledge/entities/merge-preview",
      { sourceId: a.id, targetId: c.id },
      409,
    );
    const preview = await call("POST", "/knowledge/entities/merge-preview", {
      sourceId: a.id,
      targetId: b.id,
    });
    await call("POST", "/knowledge/entities/merge", {
      sourceId: a.id,
      targetId: b.id,
      previewHash: preview.previewHash,
    });
    expect(
      (await call("GET", "/knowledge/edges")).items.find(
        (e: any) => e.id === edge.id,
      ).target.id,
    ).toBe(b.id);
    const d = {
        entityId: b.id,
        name: "Different Atlas",
        aliases: ["AM"],
        edgeIds: [edge.id],
      },
      split = await call("POST", "/knowledge/entities/split-preview", d);
    const result = await call("POST", "/knowledge/entities/split", {
      ...d,
      previewHash: split.previewHash,
    });
    expect(
      (await call("GET", "/knowledge/edges")).items.find(
        (e: any) => e.id === edge.id,
      ).target.id,
    ).toBe(result.id);
    await call(
      "POST",
      "/knowledge/entities/split",
      { ...d, previewHash: split.previewHash },
      400,
    );
    const entities = await call("GET", "/knowledge/entities");
    expect(
      entities.items.find((e: any) => e.id === b.id).aliases,
    ).not.toContain("AM");
    expect(entities.audit.some((a: any) => a.action === "split")).toBe(true);
  },
);
it.skipIf(!enabled)(
  "F16 suggestions expose source cues and accept/reject are idempotent",
  async () => {
    await call("POST", "/knowledge/entities", {
      name: "Atlas Method",
      entityType: "method",
      aliases: [],
    });
    await call("POST", "/knowledge/suggestions/generate", {
      workIds: [work.id],
    });
    const candidates = (
      await call("GET", "/knowledge/suggestions")
    ).items.filter(
      (s: any) => s.source.id === work.id && s.state === "pending",
    );
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    const a = candidates[0],
      b = candidates[1];
    expect(a.evidence.kind).toBe("abstract");
    expect(a.evidence.quote).toContain("Atlas Method");
    const accepted = await call(
      "POST",
      `/knowledge/suggestions/${a.id}/review`,
      { decision: "accepted" },
    );
    await call("POST", `/knowledge/suggestions/${a.id}/review`, {
      decision: "accepted",
    });
    await call("POST", `/knowledge/suggestions/${b.id}/review`, {
      decision: "rejected",
    });
    await call("POST", "/knowledge/suggestions/generate", {
      workIds: [work.id],
    });
    const after = (await call("GET", "/knowledge/suggestions")).items;
    expect(after.find((s: any) => s.id === b.id).state).toBe("rejected");
    expect(
      (await call("GET", "/knowledge/edges")).items.find(
        (e: any) => e.id === accepted.edgeId,
      ).origin,
    ).toBe("suggested_reviewed");
  },
);
it.skipIf(!enabled)(
  "F17 outline reordering retains passage IDs, exports citations and rejects stale saves",
  async () => {
    const ar = await call("POST", "/arguments", { title: "Reliable learning" }),
      claim = {
        id: uuid(),
        kind: "claim",
        text: "Robots can learn",
        passageIds: [passageId],
        noteIds: [],
      },
      caveat = {
        id: uuid(),
        kind: "caveat",
        text: "Limited sample",
        passageIds: [],
        noteIds: [],
      };
    await call("PATCH", "/knowledge/arguments/" + ar.id, {
      version: 1,
      title: "Reliable learning",
      description: "Qualified synthesis",
      outline: [claim, caveat],
    });
    await call("PATCH", "/knowledge/arguments/" + ar.id, {
      version: 2,
      title: "Reliable learning",
      description: "Qualified synthesis",
      outline: [caveat, claim],
    });
    await call(
      "PATCH",
      "/knowledge/arguments/" + ar.id,
      { version: 2, title: "Stale", description: "", outline: [] },
      409,
    );
    const loaded = await call("GET", "/knowledge/arguments/" + ar.id);
    expect(loaded.outline[1].passageIds).toEqual([passageId]);
    const exported = await call(
      "GET",
      "/knowledge/arguments/" + ar.id + "/export",
    );
    expect(exported.markdown).toContain("/passages/" + passageId);
    expect(exported.markdown).toContain(work.citationKey);
  },
);
it.skipIf(!enabled)(
  "F18 sourced cells retain corrections and reject unsupported or cross-paper evidence",
  async () => {
    const c = await call("POST", "/knowledge/comparisons", {
      title: "Methods comparison",
      workIds: [work.id, other.id],
    });
    const d = {
      workId: work.id,
      column: "method",
      text: "Learning from demonstrations",
      source: { kind: "passage", passageId },
      version: 0,
    };
    await call("PUT", `/knowledge/comparisons/${c.id}/cells`, d);
    await call("PUT", `/knowledge/comparisons/${c.id}/cells`, {
      ...d,
      text: "Demonstration learning with caveats",
      version: 1,
    });
    await call(
      "PUT",
      `/knowledge/comparisons/${c.id}/cells`,
      { ...d, workId: other.id },
      400,
    );
    await call(
      "PUT",
      `/knowledge/comparisons/${c.id}/cells`,
      {
        ...d,
        column: "results",
        source: { kind: "abstract", quote: "A fabricated result" },
      },
      400,
    );
    await call("PUT", `/knowledge/comparisons/${c.id}/cells`, {
      ...d,
      column: "results",
      source: { kind: "abstract", quote: "Results improve reliability." },
    });
    const data = await call("GET", "/knowledge/comparisons/" + c.id);
    expect(
      data.cells.find((c: any) => c.column_name === "method").history,
    ).toHaveLength(1);
    const output = await call(
      "GET",
      "/knowledge/comparisons/" + c.id + "/export",
    );
    expect(output.markdown).toContain("Unrecorded");
    expect(output.markdown).toContain("/passages/" + passageId);
  },
);
it.skipIf(!enabled)(
  "F19 expands multiple seed directions, reports partial outages and imports only sourced citation facts",
  async () => {
    const raw = (id: string, refs: string[] = []) => ({
      id: "https://openalex.org/" + id,
      title: "Seed " + id,
      doi: "https://doi.org/10.9876/" + id,
      referenced_works: refs.map((x) => "https://openalex.org/" + x),
      authorships: [],
      publication_year: 2025,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: any) => {
        const u = new URL(String(input));
        if (u.hostname === "api.crossref.org")
          throw new Error("Crossref offline");
        if (u.searchParams.has("search"))
          return new Response(
            JSON.stringify({ results: [raw("W7701", ["W7702"])] }),
          );
        if (u.searchParams.get("filter")?.startsWith("cites:"))
          return new Response(
            JSON.stringify({ results: [raw("W7703", ["W7701"])] }),
          );
        if (u.searchParams.has("filter"))
          return new Response(JSON.stringify({ results: [raw("W7702")] }));
        return new Response(
          JSON.stringify(
            raw(u.pathname.endsWith("W7702") ? "W7702" : "W7701", ["W7702"]),
          ),
        );
      }),
    );
    const run = await call("POST", "/knowledge/discovery", {
      query: "learning",
      seeds: ["W7701", "10.9876/W7702"],
      direction: "both",
      excludeTerms: ["Seed W7703"],
      excludeIds: ["10.9876/unrelated"],
    });
    expect(run.coverage.some((c: any) => c.state === "failed")).toBe(true);
    expect(run.items.some((i: any) => i.externalId.endsWith("W7703"))).toBe(
      false,
    );
    expect(
      run.items.some((i: any) =>
        i.paths.some((p: any) => p.kind === "reference"),
      ),
    ).toBe(true);
    const imported = await call(
      "POST",
      `/knowledge/discovery/${run.id}/import`,
      {
        resultIds: run.items.map((i: any) => i.resultId),
        collectionId: collection.id,
      },
    );
    const twice = await call("POST", `/knowledge/discovery/${run.id}/import`, {
      resultIds: run.items.map((i: any) => i.resultId),
    });
    expect(twice.items.map((i: any) => i.work.id)).toEqual(
      imported.items.map((i: any) => i.work.id),
    );
    const graph = await call("POST", "/knowledge/layers", {
      collectionId: collection.id,
    });
    expect(
      graph.edges.some(
        (e: any) =>
          e.layer === "citation" &&
          e.evidence.referencedId === "https://openalex.org/W7702",
      ),
    ).toBe(true);
  },
);
it.skipIf(!enabled)(
  "F20 reproducible bibliographic/semantic layers keep citations and personal edges distinct",
  async () => {
    const suffix = Date.now(),
      a = await repo.createWork({
        title: "Layer A " + suffix,
        connector: "openalex",
        externalId: "https://openalex.org/W" + suffix,
        sourcePayload: { referenced_works: ["R1", "R2"] },
      }),
      b = await repo.createWork({
        title: "Layer B " + suffix,
        connector: "openalex",
        externalId: "https://openalex.org/W" + (suffix + 1),
        sourcePayload: { referenced_works: ["R2", "R3"] },
      });
    const c = await repo.createCollection({ name: "Layer scope " + suffix });
    await repo.addToCollection(c.id, [a.id, b.id]);
    await call("POST", "/knowledge/edges", {
      source: { kind: "work", id: a.id },
      target: { kind: "work", id: b.id },
      predicate: "read_before",
      rationale: "Background first",
    });
    vi.stubEnv("VANI_EMBED_MODEL", "fixture-vectors");
    const chunks = (await corpus(undefined, c.id)).chunks.filter(
      (c) => c.kind === "metadata" && c.id.endsWith(":0"),
    );
    for (const chunk of chunks)
      await pool.query(
        "INSERT INTO semantic_chunk(cache_key,model,embedding) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [embeddingKey(chunk.text), "fixture-vectors", "[1,0]"],
      );
    const result = await call("POST", "/knowledge/layers", {
      collectionId: c.id,
    });
    expect(
      result.edges.find((e: any) => e.layer === "bibliographic").score,
    ).toBeCloseTo(1 / 3);
    expect(
      result.edges.find((e: any) => e.layer === "semantic").score,
    ).toBeCloseTo(1);
    expect(result.edges.find((e: any) => e.layer === "personal").origin).toBe(
      "user",
    );
    expect(result.edges.some((e: any) => e.layer === "citation")).toBe(false);
  },
);
it.skipIf(!enabled)(
  "concurrent imports allocate unique stable keys and deduplicate the same DOI",
  async () => {
    const stamp = uuid();
    const works = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        repo.createWork({
          title: `Concurrent ${stamp} ${i}`,
          year: 2026,
          authors: [{ family: "Concurrent" }],
        }),
      ),
    );
    expect(new Set(works.map((w) => w.citationKey)).size).toBe(6);
    const doi = "10.9998/" + stamp;
    const same = await Promise.all(
      Array.from({ length: 3 }, () =>
        repo.createWork({ title: "Same DOI " + stamp, doi, year: 2026 }),
      ),
    );
    expect(new Set(same.map((w) => w.id)).size).toBe(1);
  },
);
it.skipIf(!enabled)(
  "entity merges retire collapsed self-links and invalidate stale previews",
  async () => {
    const a = await call("POST", "/knowledge/entities", {
        name: "Merge A",
        entityType: "concept",
        aliases: [],
      }),
      b = await call("POST", "/knowledge/entities", {
        name: "Merge B",
        entityType: "concept",
        aliases: [],
      });
    const d = { sourceId: a.id, targetId: b.id },
      old = await call("POST", "/knowledge/entities/merge-preview", d);
    const edge = await call("POST", "/knowledge/edges", {
      source: { kind: "entity", id: a.id },
      target: { kind: "entity", id: b.id },
      predicate: "relates_to",
      rationale: "Potential aliases",
    });
    await call(
      "POST",
      "/knowledge/entities/merge",
      { ...d, previewHash: old.previewHash },
      409,
    );
    const preview = await call("POST", "/knowledge/entities/merge-preview", d);
    expect(preview.collapsedEdgeIds).toEqual([edge.id]);
    await call("POST", "/knowledge/entities/merge", {
      ...d,
      previewHash: preview.previewHash,
    });
    expect(
      (await call("GET", "/knowledge/edges")).items.some(
        (e: any) => e.id === edge.id,
      ),
    ).toBe(false);
  },
);
