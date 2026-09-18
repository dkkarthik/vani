import process from "node:process";
import console from "node:console";
import { readFile } from "node:fs/promises";
import { compareReports } from "./report.mjs";
const paths = process.argv.slice(2);
if (paths.length !== 2)
  throw Error("Usage: npm run lab:compare -- BEFORE.json AFTER.json");
const [before, after] = await Promise.all(
  paths.map(async (p) => JSON.parse(await readFile(p, "utf8"))),
);
console.log(JSON.stringify(compareReports(before, after), null, 2));
