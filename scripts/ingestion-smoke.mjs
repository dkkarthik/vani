/* global console, process, setTimeout, window, URL, Response, Buffer */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { buildApp } from "../apps/api/dist/app.js";
import { migrate } from "../apps/api/dist/cli/migrate.js";
import { pool } from "../apps/api/dist/db.js";
import { enrichPaper } from "../apps/api/dist/ingestion/enrichment.js";
assert.equal(
  process.env.VANI_INTEGRATION_TEST,
  "true",
  "Use a disposable database.",
);
await migrate();
const stamp = Date.now(),
  output = process.env.VANI_SMOKE_OUTPUT || "/tmp/vani-ingestion-smoke";
await mkdir(output, { recursive: true });
const bytes = Buffer.concat([
  await readFile(resolve("apps/api/src/research/fixtures/reading.pdf")),
  Buffer.from("\n% ingestion fixture " + stamp + "\n"),
]);
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.hostname === "api.crossref.org")
    return Response.json({
      message: {
        title: ["Linked paper " + stamp],
        abstract:
          "We propose an efficient learning method for reliable control.",
        DOI: "10.1234/" + stamp,
      },
    });
  if (url.hostname === "127.0.0.1" && url.port === "11434")
    throw Error("Local model offline fixture");
  return nativeFetch(input, init);
};
const app = await buildApp();
let browser, vite;
try {
  await app.listen({ host: "127.0.0.1", port: 58090 });
  vite = spawn(
    process.execPath,
    [
      resolve("node_modules/vite/bin/vite.js"),
      "--host",
      "127.0.0.1",
      "--port",
      "55182",
      "--strictPort",
    ],
    {
      cwd: resolve("apps/web"),
      env: { ...process.env, VANI_DEV_API_TARGET: "http://127.0.0.1:58090" },
      stdio: "pipe",
    },
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
  for (let i = 0; i < 40; i++) {
    try {
      await page.goto("http://127.0.0.1:55182/collections");
      break;
    } catch {
      if (i === 39) throw Error("Vite did not start");
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  const button = (name) => page.getByRole("button", { name, exact: true }),
    field = (name) => page.getByLabel(name, { exact: true });
  await button("New collection").click();
  await field("Collection name").fill("Ingestion browser " + stamp);
  await button("Create collection").click();
  await page
    .getByRole("heading", { name: "Ingestion browser " + stamp, exact: true })
    .waitFor();
  await field("Collection PDF").setInputFiles({
    name: "demonstrations.pdf",
    mimeType: "application/pdf",
    buffer: bytes,
  });
  await field("Paper title (optional)").fill("Uploaded learning " + stamp);
  const saved = page.waitForResponse(
    (r) => r.url().endsWith("/ingest") && r.status() === 200,
  );
  await button("Add paper").click();
  const result = await (await saved).json();
  await page
    .getByRole("heading", { name: "Collection discovery", exact: true })
    .waitFor();
  await page
    .getByRole("checkbox", { name: "Uploaded learning " + stamp, exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("checkbox", {
        name: "Uploaded learning " + stamp,
        exact: true,
      })
      .isChecked(),
    true,
  );
  await field("Focused topic (optional override)").fill("");
  await button("Save and build collection").click();
  await page
    .getByRole("heading", { name: "Collection discovery", exact: true })
    .waitFor({ state: "hidden" });
  await page
    .getByText("Using search terms from your seed papers", { exact: false })
    .waitFor();
  await enrichPaper(result.work.id);
  await page.reload();
  await field("Active collection").selectOption({
    label: "Ingestion browser " + stamp,
  });
  await page.getByText("Primary contribution:", { exact: false }).waitFor();
  await page.getByText("PDF: saved", { exact: false }).waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: resolve(output, "uploaded.png"),
    fullPage: true,
  });
  await field("Add paper from").selectOption("link");
  await field("Paper link or DOI").fill("https://doi.org/10.1234/" + stamp);
  await field("Paper title (optional)").fill("");
  const linked = page.waitForResponse(
    (r) => r.url().endsWith("/ingest") && r.status() === 200,
  );
  await button("Add paper").click();
  const linkResult = await (await linked).json();
  await page
    .getByRole("heading", { name: "Collection discovery", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("checkbox", {
        name: "Uploaded learning " + stamp,
        exact: true,
      })
      .isChecked(),
    true,
  );
  assert.equal(
    await page
      .getByRole("checkbox", { name: "Linked paper " + stamp, exact: true })
      .isChecked(),
    true,
  );
  await button("Infer a revised focus from all selected seeds").click();
  assert.equal(
    await field("Focused topic (optional override)").inputValue(),
    "",
  );
  await field("Focused topic (optional override)").fill(
    "Efficient demonstration learning for reliable control",
  );
  await button("Save and build collection").click();
  await page
    .getByRole("heading", { name: "Collection discovery", exact: true })
    .waitFor({ state: "hidden" });
  await enrichPaper(linkResult.work.id);
  await page.reload();
  await field("Active collection").selectOption({
    label: "Ingestion browser " + stamp,
  });
  await page.getByText("PDF: unavailable", { exact: false }).waitFor();
  await page
    .getByText(
      "We propose an efficient learning method for reliable control.",
      { exact: false },
    )
    .first()
    .waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: resolve(output, "existing-collection.png"),
    fullPage: true,
  });
  await page
    .getByRole("heading", { name: "Collection keywords", exact: true })
    .waitFor();
  await field("Add collection keyword").fill("unwantedtopic");
  await button("Add keyword").click();
  await button("Remove keyword unwantedtopic").waitFor();
  await button("Remove keyword unwantedtopic").click();
  await button("Remove keyword unwantedtopic").waitFor({ state: "hidden" });
  await page.reload();
  await field("Active collection").selectOption({
    label: "Ingestion browser " + stamp,
  });
  await page
    .getByRole("heading", { name: "Collection keywords", exact: true })
    .waitFor();
  assert.equal(await button("Remove keyword unwantedtopic").count(), 0);
  await page
    .getByText("You uploaded this PDF to the collection.", { exact: false })
    .waitFor();
  await page
    .getByText("You added this paper through a paper link or DOI.", {
      exact: false,
    })
    .waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: resolve(output, "keywords-and-reasons.png"),
    fullPage: true,
  });
  const attachment = (
    await pool.query(
      "SELECT o.storage_path FROM attachment a JOIN object_store o ON o.hash_sha256=a.object_hash WHERE a.work_id=$1",
      [result.work.id],
    )
  ).rows[0];
  assert.deepEqual(await readFile(attachment.storage_path), bytes);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        passed: true,
        screenshots: output,
        checks: [
          "empty collection creation",
          "PDF upload and local bytes",
          "seed selection and explicit focus",
          "background contribution excerpt",
          "DOI ingestion into existing collection",
          "preserved seeds",
          "focus refinement",
          "unavailable PDF and abstract fallback",
          "visible keyword add/remove/persistence",
          "upload and link inclusion reasons",
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
