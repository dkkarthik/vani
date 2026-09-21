import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { v7 as uuid } from "uuid";
import { pool } from "../db.js";
import { migrate } from "../cli/migrate.js";
import { config } from "../config.js";
import { resetModelIdentity, taskLimits } from "../models/router.js";
import { Focus } from "./algorithm.js";
import {
  beginAttempt,
  finishAttempt,
  holdRun,
  type ReadPacket,
} from "./compute.js";
import { enqueueCore, runCoreWorker } from "./service.js";
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
    "UPDATE core_run SET status='superseded' WHERE status IN ('queued','running','paused','awaiting_evidence')",
  );
  const collection = uuid();
  await pool.query(
    "INSERT INTO collection(id,name) VALUES($1,'Compute fixture')",
    [collection],
  );
  const snapshot = Focus.parse({
    question: "Robot learning",
    publicQueries: ["robot learning"],
  });
  await pool.query(
    "INSERT INTO core_focus(collection_id,profile) VALUES($1,$2)",
    [collection, JSON.stringify(snapshot)],
  );
  const run = await enqueueCore(collection);
  await pool.query("UPDATE core_run SET phase='screening' WHERE id=$1", [
    run.id,
  ]);
  run.phase = "screening";
  const c = { id: uuid(), stage: "D1a", attempts: 0, assessment: {} };
  await pool.query(
    "INSERT INTO core_candidate(id,collection_id,identity,paper,source_hash,focus_version,run_id,stage) VALUES($1::uuid,$2,$1::text,$3,'hash',1,$4,'D1a')",
    [
      c.id,
      collection,
      JSON.stringify({
        title: "Robots learn demonstrations",
        abstract: "Robots learn directly from demonstrations.",
      }),
      run.id,
    ],
  );
  const packet: ReadPacket = {
    version: "test",
    instruction: "read",
    input: { text: "data" },
    schema: {},
    model: "local",
    digest: "one",
    task: "d1",
    limits: taskLimits.d1,
  };
  return { run, c, packet };
}
it.skipIf(!enabled)(
  "deduplicates rejected fingerprints across refresh, while changed inputs and explicit overrides work",
  async () => {
    const { run, c, packet } = await fixture();
    const id = await beginAttempt(run, c, packet);
    expect(id).toBeTruthy();
    await finishAttempt(
      id!,
      "rejected",
      [{ code: "quote_mismatch", path: "quote", message: "test" }],
      "invalid",
      {},
      undefined,
      100,
    );
    await pool.query(
      "UPDATE core_run SET status='completed_with_errors' WHERE id=$1",
      [run.id],
    );
    const next = await enqueueCore(run.collection_id);
    expect(await beginAttempt(next, c, packet)).toBeNull();
    expect(
      (await pool.query("SELECT state FROM core_candidate WHERE id=$1", [c.id]))
        .rows[0].state,
    ).toBe("blocked");
    expect(
      await beginAttempt(next, c, { ...packet, digest: "changed" }),
    ).toBeTruthy();
    c.assessment = { explicitReadingOverride: true };
    expect(await beginAttempt(next, c, packet)).toBeTruthy();
  },
);
it.skipIf(!enabled)(
  "never resets a held run through scheduled or ordinary refresh",
  async () => {
    const { run } = await fixture();
    await holdRun(run.id, "failure circuit");
    const again = await enqueueCore(run.collection_id);
    expect(again.status).toBe("paused");
    expect(again.compute_control.held).toBe(true);
  },
);
it.skipIf(!enabled)(
  "captures real pipeline validation diagnostics and blocks repeated calls",
  async () => {
    const { run, c } = await fixture();
    resetModelIdentity();
    let chats = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        if (String(url).endsWith("/api/tags"))
          return Response.json({
            models: [{ name: config.ollamaModel, digest: "reader" }],
          });
        chats++;
        return Response.json({
          done: true,
          eval_count: 20,
          prompt_eval_count: 30,
          message: {
            content: JSON.stringify({
              contribution: "test",
              likelyRelated: true,
              reason: "test",
              quote: "This quotation is invented.",
              uncertainties: [],
            }),
          },
        });
      }),
    );
    await runCoreWorker();
    const row = (
      await pool.query(
        "SELECT * FROM core_read_attempt WHERE candidate_id=$1",
        [c.id],
      )
    ).rows[0];
    expect(row.status).toBe("rejected");
    expect(row.issues[0].code).toBe("quote_mismatch");
    expect(row.raw_output).toContain("invented");
    expect(row.packet.input.paper.text).toContain("Robots");
    expect(row.invocation.outputTokens).toBe(20);
    await pool.query(
      "UPDATE core_run SET status='completed_with_errors' WHERE id=$1",
      [run.id],
    );
    const again = await enqueueCore(run.collection_id);
    await pool.query("UPDATE core_run SET phase='screening' WHERE id=$1", [
      again.id,
    ]);
    await runCoreWorker();
    expect(chats).toBe(1);
    vi.unstubAllGlobals();
  },
);
it.skipIf(!enabled)(
  "counts interrupted calls, retains fingerprint gates after packet pruning, and limits a stage wave",
  async () => {
    const { run, c, packet } = await fixture();
    expect(await beginAttempt(run, c, packet)).toBeTruthy();
    expect(await beginAttempt(run, c, packet)).toBeTruthy();
    expect(await beginAttempt(run, c, packet)).toBeNull();
    for (let i = 0; i < 5; i++)
      await pool.query(
        "INSERT INTO core_read_attempt(id,candidate_id,run_id,collection_id,stage,input_hash,packet,status) VALUES($1::uuid,$2,$3,$4,'D2',$1::text,'{}','rejected')",
        [uuid(), c.id, run.id, run.collection_id],
      );
    const deep = { ...c, stage: "D2" };
    expect(await beginAttempt(run, deep, { ...packet, task: "d2" })).toBeNull();
    expect(
      (
        await pool.query(
          "SELECT status,compute_control FROM core_run WHERE id=$1",
          [run.id],
        )
      ).rows[0],
    ).toMatchObject({ status: "paused", compute_control: { held: true } });
  },
);
