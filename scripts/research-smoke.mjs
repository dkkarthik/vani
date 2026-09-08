/* global console, process, Buffer, setTimeout, URL, window */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { buildApp } from "../apps/api/dist/app.js";
import { migrate } from "../apps/api/dist/cli/migrate.js";
import { pool } from "../apps/api/dist/db.js";
assert.equal(
  process.env.VANI_INTEGRATION_TEST,
  "true",
  "Use a disposable DATABASE_URL and VANI_DATA_DIR with VANI_INTEGRATION_TEST=true.",
);
const apiPort = Number(process.env.VANI_SMOKE_API_PORT || "58082"),
  webPort = Number(process.env.VANI_SMOKE_WEB_PORT || "55174");
const output = resolve(
  process.env.VANI_SMOKE_OUTPUT || "/tmp/vani-research-smoke",
);
await mkdir(output, { recursive: true });
await migrate();
const app = await buildApp();
let vite, browser;
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
  let viteLog = "";
  vite.stderr.on("data", (chunk) => {
    viteLog += chunk;
  });
  vite.stdout.on("data", (chunk) => {
    viteLog += chunk;
  });
  const collection = (
    await app.inject({
      method: "POST",
      url: "/api/v1/collections",
      payload: { name: `Browser import ${Date.now()}` },
    })
  ).json();
  browser = await chromium.launch({
    headless: true,
    ...(process.env.VANI_SMOKE_CHROMIUM
      ? { executablePath: process.env.VANI_SMOKE_CHROMIUM }
      : {}),
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      await page.goto(`http://127.0.0.1:${webPort}/imports`);
      break;
    } catch {
      if (attempt === 39) throw new Error(viteLog);
      await new Promise((done) => setTimeout(done, 250));
    }
  }
  await page.getByLabel("Destination collection").selectOption(collection.id);
  const title = `Browser bibliography ${Date.now()}`;
  const input = JSON.stringify([
    {
      id: "browser",
      title,
      type: "book",
      author: [{ given: "Ana", family: "García" }],
      publisher: "Example Press",
      issued: { "date-parts": [[2024]] },
      note: "A migrated reading note",
      tags: ["unmapped tag"],
    },
  ]);
  await page.getByLabel("Bibliographies and PDFs").setInputFiles({
    name: "browser.json",
    mimeType: "application/json",
    buffer: Buffer.from(input),
  });
  await page
    .getByRole("button", { name: "Preview import", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Review before importing · preview" })
    .waitFor();
  await page.getByRole("button", { name: "Edit record", exact: true }).click();
  await page
    .getByLabel("Title", { exact: true })
    .fill("Corrected during preview");
  await page
    .getByRole("button", { name: "Save metadata", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Edit record", exact: true })
    .waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: resolve(output, "import-preview.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Confirm selected records", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Import report · complete" })
    .waitFor();
  const reportUrl = page.url();
  await page.reload();
  await page
    .getByRole("heading", { name: "Import report · complete" })
    .waitFor();
  const downloadResponse = await page.request.get(
    new URL(
      await page
        .getByRole("link", { name: "browser.json", exact: true })
        .getAttribute("href"),
      page.url(),
    ).href,
  );
  assert.equal(await downloadResponse.text(), input);
  await page
    .getByRole("link", { name: "Review imported paper metadata" })
    .click();
  await page
    .getByRole("heading", { name: "Edit canonical metadata" })
    .waitFor();
  await page
    .getByLabel("Title · Your correction", { exact: true })
    .fill("My protected correction");
  await page
    .getByRole("button", { name: "Save metadata", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "My protected correction", exact: true })
    .waitFor();
  const editedDoc = (
    await app.inject({
      method: "GET",
      url: `/api/v1/works/${page.url().split("/").at(-2)}/metadata`,
    })
  ).json();
  assert.deepEqual(
    editedDoc.fields.authors.map(({ given, family }) => ({ given, family })),
    [{ given: "Ana", family: "García" }],
  );
  assert.equal(editedDoc.fields.year, 2024);
  assert.equal(editedDoc.fields.publisher, "Example Press");
  assert.deepEqual(editedDoc.locks, ["title"]);
  await page.reload();
  assert.equal(
    await page
      .getByLabel("Title · Your correction", { exact: true })
      .inputValue(),
    "My protected correction",
  );
  await page
    .getByRole("checkbox", { name: "Apply Title", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Apply selections and record review" })
    .click();
  await page
    .getByText("Selected fields contain your corrections.", { exact: false })
    .waitFor();
  await page
    .getByRole("checkbox", {
      name: "Allow selected source fields to replace my protected corrections",
    })
    .check();
  await page
    .getByRole("button", { name: "Apply selections and record review" })
    .click();
  await page.getByRole("heading", { name: title, exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("Title", { exact: true }).inputValue(),
    title,
  );
  await page
    .getByRole("heading", { name: "Decision history" })
    .scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: resolve(output, "metadata-review.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto(reportUrl);
  await page
    .getByRole("heading", { name: "Import report · complete" })
    .waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: resolve(output, "import-report-compact.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        passed: true,
        checks: [
          "preview edit",
          "confirmation",
          "persisted report",
          "exact original download",
          "protected correction",
          "explicit source override",
          "decision history",
          "no browser exceptions",
        ],
        screenshots: output,
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  vite?.kill("SIGTERM");
  await app.close();
  await pool.end();
}
