/* global chrome, fetch, console */
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { URL } from "node:url";
import { Buffer } from "node:buffer";
import process from "node:process";
import { chromium } from "playwright";

// This explicit variable prevents accidentally using the normal development database.
if (!process.env.VANI_SMOKE_DATABASE_URL)
  throw new Error(
    "Set VANI_SMOKE_DATABASE_URL to a disposable, migrated PostgreSQL database.",
  );
const root = resolve(import.meta.dirname, "..");
const temp = await mkdtemp(join(tmpdir(), "vani-extension-smoke-"));
const output = join(root, "dist", "extension-smoke");
await mkdir(output, { recursive: true });
const apiPort = Number(process.env.VANI_SMOKE_API_PORT || 18080);
const webPort = Number(process.env.VANI_SMOKE_WEB_PORT || 15173);
const baseUrl = `http://127.0.0.1:${apiPort}`;
const appUrl = `http://127.0.0.1:${webPort}`;
const children = [];
const servers = [];
let context;
const start = (args, env = {}) => {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (data) => {
    logs += data;
  });
  child.stderr.on("data", (data) => {
    logs += data;
  });
  children.push(child);
  child.logs = () => logs;
  return child;
};
async function until(check, description, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = await check();
    if (result) return result;
    await delay(100);
  }
  throw new Error(`Timed out: ${description}`);
}
const listen = async (server) => {
  servers.push(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server.address().port;
};
try {
  const api = start(
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      "import {buildApp} from './apps/api/src/app.ts';import {migrate} from './apps/api/src/cli/migrate.ts';await migrate();const app=await buildApp();await app.listen({host:'127.0.0.1',port:Number(process.env.VANI_API_PORT)});",
    ],
    {
      NODE_ENV: "test",
      DATABASE_URL: process.env.VANI_SMOKE_DATABASE_URL,
      VANI_DATA_DIR: join(temp, "data"),
      VANI_WEB_ORIGIN: appUrl,
      VANI_API_PORT: String(apiPort),
    },
  );
  await until(async () => {
    if (api.exitCode !== null) throw new Error(api.logs());
    return fetch(`${baseUrl}/api/v1/health`)
      .then((response) => response.ok)
      .catch(() => false);
  }, "API startup");
  // Vite needs the web workspace as its root; keep the test service isolated from npm dev.
  start(
    [
      "node_modules/vite/bin/vite.js",
      "apps/web",
      "--host",
      "127.0.0.1",
      "--port",
      String(webPort),
      "--strictPort",
    ],
    { VANI_DEV_API_TARGET: baseUrl },
  );
  await until(
    () =>
      fetch(appUrl)
        .then((response) => response.ok)
        .catch(() => false),
    "web startup",
  );
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(temp, "key.pem"),
      "-out",
      join(temp, "cert.pem"),
      "-subj",
      "/CN=localhost",
      "-days",
      "1",
    ],
    { stdio: "ignore" },
  );
  let pdfMode = "pdf";
  const stream =
    "BT /F1 20 Tf 60 700 Td (Connecting evidence across a research collection) Tj 0 -40 Td /F1 12 Tf (Sample paper - extension test fixture) Tj ET";
  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Count 1/Kids[3 0 R]>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>",
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
    `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`,
  ];
  let pdfDocument = "%PDF-1.7\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdfDocument.length);
    pdfDocument += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdfDocument.length;
  pdfDocument += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => String(offset).padStart(10, "0") + " 00000 n ")
    .join("\n")}\ntrailer<</Size 6/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  const pdf = Buffer.from(pdfDocument);
  const pdfPort = await listen(
    createHttpsServer(
      {
        key: await readFile(join(temp, "key.pem")),
        cert: await readFile(join(temp, "cert.pem")),
      },
      async (_request, response) => {
        await delay(2000);
        response.setHeader(
          "Content-Type",
          pdfMode === "pdf" ? "application/pdf" : "text/html",
        );
        response.end(
          pdfMode === "pdf" ? pdf : "<html>Publisher login required</html>",
        );
      },
    ),
  );
  const fixturePort = await listen(
    createServer((_request, response) => {
      response.setHeader("Content-Type", "text/html");
      response.end(
        `<!doctype html><title>Sample paper | Research archive</title><meta name="citation_title" content="Connecting evidence across a research collection"><meta name="citation_author" content="Lee, Grace"><meta name="citation_author" content="Patel, Arun"><meta name="citation_publication_date" content="2026/09/07"><meta name="citation_journal_title" content="Research Methods"><meta name="citation_pdf_url" content="https://127.0.0.1:${pdfPort}/paper.pdf"><meta name="citation_abstract" content="This sample paper demonstrates a connected reading workflow, from collecting sources to preserving evidence."><h1>Connecting evidence across a research collection</h1><p>Sample paper used for extension testing.</p>`,
      );
    }),
  );
  const extension = join(temp, "extension");
  await cp(join(root, "apps/extension/dist"), extension, { recursive: true });
  // Headless Chrome cannot accept its native permission bubble. Pre-grant only
  // the HTTPS fixture host in this disposable copy, leaving the release untouched.
  const manifest = JSON.parse(
    await readFile(join(extension, "manifest.json"), "utf8"),
  );
  assert.deepEqual(manifest.host_permissions, [
    "http://127.0.0.1/*",
    "http://localhost/*",
  ]);
  manifest.host_permissions.push("https://127.0.0.1/*");
  await writeFile(join(extension, "manifest.json"), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(join(temp, "profile"), {
    channel: "chromium",
    headless: true,
    ...(process.env.VANI_TEST_CHROME
      ? { executablePath: process.env.VANI_TEST_CHROME }
      : {}),
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      "--ignore-certificate-errors",
    ],
  });
  const errors = [];
  context.on("page", (page) =>
    page.on("pageerror", (error) => errors.push(error.message)),
  );
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  const extensionId = new URL(worker.url()).host;
  const app = context.pages()[0];
  await app.goto(`${appUrl}/settings`);
  await app.getByRole("button", { name: "Get capture key" }).click();
  const token = await until(
    () =>
      app
        .getByLabel("Capture key", { exact: true })
        .inputValue()
        .catch(() => ""),
    "pairing key",
  );
  assert.match(token, /^[a-f0-9]{64}$/);
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.locator("#token").fill(token);
  await options.locator("summary").click();
  await options.locator("#base-url").fill(baseUrl);
  await options.locator("#app-url").fill(appUrl);
  await options.getByRole("button", { name: "Connect and test" }).click();
  await until(
    async () =>
      (await options.locator("#status").innerText()).startsWith("Connected."),
    "extension pairing",
  );
  await options.locator("#token").fill("");
  await options.setViewportSize({ width: 1280, height: 800 });
  await options.screenshot({ path: join(output, "extension-settings.png") });
  const article = await context.newPage();
  await article.goto(`http://127.0.0.1:${fixturePort}/article?utm_source=test`);
  const cdp = await context.newCDPSession(article);
  async function openPopup() {
    await article.bringToFront();
    await worker.evaluate(() => chrome.action.openPopup());
    const target = await until(
      async () =>
        (await cdp.send("Target.getTargets")).targetInfos.find(
          (target) =>
            target.url === `chrome-extension://${extensionId}/popup.html`,
        ),
      "toolbar popup",
    );
    // Toolbar popups are not exposed as Playwright pages; use the same CDP target directly.
    const { sessionId } = await cdp.send("Target.attachToTarget", {
      targetId: target.targetId,
      flatten: false,
    });
    let sequence = 0;
    const call = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++sequence;
        const receive = (event) => {
          if (event.sessionId !== sessionId) return;
          const data = JSON.parse(event.message);
          if (data.id !== id) return;
          cdp.off("Target.receivedMessageFromTarget", receive);
          if (data.error) reject(new Error(data.error.message));
          else resolve(data.result);
        };
        cdp.on("Target.receivedMessageFromTarget", receive);
        cdp
          .send("Target.sendMessageToTarget", {
            sessionId,
            message: JSON.stringify({ id, method, params }),
          })
          .catch(reject);
      });
    const evaluate = async (expression) => {
      const result = await call("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
        userGesture: true,
      });
      if (result.exceptionDetails)
        throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    await until(
      () =>
        evaluate(
          "document.querySelector('#title')?.value.includes('Connecting evidence')",
        ),
      "page metadata",
    );
    await until(
      () =>
        evaluate(
          "document.querySelector('#collection').options[0]?.textContent !== 'Connecting to VANI…'",
        ),
      "collection list",
    );
    return {
      evaluate,
      call,
      close: () =>
        cdp.send("Target.closeTarget", { targetId: target.targetId }),
    };
  }
  let popup = await openPopup();
  await popup.evaluate(
    "document.querySelector('#new-collection').click();document.querySelector('#collection-name').value='Browser capture smoke';document.querySelector('#create-collection').click()",
  );
  await until(
    () =>
      popup.evaluate("Boolean(document.querySelector('#collection').value)"),
    "create collection",
  );
  await popup.evaluate("document.querySelector('#save').click()");
  await until(
    async () =>
      (await worker.evaluate(() => chrome.storage.local.get("job"))).job
        ?.state === "downloading",
    "background PDF download",
  );
  await popup.close();
  const saved = await until(async () => {
    const { job } = await worker.evaluate(() =>
      chrome.storage.local.get("job"),
    );
    if (job?.state === "error" || job?.state === "partial")
      throw new Error(job.message);
    return job?.state === "complete" && job;
  }, "save after closing popup");
  assert.equal(saved.result.pdfStatus, "saved");
  assert.equal(new URL(saved.result.sourceUrl).search, "");
  console.log(
    "PASS: toolbar metadata extraction, UI pairing, collection creation, and background PDF save after popup closes",
  );
  popup = await openPopup();
  await popup.evaluate("document.querySelector('#save').click()");
  const duplicate = await until(async () => {
    const { job } = await worker.evaluate(() =>
      chrome.storage.local.get("job"),
    );
    return job?.state === "complete" && job.input.id !== saved.input.id && job;
  }, "duplicate save");
  assert.equal(duplicate.result.workId, saved.result.workId);
  assert.equal(duplicate.result.duplicate, true);
  assert.equal(duplicate.result.attachmentId, saved.result.attachmentId);
  console.log("PASS: repeat capture reuses paper and PDF");
  await popup.close();
  pdfMode = "html";
  popup = await openPopup();
  await popup.evaluate("document.querySelector('#save').click()");
  const partial = await until(async () => {
    const { job } = await worker.evaluate(() =>
      chrome.storage.local.get("job"),
    );
    return job?.state === "partial" && job;
  }, "publisher login fallback");
  assert.equal(partial.result.workId, saved.result.workId);
  assert.match(partial.message, /not a PDF/);
  pdfMode = "pdf";
  await popup.evaluate("document.querySelector('#retry').click()");
  await until(
    async () =>
      (await worker.evaluate(() => chrome.storage.local.get("job"))).job
        ?.state === "complete",
    "PDF retry",
  );
  // Re-render the live popup DOM for a full-height store image. Native toolbar
  // screenshots can truncate content at Chrome's popup viewport boundary.
  const markup = await popup.evaluate(`(() => {
    const copy = document.documentElement.cloneNode(true);
    const fields = copy.querySelectorAll('input,textarea,select');
    document.querySelectorAll('input,textarea,select').forEach((field, index) => {
      const target = fields[index];
      if (field.tagName === 'TEXTAREA') target.textContent = field.value;
      else if (field.tagName === 'SELECT') [...target.options].forEach((option, i) => { if (field.options[i].selected) option.setAttribute('selected', ''); else option.removeAttribute('selected'); });
      else { target.setAttribute('value', field.value); if (field.checked) target.setAttribute('checked', ''); else target.removeAttribute('checked'); }
    });
    copy.querySelectorAll('script').forEach(script => script.remove());
    return copy.outerHTML;
  })()`);
  console.log("PASS: login HTML preserves metadata; retry attaches PDF");
  await popup.close();
  const store = join(root, "apps/extension/store");
  const artwork = await context.newPage();
  await artwork.setViewportSize({ width: 410, height: 900 });
  const css = await readFile(join(extension, "styles.css"), "utf8");
  await artwork.setContent(
    markup.replace(
      /<link[^>]+href="styles.css"[^>]*>/,
      `<style>${css}</style>`,
    ),
  );
  const popupImage = await artwork.locator("body").screenshot();
  const screenshot = { data: popupImage.toString("base64") };
  await writeFile(join(output, "capture-popup.png"), popupImage);
  await writeFile(join(store, "popup-example.png"), popupImage);
  await cp(
    join(output, "extension-settings.png"),
    join(store, "settings-1280x800.png"),
  );
  await artwork.setViewportSize({ width: 1280, height: 800 });
  const poster = (await readFile(join(store, "capture.html"), "utf8")).replace(
    "popup-example.png",
    `data:image/png;base64,${screenshot.data}`,
  );
  await artwork.setContent(poster);
  await artwork.locator("img").evaluate((image) => image.decode());
  await artwork.screenshot({ path: join(store, "capture-1280x800.png") });
  await artwork.setViewportSize({ width: 440, height: 280 });
  await artwork.setContent(
    `<style>body{margin:0}</style>${await readFile(join(store, "promo.svg"), "utf8")}`,
  );
  await artwork.screenshot({ path: join(store, "promo-440x280.png") });
  await artwork.close();
  await app.goto(`${appUrl}/read/${saved.result.workId}`);
  await app.getByRole("heading", { name: "Captured sources" }).waitFor();
  await app.setViewportSize({ width: 1280, height: 800 });
  await delay(1500);
  await app.screenshot({ path: join(output, "vani-captured-paper.png") });
  const attachments = await fetch(
    `${baseUrl}/api/v1/works/${saved.result.workId}/attachments`,
  ).then((response) => response.json());
  assert.equal(attachments.items.length, 1);
  const content = await fetch(
    `${baseUrl}/api/v1/attachments/${attachments.items[0].id}/content`,
  );
  assert.equal(content.status, 200);
  assert.deepEqual(Buffer.from(await content.arrayBuffer()), pdf);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: VANI reader displays the captured source and a single PDF attachment",
  );
} finally {
  await context?.close();
  for (const child of children) child.kill("SIGTERM");
  await Promise.all(
    servers.map((server) => new Promise((resolve) => server.close(resolve))),
  );
  await rm(temp, { recursive: true, force: true });
}
