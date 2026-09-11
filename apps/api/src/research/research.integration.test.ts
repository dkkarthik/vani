import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it, vi, afterEach } from "vitest";
import { v7 as uuid } from "uuid";
import type { FastifyInstance } from "fastify";
import { MetadataFields } from "@vani/shared";
import { buildApp } from "../app.js";
import { migrate } from "../cli/migrate.js";
import { pool } from "../db.js";
import { Repository } from "../repository.js";
import { ObjectStore } from "../object-store.js";
import { CleanupRepository } from "./cleanup.js";
import { mergePreview, mergeWorks } from "./identity.js";
import { indexDocument, passage } from "./documents.js";
const enabled = process.env.VANI_INTEGRATION_TEST === "true";
let app: FastifyInstance;
const repo = new Repository();
beforeAll(async () => {
  if (enabled) {
    await migrate();
    app = await buildApp();
  }
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
async function call(method: any, url: string, payload?: any, expected = 200) {
  const r = await app.inject({ method, url, payload });
  expect(r.statusCode, r.body).toBe(expected);
  return r.json();
}
async function pdf(workId: string) {
  const bytes = await readFile(
    new URL("./fixtures/reading.pdf", import.meta.url),
  );
  const object = await new ObjectStore().put(bytes, "application/pdf"),
    id = uuid();
  await pool.query(
    "INSERT INTO attachment(id,work_id,object_hash,filename) VALUES($1,$2,$3,$4)",
    [id, workId, object.hash, "reading.pdf"],
  );
  await indexDocument(id);
  return { id, hash: object.hash, bytes, path: object.path };
}
async function annotate(
  file: { id: string; hash: string },
  quote = "Robots learn from demonstrations.",
) {
  return call("POST", `/api/v1/attachments/${file.id}/annotations`, {
    type: "highlight",
    body: "Learning evidence",
    tags: ["Robotics"],
    selector: {
      hash: file.hash,
      page: 1,
      quote,
      rects: [{ x: 0.1, y: 0.08, width: 0.55, height: 0.04 }],
    },
  });
}
it.skipIf(!enabled)(
  "F05 nested and live saved collections preserve independent project state",
  async () => {
    const a = await call("POST", "/api/v1/organization/collections", {
      name: "Parent " + uuid(),
    });
    const b = await call("POST", "/api/v1/organization/collections", {
      name: "Child " + uuid(),
      parentId: a.id,
    });
    await call(
      "PATCH",
      `/api/v1/organization/collections/${a.id}`,
      { name: "Cycle", parentId: b.id, revision: 1 },
      409,
    );
    const w = await repo.createWork({
      title: "Flexible library " + uuid(),
      year: 2024,
    });
    await call("PUT", "/api/v1/organization/memberships", {
      collectionId: a.id,
      workIds: [w.id],
      status: "reading",
      priority: 5,
      rationale: "Core evidence",
    });
    await call("PUT", "/api/v1/organization/memberships", {
      collectionId: b.id,
      workIds: [w.id],
      status: "rejected",
      priority: 1,
      rationale: "Not relevant here",
    });
    const state = await call("POST", "/api/v1/organization/works", {
      collectionId: a.id,
      rule: { status: "reading" },
    });
    expect(state.items.some((x: any) => x.id === w.id)).toBe(true);
    expect(
      (
        await call("POST", "/api/v1/organization/works", {
          collectionId: a.id,
          rule: { status: "rejected" },
        })
      ).items.some((x: any) => x.id === w.id),
    ).toBe(false);
    const saved = await call("POST", "/api/v1/organization/collections", {
      name: "Robotics " + uuid(),
      rule: { tag: "robotics" },
    });
    expect(
      (
        await call("POST", "/api/v1/organization/works", {
          collectionId: saved.id,
        })
      ).items.some((x: any) => x.id === w.id),
    ).toBe(false);
    await call("PUT", `/api/v1/organization/works/${w.id}/tags`, {
      revision: 1,
      tags: ["Robotics"],
    });
    expect(
      (await call("GET", `/api/v1/collections/${saved.id}/members`)).items.some(
        (x: any) => x.id === w.id,
      ),
    ).toBe(true);
    await call(
      "PUT",
      "/api/v1/organization/memberships",
      { collectionId: saved.id, workIds: [w.id] },
      409,
    );
    await call("DELETE", `/api/v1/organization/memberships/${a.id}/${w.id}`);
    await call("DELETE", `/api/v1/organization/memberships/${b.id}/${w.id}`);
    expect(
      (
        await call("POST", "/api/v1/organization/works", {
          rule: { unfiled: true, tag: "robotics" },
        })
      ).items.some((x: any) => x.id === w.id),
    ).toBe(true);
  },
);
it.skipIf(!enabled)(
  "F04/F08 logical merge retains keys, attachment/annotation IDs, notes and source assertions",
  async () => {
    const source = await repo.createWork({
        title: "Original duplicate " + uuid(),
      }),
      target = await repo.createWork({
        title: "Canonical duplicate " + uuid(),
      });
    const file = await pdf(source.id),
      annotation = await annotate(file);
    await repo.createNote({
      title: "Preserve source note",
      markdown: "Original note",
      workId: source.id,
    });
    await call("GET", `/api/v1/works/${source.id}/metadata`);
    const preview = await mergePreview(source.id, target.id);
    await expect(
      mergeWorks(
        source.id,
        target.id,
        preview.source.version + 1,
        preview.target.version,
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    await mergeWorks(
      source.id,
      target.id,
      preview.source.version,
      preview.target.version,
    );
    expect((await repo.getWork(source.id))!.id).toBe(target.id);
    expect(
      (await call("GET", "/api/v1/identity/resolve?key=" + source.citationKey))
        .id,
    ).toBe(target.id);
    expect(
      (await call("GET", `/api/v1/works/${target.id}/attachments`)).items.some(
        (x: any) => x.id === file.id,
      ),
    ).toBe(true);
    expect(
      (await call("GET", `/api/v1/notes?workId=${target.id}`)).items.some(
        (x: any) => x.title === "Preserve source note",
      ),
    ).toBe(true);
    expect(
      (await call("GET", `/api/v1/works/${source.id}/metadata`)).workId,
    ).toBe(target.id);
    expect(
      (
        await call("GET", `/api/v1/works/${target.id}/metadata`)
      ).assertions.some((a: any) => a.metadata.title === source.title),
    ).toBe(true);
    const resolved = await passage(annotation.id);
    expect(resolved.work_id).toBe(target.id);
    expect(resolved.attachment_id).toBe(file.id);
    expect(resolved.anchor.status).toBe("exact");
    expect((await mergeWorks(source.id, target.id, 1, 1)).repeated).toBe(true);
    expect(await readFile(file.path)).toEqual(file.bytes);
    const preprint = await repo.createWork({
        title: "Preprint",
        manifestationType: "preprint",
        doi: "10.1234/" + uuid(),
      }),
      published = await repo.createWork({
        title: "Published",
        doi: "10.1234/" + uuid(),
      });
    expect(
      (await mergePreview(preprint.id, published.id)).conflicts,
    ).toHaveLength(2);
    await call("POST", `/api/v1/works/${preprint.id}/versions`, {
      targetId: published.id,
      relation: "preprint_of",
      reason: "User checked the publisher record",
    });
    expect(
      (await call("GET", `/api/v1/works/${published.id}/versions`)).items[0]
        .relation,
    ).toBe("preprint_of");
  },
);
it.skipIf(!enabled)(
  "F06 applies and undoes atomically and refuses to overwrite later edits",
  async () => {
    const works = await Promise.all([
        repo.createWork({ title: "Cleanup " + uuid() }),
        repo.createWork({ title: "Cleanup " + uuid() }),
      ]),
      cleanup = new CleanupRepository();
    const p = await cleanup.preview(
      works.map((w) => w.id),
      { type: "field", field: "publisher", value: "Reviewed Press" },
    );
    const applied = await cleanup.apply(p.id);
    expect(applied.state).toBe("applied");
    for (const w of works)
      expect((await repo.getWork(w.id))!.publisher).toBe("Reviewed Press");
    const undone = await cleanup.apply(p.id, true);
    expect(undone.state).toBe("undone");
    for (const w of works) {
      const restored = (await repo.getWork(w.id))!;
      expect(restored.publisher).toBe("");
      expect(restored.citationKey).toBe(w.citationKey);
    }
    const newer = await cleanup.preview(
      works.map((w) => w.id),
      { type: "add_tag", tag: "important" },
    );
    await cleanup.apply(newer.id);
    const w = (await repo.getWork(works[0]!.id))!;
    await call("PATCH", `/api/v1/works/${w.id}/metadata`, {
      revision: w.version,
      patch: { title: "Later edit" },
    });
    await expect(cleanup.apply(newer.id, true)).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(
      (await pool.query("SELECT tags FROM work WHERE id=$1", [works[1]!.id]))
        .rows[0].tags,
    ).toEqual(["important"]);
    const stale = await cleanup.preview(
      works.map((w) => w.id),
      { type: "field", field: "language", value: "en" },
    );
    await pool.query("UPDATE work SET version=version+1 WHERE id=$1", [
      works[1]!.id,
    ]);
    await expect(cleanup.apply(stale.id)).rejects.toMatchObject({
      statusCode: 409,
    });
    expect((await repo.getWork(works[0]!.id))!.language).toBe("");
  },
);
it.skipIf(!enabled)(
  "F07/F08/F09 persist annotations, flag uncertainty, and reuse evidence across arguments",
  async () => {
    const work = await repo.createWork({
        title: "Evidence workspace " + uuid(),
      }),
      file = await pdf(work.id),
      a = await annotate(file);
    const document = await call(
      "GET",
      `/api/v1/attachments/${file.id}/document`,
    );
    expect(document.index.page_count).toBe(2);
    expect(document.index.pages[1].text).toContain("reliable control");
    await call("PUT", `/api/v1/attachments/${file.id}/position`, {
      page: 2,
      zoom: 1.5,
    });
    expect(
      (await call("GET", `/api/v1/attachments/${file.id}/document`)).position
        .page,
    ).toBe(2);
    await call(
      "POST",
      `/api/v1/attachments/${file.id}/annotations`,
      {
        type: "area",
        selector: {
          hash: file.hash,
          page: 99,
          quote: "",
          rects: [{ x: 0.1, y: 0.1, width: 0.2, height: 0.2 }],
        },
      },
      409,
    );
    const uncertain = await annotate(file, "Quotation not in this document");
    expect(uncertain.anchor.status).toBe("uncertain");
    const argumentsList = await Promise.all([
      call("POST", "/api/v1/arguments", { title: "Argument A" }),
      call("POST", "/api/v1/arguments", { title: "Argument B" }),
    ]);
    for (const argument of argumentsList)
      await call("PUT", `/api/v1/arguments/${argument.id}/evidence/${a.id}`, {
        rationale: "Supports the claim",
      });
    expect(
      (
        await call("POST", "/api/v1/evidence", {
          argumentId: argumentsList[0]!.id,
          tag: "robotics",
          topic: "demonstrations",
          type: "highlight",
        })
      ).total,
    ).toBe(1);
    await call(
      "DELETE",
      `/api/v1/arguments/${argumentsList[0]!.id}/evidence/${a.id}`,
    );
    expect(
      (
        await call("POST", "/api/v1/evidence", {
          argumentId: argumentsList[1]!.id,
        })
      ).total,
    ).toBe(1);
    await call("PATCH", `/api/v1/annotations/${a.id}`, {
      revision: a.version,
      body: "Updated everywhere",
      tags: ["control"],
    });
    expect(
      (
        await call("POST", "/api/v1/evidence", {
          argumentId: argumentsList[1]!.id,
        })
      ).items[0].body_markdown,
    ).toBe("Updated everywhere");
    const note = await call("POST", `/api/v1/passages/${a.id}/note`);
    expect((await call("GET", "/api/v1/notes/" + note.id)).markdown).toContain(
      "/passages/" + a.id,
    );
    const other = await repo.createWork({ title: "Related argument" });
    await call(
      "POST",
      "/api/v1/relationships",
      {
        sourceId: work.id,
        targetId: other.id,
        predicate: "extends",
        confidence: 1,
        verificationStatus: "verified",
        evidence: [{ exactText: a.selector.quote, passageId: a.id }],
      },
      201,
    );
    await call("DELETE", `/api/v1/annotations/${a.id}`, {
      revision: a.version + 1,
    });
    await call("GET", "/api/v1/passages/" + a.id, undefined, 410);
    expect(
      (
        await call("POST", "/api/v1/evidence", {
          argumentId: argumentsList[1]!.id,
        })
      ).total,
    ).toBe(0);
  },
);
it.skipIf(!enabled)(
  "F10 searches four source types with filters and explicit hybrid fallback",
  async () => {
    const work = await repo.createWork({
        title: "Robots learn " + uuid(),
        year: 2025,
      }),
      file = await pdf(work.id);
    await annotate(file);
    await repo.createNote({
      title: "Robots learn note",
      markdown: "Robots learn by observing expert demonstrations.",
      workId: work.id,
    });
    const c = await repo.createCollection({ name: "Search scope" });
    await repo.addToCollection(c.id, [work.id]);
    const results = await call("POST", "/api/v1/evidence-search", {
      query: "Robots learn",
      mode: "exact",
      collectionId: c.id,
    });
    expect(new Set(results.items.map((i: any) => i.kind))).toEqual(
      new Set(["metadata", "page", "annotation", "note"]),
    );
    expect(results.items.every((i: any) => i.workId === work.id)).toBe(true);
    expect(
      (
        await call("POST", "/api/v1/evidence-search", {
          query: "Robots learn",
          mode: "exact",
          collectionId: c.id,
          rule: { yearFrom: 2026 },
        })
      ).total,
    ).toBe(0);
    vi.stubEnv("VANI_EMBED_MODEL", "");
    const hybrid = await call("POST", "/api/v1/evidence-search", {
      query: "Robots learn",
      mode: "hybrid",
      collectionId: c.id,
    });
    expect(hybrid.mode).toBe("lexical");
    expect(hybrid.warning).toContain("No local embedding model");
    const legacy = await call("POST", "/api/v1/search", { query: "Robots" });
    expect(legacy.items.every((i: any) => i.features.semantic === 0)).toBe(
      true,
    );
    expect(MetadataFields.parse(await repo.getWork(work.id)).title).toBe(
      work.title,
    );
  },
);
it.skipIf(!enabled)(
  "F10 indexes real provider vectors, reuses unchanged cache and retrieves meaning-only matches",
  async () => {
    const title = "Teaching intelligent agents through examples " + uuid(),
      work = await repo.createWork({ title });
    const collection = await repo.createCollection({
      name: "Semantic fixture " + uuid(),
    });
    await repo.addToCollection(collection.id, [work.id]);
    vi.stubEnv("VANI_EMBED_MODEL", "fixture-" + uuid());
    const fetch = vi.fn(async (_url: any, init: any) => {
      const body = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          embeddings: body.input.map((text: string) =>
            text.includes(title) || text === "imitation" ? [1, 0] : [0, 1],
          ),
        }),
      );
    });
    vi.stubGlobal("fetch", fetch);
    let progress: any;
    for (let i = 0; i < 10; i++) {
      progress = await call("POST", "/api/v1/semantic-index", {});
      expect(progress.error).toBe("");
      if (!progress.remaining) break;
    }
    expect(progress.remaining).toBe(0);
    expect((await call("POST", "/api/v1/semantic-index", {})).indexed).toBe(0);
    const result = await call("POST", "/api/v1/evidence-search", {
      query: "imitation",
      mode: "hybrid",
      collectionId: collection.id,
    });
    expect(result.mode).toBe("hybrid");
    expect(result.items[0].workId).toBe(work.id);
    expect(result.items[0].lexical).toBe(0);
    expect(result.items[0].semantic).toBe(1);
    await call("PATCH", `/api/v1/works/${work.id}/metadata`, {
      revision: 1,
      patch: { title: title + " revised" },
    });
    expect(
      (await call("POST", "/api/v1/semantic-index", {})).indexed,
    ).toBeGreaterThan(0);
  },
);
