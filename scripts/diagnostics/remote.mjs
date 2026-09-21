/* global fetch, AbortSignal */
import { URL } from "node:url";
import process from "node:process";
import console from "node:console";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
export function summarize(core, members) {
  const candidates = core.candidates ?? [];
  const errors = {};
  for (const c of candidates)
    if (c.last_error) errors[c.last_error] = (errors[c.last_error] ?? 0) + 1;
  return {
    focus: core.focus?.profile,
    focusVersion: core.focus?.version,
    members: members.items?.map((w) => ({ id: w.id, title: w.title })),
    counts: core.counts,
    candidatesCaptured: candidates.length,
    errors,
    runs: core.runs?.map((r) => ({
      id: r.id,
      status: r.status,
      phase: r.phase,
      error: r.error,
      counters: r.counters,
      nextAttemptAt: r.next_attempt_at,
      updatedAt: r.updated_at,
      frontierTasks: r.frontier?.length,
    })),
    admission:
      core.focus?.profile.mode === "review"
        ? "Review mode requires explicit acceptance; discovery does not itself add collection members."
        : "Inspect policy and admission evidence.",
    candidateStatesNote:
      "D1b needs_evidence also includes screening rejection or exhausted D2 budget; it does not necessarily mean a missing PDF.",
    sample: candidates.slice(0, 30).map((c) => ({
      id: c.id,
      title: c.title,
      stage: c.stage,
      state: c.state,
      proximity: c.proximity,
      error: c.last_error,
      paths: c.paths,
    })),
  };
}
export async function collect(base, destination, request = fetch) {
  const url = new URL(base);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw Error(
      "Use an HTTP(S) origin without credentials or query parameters.",
    );
  const get = async (path) => {
    const r = await request(new URL("/api/v1" + path, url), {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw Error(`${path}: HTTP ${r.status}`);
    return r.json();
  };
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const result = {
    startedAt: new Date().toISOString(),
    base: url.origin,
    readOnly: true,
    limitations: [
      "Live pagination is not a transactionally consistent snapshot; production may change during collection.",
      "Only API-visible diagnostics are captured. Host tests and full assessment history require SSH.",
    ],
    collections: [],
  };
  for (const [name, path] of [
    ["health", "/health"],
    ["system", "/system/health"],
    ["updates", "/system/updates"],
  ]) {
    try {
      result[name] = await get(path);
    } catch (e) {
      result[name] = { error: e.message };
    }
  }
  const collections = await get("/collections");
  for (const collection of collections.items) {
    const id = encodeURIComponent(collection.id);
    const core = await get(`/collections/${id}/core`);
    const expected = (core.counts ?? []).reduce(
      (n, c) => n + Number(c.count),
      0,
    );
    let offset = core.candidates.length;
    while (offset < expected && offset < 20000) {
      const page = await get(`/collections/${id}/core?offset=${offset}`);
      if (!page.candidates?.length) break;
      core.candidates.push(...page.candidates);
      offset += page.candidates.length;
    }
    const members = await get(`/collections/${id}/members`);
    const summary = {
      id: collection.id,
      name: collection.name,
      ...summarize(core, members),
      expectedCandidates: expected,
      uniqueCandidates: new Set(core.candidates.map((c) => c.id)).size,
      complete: new Set(core.candidates.map((c) => c.id)).size >= expected,
    };
    result.collections.push(summary);
    await writeFile(
      resolve(destination, id + ".json"),
      JSON.stringify({ collection, core, members }, null, 2),
      { mode: 0o600 },
    );
  }
  result.finishedAt = new Date().toISOString();
  await writeFile(
    resolve(destination, "summary.json"),
    JSON.stringify(result, null, 2),
    { mode: 0o600 },
  );
  return result;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [base, out] = process.argv.slice(2);
  if (!base || !out)
    throw Error(
      "Usage: node scripts/diagnostics/remote.mjs http://host:3000 OUTPUT_DIRECTORY",
    );
  const result = await collect(base, resolve(out));
  console.log(
    JSON.stringify(
      {
        saved: resolve(out),
        collections: result.collections.map((c) => ({
          name: c.name,
          members: c.members.length,
          candidates: c.candidatesCaptured,
          complete: c.complete,
          errors: c.errors,
        })),
      },
      null,
      2,
    ),
  );
}
