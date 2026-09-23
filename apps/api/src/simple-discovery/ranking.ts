import { Worker } from "node:worker_threads";
import { existsSync } from "node:fs";
import type { Document, rank } from "./ranker.js";
export async function rankInWorker(
  documents: Document[],
  query: string,
): Promise<ReturnType<typeof rank>> {
  const compiled = new URL("./ranker.js", import.meta.url),
    module = existsSync(compiled)
      ? compiled
      : new URL("./ranker.ts", import.meta.url);
  return new Promise((resolve, reject) => {
    const w = new Worker(
      new URL(
        "data:text/javascript," +
          encodeURIComponent(
            "import {parentPort,workerData} from 'node:worker_threads'; const {rank}=await import(workerData.module); parentPort.postMessage(rank(workerData.documents,workerData.query));",
          ),
      ),
      { workerData: { module: module.href, documents, query } },
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
