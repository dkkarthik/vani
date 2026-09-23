import { v7 as uuid } from "uuid";
import { pool, transaction } from "../db.js";
import { Repository } from "../repository.js";
import { manualCollection } from "../research/organization.js";
import { retainCandidateSource } from "../planning/monitor.js";
import { Profile, type Settings } from "./settings.js";
import { aliases, isPublicPaper, storePaper } from "./corpus.js";
import { fetchBatch, ProviderError, type Task } from "./sources.js";
import { rankInWorker } from "./ranking.js";
import type { Document } from "./ranker.js";
const error = (s: string, statusCode = 409) =>
  Object.assign(Error(s), { statusCode });
export async function settings(id: string) {
  await manualCollection(pool, id);
  const row = (
    await pool.query(
      "SELECT * FROM simple_discovery_settings WHERE collection_id=$1",
      [id],
    )
  ).rows[0];
  if (row) return row;
  const focus = (
    await pool.query("SELECT profile FROM core_focus WHERE collection_id=$1", [
      id,
    ])
  ).rows[0];
  return {
    collection_id: id,
    version: 0,
    profile: Profile.parse({
      publicQueries: (focus?.profile.publicQueries ?? []).slice(0, 8),
    }),
  };
}
export async function saveSettings(
  id: string,
  version: number,
  profile: Settings,
) {
  await manualCollection(pool, id);
  return transaction(async (db) => {
    await db.query("SELECT id FROM collection WHERE id=$1 FOR UPDATE", [id]);
    const old = (
      await db.query(
        "SELECT version FROM simple_discovery_settings WHERE collection_id=$1",
        [id],
      )
    ).rows[0];
    if ((old?.version ?? 0) !== version)
      throw error("Discovery settings changed; reload before saving.");
    const row = (
      await db.query(
        "INSERT INTO simple_discovery_settings(collection_id,version,profile) VALUES($1,$2,$3) ON CONFLICT(collection_id) DO UPDATE SET version=excluded.version,profile=excluded.profile,next_refresh_at=now(),updated_at=now() RETURNING *",
        [id, version + 1, JSON.stringify(profile)],
      )
    ).rows[0];
    await db.query(
      "UPDATE simple_run SET status='superseded',updated_at=now() WHERE collection_id=$1 AND status IN ('queued','running')",
      [id],
    );
    return row;
  });
}
export async function enqueue(
  id: string,
  mode: "refresh" | "rerank" = "refresh",
) {
  const cfg = await settings(id);
  if (!cfg.version || !cfg.profile.enabled)
    throw error("Enable simple discovery and save its settings first.");
  return transaction(async (db) => {
    await db.query("SELECT id FROM collection WHERE id=$1 FOR UPDATE", [id]);
    const current = (
      await db.query(
        "SELECT * FROM simple_discovery_settings WHERE collection_id=$1",
        [id],
      )
    ).rows[0];
    if (current.version !== cfg.version)
      throw error("Discovery settings changed; retry.");
    const active = (
      await db.query(
        "SELECT * FROM simple_run WHERE collection_id=$1 AND status IN ('queued','running')",
        [id],
      )
    ).rows[0];
    if (active) {
      if (mode === "rerank")
        await db.query("UPDATE simple_run SET rerank=true WHERE id=$1", [
          active.id,
        ]);
      return active;
    }
    const p = Profile.parse(current.profile),
      tasks: Task[] = [];
    if (mode === "refresh") {
      // Cycle sources within each query so a broken provider cannot starve the others.
      for (const query of p.publicQueries)
        for (const source of [...new Set(p.sources)])
          tasks.push({
            source,
            query,
            kind: "query",
            page: 0,
            state: "pending",
            found: 0,
          });
      if (p.sources.includes("arxiv") && p.arxivCategories.length)
        tasks.push({
          source: "arxiv",
          query: p.arxivCategories.join(","),
          kind: "feed",
          page: 0,
          state: "pending",
          found: 0,
        });
      if (!tasks.length)
        throw error(
          "Add public search queries or arXiv categories before refreshing.",
        );
    }
    const run = (
      await db.query(
        "INSERT INTO simple_run(id,collection_id,settings_version,snapshot,tasks) VALUES($1,$2,$3,$4,$5) RETURNING *",
        [uuid(), id, current.version, JSON.stringify(p), JSON.stringify(tasks)],
      )
    ).rows[0];
    if (mode === "refresh")
      await db.query(
        "UPDATE simple_discovery_settings SET next_refresh_at=now()+interval '24 hours' WHERE collection_id=$1",
        [id],
      );
    return run;
  });
}
async function rerank(run: any) {
  const labelVersion = (
    await pool.query(
      "SELECT label_version FROM simple_discovery_settings WHERE collection_id=$1",
      [run.collection_id],
    )
  ).rows[0].label_version;
  const repo = new Repository();
  const members = await repo.listWorks({
    collectionId: run.collection_id,
    limit: 10000,
  });
  const focus = (
    await pool.query("SELECT profile FROM core_focus WHERE collection_id=$1", [
      run.collection_id,
    ])
  ).rows[0]?.profile;
  const seeds = [...members.slice(0, 200)];
  for (const anchor of (focus?.anchors ?? []).slice(0, 30))
    if (!seeds.some((s) => s.id === anchor.workId)) {
      const w = await repo.getWork(anchor.workId);
      if (w) seeds.push(w);
    }
  const feedback = (
    await pool.query(
      "SELECT r.*,p.paper FROM simple_recommendation r JOIN simple_paper p ON p.id=r.paper_id WHERE r.collection_id=$1 AND (feedback IS NOT NULL OR work_id IS NOT NULL)",
      [run.collection_id],
    )
  ).rows;
  const labels = new Map(feedback.map((f) => [f.paper_id, f.feedback]));
  const publicRows = (
    await pool.query(
      "SELECT * FROM simple_paper ORDER BY updated_at DESC,id LIMIT 20000",
    )
  ).rows;
  // Keep explicitly judged records even if they fall outside the recency-bounded pool.
  const rows = [
    ...new Map(
      [
        ...feedback.map((f) => ({ id: f.paper_id, paper: f.paper })),
        ...publicRows,
      ].map((r) => [r.id, r]),
    ).values(),
  ];
  const seedKeys = new Set([...members, ...seeds].flatMap(aliases)),
    seen = new Set<string>(),
    eligible: any[] = [];
  const rejectedKeys = new Set(
    feedback
      .filter((f) => f.feedback === "down")
      .flatMap((f) => aliases(f.paper)),
  );
  const documents: Document[] = seeds
    .filter(
      (s) =>
        s.recordKind !== "demo_fixture" &&
        !aliases(s).some((k) => rejectedKeys.has(k)),
    )
    .map((s) => ({
      id: "seed:" + s.id,
      title: s.title,
      abstract: s.abstract,
      seed: true,
    }));
  for (const row of rows) {
    const keys = aliases(row.paper);
    if (keys.some((k) => seen.has(k))) continue;
    for (const k of keys) seen.add(k);
    const label = labels.get(row.id);
    const member = keys.some((k) => seedKeys.has(k));
    if (!member)
      documents.push({
        id: row.id,
        title: row.paper.title,
        abstract: row.paper.abstract,
        label: label ?? undefined,
      });
    else if (label === "down")
      documents.push({
        id: row.id,
        title: row.paper.title,
        abstract: row.paper.abstract,
        label: "down",
      });
    if (!member) eligible.push(row);
  }
  const result = await rankInWorker(
    documents,
    (focus?.question ?? "") + " " + run.snapshot.publicQueries.join(" "),
  );
  const eligibleIds = new Set(eligible.map((r) => r.id));
  const ranked = result.items.filter((i) => eligibleIds.has(i.id));
  const chosen = ranked
    .filter((i) => labels.get(i.id) !== "down")
    .slice(0, run.snapshot.maxRecommendations);
  // Keep dismissed papers visible under their filter, and persist their new scores too.
  chosen.push(...ranked.filter((i) => labels.get(i.id) === "down"));
  await transaction(async (db) => {
    await db.query("SELECT id FROM collection WHERE id=$1 FOR UPDATE", [
      run.collection_id,
    ]);
    const state = (
      await db.query("SELECT status FROM simple_run WHERE id=$1 FOR UPDATE", [
        run.id,
      ])
    ).rows[0];
    const cfg = (
      await db.query(
        "SELECT version,label_version FROM simple_discovery_settings WHERE collection_id=$1",
        [run.collection_id],
      )
    ).rows[0];
    if (
      !["queued", "running"].includes(state?.status) ||
      cfg.version !== run.settings_version
    )
      return;
    if (cfg.label_version !== labelVersion) {
      await db.query("UPDATE simple_run SET rerank=true WHERE id=$1", [run.id]);
      return;
    }
    await db.query(
      "UPDATE simple_recommendation SET run_id=NULL WHERE collection_id=$1",
      [run.collection_id],
    );
    // Mark the earlier ranking as retained; list endpoints only expose the latest published model generation.
    for (const item of chosen)
      await db.query(
        "INSERT INTO simple_recommendation(collection_id,paper_id,run_id,score,explanation) VALUES($1,$2,$3,$4,$5) ON CONFLICT(collection_id,paper_id) DO UPDATE SET run_id=excluded.run_id,score=excluded.score,explanation=excluded.explanation,updated_at=now()",
        [
          run.collection_id,
          item.id,
          run.id,
          item.score,
          JSON.stringify({
            terms: item.terms,
            cosine: item.cosine,
            algorithm: result.metadata.algorithm,
          }),
        ],
      );
    await db.query(
      "INSERT INTO simple_model(collection_id,run_id,metadata,model) VALUES($1,$2,$3,$4) ON CONFLICT(collection_id) DO UPDATE SET run_id=excluded.run_id,metadata=excluded.metadata,model=excluded.model,updated_at=now()",
      [
        run.collection_id,
        run.id,
        JSON.stringify({
          ...result.metadata,
          labelVersion,
          seedLimit: 200,
          eligible: eligible.length,
          shown: chosen.length,
          corpusLimit: 20000,
        }),
        JSON.stringify(result.model),
      ],
    );
    await db.query(
      "UPDATE simple_run SET rerank=false,counters=$2,updated_at=now() WHERE id=$1",
      [run.id, JSON.stringify(result.metadata)],
    );
  });
}
export async function runSimpleWorker() {
  const db = await pool.connect();
  let locked = false;
  try {
    locked = (await db.query("SELECT pg_try_advisory_lock(73421931) locked"))
      .rows[0].locked;
    if (!locked) return;
    const run = (
      await db.query(
        "SELECT r.* FROM simple_run r JOIN collection c ON c.id=r.collection_id AND c.deleted_at IS NULL WHERE r.status IN ('queued','running') ORDER BY r.updated_at,r.created_at LIMIT 1",
      )
    ).rows[0];
    if (!run) return;
    const started = await db.query(
      "UPDATE simple_run SET status='running',updated_at=now() WHERE id=$1 AND status IN ('queued','running')",
      [run.id],
    );
    if (!started.rowCount) return;
    try {
      if (run.rerank) {
        await rerank(run);
        return;
      }
      const tasks: Task[] = run.tasks;
      const task = tasks.find((t) => t.state === "pending");
      if (!task) {
        await db.query(
          "UPDATE simple_run SET status=$2,updated_at=now() WHERE id=$1 AND status='running' AND rerank=false",
          [
            run.id,
            tasks.some((t) => t.state === "failed") ? "partial" : "completed",
          ],
        );
        return;
      }
      const clock = (
        await db.query(
          "SELECT next_at FROM simple_source_clock WHERE source=$1",
          [task.source],
        )
      ).rows[0];
      if (clock && new Date(clock.next_at).getTime() > Date.now()) {
        if (new Date(clock.next_at).getTime() - Date.now() <= 3500) return;
        // Publish partial results instead of repeatedly blocking the worker on a throttled source.
        task.state = "failed";
        task.retryAt = new Date(clock.next_at).toISOString();
        task.error = "Source cooling down; refresh after " + task.retryAt;
      } else {
        await db.query(
          "INSERT INTO simple_source_clock(source,next_at) VALUES($1,now()+interval '3 seconds') ON CONFLICT(source) DO UPDATE SET next_at=excluded.next_at",
          [task.source],
        );
        try {
          const batch = await fetchBatch(task);
          for (const paper of batch) await storePaper(paper, task);
          task.found += batch.length;
          task.page++;
          if (batch.length < 100) task.state = "complete";
          else if (task.page >= run.snapshot.pagesPerQuery)
            task.state = "limited";
          // Rotate pending page tasks so every source gets a first page before later pages.
          tasks.splice(tasks.indexOf(task), 1);
          tasks.push(task);
        } catch (e) {
          task.state = "failed";
          task.error =
            e instanceof ProviderError
              ? e.message
              : `${task.source}: request or response failed; retry this source later.`;
          if (e instanceof ProviderError && e.retryAt) {
            task.retryAt = e.retryAt;
            await db.query(
              "UPDATE simple_source_clock SET next_at=$2 WHERE source=$1",
              [task.source, e.retryAt],
            );
          }
        }
      }
      await db.query(
        "UPDATE simple_run SET tasks=$2,rerank=true,updated_at=now() WHERE id=$1 AND status='running'",
        [run.id, JSON.stringify(tasks)],
      );
    } catch (e) {
      await db.query(
        "UPDATE simple_run SET status='failed',error=$2,updated_at=now() WHERE id=$1 AND status='running'",
        [run.id, String(e).slice(0, 1000)],
      );
    }
  } finally {
    if (locked) await db.query("SELECT pg_advisory_unlock(73421931)");
    db.release();
  }
}
export async function scheduleSimple() {
  const rows = (
    await pool.query(
      "SELECT s.collection_id FROM simple_discovery_settings s JOIN collection c ON c.id=s.collection_id AND c.deleted_at IS NULL WHERE s.profile->>'enabled'='true' AND s.profile->>'daily'='true' AND s.next_refresh_at<=now() LIMIT 20",
    )
  ).rows;
  for (const r of rows)
    try {
      await enqueue(r.collection_id);
    } catch {
      await pool.query(
        "UPDATE simple_discovery_settings SET next_refresh_at=now()+interval '1 hour' WHERE collection_id=$1",
        [r.collection_id],
      );
    }
}
export async function importRetained(id: string) {
  await settings(id);
  let imported = 0;
  const rows = (
    await pool.query(
      "SELECT c.paper,c.feedback FROM core_candidate c WHERE c.collection_id=$1 AND NOT EXISTS(SELECT 1 FROM work w WHERE w.id=c.work_id AND w.access_class IN ('private','user_uploaded')) ORDER BY (c.feedback <> '{}'::jsonb) DESC,c.updated_at DESC LIMIT 2000",
      [id],
    )
  ).rows;
  for (const r of rows)
    if (isPublicPaper(r.paper)) {
      const paperId = await storePaper(r.paper, { kind: "retained" });
      const label = ["closest", "related"].includes(r.feedback?.label)
        ? "up"
        : r.feedback?.label === "out_of_scope"
          ? "down"
          : null;
      if (paperId && label)
        await transaction(async (db) => {
          await db.query("SELECT id FROM collection WHERE id=$1 FOR UPDATE", [
            id,
          ]);
          const inserted = await db.query(
            "INSERT INTO simple_recommendation(collection_id,paper_id,feedback,reason) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING paper_id",
            [id, paperId, label, r.feedback.reason ?? ""],
          );
          if (inserted.rowCount) {
            await db.query(
              "INSERT INTO simple_feedback(id,collection_id,paper_id,judgment) VALUES($1,$2,$3,$4)",
              [
                uuid(),
                id,
                paperId,
                JSON.stringify({
                  label,
                  reason: r.feedback.reason ?? "",
                  origin: "core_feedback_import",
                }),
              ],
            );
            await db.query(
              "UPDATE simple_discovery_settings SET label_version=label_version+1 WHERE collection_id=$1",
              [id],
            );
          }
        });
      imported++;
    }
  return { imported };
}
export async function savePaper(collection: string, paperId: string) {
  await settings(collection);
  const r = (
    await pool.query(
      "SELECT r.*,p.paper FROM simple_recommendation r JOIN simple_paper p ON p.id=r.paper_id WHERE r.collection_id=$1 AND r.paper_id=$2",
      [collection, paperId],
    )
  ).rows[0];
  if (!r) throw error("Recommendation not found.", 404);
  const repo = new Repository();
  const work = r.work_id
    ? await repo.getWork(r.work_id)
    : await repo.createWork({ ...r.paper, deduplicateByTitle: true });
  if (!work) throw error("Paper unavailable.", 404);
  await retainCandidateSource(work.id, r.paper);
  await transaction(async (db) => {
    await db.query("SELECT id FROM collection WHERE id=$1 FOR UPDATE", [
      collection,
    ]);
    await db.query(
      "INSERT INTO simple_feedback(id,collection_id,paper_id,judgment) VALUES($1,$2,$3,$4)",
      [
        uuid(),
        collection,
        paperId,
        JSON.stringify({ label: "up", origin: "save_to_collection" }),
      ],
    );
    await db.query(
      "INSERT INTO collection_membership(collection_id,work_id,inclusion_reason) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [
        collection,
        work.id,
        JSON.stringify({
          kind: "manual",
          text: "Saved from simple discovery recommendations.",
          paperId,
          score: r.score,
          ranking: r.explanation,
        }),
      ],
    );
    await db.query(
      "UPDATE simple_discovery_settings SET label_version=label_version+1 WHERE collection_id=$1",
      [collection],
    );
    await db.query(
      "UPDATE simple_recommendation SET work_id=$3,feedback='up',updated_at=now() WHERE collection_id=$1 AND paper_id=$2",
      [collection, paperId, work.id],
    );
  });
  return { workId: work.id };
}
