import { beforeAll, afterAll, it, expect } from "vitest";
import { v7 as uuid } from "uuid";
import { pool } from "../db.js";
import { migrate } from "../cli/migrate.js";
import { Repository } from "../repository.js";
import { enqueueCore, stageCandidate } from "./service.js";
import {
  freezeHoldout,
  labelHoldout,
  evaluateAndPromote,
} from "./evaluation.js";
const enabled = process.env.VANI_INTEGRATION_TEST === "true";
beforeAll(async () => {
  if (enabled) await migrate();
});
afterAll(async () => {
  if (enabled) await pool.end();
});
it.skipIf(!enabled)(
  "requires two disjoint prospective holdouts, rejects paper reuse, and promotes only computed improvement",
  async () => {
    const col = await new Repository().createCollection({
        name: "Calibration fixture " + uuid(),
      }),
      run = await enqueueCore(col.id),
      policyId = uuid();
    await pool.query(
      "INSERT INTO core_policy(id,collection_id,settings) VALUES($1,$2,$3)",
      [
        policyId,
        col.id,
        JSON.stringify({
          lexical: 0.1,
          semantic: 0.6,
          graph: 0.25,
          author: 0.05,
        }),
      ],
    );
    expect((await evaluateAndPromote(policyId)).status).toBe(
      "insufficient_data",
    );
    let used: string[] = [];
    for (let phase = 0; phase < 2; phase++) {
      for (let group = 0; group < 10; group++) {
        const labels = [];
        for (let i = 0; i < 20; i++) {
          const c = await stageCandidate(
            run,
            {
              title: `Evaluation ${phase} ${group} ${i}`,
              connector: "fixture",
              externalId: uuid(),
              sourcePayload: {},
            },
            { channel: "test" },
          );
          await pool.query(
            "UPDATE core_candidate SET features=$2 WHERE id=$1",
            [
              c.id,
              JSON.stringify({
                lexical: i < 10 ? 0 : 0.65,
                semantic: i < 10 ? 0.6 : 0.35,
                graph: 0,
                author: 0,
              }),
            ],
          );
          labels.push({
            id: c.id,
            label: i < 10 ? "closest" : "out_of_scope",
            reason: "Synthetic independent adjudication fixture",
          });
        }
        const h = await freezeHoldout(policyId, {
          question: `Distinct evaluation question ${phase} ${group}`,
          candidateIds: labels.map((l) => l.id),
        });
        await labelHoldout(h.id, labels);
        await expect(labelHoldout(h.id, labels)).rejects.toMatchObject({
          statusCode: 409,
        });
        used = labels.map((l) => l.id);
      }
      const e = await evaluateAndPromote(policyId);
      expect(e.status).toBe(phase ? "active" : "canary");
      expect(e.precision).toBe(1);
      expect(e.lowerBound).toBeGreaterThan(0);
      if (!phase)
        await expect(
          freezeHoldout(policyId, {
            question: "Reused evaluation question",
            candidateIds: used,
          }),
        ).rejects.toMatchObject({ statusCode: 409 });
    }
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM core_policy WHERE collection_id=$1 AND status='active'",
          [col.id],
        )
      ).rows[0].n,
    ).toBe(1);
  },
  30000,
);
