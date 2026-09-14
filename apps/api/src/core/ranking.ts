import { Worker } from "node:worker_threads";
import { existsSync } from "node:fs";
import {
  rankPapers,
  type Paper,
  type FocusProfile,
  defaultWeights,
} from "./algorithm.js";
export async function computeRanking(
  papers: Paper[],
  anchors: Paper[],
  focus: FocusProfile,
  embedding: number[],
  weights = defaultWeights,
): Promise<ReturnType<typeof rankPapers>> {
  if (papers.length < 1000)
    return rankPapers(papers, anchors, focus, embedding, weights);
  const compiled = new URL("./algorithm.js", import.meta.url),
    algorithm = existsSync(compiled)
      ? compiled
      : new URL("./algorithm.ts", import.meta.url);
  // Large sparse graph walks run off the HTTP event loop. Node 22.22+ supports the development .ts module.
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL(
        "data:text/javascript," +
          encodeURIComponent(
            `import {parentPort,workerData} from 'node:worker_threads';const m=await import(workerData.algorithm);parentPort.postMessage(m.rankPapers(...workerData.args));`,
          ),
      ),
      {
        workerData: {
          algorithm: algorithm.href,
          args: [papers, anchors, focus, embedding, weights],
        },
      },
    );
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(
        Error("Graph ranking exceeded its five-minute checkpoint budget."),
      );
    }, 300000);
    worker.once("message", (value) => {
      clearTimeout(timer);
      resolve(value);
    });
    worker.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    worker.once("exit", (code) => {
      clearTimeout(timer);
      if (code) reject(Error("Graph ranking worker exited: " + code));
    });
  });
}
