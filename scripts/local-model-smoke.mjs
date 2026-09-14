/* global fetch, AbortSignal */
import process from "node:process";
import console from "node:console";
import { URL } from "node:url";
import { readFile } from "node:fs/promises";
const settings = { ...process.env };
for (const line of (await readFile(".env", "utf8").catch(() => "")).split(
  "\n",
)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !settings[m[1]])
    settings[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
}
const base = new URL(settings.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434");
if (!["127.0.0.1", "localhost", "[::1]"].includes(base.hostname))
  throw Error("Smoke test requires loopback Ollama.");
const reader = settings.OLLAMA_MODEL ?? "qwen3.8:27b-q4_K_M",
  embedding = settings.OLLAMA_EMBED_MODEL ?? "qwen3-embedding:0.6b";
async function call(path, body) {
  const r = await fetch(new URL(path, base), {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    redirect: "error",
    signal: AbortSignal.timeout(300000),
  });
  if (!r.ok) throw Error(`Ollama ${path}: ${r.status}`);
  return r.json();
}
try {
  const tags = await call("/api/tags");
  for (const name of [reader, embedding]) {
    const m = tags.models.find(
      (m) => m.name === name || m.name === name + ":latest",
    );
    if (!m?.digest || m.remote_host || m.remote_model)
      throw Error("Missing or hosted model: " + name);
  }
  const chat = await call("/api/chat", {
    model: reader,
    messages: [
      {
        role: "user",
        content:
          'Return JSON {"quote":"Robots learn from demonstrations."}. Copy the quoted sentence exactly.',
      },
    ],
    format: "json",
    think: false,
    stream: false,
    keep_alive: "1m",
    options: { num_ctx: 16384, num_predict: 256, temperature: 0 },
  });
  const valid =
    JSON.parse(chat.message.content).quote ===
    "Robots learn from demonstrations.";
  const loaded = await call("/api/ps");
  const resident = loaded.models.find(
    (m) => m.name === reader || m.name === reader + ":latest",
  );
  const vectors = await call("/api/embed", {
    model: embedding,
    input: ["Robot policy learning from demonstrations."],
    truncate: false,
    keep_alive: 0,
  });
  const report = {
    schemaVersion: 1,
    at: new Date().toISOString(),
    reader,
    embedding,
    digests: tags.models
      .filter((m) =>
        [reader, embedding].some(
          (n) => m.name === n || m.name === n + ":latest",
        ),
      )
      .map((m) => ({ name: m.name, digest: m.digest })),
    validJsonAndQuote: valid,
    embeddingDimensions: vectors.embeddings?.[0]?.length ?? 0,
    readerTokensPerSecond: chat.eval_duration
      ? chat.eval_count / (chat.eval_duration / 1e9)
      : null,
    readerGpuFraction: resident?.size
      ? resident.size_vram / resident.size
      : null,
    ready:
      valid &&
      Boolean(vectors.embeddings?.[0]?.length) &&
      Boolean(resident?.size_vram > 0),
    limitations: [
      "Synthetic inference smoke test; does not validate research ranking accuracy or sustained 20k-candidate throughput.",
    ],
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.ready) process.exitCode = 2;
} catch (e) {
  console.error("Local model smoke test failed: " + e.message);
  process.exitCode = 2;
}
