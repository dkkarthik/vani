/* global console, process, setTimeout, window, URL, Response, Buffer */
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
const output = process.env.VANI_SMOKE_OUTPUT || "/tmp/vani-connected-smoke",
  apiPort = 58086,
  webPort = 55178;
await mkdir(output, { recursive: true });
await migrate();
const stamp = Date.now(),
  title = "Connected browser " + stamp,
  method = "Browser Method " + stamp,
  repo = new Repository();
const work = await repo.createWork({
  title,
  abstract: `We use ${method} to learn. We compare against ${method}. Results improve reliability.`,
  authors: [{ family: "Browser" }],
});
const second = await repo.createWork({
  title: "Second browser " + stamp,
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
async function api(method, path, payload) {
  const r = await app.inject({ method, url: "/api/v1" + path, payload });
  assert.ok(r.statusCode < 300, r.body);
  return r.json();
}
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
      await page.goto(base + "/knowledge");
      break;
    } catch {
      if (i === 39) throw Error(logs);
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  await page
    .getByLabel("New note title", { exact: true })
    .fill("Context note " + stamp);
  await page.getByRole("button", { name: "Create note", exact: true }).click();
  await page
    .getByLabel("Personal interpretation (Markdown)", { exact: true })
    .fill(
      "My interpretation is **qualified**. $x^2$\n\n| Method | Result |\n| --- | --- |\n| A | B |",
    );
  await page.locator(".katex").waitFor();
  await page.getByLabel("Add local image", { exact: true }).setInputFiles({
    name: "dot.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await page
    .getByText("Image inserted into draft.", { exact: false })
    .waitFor();
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await page.waitForResponse(
    (r) =>
      r.url().includes("/knowledge/notes/") && r.request().method() === "GET",
  );
  await page
    .getByLabel("Source passage", { exact: true })
    .selectOption(passage);
  await page
    .getByLabel("Reference kind", { exact: true })
    .selectOption("figure");
  await page
    .getByLabel("Reference label", { exact: true })
    .fill("Figure 1 context");
  await page.getByRole("button", { name: "Attach source reference" }).click();
  await page.getByText("figure: Figure 1 context").waitFor();
  const noteUrl = page.url();
  await page.reload();
  await page.locator(".rich-markdown img").waitFor();
  assert.ok(
    await page.locator(".rich-markdown img").evaluate(async (image) => {
      await image.decode();
      return image.naturalWidth > 0;
    }),
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve(output, "notes.png"), fullPage: true });
  const noteId = noteUrl.split("/").at(-1),
    topic = await api("POST", "/knowledge/notes", {
      title: "Topic synthesis " + stamp,
      noteType: "topic",
    });
  await api("PUT", `/knowledge/notes/${topic.id}/links/${noteId}`, {
    rationale: "Reuse source understanding",
  });
  await page.reload();
  await page
    .getByRole("link", { name: "Topic synthesis " + stamp, exact: true })
    .waitFor();
  await page.goto(base + "/knowledge?tab=reading");
  await page
    .getByLabel("Reading project", { exact: true })
    .selectOption(project.id);
  const row = page
    .locator("section.review-panel")
    .filter({ has: page.getByRole("link", { name: title, exact: true }) });
  await row
    .getByLabel("Question this paper may answer")
    .fill("Can this method generalize?");
  await row
    .getByLabel("Why I saved this paper")
    .fill("Useful method comparison");
  await row.getByLabel("In my reading queue").check();
  await row.getByRole("button", { name: "Save reading plan" }).click();
  await page
    .getByRole("link", { name: "Resume next: " + title, exact: true })
    .waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: resolve(output, "reading.png"),
    fullPage: true,
  });
  await page.goto(base + "/knowledge?tab=entities");
  await page.getByLabel("Entity name", { exact: true }).fill(method);
  await page.getByLabel("Entity type", { exact: true }).selectOption("method");
  await page
    .getByLabel("Aliases (one per line)", { exact: true })
    .fill("BM " + stamp);
  await page.getByRole("button", { name: "Save entity", exact: true }).click();
  await page.locator(".k-row strong").filter({ hasText: method }).waitFor();
  const entity = (await api("GET", "/knowledge/entities")).items.find(
    (e) => e.name === method,
  );
  await page.goto(base + "/knowledge?tab=connections");
  await page.getByLabel("Source object", { exact: true }).selectOption(work.id);
  await page
    .getByLabel("Target object", { exact: true })
    .selectOption(entity.id);
  await page
    .getByLabel("Relationship", { exact: true })
    .selectOption("uses_method");
  await page
    .getByLabel("Relationship rationale", { exact: true })
    .fill("The method explains the training choice.");
  await page
    .getByLabel("Supporting passages", { exact: true })
    .selectOption([passage]);
  await page
    .getByRole("button", { name: "Save connection", exact: true })
    .click();
  await page
    .locator("article.review-panel")
    .filter({ hasText: title })
    .getByText("The method explains the training choice.", { exact: true })
    .waitFor();
  await page.goto(base + "/knowledge?tab=suggestions");
  await page
    .getByLabel("Papers to inspect", { exact: true })
    .selectOption([work.id]);
  await page
    .getByRole("button", { name: "Generate suggestions", exact: true })
    .click();
  await page
    .getByText("Suggestion generation finished.", { exact: true })
    .waitFor();
  const suggestion = page
    .locator("article.review-panel")
    .filter({ hasText: title })
    .first();
  await suggestion.getByRole("button", { name: "Accept suggestion" }).click();
  await suggestion.getByText("abstract", { exact: false }).count();
  await page.getByText("Saved.", { exact: true }).waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: resolve(output, "suggestions.png"),
    fullPage: true,
  });
  await page.goto(base + "/knowledge?tab=arguments");
  await page
    .getByLabel("New argument title", { exact: true })
    .fill("Browser argument " + stamp);
  await page
    .getByRole("button", { name: "Create argument", exact: true })
    .click();
  await page.getByRole("button", { name: "Add outline block" }).click();
  await page
    .getByLabel("Block 1 text", { exact: true })
    .fill("Robots can learn from demonstration.");
  await page
    .getByLabel("Block 1 passages", { exact: true })
    .selectOption([passage]);
  await page.getByRole("button", { name: "Save outline", exact: true }).click();
  await page.waitForResponse(
    (r) =>
      r.url().includes("/knowledge/arguments/") &&
      r.request().method() === "GET",
  );
  await page.getByRole("button", { name: "Preview saved Markdown" }).click();
  await page.getByRole("button", { name: "Download Markdown" }).waitFor();
  assert.ok(
    await page
      .locator(".rich-markdown")
      .textContent()
      .then((t) => t.includes("Robots learn from demonstrations.")),
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: resolve(output, "argument.png"),
    fullPage: true,
  });
  await page.goto(base + "/knowledge?tab=comparisons");
  await page
    .getByLabel("New comparison title", { exact: true })
    .fill("Browser comparison " + stamp);
  await page
    .getByLabel("Papers to compare", { exact: true })
    .selectOption([work.id, second.id]);
  await page
    .getByRole("button", { name: "Create comparison", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Edit method for " + title, exact: true })
    .click();
  await page
    .getByLabel("Comparison finding", { exact: true })
    .fill("Demonstration learning");
  await page
    .getByLabel("Cell supporting passage", { exact: true })
    .selectOption(passage);
  await page.getByRole("button", { name: "Save sourced cell" }).click();
  await page
    .getByRole("button", { name: "Edit method for " + title, exact: true })
    .filter({ hasText: "Demonstration learning" })
    .waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: resolve(output, "comparison.png"),
    fullPage: true,
  });
  await page.goto(base + "/explore");
  await page
    .getByLabel("Research question or topic", { exact: true })
    .fill("Robust learning");
  await page
    .getByLabel("DOI or OpenAlex seeds (one per line)", { exact: true })
    .fill("W8801");
  await page.getByRole("button", { name: "Explore literature" }).click();
  await page.getByText("crossref topic: failed", { exact: true }).waitFor();
  await page
    .getByLabel("Import destination", { exact: true })
    .selectOption(project.id);
  for (const c of await page
    .locator("article.review-panel input[type=checkbox]")
    .all())
    await c.check();
  await page
    .getByRole("button", { name: "Import selected (3)", exact: true })
    .click();
  await page.getByText("Selected papers imported;", { exact: false }).waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: resolve(output, "discovery.png"),
    fullPage: true,
  });
  await page.goto(base + "/map");
  await page
    .getByLabel("Active collection", { exact: true })
    .selectOption(project.id);
  await page
    .getByRole("button", { name: "cites", exact: true })
    .first()
    .waitFor();
  await page
    .getByRole("button", { name: "cites", exact: true })
    .first()
    .click();
  await page.getByRole("region", { name: "Selected relationship" }).waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: resolve(output, "layers.png"),
    fullPage: true,
  });
  await page.getByLabel("Direct citations", { exact: false }).uncheck();
  assert.equal(
    await page.getByRole("button", { name: "cites", exact: true }).count(),
    0,
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(await readFile(stored.path), bytes);
  console.log(
    JSON.stringify(
      {
        passed: true,
        screenshots: output,
        checks: [
          "rich note equations/table/image",
          "structured figure reference",
          "note backlink",
          "reading queue",
          "typed edge",
          "entity creation",
          "suggestion acceptance",
          "argument export",
          "sourced comparison",
          "multi-seed discovery coverage/import",
          "layer filters",
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
