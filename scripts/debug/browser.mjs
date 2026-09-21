import { setTimeout, clearTimeout } from "node:timers";
import process from "node:process";
import console from "node:console";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
const output = resolve(process.argv[2]);
if (!process.env.OLLAMA_BASE_URL?.endsWith(":11437"))
  throw Error("Browser job must run in the managed debug environment.");
const web = spawn(process.execPath, ["scripts/serve-local.mjs"], {
  env: {
    ...process.env,
    VANI_WEB_HOST: "127.0.0.1",
    VANI_WEB_PORT: "3003",
    VANI_API_PORT: "18082",
  },
  stdio: "pipe",
});
let browser;
const errors = [];
const pages = [];
try {
  await new Promise((accept, reject) => {
    const timer = setTimeout(
      () => reject(Error("Debug web startup timeout")),
      10000,
    );
    web.stdout.once("data", () => {
      clearTimeout(timer);
      accept();
    });
    web.once("exit", (code) => {
      clearTimeout(timer);
      reject(Error("Debug web exited " + code));
    });
    web.once("error", reject);
  });
  browser = await chromium.launch({
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => {
    if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`);
  });
  for (const route of ["collections", "library", "search", "settings"]) {
    await page.goto(`http://127.0.0.1:3003/${route}`, {
      waitUntil: "networkidle",
      timeout: 30000,
    });
    await page.screenshot({
      path: resolve(output, route + ".png"),
      fullPage: true,
    });
    pages.push({
      route,
      title: await page.title(),
      rendered: await page.locator("main").isVisible(),
    });
  }
  if (pages.some((p) => !p.rendered) || errors.length)
    throw Error("Browser smoke failed: " + errors.join("; "));
  console.log(
    "Sandbox browser route smoke passed. This does not certify all UI workflows.",
  );
} finally {
  await writeFile(
    resolve(output, "browser.json"),
    JSON.stringify(
      {
        pages,
        errors,
        scope: "Read-only route rendering smoke; not full workflow acceptance.",
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  await browser?.close();
  web.kill("SIGTERM");
}
