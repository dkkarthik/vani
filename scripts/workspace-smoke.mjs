/* global console, process, setTimeout, window, document */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { v7 as uuid } from "uuid";
import { buildApp } from "../apps/api/dist/app.js";
import { migrate } from "../apps/api/dist/cli/migrate.js";
import { pool } from "../apps/api/dist/db.js";
import { ObjectStore } from "../apps/api/dist/object-store.js";
assert.equal(
  process.env.VANI_INTEGRATION_TEST,
  "true",
  "Use a disposable database and object directory.",
);
const apiPort = Number(process.env.VANI_SMOKE_API_PORT || 58084),
  webPort = Number(process.env.VANI_SMOKE_WEB_PORT || 55176),
  output = process.env.VANI_SMOKE_OUTPUT || "/tmp/vani-workspace-smoke";
await mkdir(output, { recursive: true });
await migrate();
const app = await buildApp();
let browser, vite;
async function api(method, url, payload) {
  const r = await app.inject({ method, url, payload });
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
  const stamp = Date.now(),
    title = "Reader workflow " + stamp;
  const work = await api("POST", "/api/v1/works", {
    title,
    authors: [{ given: "Ana", family: "García" }],
    year: 2026,
  });
  const original = await readFile(
      resolve("apps/api/src/research/fixtures/reading.pdf"),
    ),
    stored = await new ObjectStore().put(original, "application/pdf"),
    attachmentId = uuid();
  await pool.query(
    "INSERT INTO attachment(id,work_id,object_hash,filename) VALUES($1,$2,$3,$4)",
    [attachmentId, work.id, stored.hash, "reading.pdf"],
  );
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
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      await page.goto(base + "/read/" + work.id);
      break;
    } catch {
      if (attempt === 39) throw new Error(logs);
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  await page
    .locator(".textLayer span")
    .filter({ hasText: "Robots learn from demonstrations." })
    .waitFor();
  await page.getByText("Text: ready", { exact: false }).waitFor();
  await page.getByLabel("Search this PDF").fill("reliable control");
  await page.getByRole("button", { name: /Page 2: Evidence/ }).click();
  await page
    .locator(".textLayer span")
    .filter({ hasText: "Evidence connects robust learning" })
    .waitFor();
  assert.equal(
    await page.getByLabel("PDF page", { exact: true }).inputValue(),
    "2",
  );
  await page.screenshot({
    path: resolve(output, "reader-rotated.png"),
    fullPage: true,
  });
  await page.getByLabel("Zoom", { exact: true }).selectOption("1.25");
  await page.waitForResponse(
    (r) => r.url().includes("/position") && r.request().method() === "PUT",
  );
  await page.reload();
  await page
    .locator(".textLayer span")
    .filter({ hasText: "Evidence connects robust learning" })
    .waitFor();
  assert.equal(
    await page.getByLabel("PDF page", { exact: true }).inputValue(),
    "2",
  );
  assert.equal(
    await page.getByLabel("Zoom", { exact: true }).inputValue(),
    "1.25",
  );
  await page
    .getByRole("button", { name: "Previous page", exact: true })
    .click();
  await page
    .locator(".textLayer span")
    .filter({ hasText: "Robots learn from demonstrations." })
    .waitFor();
  const span = page
    .locator(".textLayer span")
    .filter({ hasText: "Robots learn from demonstrations." });
  await span.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    el.dispatchEvent(new window.MouseEvent("mouseup", { bubbles: true }));
  });
  await page
    .getByLabel("Comment", { exact: true })
    .fill("This passage supports our robotics argument.");
  await page
    .getByLabel("Evidence tags (comma separated)")
    .fill("robotics, learning");
  await page
    .getByRole("button", { name: "Save annotation", exact: true })
    .click();
  await page.getByText("Annotation saved.", { exact: true }).waitFor();
  const documentState = await api(
      "GET",
      `/api/v1/attachments/${attachmentId}/document`,
    ),
    annotation = documentState.annotations[0];
  assert.ok(annotation);
  assert.equal(annotation.selector.hash, stored.hash);
  await page.getByRole("button", { name: "Select area", exact: true }).click();
  const bounds = await page.locator(".area-selector").boundingBox();
  assert.ok(bounds);
  await page.mouse.move(bounds.x + 90, bounds.y + 120);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 330, bounds.y + 185, { steps: 5 });
  await page.mouse.up();
  await page.getByLabel("Comment", { exact: true }).fill("A spatial comment");
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes("/annotations") && r.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Save annotation", exact: true }).click(),
  ]);
  await page.goto(base + "/passages/" + annotation.id);
  await page.getByText("Passage anchor: exact", { exact: false }).waitFor();
  await page.locator(".pdf-mark.active").first().waitFor();
  await page.screenshot({
    path: resolve(output, "reader-highlight.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Create linked note", exact: true })
    .first()
    .click();
  await page.goto(base + "/evidence");
  await page.getByLabel("Evidence or paper tag").fill("robotics");
  await page.getByLabel("Argument title").fill("Browser argument " + stamp);
  await page
    .getByRole("button", { name: "Create argument", exact: true })
    .click();
  const argument = await page
    .getByLabel("Target argument")
    .locator("option")
    .filter({ hasText: "Browser argument " + stamp })
    .getAttribute("value");
  await page
    .getByRole("checkbox", {
      name: "Select passage " + annotation.id,
      exact: true,
    })
    .check();
  await page.getByLabel("Target argument").selectOption(argument);
  await page.getByLabel("Why this evidence matters").fill("Direct support");
  await page
    .getByRole("button", { name: "Add selected evidence", exact: true })
    .click();
  await page.getByLabel("Argument", { exact: true }).selectOption(argument);
  await page.getByText("1 passages", { exact: false }).waitFor();
  await page.screenshot({
    path: resolve(output, "evidence.png"),
    fullPage: true,
  });
  await page.goto(base + "/search");
  await page
    .getByLabel("Search query")
    .fill("Robots learn from demonstrations");
  await page.getByLabel("Search mode").selectOption("exact");
  await page
    .getByRole("button", { name: "Search evidence", exact: true })
    .click();
  await page.getByRole("heading", { name: /matching chunks/ }).waitFor();
  assert.ok(
    (await page.getByRole("link", { name: "Open matched source" }).count()) > 0,
  );
  await page.screenshot({
    path: resolve(output, "search.png"),
    fullPage: true,
  });
  await page.goto(base + "/organize");
  await page.getByLabel("Text", { exact: true }).fill(title);
  await page
    .getByRole("checkbox", { name: "Select " + title, exact: true })
    .check();
  await page.getByRole("button", { name: "cleanup", exact: true }).click();
  await page.getByLabel("Operation", { exact: true }).selectOption("add_tag");
  await page.getByLabel("New value / tag").fill("reviewed");
  await page
    .getByRole("button", { name: "Preview selected changes", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Apply previewed changes", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Undo this batch", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Batch · undone", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "collections", exact: true }).click();
  await page
    .getByLabel("Name", { exact: true })
    .fill("Browser collection " + stamp);
  await page
    .getByRole("button", { name: "Save collection", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Edit Browser collection " + stamp,
      exact: true,
    })
    .waitFor();
  await page.screenshot({
    path: resolve(output, "organization.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(await readFile(stored.path), original);
  console.log(
    JSON.stringify(
      {
        passed: true,
        screenshots: output,
        checks: [
          "rotated PDF",
          "in-document search",
          "remembered position and zoom",
          "text highlight",
          "area comment",
          "exact passage link",
          "linked note",
          "argument evidence reuse",
          "exact search",
          "batch preview apply undo",
          "collection creation",
          "original bytes preserved",
        ],
      },
      null,
      2,
    ),
  );
} catch (error) {
  if (browser) {
    const pages = browser.contexts()[0]?.pages();
    await pages?.[0]
      ?.screenshot({ path: resolve(output, "failure.png"), fullPage: true })
      .catch(() => {});
  }
  throw error;
} finally {
  await browser?.close();
  vite?.kill("SIGTERM");
  await app.close();
  await pool.end();
}
