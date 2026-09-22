import { beforeAll, afterAll, it, expect } from "vitest";
import Fastify from "fastify";
import { v7 as uuid } from "uuid";
import { pool } from "../db.js";
import { migrate } from "../cli/migrate.js";
import { Focus } from "./algorithm.js";
import { enqueueCore, stageCandidate } from "./service.js";
import { registerCore } from "./routes.js";
const enabled = process.env.VANI_INTEGRATION_TEST === "true";
beforeAll(async () => {
  if (enabled) await migrate();
});
afterAll(async () => {
  if (enabled) await pool.end();
});
it.skipIf(!enabled)(
  "retains per-run decisions, paths and feedback provenance across refreshes",
  async () => {
    const collection = uuid();
    await pool.query(
      "INSERT INTO collection(id,name) VALUES($1,'Refresh review fixture')",
      [collection],
    );
    await pool.query(
      "INSERT INTO core_focus(collection_id,profile) VALUES($1,$2)",
      [
        collection,
        JSON.stringify(
          Focus.parse({
            question: "Adaptive mesh refinement",
            publicQueries: ["adaptive mesh refinement"],
          }),
        ),
      ],
    );
    const first = await enqueueCore(collection);
    const c = await stageCandidate(
      first,
      {
        title: "Adaptive mesh refinement",
        connector: "crossref",
        externalId: "fixture",
        abstract: "Sparse spatial representations.",
      },
      { query: "adaptive mesh refinement", source: "crossref" },
    );
    await pool.query(
      "UPDATE core_candidate SET stage='D1b',state='reviewed',assessment='{\"likelyRelated\":false,\"reason\":\"Different task\"}' WHERE id=$1",
      [c.id],
    );
    const app = Fastify();
    await registerCore(app);
    const root = `/api/v1/collections/${collection}/core/runs/${first.id}`;
    let response = await app.inject({
      url: root + "?stage=D0&outcome=not_related",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().total).toBe(1);
    expect(response.json().items[0].retrieved).toBe(true);
    expect(
      (await app.inject({ url: root + "?search=unrelated" })).json().total,
    ).toBe(0);
    await pool.query("UPDATE core_run SET status='completed' WHERE id=$1", [
      first.id,
    ]);
    const before = (
      await pool.query(
        "SELECT snapshot FROM core_run_candidate WHERE run_id=$1",
        [first.id],
      )
    ).rows[0].snapshot;
    const next = await enqueueCore(collection);
    await stageCandidate(
      next,
      {
        title: "Adaptive mesh refinement",
        connector: "crossref",
        externalId: "fixture",
        abstract: "Sparse spatial representations.",
      },
      { query: "sparse representation", source: "crossref" },
    );
    response = await app.inject({
      method: "POST",
      url: `/api/v1/core/candidates/${c.id}/feedback`,
      payload: { label: "related", runId: first.id },
    });
    expect(response.statusCode).toBe(200);
    expect(
      (
        await pool.query(
          "SELECT snapshot FROM core_run_candidate WHERE run_id=$1",
          [first.id],
        )
      ).rows[0].snapshot,
    ).toEqual(before);
    const traces = (
      await pool.query(
        "SELECT * FROM core_run_candidate WHERE candidate_id=$1 ORDER BY first_seen_at",
        [c.id],
      )
    ).rows;
    expect(traces).toHaveLength(2);
    expect(traces[0].paths[0].query).toBe("adaptive mesh refinement");
    expect(traces[1].paths[0].query).toBe("sparse representation");
    expect(
      (await app.inject({ url: root })).json().items[0].current_feedback.label,
    ).toBe("related");
    expect(
      (
        await app.inject({
          url: `/api/v1/collections/${uuid()}/core/runs/${first.id}`,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/core/candidates/${c.id}/feedback`,
          payload: { label: "related", runId: uuid() },
        })
      ).statusCode,
    ).toBe(404);
    await pool.query(
      "UPDATE core_candidate SET state='reviewed',proximity='out_of_scope',assessment='{\"humanDecision\":true}' WHERE id=$1",
      [c.id],
    );
    await app.inject({
      method: "POST",
      url: `/api/v1/core/candidates/${c.id}/feedback`,
      payload: { label: "clear", runId: first.id },
    });
    expect(
      (
        await pool.query(
          "SELECT state,stage,proximity FROM core_candidate WHERE id=$1",
          [c.id],
        )
      ).rows[0],
    ).toMatchObject({ state: "stale", stage: "D0", proximity: "unassessed" });
    expect(
      (
        await pool.query("SELECT feedback FROM core_candidate WHERE id=$1", [
          c.id,
        ])
      ).rows[0].feedback,
    ).toEqual({});
    const detail = (
      await app.inject({ url: root + `/candidates/${c.id}` })
    ).json();
    expect(detail.events.length).toBeGreaterThan(1);
    expect(detail.feedbackHistory).toHaveLength(2);
    await app.close();
  },
);
