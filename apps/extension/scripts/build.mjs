import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
await rm(`${root}/dist`, { recursive: true, force: true });
await mkdir(`${root}/dist`, { recursive: true });
await build({
  entryPoints: ["popup", "options", "background"].map(
    (name) => `${root}/src/${name}.ts`,
  ),
  outdir: `${root}/dist`,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "chrome120",
  sourcemap: false,
  minify: false,
});
for (const file of [
  "manifest.json",
  "popup.html",
  "options.html",
  "styles.css",
  "icons",
]) {
  await cp(`${root}/${file}`, `${root}/dist/${file}`, { recursive: true });
}
