import process from "node:process";
import { setInterval, clearInterval } from "node:timers";
import { URL } from "node:url";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { buildApp } from "../../apps/api/dist/app.js";
import { pool } from "../../apps/api/dist/db.js";
import { migrate } from "../../apps/api/dist/cli/migrate.js";
import {
  bindModelPersistence,
  systemHealth,
} from "../../apps/api/dist/core/routes.js";
import {
  runCoreWorker,
  resumeEvidence,
  getFocus,
} from "../../apps/api/dist/core/service.js";
import { runEnrichment } from "../../apps/api/dist/ingestion/enrichment.js";
import { makeReport, markdownReport } from "./report.mjs";
const root = resolve(process.env.VANI_LAB_DIR || ".vani-refresh-lab");
const db = new URL(process.env.DATABASE_URL || "http://invalid");
if (
  process.env.VANI_REFRESH_LAB !== "true" ||
  db.hostname !== "127.0.0.1" ||
  db.port !== "55442" ||
  db.pathname !== "/vani_refresh_lab" ||
  resolve(process.env.VANI_DATA_DIR || "") !== resolve(root, "data")
)
  throw Error("Refusing to start outside the isolated refresh lab.");
process.env.VANI_CLOUD_MODE = "off";
await migrate();
await pool.query(
  `CREATE TABLE IF NOT EXISTS refresh_lab_expected (id uuid PRIMARY KEY,collection_id uuid REFERENCES collection(id),title text NOT NULL,doi text NOT NULL DEFAULT '',url text NOT NULL DEFAULT '',reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());`,
);
bindModelPersistence();
const app = await buildApp();
app.get("/lab", async (_, reply) =>
  reply
    .type("text/html")
    .send(await readFile(new URL("./index.html", import.meta.url), "utf8")),
);
app.get("/", async (_, reply) => reply.redirect("/lab"));
const idOf = (r) => z.string().uuid().parse(r.params.id);
async function report(id) {
  const collection = (
    await pool.query(
      "SELECT * FROM collection WHERE id=$1 AND deleted_at IS NULL",
      [id],
    )
  ).rows[0];
  if (!collection)
    throw Object.assign(Error("Collection not found"), { statusCode: 404 });
  const [runs, candidates, seeds, expected, invocations] = await Promise.all([
    pool.query(
      "SELECT * FROM core_run WHERE collection_id=$1 ORDER BY created_at DESC",
      [id],
    ),
    pool.query(
      "SELECT c.*,c.features-'embedding' features,EXISTS(SELECT 1 FROM collection_membership m WHERE m.collection_id=c.collection_id AND m.work_id=c.work_id) accepted FROM core_candidate c WHERE collection_id=$1 ORDER BY (features->>'score')::float DESC NULLS LAST,id",
      [id],
    ),
    pool.query(
      "SELECT w.id,w.title,w.doi,w.access_class,e.pdf_status,e.pdf_error,e.status summary_status,e.summary FROM collection_membership m JOIN work w ON w.id=m.work_id LEFT JOIN paper_enrichment e ON e.work_id=w.id WHERE m.collection_id=$1",
      [id],
    ),
    pool.query(
      "SELECT * FROM refresh_lab_expected WHERE collection_id=$1 ORDER BY created_at",
      [id],
    ),
    pool.query(
      "SELECT task,provider,model,digest,status,reason,created_at FROM model_invocation WHERE collection_id=$1 ORDER BY created_at",
      [id],
    ),
  ]);
  return makeReport({
    collection,
    focus: await getFocus(id),
    runs: runs.rows,
    candidates: candidates.rows,
    members: seeds.rows,
    expected: expected.rows,
    invocations: invocations.rows,
  });
}
app.get("/lab/api/health", async () => {
  const result = await systemHealth();
  if (process.platform === "darwin")
    result.gpu = {
      state: "not_applicable",
      detail:
        "The NVIDIA check does not apply on macOS; consult the recorded local inference smoke test for GPU residency.",
    };
  const smoke = await readFile(resolve(root, "model-smoke.json"), "utf8")
    .then(JSON.parse)
    .catch(() => null);
  return { ...result, localInferenceSmoke: smoke };
});
app.get("/lab/api/meta", async () => ({ lab: true, root, cloud: "off" }));
app.get("/lab/api/collections/:id/report", (r) => report(idOf(r)));
app.post("/lab/api/collections/:id/snapshot", async (r) => {
  const data = await report(idOf(r)),
    name = new Date().toISOString().replace(/[:.]/g, "-") + "-" + randomUUID();
  const folder = resolve(root, "reports", data.collection.id);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  await writeFile(
    resolve(folder, name + ".json"),
    JSON.stringify(data, null, 2),
    { flag: "wx", mode: 0o600 },
  );
  await writeFile(resolve(folder, name + ".md"), markdownReport(data), {
    flag: "wx",
    mode: 0o600,
  });
  return {
    json: resolve(folder, name + ".json"),
    markdown: resolve(folder, name + ".md"),
  };
});
app.post("/lab/api/collections/:id/expected", async (r) => {
  const id = idOf(r);
  await getFocus(id);
  const value = z
    .object({
      title: z.string().trim().min(2).max(1000),
      doi: z.string().max(300).default(""),
      url: z.union([z.literal(""), z.string().url()]).default(""),
      reason: z.string().trim().min(2).max(2000),
    })
    .parse(r.body);
  return (
    await pool.query(
      "INSERT INTO refresh_lab_expected(id,collection_id,title,doi,url,reason) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
      [randomUUID(), id, value.title, value.doi, value.url, value.reason],
    )
  ).rows[0];
});
let coreBusy = false,
  enrichmentBusy = false;
const tick = async () => {
  if (coreBusy) return;
  coreBusy = true;
  try {
    await runCoreWorker();
    await resumeEvidence();
  } catch (e) {
    app.log.error(e);
  } finally {
    coreBusy = false;
  }
};
const enrich = async () => {
  if (enrichmentBusy) return;
  enrichmentBusy = true;
  try {
    await runEnrichment();
  } catch (e) {
    app.log.error(e);
  } finally {
    enrichmentBusy = false;
  }
};
const timers = [
  setInterval(() => void tick(), 2000),
  setInterval(() => void enrich(), 3000),
];
const stop = async () => {
  timers.forEach(clearInterval);
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
await app.listen({ host: "127.0.0.1", port: 18082 });
