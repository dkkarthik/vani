import { v7 as uuid } from "uuid";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { freemem } from "node:os";
import { z } from "zod";
import { pool, transaction } from "../db.js";
import { generate, modelLoad } from "../models/router.js";
import { hash, nextAudit, defaultWeights, lexical } from "./algorithm.js";
import { getFocus, enqueueCore } from "./service.js";
export function inWindow(
  now: Date,
  timezone: string,
  start: number,
  end: number,
) {
  const hour = Number(
    new Intl.DateTimeFormat("en", {
      timeZone: timezone,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(now),
  );
  return start < end
    ? hour >= start && hour < end
    : start > end
      ? hour >= start || hour < end
      : false;
}
export async function auditIdle(profile: any) {
  const load = modelLoad();
  if (load.active || load.queued || Date.now() - load.lastInteractive < 900000)
    return "Waiting for 15 minutes without interactive work.";
  if (
    !inWindow(
      new Date(),
      profile.audits.timezone,
      profile.audits.startHour,
      profile.audits.endHour,
    )
  )
    return "Outside the configured quiet window.";
  if (freemem() < 4 * 1024 ** 3) return "Insufficient available system memory.";
  try {
    const { stdout } = await promisify(execFile)(
      "nvidia-smi",
      [
        "--query-gpu=utilization.gpu,memory.free",
        "--format=csv,noheader,nounits",
      ],
      { timeout: 3000 },
    );
    const values = stdout
      .trim()
      .split("\n")
      .map((line) => line.split(",").map(Number));
    if (!values.some(([use, free]) => use! < 15 && free! > 4096))
      return "GPU busy or memory headroom insufficient.";
  } catch {
    return "GPU load cannot be verified; audit deferred.";
  }
  if (
    (
      await pool.query(
        "SELECT 1 FROM core_run WHERE status IN ('queued','running') LIMIT 1",
      )
    ).rowCount
  )
    return "Discovery has higher priority.";
  return null;
}
export async function enqueueAudit(
  collectionId: string,
  kind: "early" | "deep",
) {
  const focus = await getFocus(collectionId);
  const referenceSet = (
    await pool.query(
      "SELECT id,paper->>'title' title,assessment->>'contribution' contribution,proximity,feedback FROM core_candidate WHERE collection_id=$1 AND (proximity IN ('closest','related') OR feedback->>'label' IN ('closest','related')) AND COALESCE(feedback->>'label','')<>'out_of_scope' ORDER BY (feedback->>'label'='closest') DESC NULLS LAST,(proximity='closest') DESC,id",
      [collectionId],
    )
  ).rows;

  return transaction(async (db) => {
    await db.query("SELECT id FROM collection WHERE id=$1 FOR UPDATE", [
      collectionId,
    ]);
    const prior = (
      await db.query(
        "SELECT * FROM core_audit WHERE collection_id=$1 AND kind=$2 AND status IN ('queued','running','paused')",
        [collectionId, kind],
      )
    ).rows[0];
    if (prior) return prior;
    const policy = (
      await db.query(
        "SELECT id FROM core_policy WHERE collection_id=$1 AND status='active'",
        [collectionId],
      )
    ).rows[0];
    const audit = (
      await db.query(
        "INSERT INTO core_audit(id,collection_id,kind,snapshot,policy_id) VALUES($1,$2,$3,$4,$5) RETURNING *",
        [
          uuid(),
          collectionId,
          kind,
          JSON.stringify({
            focusVersion: focus.version,
            profile: focus.profile,
            referenceSet,
            referenceSetProvisional: true,
            at: new Date().toISOString(),
          }),
          policy?.id ?? null,
        ],
      )
    ).rows[0];
    await db.query(
      `INSERT INTO core_audit_item(audit_id,candidate_id,snapshot) SELECT $1,id,jsonb_build_object('stage',stage,'state',state,'proximity',proximity,'features',features-'embedding','assessment',assessment,'feedback',feedback,'sourceHash',source_hash,'focusVersion',focus_version,'paper',paper,'evidence',(SELECT sources FROM core_assessment a WHERE a.candidate_id=core_candidate.id ORDER BY created_at DESC LIMIT 1)) FROM core_candidate WHERE collection_id=$2 AND ${kind === "early" ? "true" : "EXISTS(SELECT 1 FROM core_assessment a WHERE a.candidate_id=core_candidate.id AND a.stage IN ('D2','D3'))"}`,
      [audit.id, collectionId],
    );
    return audit;
  });
}
export async function scheduleAudits() {
  const focuses = (
    await pool.query(
      "SELECT * FROM core_focus WHERE profile->'audits'->>'enabled'='true'",
    )
  ).rows;
  for (const f of focuses)
    for (const kind of ["deep", "early"] as const) {
      const previous = (
        await pool.query(
          "SELECT created_at FROM core_audit WHERE collection_id=$1 AND kind=$2 ORDER BY created_at DESC LIMIT 1",
          [f.collection_id, kind],
        )
      ).rows[0];
      if (
        !previous ||
        nextAudit(
          new Date(previous.created_at),
          kind,
          f.profile.audits.timezone,
        ) <= new Date()
      )
        await enqueueAudit(f.collection_id, kind);
    }
}
const Judgment = z.object({
  diagnosis: z.string().max(3000),
  likelyMiss: z.boolean(),
  reason: z.string().max(2000),
  quote: z.string().min(12).max(1000),
  suggestedWeights: z.object({
    lexical: z.number().min(0).max(1),
    semantic: z.number().min(0).max(1),
    graph: z.number().min(0).max(1),
    author: z.number().min(0).max(0.05),
  }),
});
export function boundedWeights(
  old: typeof defaultWeights,
  proposal: typeof defaultWeights,
) {
  const sum = Object.values(proposal).reduce((a, b) => a + b, 0);
  if (sum <= 0) return old;
  const normalized = Object.fromEntries(
    Object.entries(proposal).map(([k, v]) => [k, v / sum]),
  ) as typeof defaultWeights;
  if (normalized.author > 0.05) return old;
  const distance =
    Object.keys(old).reduce(
      (s, k) =>
        s +
        Math.abs(
          old[k as keyof typeof old] - normalized[k as keyof typeof old],
        ),
      0,
    ) / 2;
  const scale = distance > 0.1 ? 0.1 / distance : 1;
  return Object.fromEntries(
    Object.keys(old).map((k) => [
      k,
      old[k as keyof typeof old] +
        scale *
          (normalized[k as keyof typeof old] - old[k as keyof typeof old]),
    ]),
  ) as typeof defaultWeights;
}
export async function runAuditWorker() {
  const db = await pool.connect();
  let locked = false;
  try {
    locked = (await db.query("SELECT pg_try_advisory_lock(73421911) locked"))
      .rows[0].locked;
    if (!locked) return;
    const audit = (
      await pool.query(
        "SELECT * FROM core_audit WHERE status IN ('queued','running','paused') AND next_attempt_at<=now() ORDER BY (kind='deep') DESC,created_at LIMIT 1",
      )
    ).rows[0];
    if (!audit) return;
    const current = await getFocus(audit.collection_id);
    if (current.version !== audit.snapshot.focusVersion) {
      await pool.query(
        "UPDATE core_audit SET status='superseded',report='{\"reason\":\"Focus changed\"}' WHERE id=$1",
        [audit.id],
      );
      return;
    }
    const reason = await auditIdle(audit.snapshot.profile);
    if (reason) {
      await pool.query(
        "UPDATE core_audit SET status='paused',report=report||$2::jsonb,next_attempt_at=now()+interval '5 minutes' WHERE id=$1",
        [audit.id, JSON.stringify({ deferredReason: reason })],
      );
      return;
    }
    const items = (
      await pool.query(
        "SELECT * FROM core_audit_item WHERE audit_id=$1 ORDER BY candidate_id",
        [audit.id],
      )
    ).rows;
    if (!audit.counters.swept) {
      const controls = items.filter(
        (i) => !["related", "closest"].includes(i.snapshot.proximity),
      );
      const cap = audit.kind === "early" ? 100 : 50,
        reserved = audit.kind === "early" ? 25 : 10;
      const sample = (rows: any[], n: number) =>
        [...rows]
          .sort((a, b) =>
            hash([audit.id, a.candidate_id]).localeCompare(
              hash([audit.id, b.candidate_id]),
            ),
          )
          .slice(0, n);
      const chosen = sample(
          controls,
          Math.min(
            controls.length,
            Math.max(reserved, cap - (items.length - controls.length)),
          ),
        ),
        other = sample(
          items.filter(
            (i) => !controls.some((c) => c.candidate_id === i.candidate_id),
          ),
          Math.max(0, cap - chosen.length),
        ),
        selected = new Set([...chosen, ...other].map((i) => i.candidate_id));
      for (const item of items) {
        const isControl = controls.some(
          (c) => c.candidate_id === item.candidate_id,
        );
        await pool.query(
          "UPDATE core_audit_item SET diagnostic=$3,state=$4,sampling_probability=$5 WHERE audit_id=$1 AND candidate_id=$2",
          [
            audit.id,
            item.candidate_id,
            JSON.stringify({
              recordChecked: true,
              recomputedLexical: lexical(
                audit.snapshot.profile.question,
                item.snapshot.paper.title + " " + item.snapshot.paper.abstract,
              ),
              modelReferenceIsNotTruth: true,
              referenceSet: "provisional current assessments",
              label: item.snapshot.feedback?.label ?? "unjudged",
              originalProximity: item.snapshot.proximity,
              sourceHash: item.snapshot.sourceHash,
              control: isControl,
            }),
            selected.has(item.candidate_id) ? "selected" : "metadata_checked",
            isControl
              ? Math.min(1, chosen.length / Math.max(1, controls.length))
              : Math.min(
                  1,
                  other.length / Math.max(1, items.length - controls.length),
                ),
          ],
        );
      }
      await pool.query(
        "UPDATE core_audit SET status='running',counters=$2,updated_at=now() WHERE id=$1",
        [
          audit.id,
          JSON.stringify({
            swept: true,
            records: items.length,
            selected: selected.size,
            fresh: 0,
            milliseconds: 0,
          }),
        ],
      );
      return;
    }
    const limit = (audit.kind === "early" ? 2 : 6) * 3600000;
    const next = items.find((i) => i.state === "selected");
    if (next && Number(audit.counters.milliseconds ?? 0) < limit) {
      const start = Date.now();
      try {
        const paperText = (
          next.snapshot.paper.title +
          "\n" +
          next.snapshot.paper.abstract
        ).slice(0, 6000);
        const latest = { sources: next.snapshot.evidence };
        const evidence = latest?.sources?.length
          ? latest.sources
              .slice(0, 5)
              .map((s: any) => ({ ...s, text: s.text.slice(0, 2500) }))
          : [{ text: paperText }];
        const result = await generate(
          "Audit this prior retrieval decision. The final set is provisional; absence is not a negative label. Identify potential false dismissal or unnecessary promotion and propose retrieval weights. Return {diagnosis,likelyMiss,reason,quote,suggestedWeights:{lexical,semantic,graph,author}}. Quote exact supplied evidence. Do not treat model agreement as an independent human judgment.",
          {
            question: audit.snapshot.profile.question,
            provisionalReferenceSet: (audit.snapshot.referenceSet ?? [])
              .slice(0, 10)
              .map((r: any) => ({
                id: r.id,
                title: r.title,
                contribution: r.contribution?.slice(0, 600),
                humanLabel: r.feedback?.label ?? "unjudged",
              })),
            record: {
              stage: next.snapshot.stage,
              state: next.snapshot.state,
              proximity: next.snapshot.proximity,
              assessment: next.snapshot.assessment,
              features: next.snapshot.features,
              feedback: next.snapshot.feedback,
            },
            evidence,
          },
          Judgment,
          {
            task: audit.kind === "early" ? "early_audit" : "deep_audit",
            collectionId: audit.collection_id,
            privateEvidence: true,
            timeoutMs: 180000,
          },
        );
        if (!evidence.some((s: any) => s.text.includes(result.value.quote)))
          throw Error("Audit evidence mismatch.");
        await pool.query(
          "UPDATE core_audit_item SET state='rejudged',judgment=$3 WHERE audit_id=$1 AND candidate_id=$2",
          [
            audit.id,
            next.candidate_id,
            JSON.stringify({
              ...result.value,
              provisional: true,
              provenance: result.provenance,
            }),
          ],
        );
        await pool.query(
          "UPDATE core_audit SET counters=counters||jsonb_build_object('fresh',COALESCE((counters->>'fresh')::int,0)+1,'milliseconds',COALESCE((counters->>'milliseconds')::int,0)+$2::int),updated_at=now() WHERE id=$1",
          [audit.id, Date.now() - start],
        );
      } catch (e) {
        await pool.query(
          "UPDATE core_audit SET status='paused',report=report||$2::jsonb,counters=counters||jsonb_build_object('milliseconds',COALESCE((counters->>'milliseconds')::int,0)+$3::int),next_attempt_at=now()+interval '15 minutes' WHERE id=$1",
          [
            audit.id,
            JSON.stringify({ deferredReason: String(e) }),
            Date.now() - start,
          ],
        );
      }
      return;
    }
    if (next) {
      await pool.query(
        "UPDATE core_audit SET status='partial',report=report||'{\"deferredReason\":\"Audit budget exhausted; unfinished semantic judgments retained\"}',next_attempt_at=now()+interval '1 day' WHERE id=$1",
        [audit.id],
      );
      return;
    }
    const judgments = items.filter((i) => i.judgment),
      old = audit.policy_id
        ? (
            await pool.query("SELECT settings FROM core_policy WHERE id=$1", [
              audit.policy_id,
            ])
          ).rows[0]?.settings
        : defaultWeights;
    const mean = Object.fromEntries(
      Object.keys(defaultWeights).map((k) => [
        k,
        judgments.reduce(
          (n, j) => n + Number(j.judgment.suggestedWeights[k]),
          0,
        ) / Math.max(1, judgments.length),
      ]),
    ) as typeof defaultWeights;
    const proposal = judgments.length ? boundedWeights(old, mean) : old;
    const policyId = uuid();
    await pool.query(
      "INSERT INTO core_policy(id,collection_id,parent_id,settings,evaluation) VALUES($1,$2,$3,$4,$5)",
      [
        policyId,
        audit.collection_id,
        audit.policy_id,
        JSON.stringify(proposal),
        JSON.stringify({
          auditId: audit.id,
          status: "awaiting_independent_human_evaluation",
          modelLabelsProvisional: true,
        }),
      ],
    );
    await pool.query(
      "UPDATE core_audit SET status='complete',report=$2,updated_at=now() WHERE id=$1",
      [
        audit.id,
        JSON.stringify({
          recordsChecked: items.length,
          freshJudgments: judgments.length,
          metadataOnly: items.length - judgments.length,
          likelyMisses: judgments
            .filter((i) => i.judgment.likelyMiss)
            .map((i) => i.candidate_id),
          policyId,
          policyChanged: false,
          unknownLabels: items.filter((i) => !i.snapshot.feedback).length,
        }),
      ],
    );
    // A new search frontier is a probe, not automatic acceptance of audit suggestions.
    if (
      audit.kind === "early" &&
      judgments.some((i) => i.judgment.likelyMiss)
    ) {
      const probe = await enqueueCore(audit.collection_id);
      const query = audit.snapshot.profile.publicQueries[0];
      if (query)
        await pool.query(
          "UPDATE core_run SET frontier=$2::jsonb||frontier,phase='discovery' WHERE id=$1",
          [
            probe.id,
            JSON.stringify([
              {
                source: "probe",
                query,
                sort: "cited_by_count:asc",
                cursor: "*",
                pages: 0,
                auditId: audit.id,
              },
            ]),
          ],
        );
    }
  } finally {
    if (locked) await db.query("SELECT pg_advisory_unlock(73421911)");
    db.release();
  }
}
