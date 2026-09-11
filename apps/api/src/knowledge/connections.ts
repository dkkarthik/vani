import { createHash } from "node:crypto";
import { v7 as uuid } from "uuid";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { KId as Id, EntityType, EdgeInput } from "@vani/shared";
import { pool, transaction } from "../db.js";
import { fail } from "../metadata.js";
import { displayRef, resolveRef, refs, type DB } from "./common.js";
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const Entity = z.object({
  name: z.string().trim().min(1).max(200),
  entityType: EntityType,
  aliases: z
    .array(z.string().trim().min(1).max(200))
    .max(100)
    .transform((a) => [...new Set(a)]),
});
async function lock(db: DB) {
  await db.query(
    "SELECT pg_advisory_xact_lock(hashtext('knowledge-identity'))",
  );
}
export async function edgeView(e: any, db: DB = pool) {
  return {
    ...e,
    source: await displayRef(e.source, db),
    target: await displayRef(e.target, db),
    passages: await Promise.all(
      e.passage_ids.map((id: string) =>
        displayRef({ kind: "passage", id }, db),
      ),
    ),
  };
}
export async function insertEdge(
  db: DB,
  data: z.infer<typeof EdgeInput>,
  origin = "user",
  provenance: unknown = {},
) {
  const s = await resolveRef(data.source, db),
    t = await resolveRef(data.target, db);
  if (s.kind === t.kind && s.id === t.id)
    fail(400, "Choose different endpoints.");
  await refs(data.passageIds, "passage", db);
  const id = uuid();
  await db.query(
    "INSERT INTO knowledge_edge(id,source,target,predicate,rationale,origin,provenance,passage_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      id,
      JSON.stringify({ kind: s.kind, id: s.id }),
      JSON.stringify({ kind: t.kind, id: t.id }),
      data.predicate,
      data.rationale,
      origin,
      JSON.stringify(provenance),
      data.passageIds,
    ],
  );
  return { id };
}
async function entity(id: string, db: DB) {
  const row = (
    await db.query(
      "SELECT * FROM knowledge_entity WHERE id=canonical_entity($1)",
      [id],
    )
  ).rows[0];
  if (!row) fail(404, "Entity not found.");
  return row;
}
async function affected(id: string, db: DB) {
  return (
    await db.query(
      `SELECT * FROM knowledge_edge WHERE deleted_at IS NULL AND ((source->>'kind'='entity' AND canonical_entity((source->>'id')::uuid)=$1) OR (target->>'kind'='entity' AND canonical_entity((target->>'id')::uuid)=$1)) ORDER BY id`,
      [id],
    )
  ).rows;
}
const Merge = z.object({ sourceId: Id, targetId: Id });
const Split = z.object({
  entityId: Id,
  name: z.string().trim().min(1).max(200),
  aliases: z.array(z.string()).max(100),
  edgeIds: z.array(Id).max(1000),
});
async function mergePreview(d: z.infer<typeof Merge>, db: DB) {
  const source = await entity(d.sourceId, db),
    target = await entity(d.targetId, db);
  if (source.id === target.id) fail(400, "Choose two different entities.");
  if (source.entity_type !== target.entity_type)
    fail(409, "Only entities of the same type can merge.");
  const edges = await affected(source.id, db);
  const collapsedEdgeIds: string[] = [];
  for (const edge of edges) {
    if (edge.source.kind !== "entity" || edge.target.kind !== "entity")
      continue;
    const s = await resolveRef(edge.source, db),
      t = await resolveRef(edge.target, db);
    if (
      [source.id, target.id].includes(s.id) &&
      [source.id, target.id].includes(t.id)
    )
      collapsedEdgeIds.push(edge.id);
  }
  const snapshot = { source, target, edges, collapsedEdgeIds };
  return { ...snapshot, previewHash: hash(snapshot) };
}
async function splitPreview(d: z.infer<typeof Split>, db: DB) {
  const source = await entity(d.entityId, db),
    edges = await affected(source.id, db);
  if (d.aliases.some((a) => !source.aliases.includes(a)))
    fail(400, "Select only existing aliases.");
  if (
    new Set(d.edgeIds).size !== d.edgeIds.length ||
    d.edgeIds.some((id) => !edges.some((e) => e.id === id))
  )
    fail(400, "Select only edges belonging to this entity.");
  const snapshot = {
    source,
    selection: Split.parse(d),
    edges: edges.filter((e) => d.edgeIds.includes(e.id)),
  };
  return { ...snapshot, previewHash: hash(snapshot) };
}
export function ruleMatches(text: string, names: string[]) {
  const out: {
    predicate: string;
    quote: string;
    rule: string;
    confidence: number;
  }[] = [];
  for (const sentence of text
    .split(/(?<=[.!?])\s+|\n/)
    .filter((s) => s.length <= 1500)) {
    for (const name of names) {
      const at = sentence.toLowerCase().indexOf(name.toLowerCase());
      if (
        at < 0 ||
        /[\p{L}\p{N}_]/u.test(sentence[at - 1] ?? "") ||
        /[\p{L}\p{N}_]/u.test(sentence[at + name.length] ?? "")
      )
        continue;
      const before = sentence.slice(Math.max(0, at - 90), at).toLowerCase();
      for (const [pattern, predicate, rule] of [
        [
          /\b(uses?|using|appl(?:y|ies|ied))\b[^.!?]{0,60}$/,
          "uses_method",
          "explicit use cue before entity",
        ],
        [
          /\b(extends?|builds? on)\b[^.!?]{0,60}$/,
          "extends",
          "explicit extension cue before entity",
        ],
        [
          /\b(compares? (?:against|with|to)|compared (?:against|with|to))\b[^.!?]{0,60}$/,
          "compares_against",
          "explicit comparison cue before entity",
        ],
      ] as const) {
        if (pattern.test(before) && !/\b(not|never|without|no)\b/.test(before))
          out.push({
            predicate,
            quote: sentence.trim(),
            rule,
            confidence: 0.65,
          });
      }
    }
  }
  return [...new Map(out.map((o) => [o.predicate + o.quote, o])).values()];
}
export async function registerConnections(app: FastifyInstance) {
  app.get("/api/v1/knowledge/options", async () => ({
    works: (
      await pool.query(
        "SELECT id,title label FROM work WHERE merged_into IS NULL AND deleted_at IS NULL ORDER BY title LIMIT 500",
      )
    ).rows,
    notes: (
      await pool.query(
        "SELECT id,title label FROM note WHERE deleted_at IS NULL ORDER BY title LIMIT 500",
      )
    ).rows,
    entities: (
      await pool.query(
        "SELECT id,name label,entity_type FROM knowledge_entity WHERE merged_into IS NULL ORDER BY name LIMIT 500",
      )
    ).rows,
    passages: (
      await pool.query(
        `SELECT a.id,w.title||' · p. '||a.page_start||' · '||left(coalesce(a.selector->>'quote',a.body_markdown),80) label FROM annotation a JOIN attachment at ON at.id=a.attachment_id JOIN work w ON w.id=canonical_work(at.work_id) WHERE a.deleted_at IS NULL AND w.deleted_at IS NULL ORDER BY a.created_at DESC LIMIT 500`,
      )
    ).rows,
    limit: 500,
  }));
  app.get("/api/v1/knowledge/edges", async () => ({
    items: await Promise.all(
      (
        await pool.query(
          "SELECT * FROM knowledge_edge WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 1000",
        )
      ).rows.map((e) => edgeView(e)),
    ),
    limit: 1000,
  }));
  app.post("/api/v1/knowledge/edges", async (r) =>
    transaction(async (db) => {
      await lock(db);
      return insertEdge(db, EdgeInput.parse(r.body));
    }),
  );
  app.patch("/api/v1/knowledge/edges/:id", async (r) => {
    const id = Id.parse((r.params as any).id),
      d = EdgeInput.extend({ version: z.number().int().positive() }).parse(
        r.body,
      );
    return transaction(async (db) => {
      await lock(db);
      const s = await resolveRef(d.source, db),
        t = await resolveRef(d.target, db);
      if (s.id === t.id && s.kind === t.kind)
        fail(400, "Choose different endpoints.");
      await refs(d.passageIds, "passage", db);
      const result = await db.query(
        `UPDATE knowledge_edge SET source=$2,target=$3,predicate=$4,rationale=$5,passage_ids=$6,version=version+1 WHERE id=$1 AND version=$7 AND deleted_at IS NULL RETURNING *`,
        [
          id,
          JSON.stringify({ kind: s.kind, id: s.id }),
          JSON.stringify({ kind: t.kind, id: t.id }),
          d.predicate,
          d.rationale,
          d.passageIds,
          d.version,
        ],
      );
      if (!result.rowCount)
        fail(409, "Relationship changed. Reload before saving.");
      return edgeView(result.rows[0], db);
    });
  });
  app.delete("/api/v1/knowledge/edges/:id", async (r) => {
    const id = Id.parse((r.params as any).id),
      { version } = z
        .object({ version: z.number().int().positive() })
        .parse(r.body);
    return transaction(async (db) => {
      await lock(db);
      if (
        !(
          await db.query(
            "UPDATE knowledge_edge SET deleted_at=now(),version=version+1 WHERE id=$1 AND version=$2 AND deleted_at IS NULL",
            [id, version],
          )
        ).rowCount
      )
        fail(409, "Relationship changed. Reload before removing.");
      return { removed: true };
    });
  });
  app.get("/api/v1/knowledge/entities", async () => ({
    items: (
      await pool.query(
        "SELECT * FROM knowledge_entity ORDER BY name LIMIT 1000",
      )
    ).rows,
    audit: (
      await pool.query(
        "SELECT * FROM entity_audit ORDER BY created_at DESC LIMIT 50",
      )
    ).rows,
    limit: 1000,
  }));
  app.post("/api/v1/knowledge/entities", async (r) => {
    const d = Entity.parse(r.body),
      id = uuid();
    await pool.query(
      "INSERT INTO knowledge_entity(id,name,entity_type,aliases,origin) VALUES($1,$2,$3,$4,$5)",
      [id, d.name, d.entityType, d.aliases, JSON.stringify({ type: "user" })],
    );
    return { id };
  });
  app.patch("/api/v1/knowledge/entities/:id", async (r) => {
    const d = Entity.extend({ version: z.number().int().positive() }).parse(
        r.body,
      ),
      id = Id.parse((r.params as any).id);
    return transaction(async (db) => {
      await lock(db);
      if (
        !(
          await db.query(
            "UPDATE knowledge_entity SET name=$2,entity_type=$3,aliases=$4,version=version+1 WHERE id=$1 AND version=$5 AND merged_into IS NULL",
            [id, d.name, d.entityType, d.aliases, d.version],
          )
        ).rowCount
      )
        fail(409, "Entity changed. Reload before saving.");
      return { saved: true };
    });
  });
  app.post("/api/v1/knowledge/entities/merge-preview", async (r) =>
    mergePreview(Merge.parse(r.body), pool),
  );
  app.post("/api/v1/knowledge/entities/merge", async (r) => {
    const d = Merge.extend({ previewHash: z.string() }).parse(r.body);
    return transaction(async (db) => {
      await lock(db);
      const p = await mergePreview(d, db);
      if (p.previewHash !== d.previewHash)
        fail(409, "Merge preview changed. Review again.");
      await db.query(
        "UPDATE knowledge_entity SET aliases=$2,version=version+1 WHERE id=$1",
        [
          p.target.id,
          [
            ...new Set([
              ...p.target.aliases,
              p.source.name,
              ...p.source.aliases,
            ]),
          ].filter((n) => n !== p.target.name),
        ],
      );
      await db.query(
        "UPDATE knowledge_entity SET merged_into=$2,version=version+1 WHERE id=$1",
        [p.source.id, p.target.id],
      );
      await db.query(
        "UPDATE knowledge_edge SET deleted_at=now(),version=version+1 WHERE id=ANY($1::uuid[])",
        [p.collapsedEdgeIds],
      );
      await db.query("INSERT INTO entity_audit VALUES($1,$2,$3,now())", [
        uuid(),
        "merge",
        JSON.stringify(p),
      ]);
      return { id: p.target.id };
    });
  });
  app.post("/api/v1/knowledge/entities/split-preview", async (r) =>
    splitPreview(Split.parse(r.body), pool),
  );
  app.post("/api/v1/knowledge/entities/split", async (r) => {
    const d = Split.extend({ previewHash: z.string() }).parse(r.body);
    return transaction(async (db) => {
      await lock(db);
      const p = await splitPreview(d, db);
      if (p.previewHash !== d.previewHash)
        fail(409, "Split preview changed. Review again.");
      const id = uuid();
      await db.query(
        "INSERT INTO knowledge_entity(id,name,entity_type,aliases,origin) VALUES($1,$2,$3,$4,$5)",
        [
          id,
          d.name,
          p.source.entity_type,
          d.aliases,
          JSON.stringify({ type: "user_split", from: p.source.id }),
        ],
      );
      await db.query(
        "UPDATE knowledge_entity SET aliases=$2,version=version+1 WHERE id=$1",
        [
          p.source.id,
          p.source.aliases.filter((a: string) => !d.aliases.includes(a)),
        ],
      );
      for (const e of p.edges) {
        const s = await resolveRef(e.source, db),
          t = await resolveRef(e.target, db);
        await db.query(
          "UPDATE knowledge_edge SET source=$2,target=$3,version=version+1 WHERE id=$1",
          [
            e.id,
            JSON.stringify(
              s.kind === "entity" && s.id === p.source.id
                ? { kind: "entity", id }
                : e.source,
            ),
            JSON.stringify(
              t.kind === "entity" && t.id === p.source.id
                ? { kind: "entity", id }
                : e.target,
            ),
          ],
        );
      }
      await db.query("INSERT INTO entity_audit VALUES($1,$2,$3,now())", [
        uuid(),
        "split",
        JSON.stringify({ ...p, newId: id }),
      ]);
      return { id };
    });
  });
  app.get("/api/v1/knowledge/entities/suggest", async () => {
    const rows = (
      await pool.query(
        `SELECT w.id,w.title,w.tags,(SELECT jsonb_agg(p.display_name) FROM authorship au JOIN person p ON p.id=au.person_id WHERE au.work_id=w.id) authors FROM work w WHERE merged_into IS NULL AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 500`,
      )
    ).rows;
    const existing = (
        await pool.query(
          "SELECT name,aliases FROM knowledge_entity WHERE merged_into IS NULL",
        )
      ).rows
        .flatMap((e) => [e.name, ...e.aliases])
        .map((n) => n.toLowerCase()),
      dismissed = new Set(
        (await pool.query("SELECT fingerprint FROM entity_dismissal")).rows.map(
          (r) => r.fingerprint,
        ),
      );
    const items: any[] = [];
    const seen = new Set<string>();
    for (const w of rows)
      for (const [type, names] of [
        ["concept", w.tags],
        ["author", w.authors ?? []],
      ])
        for (const name of names) {
          const fingerprint = hash([type, name.toLowerCase()]);
          if (
            existing.includes(name.toLowerCase()) ||
            seen.has(fingerprint) ||
            dismissed.has(fingerprint)
          )
            continue;
          seen.add(fingerprint);
          items.push({
            name,
            entityType: type,
            fingerprint,
            workId: w.id,
            title: w.title,
            derivation:
              type === "author" ? "stored author metadata" : "stored user tag",
          });
        }
    return { items: items.slice(0, 100), limit: 100 };
  });
  app.post("/api/v1/knowledge/entities/dismiss", async (r) => {
    const { fingerprint } = z
      .object({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/) })
      .parse(r.body);
    await pool.query(
      "INSERT INTO entity_dismissal VALUES($1) ON CONFLICT DO NOTHING",
      [fingerprint],
    );
    return { saved: true };
  });
  app.get("/api/v1/knowledge/suggestions", async () => ({
    items: await Promise.all(
      (
        await pool.query(
          "SELECT * FROM knowledge_suggestion ORDER BY created_at DESC LIMIT 500",
        )
      ).rows.map(async (s) => ({
        ...s,
        source: await displayRef(s.source),
        target: await displayRef(s.target),
      })),
    ),
    limit: 500,
  }));
  app.post("/api/v1/knowledge/suggestions/generate", async (r) => {
    const { workIds } = z
      .object({ workIds: z.array(Id).min(1).max(50) })
      .parse(r.body);
    const entities = (
      await pool.query(
        "SELECT * FROM knowledge_entity WHERE merged_into IS NULL AND entity_type IN ('method','concept','dataset','task') ORDER BY id LIMIT 100",
      )
    ).rows;
    let created = 0;
    let examined = 0;
    for (const workId of workIds) {
      const w = await resolveRef({ kind: "work", id: workId });
      const abstract = (
        await pool.query("SELECT abstract FROM work WHERE id=$1", [w.id])
      ).rows[0].abstract;
      const pages = (
        await pool.query(
          `SELECT at.id attachment_id,di.object_hash,p->>'text' text,(p->>'page')::int page FROM attachment at JOIN document_index di ON di.object_hash=at.object_hash CROSS JOIN LATERAL jsonb_array_elements(di.pages) p WHERE canonical_work(at.work_id)=$1 ORDER BY at.id,(p->>'page')::int LIMIT 200`,
          [w.id],
        )
      ).rows;
      const chunks = [
        { text: abstract, kind: "abstract" },
        ...pages.map((p) => ({ ...p, kind: "pdf" })),
      ];
      for (const c of chunks) {
        examined++;
        for (const e of entities)
          for (const m of ruleMatches(c.text.slice(0, 30000), [
            e.name,
            ...e.aliases,
          ])) {
            if (m.predicate === "uses_method" && e.entity_type !== "method")
              continue;
            const evidence = {
              ...m,
              kind: c.kind,
              workId: w.id,
              ...("page" in c
                ? {
                    page: c.page,
                    attachmentId: c.attachment_id,
                    objectHash: c.object_hash,
                  }
                : {}),
            };
            const fingerprint = hash([w.id, e.id, m.predicate, evidence]);
            const result = await pool.query(
              "INSERT INTO knowledge_suggestion(id,fingerprint,source,target,predicate,evidence,confidence) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING",
              [
                uuid(),
                fingerprint,
                JSON.stringify({ kind: "work", id: w.id }),
                JSON.stringify({ kind: "entity", id: e.id }),
                m.predicate,
                JSON.stringify(evidence),
                m.confidence,
              ],
            );
            created += result.rowCount ?? 0;
          }
      }
    }
    return {
      created,
      examined,
      coverage:
        "Selected works only; first 200 indexed pages per work, 30,000 characters per page, 100 curated entities. Rule confidence is heuristic, not calibrated.",
    };
  });
  app.post("/api/v1/knowledge/suggestions/:id/review", async (r) => {
    const id = Id.parse((r.params as any).id),
      { decision } = z
        .object({ decision: z.enum(["accepted", "rejected"]) })
        .parse(r.body);
    return transaction(async (db) => {
      await lock(db);
      const s = (
        await db.query(
          "SELECT * FROM knowledge_suggestion WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (!s) fail(404, "Suggestion not found.");
      if (s.state !== "pending") {
        if (s.state !== decision) fail(409, "Suggestion already reviewed.");
        return s;
      }
      let edgeId = null;
      if (decision === "accepted") {
        const evidence = s.evidence;
        const current =
          evidence.kind === "abstract"
            ? (
                await db.query(
                  "SELECT abstract AS text FROM work WHERE id=canonical_work($1) AND deleted_at IS NULL",
                  [evidence.workId],
                )
              ).rows[0]?.text
            : (
                await db.query(
                  "SELECT p->>'text' AS text FROM attachment a JOIN document_index d ON d.object_hash=a.object_hash CROSS JOIN LATERAL jsonb_array_elements(d.pages) p WHERE a.id=$1 AND a.object_hash=$2 AND (p->>'page')::int=$3",
                  [evidence.attachmentId, evidence.objectHash, evidence.page],
                )
              ).rows[0]?.text;
        if (!current?.includes(evidence.quote))
          fail(
            409,
            "Suggestion source changed or is unavailable. Reject this stale suggestion and generate again.",
          );
        const d = EdgeInput.parse({
          source: s.source,
          target: s.target,
          predicate: s.predicate,
          rationale: s.evidence.quote,
          passageIds: [],
        });
        edgeId = (
          await insertEdge(db, d, "suggested_reviewed", {
            ...s.evidence,
            confidence: s.confidence,
            review: "accepted",
            suggestionId: id,
          })
        ).id;
      }
      await db.query(
        "UPDATE knowledge_suggestion SET state=$2,edge_id=$3 WHERE id=$1",
        [id, decision, edgeId],
      );
      return { id, state: decision, edgeId };
    });
  });
}
