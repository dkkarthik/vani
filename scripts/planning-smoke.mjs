/* global console, process, setTimeout, window, URL, Response */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { v7 as uuid } from "uuid";
import { buildApp } from "../apps/api/dist/app.js";
import { migrate } from "../apps/api/dist/cli/migrate.js";
import { pool } from "../apps/api/dist/db.js";
import { Repository } from "../apps/api/dist/repository.js";
import { ObjectStore } from "../apps/api/dist/object-store.js";
assert.equal(
  process.env.VANI_INTEGRATION_TEST,
  "true",
  "Use a disposable database and object directory.",
);
const output = process.env.VANI_SMOKE_OUTPUT || "/tmp/vani-planning-smoke",
  apiPort = 58088,
  webPort = 55180;
await mkdir(output, { recursive: true });
await migrate();
const stamp = Date.now(),
  title = "A Planning browser " + stamp,
  method = "Browser Method " + stamp,
  repo = new Repository();
const work = await repo.createWork({
  title,
  abstract: `We use ${method} to learn. We compare against ${method}. Results improve reliability.`,
  authors: [{ family: "Browser" }],
});
const second = await repo.createWork({
  title: "A Planning baseline " + stamp,
  abstract: "Different results.",
});
const project = await repo.createCollection({
  name: "Connected browser project " + stamp,
});
await repo.addToCollection(project.id, [work.id, second.id]);
const bytes = await readFile(
    resolve("apps/api/src/research/fixtures/reading.pdf"),
  ),
  stored = await new ObjectStore().put(bytes, "application/pdf"),
  attachment = uuid(),
  passage = uuid();
await pool.query(
  "INSERT INTO attachment(id,work_id,object_hash,filename) VALUES($1,$2,$3,$4)",
  [attachment, work.id, stored.hash, "reading.pdf"],
);
await pool.query(
  "INSERT INTO annotation(id,attachment_id,annotation_type,page_start,selector) VALUES($1,$2,'highlight',1,$3)",
  [
    passage,
    attachment,
    JSON.stringify({
      hash: stored.hash,
      page: 1,
      quote: "Robots learn from demonstrations.",
      rects: [{ x: 0.1, y: 0.1, width: 0.5, height: 0.1 }],
    }),
  ],
);
const secondPassage = uuid();
await pool.query(
  "INSERT INTO annotation(id,attachment_id,annotation_type,page_start,selector) VALUES($1,$2,'highlight',1,$3)",
  [
    secondPassage,
    attachment,
    JSON.stringify({
      hash: stored.hash,
      page: 1,
      quote: "Evidence connects robust learning to reliable control.",
      rects: [{ x: 0.1, y: 0.2, width: 0.5, height: 0.1 }],
    }),
  ],
);
await pool.query("UPDATE collection SET discovery=$2 WHERE id=$1", [
  project.id,
  JSON.stringify({
    mode: "topic",
    topic: "learning",
    enabled: true,
    timezone: "UTC",
    hour: 8,
    workIds: [],
  }),
]);
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (
    url.hostname !== "api.openalex.org" &&
    url.hostname !== "api.crossref.org"
  )
    return nativeFetch(input, init);
  if (url.hostname === "api.crossref.org")
    return new Response("Unavailable", { status: 503 });
  const raw = (id, refs = []) => ({
    id: "https://openalex.org/" + id,
    title: "Discovery browser " + id + " " + stamp,
    doi: "https://doi.org/10.9877/" + id,
    referenced_works: refs.map((x) => "https://openalex.org/" + x),
    publication_year: 2025,
    authorships: [],
  });
  if (url.searchParams.has("search"))
    return Response.json({ results: [raw("W8801", ["W8802"])] });
  if (url.searchParams.get("filter")?.startsWith("cites:"))
    return Response.json({ results: [raw("W8803", ["W8801"])] });
  if (url.searchParams.has("filter"))
    return Response.json({ results: [raw("W8802")] });
  return Response.json(raw("W8801", ["W8802"]));
};
const app = await buildApp();
let browser, vite;

try {
  await app.listen({ host: "127.0.0.1", port: apiPort });
  vite = spawn(
    process.execPath,
    [
      resolve("node_modules/vite/bin/vite.js"),
      "--host",
      "127.0.0.1",
      "--port",
      String(webPort),
      "--strictPort",
    ],
    {
      cwd: resolve("apps/web"),
      env: {
        ...process.env,
        VANI_DEV_API_TARGET: `http://127.0.0.1:${apiPort}`,
      },
      stdio: "pipe",
    },
  );
  let logs = "";
  vite.stderr.on("data", (c) => (logs += c));
  vite.stdout.on("data", (c) => (logs += c));
  browser = await chromium.launch({
    headless: true,
    ...(process.env.VANI_SMOKE_CHROMIUM
      ? { executablePath: process.env.VANI_SMOKE_CHROMIUM }
      : {}),
  });
  const page = await browser.newPage({
      viewport: { width: 1440, height: 1100 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const base = `http://127.0.0.1:${webPort}`;
  for (let i = 0; i < 40; i++) {
    try {
      await page.goto(base + "/planning");
      break;
    } catch {
      if (i === 39) throw Error(logs);
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  const field = (name) => page.getByLabel(name, { exact: true });
  const button = (name) => page.getByRole("button", { name, exact: true });
  async function savedClick(name, method, suffix) {
    const done = page.waitForResponse(
      (r) =>
        r.request().method() === method &&
        r.url().includes(suffix) &&
        r.status() < 300,
    );
    await button(name).click();
    await done;
  }
  await field("New map title").fill("Reading map " + stamp);
  await savedClick("Create research map", "POST", "/boards");
  await field("Add map object").selectOption(work.id);
  await button("Add card").click();
  await field("Card X").fill("410");
  await field("Card Y").fill("90");
  await field("Pin card position").check();
  await field("New group name").fill("Learning");
  await button("Add topic group").click();
  await field("Card group").selectOption({ label: "Learning" });
  await field("Add map object").selectOption(second.id);
  await button("Add card").click();
  await field("Current research question").fill(
    "How do demonstrations improve reliability?",
  );
  await savedClick("Save map and path", "PATCH", "/boards/");
  await page.waitForTimeout(200);
  const boardId = await field("Saved research map").inputValue();
  await page.reload();
  await field("Saved research map").selectOption(boardId);
  await page
    .locator(".board-card")
    .filter({ hasText: title })
    .getByRole("button", { name: title, exact: true })
    .click();
  assert.equal(await field("Card X").inputValue(), "410");
  assert.equal(await field("Pin card position").isChecked(), true);
  await button("Focus this card").click();
  assert.equal(await page.locator(".board-card").count(), 1);
  await button("Back view").click();
  assert.equal(await page.locator(".board-card").count(), 2);
  await field("Map view").selectOption("timeline");
  assert.equal(await page.locator(".board-list li").count(), 2);
  await field("Map view").selectOption("list");
  assert.equal(await page.locator(".board-list li").count(), 2);
  await field("Map view").selectOption("spatial");
  await button("Suggest reading steps").click();
  await page
    .getByText("Review suggestions before adding them to the path.", {
      exact: true,
    })
    .waitFor();
  await button("Add suggested step").first().click();
  await field("Step 1 rationale").fill(
    "Read first to establish the learning context.",
  );
  await savedClick("Save map and path", "PATCH", "/boards/");
  await page.waitForTimeout(200);
  const download = page.waitForEvent("download");
  await button("Export saved JSON").click();
  const file = await download;
  const exported = JSON.parse(await readFile(await file.path(), "utf8"));
  assert.equal(exported.state.cards[0].x, 410);
  assert.equal(exported.state.path.length, 1);
  const svg = await app.inject({
    method: "GET",
    url: `/api/v1/knowledge/boards/${boardId}/export?format=svg`,
  });
  assert.equal(svg.statusCode, 200);
  assert.ok(svg.body.includes("<svg"));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve(output, "maps.png"), fullPage: true });
  await button("Reading and synthesis").click();
  await field("Target paper").selectOption(work.id);
  await savedClick(
    "Create source-backed report",
    "POST",
    "/insights/first-pass",
  );
  await field("Report title").waitFor();
  await field("Section 2 text").fill(
    "Personal context: compare demonstrations with prior learning.",
  );
  await savedClick("Save report edits", "PATCH", "/insights/");
  await page.goto(base + "/ask");
  await field("Explicit answer corpus").selectOption([work.id]);
  await field("Question for selected corpus").fill(
    "What improves reliability?",
  );
  await savedClick("Create source-backed report", "POST", "/insights/ask");
  await field("Report title").waitFor();
  const sourceLink = page.locator('a[href^="/insights/"]').first();
  await sourceLink.click();
  await page
    .getByText(
      "Snapshot text is retained even if the current source changes.",
      { exact: false },
    )
    .waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: resolve(output, "source.png"),
    fullPage: true,
  });
  await page.goto(base + "/planning?tab=reports");
  await field("Report workflow").selectOption("addition");
  await field("Target paper").selectOption(work.id);
  await field("Existing baseline papers").selectOption([second.id]);
  await savedClick("Create source-backed report", "POST", "/insights/addition");
  await field("Report title").waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: resolve(output, "reports.png"),
    fullPage: true,
  });
  await page.goto(base + "/planning?tab=digests");
  await field("Monitored collection").selectOption(project.id);
  await savedClick("Check stored changes", "POST", "/capture");
  await page.getByText("Baseline established.", { exact: false }).waitFor();
  await pool.query("UPDATE work SET title=title || ' corrected' WHERE id=$1", [
    work.id,
  ]);
  await savedClick("Check stored changes", "POST", "/capture");
  await page.getByRole("heading", { name: /corrected ·/ }).waitFor();
  await savedClick("Check stored changes", "POST", "/capture");
  await page
    .getByText("No changes since the previous snapshot.", { exact: false })
    .waitFor();
  await savedClick("Acknowledge visible changes", "POST", "/control");
  await page.getByText("Reviewed ·", { exact: false }).waitFor();
  await savedClick("Pause monitoring", "POST", "/control");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: resolve(output, "digests.png"),
    fullPage: true,
  });
  await page.goto(base + "/planning?tab=reports");
  await field("Report workflow").selectOption("inspection");
  await field("Two passages to inspect").selectOption([passage, secondPassage]);
  await savedClick(
    "Create source-backed report",
    "POST",
    "/insights/inspection",
  );
  await field("Inspection judgment").selectOption("mixed");
  const rationale = page
    .locator(".outline-block")
    .filter({
      has: page.getByRole("heading", {
        name: "Judgment rationale",
        exact: true,
      }),
    });
  await rationale
    .locator("textarea")
    .fill(
      "These passages discuss related learning claims but do not establish identical conditions.",
    );
  await field("I inspected the two sources and confirm this judgment").check();
  await savedClick("Save report edits", "PATCH", "/insights/");
  await page.getByText("User-confirmed judgment", { exact: false }).waitFor();
  await page.goto(base + "/explore");
  await field("Feedback collection context").selectOption(project.id);
  await field("Research question or topic").fill("learning");
  await savedClick("Explore literature", "POST", "/discovery");
  await field("Recommendation feedback reason")
    .first()
    .fill("Outside this project scope");
  await savedClick("Dismiss recommendation", "POST", "/feedback");
  await page.getByText("Recorded: dismissed.", { exact: false }).waitFor();
  await savedClick("Explore literature", "POST", "/discovery");
  await page
    .getByText("1 unchanged results suppressed", { exact: false })
    .waitFor();
  await page.goto(base + "/planning?tab=feedback");
  const decision = page
    .locator("article")
    .filter({ hasText: "Outside this project scope" })
    .first();
  await decision
    .getByRole("button", { name: "Restore recommendation", exact: true })
    .click();
  await decision
    .getByText("restored · Outside this project scope", { exact: true })
    .waitFor();
  assert.deepEqual(errors, []);
  assert.deepEqual(await readFile(stored.path), bytes);
  console.log(
    JSON.stringify(
      {
        passed: true,
        screenshots: output,
        checks: [
          "map create/pin/group/persistence",
          "focus history/timeline/list",
          "editable reading path",
          "JSON/SVG exports",
          "first-pass edits",
          "grounded question and source inspection",
          "new-paper addition",
          "quiet change digest and acknowledgement",
          "pause control",
          "inspection confirmation",
          "discovery dismiss/suppress/restore",
          "original PDF unchanged",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  globalThis.fetch = nativeFetch;
  await browser?.close();
  vite?.kill("SIGTERM");
  await app.close();
  await pool.end();
}
