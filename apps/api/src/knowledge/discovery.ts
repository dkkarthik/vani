import { queueEnrichment } from '../ingestion/enrichment.js';
import { feedbackFor,feedbackContext } from '../planning/monitor.js';
import { createHash } from "node:crypto";
import { z } from "zod";
import { v7 as uuid } from "uuid";
import type { FastifyInstance } from "fastify";
import { KId as Id } from "@vani/shared";
import { searchCrossref, type Candidate } from "../connectors.js";
import { config } from "../config.js";
import { pool } from "../db.js";
import { Repository } from "../repository.js";
import { cleanDoi } from "../lib/citations.js";
import { fail } from "../metadata.js";
import { manualCollection } from "../research/organization.js";
const Input = z
  .object({
    query: z.string().trim().max(500).default(""),
    collectionId: Id.optional(),
    seeds: z.array(z.string().trim().min(1).max(300)).max(5).default([]),
    direction: z.enum(["seed", "references", "citing", "both"]).default("both"),
    sources: z
      .array(z.enum(["openalex", "crossref"]))
      .min(1)
      .default(["openalex", "crossref"]),
    excludeTerms: z
      .array(z.string().trim().min(1).max(200))
      .max(30)
      .default([]),
    excludeIds: z.array(z.string().max(300)).max(100).default([]),
  })
  .refine(
    (d) => d.query.length >= 2 || d.seeds.length > 0,
    "Provide a question or seed.",
  );
export function normalizeSeed(s: string) {
  const x = s.trim().replace(/^https?:\/\/openalex.org\//i, "");
  if (/^W\d+$/i.test(x)) return x.toUpperCase();
  const doi = cleanDoi(s);
  if (doi && /^10\.\d{4,9}\/[^\s]+$/i.test(doi))
    return "https://doi.org/" + doi;
  return null;
}
export function openAlexCandidate(item: any): Candidate {
  const abstract = Object.entries(item.abstract_inverted_index ?? {})
    .flatMap(([word, positions]) =>
      (positions as number[]).map((position) => ({ word, position })),
    )
    .sort((a, b) => a.position - b.position)
    .map((p) => p.word)
    .join(" ");
  return {
    title: item.title ?? item.display_name ?? "Untitled",
    abstract,
    year: item.publication_year ?? null,
    doi: cleanDoi(item.doi),
    venue: item.primary_location?.source?.display_name ?? "",
    authors: (item.authorships ?? []).map((a: any) => {
      const parts = String(a.author?.display_name ?? "Unknown").split(/\s+/);
      return { given: parts.slice(0, -1).join(" "), family: parts.at(-1)! };
    }),
    connector: "openalex",
    externalId: item.id,
    sourcePayload: item,
    verificationStatus: item.doi ? "partial" : "unverified",
  };
}
async function oa(path: string, params: Record<string, string> = {}) {
  const url = new URL("https://api.openalex.org/works" + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (config.openAlexEmail)
    url.searchParams.set("mailto", config.openAlexEmail);
  const key = process.env.OPENALEX_API_KEY;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "VANI/0.1",
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok)
    throw new Error(
      `OpenAlex returned HTTP ${response.status}${response.status === 401 || response.status === 403 ? " (check OPENALEX_API_KEY)" : ""}.`,
    );
  return response.json() as Promise<any>;
}
export async function runDiscovery(input: z.infer<typeof Input>) {
  const coverage: any[] = [];
  const results: any[] = [];
  const collect = async (label: string, task: () => Promise<any[]>) => {
    try {
      const items = await task();
      coverage.push({
        source: label,
        state: "ok",
        returned: items.length,
        limit: 20,
      });
      results.push(...items);
    } catch (e) {
      coverage.push({
        source: label,
        state: "failed",
        message: e instanceof Error ? e.message : "Provider unavailable",
      });
    }
  };
  if (input.query)
    await Promise.all(
      input.sources.map((source) =>
        collect(source + " topic", async () =>
          source === "crossref"
            ? (await searchCrossref(input.query, 20)).map((c) => ({
                ...c,
                paths: [{ kind: "topic", source }],
              }))
            : (
                await oa("", { search: input.query, per_page: "20" })
              ).results.map((p: any) => ({
                ...openAlexCandidate(p),
                paths: [{ kind: "topic", source }],
              })),
        ),
      ),
    );
  if (input.seeds.length && !input.sources.includes("openalex"))
    coverage.push({
      source: "Seed expansion",
      state: "unavailable",
      message: "Enable OpenAlex to resolve and expand seeds.",
    });
  if (input.sources.includes("openalex"))
    await Promise.all(
      input.seeds.map((seed) =>
        collect("seed " + seed, async () => {
          let normalized = normalizeSeed(seed);
          if (!normalized && Id.safeParse(seed).success) {
            const local = (
              await pool.query(
                "SELECT doi FROM work WHERE id=canonical_work($1)",
                [seed],
              )
            ).rows[0];
            const record = (
              await pool.query(
                "SELECT external_id FROM source_record WHERE canonical_work(work_id)=canonical_work($1) AND connector='openalex' ORDER BY retrieved_at DESC LIMIT 1",
                [seed],
              )
            ).rows[0];
            normalized = normalizeSeed(record?.external_id ?? local?.doi ?? "");
          }
          if (!normalized)
            throw new Error(
              "Use a DOI, OpenAlex W ID, or a saved paper with a DOI/OpenAlex record.",
            );
          const raw = await oa("/" + normalized);
          const root = openAlexCandidate(raw),
            found: any[] = [
              {
                ...root,
                paths: [{ kind: "seed", seed: raw.id, source: "openalex" }],
              },
            ];
          const tasks: Promise<void>[] = [];
          if (["references", "both"].includes(input.direction)) {
            const ids = (raw.referenced_works ?? [])
              .map(normalizeSeed)
              .filter(Boolean)
              .slice(0, 20);
            if (ids.length)
              tasks.push(
                collect(seed + " references", async () => {
                  const data = await oa("", {
                    filter: "openalex:" + ids.join("|"),
                    per_page: "20",
                  });
                  return data.results.map((p: any) => ({
                    ...openAlexCandidate(p),
                    paths: [
                      { kind: "reference", seed: raw.id, source: "openalex" },
                    ],
                  }));
                }),
              );
            else
              coverage.push({
                source: seed + " references",
                state: "ok",
                returned: 0,
                limit: 20,
              });
          }
          if (["citing", "both"].includes(input.direction))
            tasks.push(
              collect(seed + " citing", async () => {
                const data = await oa("", {
                  filter: "cites:" + normalizeSeed(raw.id),
                  per_page: "20",
                });
                return data.results.map((p: any) => ({
                  ...openAlexCandidate(p),
                  paths: [{ kind: "citing", seed: raw.id, source: "openalex" }],
                }));
              }),
            );
          await Promise.all(tasks);
          return found;
        }),
      ),
    );
  const merged = new Map<string, any>();
  let excluded = 0;
  for (const c of results) {
    const key = c.doi?.toLowerCase() ?? c.externalId;
    if (
      input.excludeTerms.some((t) =>
        (c.title + " " + c.abstract).toLowerCase().includes(t.toLowerCase()),
      ) ||
      input.excludeIds.some(
        (id) =>
          [
            c.externalId,
            normalizeSeed(c.externalId),
            c.doi,
            normalizeSeed(c.doi ?? ""),
          ].includes(id) ||
          (normalizeSeed(id) !== null &&
            normalizeSeed(id) === normalizeSeed(c.externalId)),
      )
    ) {
      excluded++;
      continue;
    }
    const old = merged.get(key);
    if (old) {
      old.paths.push(...c.paths);
      if (c.connector === "openalex") {
        old.connector = c.connector;
        old.externalId = c.externalId;
        old.sourcePayload = c.sourcePayload;
      }
    } else merged.set(key, { ...c, resultId: uuid() });
  }
  const items = [...merged.values()];
  for (const c of items) {
    const existing = (
      await pool.query(
        `SELECT DISTINCT canonical_work(w.id) id FROM work w LEFT JOIN source_record s ON s.work_id=w.id WHERE w.deleted_at IS NULL AND (($1::text IS NOT NULL AND lower(w.doi)=lower($1)) OR (s.connector=$2 AND s.external_id=$3)) LIMIT 1`,
        [c.doi ?? null, c.connector, c.externalId],
      )
    ).rows[0];
    c.existingWorkId = existing?.id ?? null;
  }
  return {
    ...await feedbackFor(items,feedbackContext(input.query,input.seeds,input.collectionId)),
    coverage,
    excluded,
    bounded: true,
    limits:
      "20 topic results per provider, 20 references and 20 citing papers per seed; metadata coverage only, not exhaustive.",
  };
}
export async function registerDiscovery(
  app: FastifyInstance,
  repository: Repository,
) {
  app.post("/api/v1/knowledge/discovery", async (r) => {
    const input = Input.parse(r.body),
      data = await runDiscovery(input),
      id = uuid();
    await pool.query("INSERT INTO discovery_run VALUES($1,$2,$3,$4,now())", [
      id,
      JSON.stringify(input),
      JSON.stringify(data.items),
      JSON.stringify({
        coverage: data.coverage,
        excluded: data.excluded,
        limits: data.limits,
          suppressed:data.suppressed,contextKey:data.contextKey,
      }),
    ]);
    return { id, ...data };
  });
  app.get("/api/v1/knowledge/discovery/:id", async (r) => {
    const run = (
      await pool.query("SELECT * FROM discovery_run WHERE id=$1", [
        Id.parse((r.params as any).id),
      ])
    ).rows[0];
    if (!run) fail(404, "Discovery run not found.");
    return { id: run.id, items: run.results, ...run.coverage };
  });
  app.post("/api/v1/knowledge/discovery/:id/import", async (r) => {
    const id = Id.parse((r.params as any).id),
      d = z
        .object({
          resultIds: z.array(Id).min(1).max(100),
          collectionId: Id.optional(),
        })
        .parse(r.body);
    if (d.collectionId) await manualCollection(pool, d.collectionId);
    const run = (
      await pool.query("SELECT * FROM discovery_run WHERE id=$1", [id])
    ).rows[0];
    if (!run) fail(404, "Discovery run not found.");
    if (
      d.resultIds.some((k) => !run.results.some((c: any) => c.resultId === k))
    )
      fail(400, "Result is not in this run.");
    const items = [];
    for (const c of run.results.filter((c: any) =>
      d.resultIds.includes(c.resultId),
    )) {
      const existing = (
        await pool.query(
          `SELECT DISTINCT canonical_work(w.id) id FROM work w LEFT JOIN source_record s ON s.work_id=w.id WHERE w.deleted_at IS NULL AND (($1::text IS NOT NULL AND lower(w.doi)=lower($1)) OR (s.connector=$2 AND s.external_id=$3)) LIMIT 1`,
          [c.doi ?? null, c.connector, c.externalId],
        )
      ).rows[0];
      const work = existing
        ? await repository.getWork(existing.id)
        : await repository.createWork(c);
      await pool.query(
        "INSERT INTO source_record(id,work_id,connector,external_id,payload,payload_hash) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",
        [
          uuid(),
          work!.id,
          c.connector,
          c.externalId,
          JSON.stringify(c.sourcePayload),
          createHash("sha256")
            .update(JSON.stringify(c.sourcePayload))
            .digest("hex"),
        ],
      );
      await queueEnrichment(work!.id);
      items.push({ resultId: c.resultId, work });
      if (d.collectionId)
        await repository.addToCollection(d.collectionId, [work!.id],{kind:"selected_discovery",text:"You selected this recommendation from Explorer.",provider:c.connector,paths:c.paths??[],runId:id});
    }
    // Citation facts only when both endpoints exist locally; provider payload is the evidence.
    const records = (
      await pool.query(
        "SELECT DISTINCT ON(canonical_work(s.work_id)) canonical_work(s.work_id) work_id,s.payload,s.external_id FROM source_record s JOIN work w ON w.id=canonical_work(s.work_id) WHERE s.connector='openalex' AND w.deleted_at IS NULL ORDER BY canonical_work(s.work_id),s.retrieved_at DESC LIMIT 3000",
      )
    ).rows;
    const changed = new Set(items.map((i) => i.work!.id));
    const ids = new Map(records.map((s) => [s.external_id, s.work_id]));
    for (const record of records)
      for (const ref of record.payload.referenced_works ?? []) {
        const target = ids.get(ref);
        if (
          target &&
          target !== record.work_id &&
          (changed.has(record.work_id) || changed.has(target))
        )
          await pool.query(
            `INSERT INTO typed_relationship(id,source_work_id,target_work_id,predicate,confidence,verification_status,evidence) VALUES($1,$2,$3,'cites',1,'verified',$4) ON CONFLICT DO NOTHING`,
            [
              uuid(),
              record.work_id,
              target,
              JSON.stringify([
                {
                  exactText: "OpenAlex referenced_works contains " + ref,
                  origin: "structured_data",
                  sourceUrl: record.external_id,
                  referencedId: ref,
                  discoveryRunId: id,
                },
              ]),
            ],
          );
      }
    return { items };
  });
}
