import { enqueueCore, runCoreWorker, resumeEvidence } from "./core/service.js";
import { scheduleAudits, runAuditWorker } from "./core/audits.js";
import { defaultKeywords, keywordMatch } from "./collection-focus.js";
import { seedFocus } from "./seed-focus.js";
import { runEnrichment } from "./ingestion/enrichment.js";
import { captureDigest, refreshWatchedSources } from "./planning/monitor.js";
import { z } from "zod";
import { DiscoverySeed, type CollectionWork, type Work } from "@vani/shared";
import { pool, query, transaction } from "./db.js";
import { Repository } from "./repository.js";
import { firstPass, synthesize } from "./first-pass.js";

// Search by minute in UTC: this handles DST and non-integral UTC offsets without fixed-offset arithmetic.
export function nextMorning(now: Date, timezone: string, hour: number): Date {
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const start = Math.floor(now.getTime() / 60000) * 60000 + 60000;
  for (let time = start; time < start + 49 * 3600000; time += 60000) {
    const parts = format.formatToParts(new Date(time));
    if (
      Number(parts.find((p) => p.type === "hour")?.value) === hour &&
      parts.find((p) => p.type === "minute")?.value === "00"
    )
      return new Date(time);
  }
  throw new Error("Could not compute morning schedule");
}

export async function configureCollection(
  repository: Repository,
  id: string,
  seed: z.infer<typeof DiscoverySeed>,
) {
  const exists = (await repository.listCollections()).some(
    (collection) => collection.id === id,
  );
  if (!exists)
    throw Object.assign(new Error("Collection not found"), { statusCode: 404 });
  seed = { ...seed, topicSource: "manual", topicNotice: "" };
  if (seed.mode === "papers") {
    const works = await Promise.all(
      seed.workIds.map((workId) => repository.getWork(workId)),
    );
    if (works.some((work) => !work || work.recordKind === "demo_fixture"))
      throw Object.assign(
        new Error("Seed papers must be existing scholarly records"),
        { statusCode: 400 },
      );
    if (!seed.topic.trim()) {
      const evidence = await Promise.all(
        works.map(async (work) => ({
          title: work!.title,
          abstract: work!.abstract,
          localExcerpt:
            (
              await query<any>(
                `SELECT d.pages FROM attachment a JOIN document_index d ON d.object_hash=a.object_hash WHERE canonical_work(a.work_id)=$1 ORDER BY a.created_at DESC LIMIT 1`,
                [work!.id],
              )
            ).rows[0]?.pages
              ?.slice(0, 3)
              .map((p: any) => p.text)
              .join("\n")
              .slice(0, 12000) ?? "",
        })),
      );
      try {
        const result = await synthesize(
          "Infer ONE moderately narrow, coherent research topic shared by these seed papers. Specify the problem, method or setting. Return JSON {topic:string}. Return an empty topic if there is no common theme.",
          evidence,
          z.object({ topic: z.string().trim().min(2).max(500) }),
          true,
          12000,
        );
        seed = {
          ...seed,
          topic: result.value.topic,
          topicSource: "model",
          topicNotice: "",
        };
      } catch {
        const topic = seedFocus(evidence);
        seed = {
          ...seed,
          topic,
          topicSource: topic ? "extractive" : "needs_focus",
          enabled: topic ? seed.enabled : false,
          topicNotice: topic
            ? "Using search terms from your seed papers because model synthesis was unavailable. Review or edit this focus in Edit discovery."
            : "Your papers and collection are saved. Enter a focused topic in Edit discovery to enable searches; there was not enough shared text to derive useful search terms.",
        };
      }
    }
  }

  await transaction(async (client) => {
    const saved = await client.query(
      "UPDATE collection SET discovery=CASE WHEN keywords IS NOT NULL AND cardinality(keywords)=0 THEN jsonb_set($2::jsonb,'{enabled}','false') ELSE $2::jsonb END,next_discovery_at=now(),discovery_error=NULL,updated_at=now() WHERE id=$1 RETURNING discovery",
      [id, JSON.stringify(seed)],
    );
    seed = saved.rows[0]?.discovery ?? seed;
    for (const workId of seed.workIds)
      await client.query(
        `INSERT INTO collection_membership(collection_id,work_id,inclusion_reason) VALUES($1,$2,'{"kind":"seed","text":"You selected this paper as a collection seed."}') ON CONFLICT DO NOTHING`,
        [id, workId],
      );
  });
  return seed;
}

export async function collectionMembers(
  repository: Repository,
  id: string,
): Promise<{ items: CollectionWork[] }> {
  const works: Work[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = await repository.listWorks({
      collectionId: id,
      limit: 500,
      offset,
    });
    works.push(...page);
    if (page.length < 500) break;
  }
  const metadata = await query<any>(
    `SELECT cm.work_id,cm.seen_at,cm.status,cm.inclusion_reason,fp.report,to_jsonb(pe) enrichment FROM collection_membership cm
    LEFT JOIN paper_enrichment pe ON pe.work_id=canonical_work(cm.work_id)
    LEFT JOIN paper_first_pass fp ON fp.collection_id=cm.collection_id AND fp.work_id=cm.work_id WHERE cm.collection_id=$1`,
    [id],
  );
  const focus = (
    await query<any>("SELECT keywords,discovery FROM collection WHERE id=$1", [
      id,
    ])
  ).rows[0];
  const keywords =
    focus?.keywords ?? defaultKeywords(focus?.discovery?.topic ?? "");
  return {
    items: works.map((work) => {
      const row = metadata.rows.find((item) => item.work_id === work.id);
      return {
        ...work,
        isNew: !row?.seen_at,
        status: row?.status ?? "inbox",
        firstPass: row?.report,
        enrichment: row?.enrichment,
        inclusionReason: row?.inclusion_reason ?? {
          kind: "legacy",
          text: "The original reason was not recorded for this existing collection member.",
        },
        currentKeywordMatches: keywordMatch(keywords, work.title, work.abstract)
          .matched,
      };
    }),
  };
}

export async function acknowledgeMembers(id: string, workIds: string[]) {
  // Acknowledge only papers actually rendered, never papers arriving concurrently or outside the visible page.
  await query(
    "UPDATE collection_membership SET seen_at=COALESCE(seen_at,clock_timestamp()) WHERE collection_id=$1 AND work_id=ANY($2::uuid[])",
    [id, workIds],
  );
}

export async function reviewMembers(repository: Repository, id: string) {
  const { items } = await collectionMembers(repository, id);
  for (const work of items) {
    if (
      work.recordKind === "demo_fixture" ||
      work.enrichment?.status === "queued" ||
      (work.firstPass &&
        !["needs_evidence", "needs_model"].includes(work.firstPass.status))
    )
      continue;
    const related = rankRelated(work, items);
    const report = await firstPass(work, related);
    await query(
      `INSERT INTO paper_first_pass(collection_id,work_id,report) VALUES($1,$2,$3)
      ON CONFLICT(collection_id,work_id) DO UPDATE SET report=excluded.report,updated_at=now()`,
      [id, work.id, JSON.stringify(report)],
    );
  }
}

const stopWords = new Set(
  "a an the and or for of to in on with by from using based study paper approach research".split(
    " ",
  ),
);
const terms = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .match(/[\p{L}\p{N}]{3,}/gu)
      ?.filter((word) => !stopWords.has(word)) ?? [],
  );
export function relevance(topic: string, title: string, abstract = "") {
  const needles = terms(topic);
  const haystack = terms(`${title} ${abstract}`);
  return needles.size
    ? [...needles].filter((term) => haystack.has(term)).length / needles.size
    : 0;
}
export function rankRelated(work: Work, others: Work[]) {
  return others
    .filter(
      (other) => other.id !== work.id && other.recordKind !== "demo_fixture",
    )
    .sort(
      (a, b) =>
        relevance(work.title, b.title, b.abstract) -
        relevance(work.title, a.title, a.abstract),
    )
    .slice(0, 8);
}

export async function runDueCollections(repository: Repository) {
  void repository;
  const db = await pool.connect();
  let locked = false;
  try {
    locked = (await db.query("SELECT pg_try_advisory_lock(73421912) locked"))
      .rows[0].locked;
    if (!locked) return;
    const due = (
      await db.query(
        "SELECT id,discovery FROM collection WHERE deleted_at IS NULL AND discovery->>'enabled'='true' AND next_discovery_at<=now()",
      )
    ).rows;
    for (const row of due) {
      try {
        const seed = DiscoverySeed.parse(row.discovery);
        await enqueueCore(row.id);
        await refreshWatchedSources(row.id);
        await captureDigest(row.id);
        await query(
          "UPDATE collection SET last_discovery_at=now(),next_discovery_at=$2 WHERE id=$1",
          [row.id, nextMorning(new Date(), seed.timezone, seed.hour)],
        );
      } catch (e) {
        await query(
          "UPDATE collection SET next_discovery_at=now()+interval '1 hour',discovery=discovery||jsonb_build_object('lastError',$2::text) WHERE id=$1",
          [row.id, String(e)],
        );
      }
    }
  } finally {
    if (locked) await db.query("SELECT pg_advisory_unlock(73421912)");
    db.release();
  }
}

export function startDiscoveryWorker(
  repository: Repository,
  onError: (error: unknown) => void,
) {
  // Separate durable queues: a slow paper read must not block daily scheduling,
  // PDF downloads or unrelated collections. Model inference remains serialized
  // by the router's shared priority/resource lease.
  const lane = (work: () => Promise<void>, ms: number) => {
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        await work();
      } catch (error) {
        onError(error);
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(() => void tick(), ms);
    timer.unref();
    void tick();
    return timer;
  };
  const timers = [
    lane(async () => {
      await runCoreWorker();
      await resumeEvidence();
    }, 2000),
    lane(runEnrichment, 3000),
    lane(async () => {
      await runDueCollections(repository);
      await scheduleAudits();
    }, 60000),
    lane(runAuditWorker, 10000),
  ];
  return () => timers.forEach(clearInterval);
}
