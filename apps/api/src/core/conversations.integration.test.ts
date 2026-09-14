import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { v7 as uuid } from "uuid";
import { migrate } from "../cli/migrate.js";
import { pool } from "../db.js";
import { buildApp } from "../app.js";
import { Repository } from "../repository.js";
import { config } from "../config.js";
import { resetModelIdentity } from "../models/router.js";
const enabled = process.env.VANI_INTEGRATION_TEST === "true",
  repo = new Repository();
let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => {
  if (enabled) {
    await migrate();
    app = await buildApp(repo);
  }
});
afterAll(async () => {
  vi.unstubAllGlobals();
  if (enabled) {
    await app.close();
    await pool.end();
  }
});
it.skipIf(!enabled)(
  "keeps conversations local, enforces collection scope, persists history and makes retries idempotent",
  async () => {
    const col = await repo.createCollection({
        name: "Scoped conversation " + uuid(),
      }),
      other = await repo.createWork({
        title: "Outside collection " + uuid(),
        abstract: "Confidential outside collection material.",
      }),
      work = await repo.createWork({
        title: "Robot learning " + uuid(),
        abstract:
          "We introduce a method for learning transferable robot behavior.",
      });
    await repo.addToCollection(col.id, [work.id]);
    const conv = (
      await app.inject({
        method: "POST",
        url: "/api/v1/conversations",
        payload: { collectionId: col.id },
      })
    ).json();
    resetModelIdentity();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        if (String(url).endsWith("/api/tags"))
          return Response.json({
            models: [{ name: config.ollamaModel, digest: "local-fixture" }],
          });
        const packet = JSON.parse(
            JSON.parse(String(init?.body)).messages[1].content,
          ),
          source = packet.sources.find((s: any) => s.workId === work.id);
        return Response.json({
          done: true,
          message: {
            content: JSON.stringify({
              claims: [
                {
                  text: source.text,
                  kind: "quotation",
                  citations: [{ sourceId: source.id, quote: source.text }],
                },
              ],
              limitations: [],
            }),
          },
        });
      }),
    );
    const url = `/api/v1/conversations/${conv.id}/messages`,
      payload = {
        question: "What method does the paper introduce?",
        requestKey: uuid(),
        scope: { collectionId: col.id, ids: [work.id] },
      };
    const a = await app.inject({ method: "POST", url, payload });
    expect(a.statusCode, a.body).toBe(201);
    expect(a.json().status).toBe("complete");
    const calls = vi.mocked(fetch).mock.calls.length;
    const repeated = await app.inject({ method: "POST", url, payload });
    expect(repeated.json().id).toBe(a.json().id);
    expect(vi.mocked(fetch).mock.calls.length).toBe(calls);
    expect(JSON.stringify(vi.mocked(fetch).mock.calls)).not.toContain(
      other.abstract,
    );
    expect(
      vi
        .mocked(fetch)
        .mock.calls.every(([u]) => String(u).startsWith("http://127.0.0.1")),
    ).toBe(true);
    const denied = await app.inject({
      method: "POST",
      url,
      payload: { ...payload, requestKey: uuid(), scope: { ids: [other.id] } },
    });
    expect(denied.statusCode).toBe(400);
    const history = await app.inject({ method: "GET", url });
    expect(history.json().items).toHaveLength(1);
  },
);
it.skipIf(!enabled)(
  "reports missing local models and supports explicitly requested excerpts",
  async () => {
    const col = await repo.createCollection({ name: "Offline " + uuid() }),
      w = await repo.createWork({
        title: "Robotics " + uuid(),
        abstract: "We develop an uncertainty-aware robot controller.",
      });
    await repo.addToCollection(col.id, [w.id]);
    const conv = (
      await app.inject({
        method: "POST",
        url: "/api/v1/conversations",
        payload: { collectionId: col.id },
      })
    ).json();
    resetModelIdentity();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw Error("offline");
      }),
    );
    const url = `/api/v1/conversations/${conv.id}/messages`;
    expect(
      (
        await app.inject({
          method: "POST",
          url,
          payload: { question: "Explain this controller" },
        })
      ).json().status,
    ).toBe("local_model_unavailable");
    vi.mocked(fetch).mockClear();
    const excerpts = (
      await app.inject({
        method: "POST",
        url,
        payload: { question: "Show evidence", extractive: true },
      })
    ).json();
    expect(excerpts.modelProvenance.provider).toBe("extractive-local");
    expect(fetch).not.toHaveBeenCalled();
  },
);
