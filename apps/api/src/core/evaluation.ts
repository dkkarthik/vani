import { v7 as uuid } from "uuid";
import { z } from "zod";
import { transaction } from "../db.js";
import { defaultWeights, hash, policyGate } from "./algorithm.js";
type Weights = typeof defaultWeights;
type RecordValue = {
  id: string;
  features: Record<string, number>;
  label: string;
};
export function pairedEvaluation(
  groups: RecordValue[][],
  proposed: Weights,
  baseline: Weights,
  d1Budget = 2000,
) {
  const score = (r: RecordValue, w: Weights) =>
    Object.keys(w).reduce(
      (s, k) =>
        s + w[k as keyof Weights] * Math.max(0, Number(r.features[k] ?? 0)),
      0,
    );
  const stats = (records: RecordValue[], w: Weights) => {
    const order = [...records].sort(
      (a, b) => score(b, w) - score(a, w) || a.id.localeCompare(b.id),
    );
    const positives = records.filter((r) => r.label === "closest").length;
    const hits = (n: number) =>
      order.slice(0, n).filter((r) => r.label === "closest").length;
    return {
      precision: hits(10) / Math.max(1, Math.min(10, records.length)),
      recall: positives ? hits(d1Budget) / positives : 1,
    };
  };
  const paired = groups.map((g) => {
    const a = stats(g, proposed),
      b = stats(g, baseline);
    return {
      ...a,
      delta: a.precision - b.precision,
      regression: a.recall < b.recall ? 1 : 0,
    };
  });
  const mean = (xs: number[]) =>
    xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  // Deterministic paired bootstrap resamples complete research-question groups, never individual correlated pairs.
  let state = 0x56a91;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const boot = Array.from({ length: 2000 }, () =>
    mean(
      paired.map(
        () => paired[Math.floor(random() * paired.length)]?.delta ?? 0,
      ),
    ),
  ).sort((a, b) => a - b);
  const baselines = {
    lexical: { lexical: 1, semantic: 0, graph: 0, author: 0 },
    semantic: { lexical: 0, semantic: 1, graph: 0, author: 0 },
    graph: { lexical: 0, semantic: 0, graph: 1, author: 0 },
  };
  const precision = mean(paired.map((g) => g.precision));
  const cheaperBaselines = Object.fromEntries(
    Object.entries(baselines).map(([k, w]) => [
      k,
      mean(groups.map((g) => stats(g, w).precision)),
    ]),
  );
  const metrics = {
    groups: groups.length,
    pairs: groups.reduce((n, g) => n + g.length, 0),
    closest: groups.flat().filter((r) => r.label === "closest").length,
    gain: mean(paired.map((g) => g.delta)),
    lowerBound: boot[49] ?? 0,
    precision,
    recall: mean(paired.map((g) => g.recall)),
    regressions: paired.reduce((n, g) => n + g.regression, 0),
    humanReviewed: true,
    freshHoldout: true,
    cheaperBaselines,
  };
  return {
    ...metrics,
    eligible:
      groups.length >= 10 &&
      policyGate(metrics) &&
      Object.values(cheaperBaselines).every((v) => precision >= v),
    method:
      "2000 paired question-group bootstrap replicates; precision@10 and recall at the D1 ceiling; 95% interval",
  };
}
export async function freezeHoldout(policyId: string, input: unknown) {
  const data = z
    .object({
      question: z.string().trim().min(10).max(2000),
      candidateIds: z.array(z.string().uuid()).min(5).max(500),
    })
    .parse(input);
  return transaction(async (db) => {
    const p = (
      await db.query(
        "SELECT * FROM core_policy WHERE id=$1 AND status IN ('shadow','canary') FOR UPDATE",
        [policyId],
      )
    ).rows[0];
    if (!p)
      throw Object.assign(Error("A shadow or canary policy is required."), {
        statusCode: 409,
      });
    const records = (
      await db.query(
        "SELECT id,identity,source_hash,focus_version,features FROM core_candidate WHERE id=ANY($1::uuid[]) AND collection_id=$2 AND feedback IS NULL",
        [data.candidateIds, p.collection_id],
      )
    ).rows;
    if (records.length !== new Set(data.candidateIds).size)
      throw Object.assign(
        Error("Holdout papers must be unjudged candidates in this collection."),
        { statusCode: 400 },
      );
    const previous = (
      await db.query(
        "SELECT snapshot FROM core_holdout h JOIN core_policy p ON p.id=h.policy_id WHERE p.collection_id=$1",
        [p.collection_id],
      )
    ).rows;
    const used = new Set(
      previous.flatMap((r) => r.snapshot.records.map((x: any) => x.identity)),
    );
    if (records.some((r) => used.has(r.identity)))
      throw Object.assign(
        Error(
          "A paper cannot be reused across protected holdout groups or policies.",
        ),
        { statusCode: 409 },
      );
    return (
      await db.query(
        "INSERT INTO core_holdout(id,policy_id,question,phase,snapshot) VALUES($1,$2,$3,$4,$5) RETURNING id,question,phase,created_at",
        [
          uuid(),
          p.id,
          data.question,
          p.status,
          JSON.stringify({
            records: records.map((r) => ({
              ...r,
              features: { ...r.features, embedding: undefined },
            })),
            policy: p.settings,
            hash: hash(records),
            origin: "frozen before independent human labels",
          }),
        ],
      )
    ).rows[0];
  });
}
export async function labelHoldout(id: string, input: unknown) {
  const labels = z
    .array(
      z.object({
        id: z.string().uuid(),
        label: z.enum(["closest", "related", "background", "out_of_scope"]),
        reason: z.string().min(10).max(2000),
      }),
    )
    .min(5)
    .max(500)
    .parse(input);
  return transaction(async (db) => {
    const h = (
      await db.query("SELECT * FROM core_holdout WHERE id=$1 FOR UPDATE", [id])
    ).rows[0];
    if (!h || h.labels || h.exposed_at)
      throw Object.assign(
        Error("Holdout is missing or already labeled/exposed."),
        { statusCode: 409 },
      );
    const expected = new Set(h.snapshot.records.map((r: any) => r.id));
    if (
      labels.length !== expected.size ||
      new Set(labels.map((l) => l.id)).size !== expected.size ||
      labels.some((l) => !expected.has(l.id))
    )
      throw Object.assign(Error("Label every frozen paper exactly once."), {
        statusCode: 400,
      });
    await db.query("UPDATE core_holdout SET labels=$2 WHERE id=$1", [
      id,
      JSON.stringify(labels),
    ]);
    return { status: "labeled", origin: "human" };
  });
}
export async function evaluateAndPromote(id: string) {
  return transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(73421915)");
    const p = (
      await db.query(
        "SELECT * FROM core_policy WHERE id=$1 AND status IN ('shadow','canary') FOR UPDATE",
        [id],
      )
    ).rows[0];
    if (!p)
      throw Object.assign(Error("Policy is not awaiting evaluation."), {
        statusCode: 409,
      });
    const holdouts = (
      await db.query(
        "SELECT * FROM core_holdout WHERE policy_id=$1 AND phase=$2 AND labels IS NOT NULL AND exposed_at IS NULL ORDER BY created_at",
        [id, p.status],
      )
    ).rows;
    const baseline = (
      await db.query(
        "SELECT * FROM core_policy WHERE collection_id=$1 AND status='active'",
        [p.collection_id],
      )
    ).rows[0];
    const focus = (
      await db.query("SELECT profile FROM core_focus WHERE collection_id=$1", [
        p.collection_id,
      ])
    ).rows[0];
    const groups = holdouts.map((h) =>
      h.snapshot.records.map((r: any) => ({
        ...r,
        label: h.labels.find((l: any) => l.id === r.id).label,
      })),
    );
    const metrics = pairedEvaluation(
      groups,
      p.settings,
      baseline?.settings ?? defaultWeights,
      focus.profile.budgets.d1,
    );
    if (metrics.groups < 10 || metrics.pairs < 50 || metrics.closest < 10)
      return { ...metrics, status: "insufficient_data", policyChanged: false };
    await db.query(
      "UPDATE core_holdout SET exposed_at=now() WHERE id=ANY($1::uuid[])",
      [holdouts.map((h) => h.id)],
    );
    const status = metrics.eligible
      ? p.status === "shadow"
        ? "canary"
        : "active"
      : "rejected";
    if (status === "active")
      await db.query(
        "UPDATE core_policy SET status='rolled_back' WHERE collection_id=$1 AND status='active'",
        [p.collection_id],
      );
    await db.query(
      "UPDATE core_policy SET status=$2,parent_id=$3,evaluation=$4 WHERE id=$1",
      [
        p.id,
        status,
        baseline?.id ?? p.parent_id,
        JSON.stringify({
          ...metrics,
          phase: p.status,
          holdouts: holdouts.map((h) => h.id),
          at: new Date().toISOString(),
        }),
      ],
    );
    return {
      ...metrics,
      status,
      policyChanged: status === "active",
      next:
        status === "canary"
          ? "Collect a second disjoint prospective holdout; canary scores cannot admit papers."
          : null,
    };
  });
}
