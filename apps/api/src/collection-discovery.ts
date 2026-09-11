import { seedFocus } from "./seed-focus.js";
import { queueEnrichment, runEnrichment } from "./ingestion/enrichment.js";
import {
  captureDigest,
  feedbackFor,
  retainCandidateSource,
  refreshWatchedSources,
} from "./planning/monitor.js";
import { z } from "zod";
import { DiscoverySeed, type CollectionWork, type Work } from "@vani/shared";
import { pool, query, transaction } from "./db.js";
import { Repository } from "./repository.js";
import { discoverCollection } from "./connectors.js";
import { firstPass, synthesize } from "./first-pass.js";
import { config } from "./config.js";

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
    await client.query(
      "UPDATE collection SET discovery=$2,next_discovery_at=now(),discovery_error=NULL,updated_at=now() WHERE id=$1",
      [id, JSON.stringify(seed)],
    );
    for (const workId of seed.workIds)
      await client.query(
        "INSERT INTO collection_membership(collection_id,work_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
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
    `SELECT cm.work_id,cm.seen_at,cm.status,fp.report,to_jsonb(pe) enrichment FROM collection_membership cm
    LEFT JOIN paper_enrichment pe ON pe.work_id=canonical_work(cm.work_id)
    LEFT JOIN paper_first_pass fp ON fp.collection_id=cm.collection_id AND fp.work_id=cm.work_id WHERE cm.collection_id=$1`,
    [id],
  );
  return {
    items: works.map((work) => {
      const row = metadata.rows.find((item) => item.work_id === work.id);
      return {
        ...work,
        isNew: !row?.seen_at,
        status: row?.status ?? "inbox",
        firstPass: row?.report,
        enrichment: row?.enrichment,
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
  const client = await pool.connect();
  try {
    // A session lock prevents overlapping workers, including across server instances. Released on crash.
    const lock = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(73421901) AS locked",
    );
    if (!lock.rows[0]?.locked) return;
    const due =
      await client.query<any>(`SELECT id,discovery,last_discovery_at FROM collection WHERE deleted_at IS NULL
      AND discovery->>'enabled'='true' AND next_discovery_at<=now() ORDER BY next_discovery_at`);
    for (const row of due.rows) {
      const seed = DiscoverySeed.parse(row.discovery);
      try {
        await captureDigest(row.id);
        const since = row.last_discovery_at
          ? new Date(new Date(row.last_discovery_at).getTime() - 90 * 86400000)
              .toISOString()
              .slice(0, 10)
          : undefined;
        const result = await discoverCollection(
          seed.topic,
          config.openAlexEmail,
          since,
        );
        const filtered = await feedbackFor(
          result.items,
          "collection:" + row.id,
        );
        for (const candidate of filtered.items) {
          if (relevance(seed.topic, candidate.title, candidate.abstract) < 0.35)
            continue;
          const work = await repository.createWork(candidate);
          await retainCandidateSource(work.id, candidate);
          await repository.addToCollection(row.id, [work.id]);
          await queueEnrichment(work.id);
        }
        const sourceChecks = await refreshWatchedSources(row.id);
        result.warnings.push(...sourceChecks.warnings);
        await captureDigest(row.id);
        await reviewMembers(repository, row.id);
        await query(
          "UPDATE collection SET last_discovery_at=now(),next_discovery_at=$2,discovery_error=$3 WHERE id=$1 AND discovery=$4::jsonb",
          [
            row.id,
            nextMorning(new Date(), seed.timezone, seed.hour),
            result.warnings.join("; ") || null,
            JSON.stringify(seed),
          ],
        );
      } catch (error) {
        await query(
          "UPDATE collection SET discovery_error=$2,next_discovery_at=now()+interval '1 hour' WHERE id=$1 AND discovery=$3::jsonb",
          [row.id, String(error), JSON.stringify(seed)],
        );
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(73421901)");
    client.release();
  }
}

export function startDiscoveryWorker(
  repository: Repository,
  onError: (error: unknown) => void,
) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runEnrichment();
      await runDueCollections(repository);
    } catch (error) {
      onError(error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), 60_000);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
