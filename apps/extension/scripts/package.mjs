import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { join } from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const { version } = JSON.parse(
  await readFile(join(root, "manifest.json"), "utf8"),
);
const output = fileURLToPath(new URL("../../../dist/", import.meta.url));
await mkdir(output, { recursive: true });
const archive = join(output, `vani-chrome-extension-${version}.zip`);
await rm(archive, { force: true });
execFileSync("zip", ["-q", "-r", archive, ".", "-x", "*.DS_Store"], {
  cwd: join(root, "dist"),
});
execFileSync("unzip", ["-t", archive], { stdio: "inherit" });
