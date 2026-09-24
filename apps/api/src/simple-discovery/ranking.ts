import { Worker } from "node:worker_threads";
import { existsSync } from "node:fs";
import type { Document, rank } from "./ranker.js";
import type { ShortlistOptions, shortlist } from "./shortlist.js";
export async function rankInWorker(
  documents: Document[],
  query: string,
): Promise<ReturnType<typeof rank>> {
  return runWorker("ranker", "rank", [documents, query]);
}
export function shortlistInWorker(
  documents: Document[],
  ids: string[],
  options: ShortlistOptions,
): Promise<ReturnType<typeof shortlist>> {
  return runWorker("shortlist", "shortlist", [documents, ids, options]);
}
async function runWorker(
  file: string,
  fn: string,
  args: unknown[],
): Promise<any> {
  const compiled = new URL(`./${file}.js`, import.meta.url),
    module = existsSync(compiled)
      ? compiled
      : new URL(`./${file}.ts`, import.meta.url);
  return new Promise((resolve, reject) => {
    const w = new Worker(
      new URL(
        "data:text/javascript," +
          encodeURIComponent(
            "import {parentPort,workerData} from 'node:worker_threads'; const code=await import(workerData.module); parentPort.postMessage(code[workerData.fn](...workerData.args));",
          ),
      ),
      { workerData: { module: module.href, fn, args } },
    );
    const timer = setTimeout(() => {
      void w.terminate();
      reject(Error("Local ranking exceeded its two-minute budget."));
    }, 120000);
    w.once("message", (value) => {
      clearTimeout(timer);
      resolve(value);
    });
    w.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    w.once("exit", (code) => {
      if (code) {
        clearTimeout(timer);
        reject(Error("Rank worker exited " + code));
      }
    });
  });
}
