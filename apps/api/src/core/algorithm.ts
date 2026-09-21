import { createHash } from "node:crypto";
import { z } from "zod";
export const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const Focus = z.object({
  question: z.string().trim().min(2).max(2000),
  objective: z
    .enum(["closest", "competitors", "foundations", "inspiration", "recent"])
    .default("closest"),
  domains: z
    .array(z.enum(["vision", "robotics", "ml", "embodied", "other"]))
    .default(["ml"]),
  anchors: z
    .array(
      z.object({
        workId: z.string().uuid(),
        weight: z.number().positive().max(10).default(1),
      }),
    )
    .max(30)
    .default([]),
  facets: z
    .array(
      z.object({
        id: z.string().min(1).max(80),
        kind: z.enum([
          "problem",
          "method",
          "contribution",
          "assumptions",
          "evaluation",
          "application",
        ]),
        text: z.string().min(2).max(1000),
      }),
    )
    .max(30)
    .default([]),
  publicQueries: z.array(z.string().trim().min(2).max(300)).max(30).default([]),
  exclusions: z.array(z.string().min(2).max(200)).max(30).default([]),
  before: z.string().date().nullable().default(null),
  mode: z.enum(["shadow", "review", "automatic"]).default("review"),
  budgets: z
    .object({
      d0: z.number().int().min(1).max(20000).default(20000),
      d1: z.number().int().min(1).max(2000).default(2000),
      d2: z.number().int().min(1).max(1000).default(200),
      d3: z.number().int().min(1).max(250).default(50),
    })
    .default({ d0: 20000, d1: 2000, d2: 200, d3: 50 }),
  compute: z
    .object({
      d1: z.number().int().min(1).max(200).default(40),
      d2: z.number().int().min(1).max(100).default(10),
      d3: z.number().int().min(1).max(50).default(3),
    })
    .default({ d1: 40, d2: 10, d3: 3 }),
  audits: z
    .object({
      enabled: z.boolean().default(true),
      timezone: z
        .string()
        .refine((s) => {
          try {
            new Intl.DateTimeFormat("en", { timeZone: s });
            return true;
          } catch {
            return false;
          }
        })
        .default("UTC"),
      startHour: z.number().int().min(0).max(23).default(2),
      endHour: z.number().int().min(0).max(23).default(6),
    })
    .default({ enabled: true, timezone: "UTC", startHour: 2, endHour: 6 }),
});
export type FocusProfile = z.infer<typeof Focus>;
export type Paper = {
  id: string;
  title: string;
  abstract: string;
  references: string[];
  authors: string[];
  year?: number | null;
  embedding?: number[];
  paths?: any[];
};
const stop = new Set(
  "the a an of for with to in on and or we our this that paper study method approach using based from is are".split(
    " ",
  ),
);
export function tokens(text: string) {
  return [
    ...new Set(
      (text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []).filter(
        (t) => !stop.has(t),
      ),
    ),
  ];
}
export function lexical(query: string, text: string) {
  const a = tokens(query),
    b = new Set(tokens(text));
  return a.length ? a.filter((t) => b.has(t)).length / a.length : 0;
}
export function cosine(a: number[] | undefined, b: number[] | undefined) {
  if (!a || !b || a.length !== b.length) return null;
  let dot = 0,
    aa = 0,
    bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    aa += a[i]! ** 2;
    bb += b[i]! ** 2;
  }
  return aa && bb ? dot / Math.sqrt(aa * bb) : null;
}
export type Edge = { from: string; to: string; weight: number };
export function pagerank(
  ids: string[],
  edges: Edge[],
  seeds: Record<string, number>,
  restart = 0.2,
) {
  const index = new Map(ids.map((id, i) => [id, i]));
  const n = ids.length;
  if (!n)
    return { scores: {} as Record<string, number>, residual: 0, iterations: 0 };
  const seed = ids.map((id) => Math.max(0, seeds[id] ?? 0)),
    sum = seed.reduce((a, b) => a + b, 0);
  if (!sum)
    return {
      scores: Object.fromEntries(ids.map((id) => [id, 0])),
      residual: 0,
      iterations: 0,
    };
  for (let i = 0; i < n; i++) seed[i] = seed[i]! / sum;
  const adjacency: Array<Array<[number, number]>> = Array.from(
      { length: n },
      () => [],
    ),
    totals = new Array(n).fill(0);
  for (const edge of edges) {
    const a = index.get(edge.from),
      b = index.get(edge.to);
    if (
      a === undefined ||
      b === undefined ||
      !Number.isFinite(edge.weight) ||
      edge.weight <= 0
    )
      continue;
    adjacency[a]!.push([b, edge.weight]);
    totals[a] += edge.weight;
  }
  let rank = [...seed],
    residual = 1,
    iterations = 0;
  while (residual > 1e-8 && iterations < 100) {
    const next = seed.map((x) => restart * x);
    let dangling = 0;
    for (let i = 0; i < n; i++) {
      if (!totals[i]) {
        dangling += rank[i]!;
      } else
        for (const [j, w] of adjacency[i]!)
          next[j] = next[j]! + ((1 - restart) * rank[i]! * w) / totals[i];
    }
    for (let j = 0; j < n; j++)
      next[j] = next[j]! + (1 - restart) * dangling * seed[j]!;
    residual = next.reduce((s, x, i) => s + Math.abs(x - rank[i]!), 0);
    rank = next;
    iterations++;
  }
  return {
    scores: Object.fromEntries(ids.map((id, i) => [id, rank[i]!])),
    residual,
    iterations,
  };
}
export function graphLayers(papers: Paper[], degreeCap = 64) {
  const ids = new Set(papers.map((p) => p.id)),
    forward: Edge[] = [],
    coupling: Edge[] = [],
    cocitation: Edge[] = [];
  const references = new Map<string, string[]>(),
    citers = new Map<string, string[]>();
  let omitted = 0;
  for (const p of papers) {
    const refs = [...new Set(p.references)];
    references.set(p.id, refs);
    for (const ref of refs) {
      const list = citers.get(ref) ?? [];
      list.push(p.id);
      citers.set(ref, list);
      if (ids.has(ref)) forward.push({ from: p.id, to: ref, weight: 1 });
    }
  }
  // Sparse inverted lists avoid an all-pairs matrix. Ubiquitous references are capped and coverage reported.
  for (const p of papers) {
    const peers = new Map<string, number>();
    for (const ref of references.get(p.id) ?? []) {
      const list = citers.get(ref) ?? [];
      const rarity = Math.log(1 + papers.length / Math.max(1, list.length));
      omitted += Math.max(0, list.length - 256);
      for (const other of list.slice(0, 256))
        if (other !== p.id) peers.set(other, (peers.get(other) ?? 0) + rarity);
    }
    const ranked = [...peers]
      .map(([id, w]) => ({
        from: p.id,
        to: id,
        weight:
          w /
          Math.sqrt(
            Math.max(1, p.references.length) *
              Math.max(1, references.get(id)?.length ?? 0),
          ),
      }))
      .sort((a, b) => b.weight - a.weight || a.to.localeCompare(b.to));
    omitted += Math.max(0, ranked.length - degreeCap);
    coupling.push(...ranked.slice(0, degreeCap));
    const co = new Map<string, number>();
    for (const citing of (citers.get(p.id) ?? []).slice(0, 256)) {
      for (const ref of (references.get(citing) ?? []).slice(0, 256))
        if (ref !== p.id && ids.has(ref))
          co.set(
            ref,
            (co.get(ref) ?? 0) +
              1 / Math.max(1, references.get(citing)!.length),
          );
    }
    cocitation.push(
      ...[...co]
        .sort((a, b) => b[1] - a[1])
        .slice(0, degreeCap)
        .map(([to, weight]) => ({ from: p.id, to, weight })),
    );
  }
  return {
    forward,
    reverse: forward.map((e) => ({ from: e.to, to: e.from, weight: e.weight })),
    coupling,
    cocitation,
    omitted,
  };
}
export const defaultWeights = {
  lexical: 0.2,
  semantic: 0.5,
  graph: 0.25,
  author: 0.05,
};
export function objectiveWeights(objective: string) {
  return objective === "foundations"
    ? { lexical: 0.15, semantic: 0.4, graph: 0.4, author: 0.05 }
    : objective === "inspiration"
      ? { lexical: 0.15, semantic: 0.7, graph: 0.1, author: 0.05 }
      : defaultWeights;
}
export function rankPapers(
  papers: Paper[],
  anchors: Paper[],
  focus: FocusProfile,
  focusEmbedding?: number[],
  weights = objectiveWeights(focus.objective),
) {
  const all = [
      ...new Map([...anchors, ...papers].map((p) => [p.id, p])).values(),
    ],
    layers = graphLayers(all),
    seed = Object.fromEntries(
      anchors.map((a, i) => [a.id, focus.anchors[i]?.weight ?? 1]),
    );
  const walks = Object.fromEntries(
    ["forward", "reverse", "coupling", "cocitation"].map((k) => [
      k,
      pagerank(
        all.map((p) => p.id),
        layers[k as "forward"],
        seed,
      ),
    ]),
  );
  const percentiles = Object.values(walks).map((w) => {
    const sorted = Object.entries(w.scores).sort((a, b) => a[1] - b[1]);
    let lower = 0;
    return Object.fromEntries(
      sorted.map(([id, value], i) => {
        if (i && value !== sorted[i - 1]![1]) lower = i;
        return [id, value ? lower / Math.max(1, all.length) : 0];
      }),
    );
  });
  const anchorAuthors = new Set(anchors.flatMap((a) => a.authors));
  const result = papers.map((p) => {
    const lexicalScore = Math.max(
      lexical(focus.question, p.title + " " + p.abstract),
      ...focus.facets.map((f) => lexical(f.text, p.title + " " + p.abstract)),
      0,
    );
    const semanticValues = [
      cosine(p.embedding, focusEmbedding),
      ...anchors.map((a) => cosine(p.embedding, a.embedding)),
    ].filter((x): x is number => x !== null);
    const semantic = semanticValues.length ? Math.max(...semanticValues) : null;
    const graph = Math.max(...percentiles.map((w) => w[p.id] ?? 0), 0);
    const author = p.authors.some((a) => anchorAuthors.has(a)) ? 1 : 0;
    const features = {
      lexical: lexicalScore,
      semantic,
      graph,
      author,
      influence: (p as any).citationCount ?? null,
      layers: Object.fromEntries(
        Object.entries(walks).map(([k, w]) => [k, w.scores[p.id] ?? 0]),
      ),
      missingAbstract: !p.abstract,
      graphOmitted: layers.omitted,
    };
    const score =
      weights.lexical * lexicalScore +
      weights.semantic * Math.max(0, semantic ?? 0) +
      weights.graph * graph +
      weights.author * author;
    return { paper: p, score, features };
  });
  return result.sort(
    (a, b) => b.score - a.score || a.paper.id.localeCompare(b.paper.id),
  );
}
export const Screen = z.object({
  contribution: z.string().max(1800),
  likelyRelated: z.boolean(),
  reason: z.string().max(1000),
  quote: z.string().min(12).max(800),
  uncertainties: z.array(z.string()).max(5),
});

export const Source = z.object({
  id: z.string(),
  workId: z.string(),
  text: z.string(),
  page: z.number().int().optional(),
  hash: z.string().optional(),
  kind: z.string(),
});
export const Assessment = z.object({
  contribution: z.string().max(3000),
  proximity: z.enum([
    "background",
    "related",
    "closest",
    "out_of_scope",
    "unassessed",
  ]),
  role: z.enum([
    "competitor",
    "predecessor",
    "foundation",
    "extension",
    "contradiction",
    "replication",
    "inspiration",
    "dataset",
    "implementation",
    "unknown",
  ]),
  similarities: z.array(z.string().max(1000)).max(8),
  differences: z.array(z.string().max(1000)).max(8),
  uncertainties: z.array(z.string().max(1000)).max(10),
  anchorId: z.string().nullable(),
  facetIds: z.array(z.string()).max(30),
  comparison: z.object({
    status: z.enum(["compatible", "qualified", "incompatible", "unknown"]),
    question: z.string().max(1000),
    dimensions: z
      .array(
        z.object({
          name: z.string().max(100),
          candidate: z.string().max(500),
          anchor: z.string().max(500),
          status: z.enum(["match", "different", "unknown", "not_applicable"]),
        }),
      )
      .max(25),
  }),
  evidence: z
    .array(
      z.object({
        sourceId: z.string(),
        quote: z.string().min(12).max(1200),
        supports: z.string().min(2).max(1000),
      }),
    )
    .max(30),
  relationships: z
    .array(
      z.object({
        predicate: z.enum([
          "compares",
          "extends",
          "uses",
          "contradicts",
          "replicates",
          "analogous",
          "background",
        ]),
        targetId: z.string(),
        sourceIds: z.array(z.string()).min(1),
      }),
    )
    .max(15)
    .default([]),
});
export type AssessmentValue = z.infer<typeof Assessment>;
export type ValidationIssue = { code: string; path: string; message: string };
export function assessmentIssues(
  a: AssessmentValue,
  sources: z.infer<typeof Source>[],
  candidateId: string,
  anchors: string[],
  stage: string,
  facets: string[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (code: string, path: string, message: string) =>
    issues.push({ code, path, message });
  a.facetIds.forEach((id, i) => {
    if (!facets.includes(id))
      add("unknown_facet", `facetIds.${i}`, "Use a supplied facet ID.");
  });
  if (a.anchorId && !anchors.includes(a.anchorId))
    add("unknown_anchor", "anchorId", "Use a supplied anchor work ID.");
  a.evidence.forEach((e, i) => {
    const source = sources.find((s) => s.id === e.sourceId);
    if (!source)
      add(
        "unknown_source",
        `evidence.${i}.sourceId`,
        "Use an exact supplied source ID.",
      );
    else if (!source.text.includes(e.quote))
      add(
        "quote_mismatch",
        `evidence.${i}.quote`,
        "Quotation is not a consecutive verbatim span of its source.",
      );
  });
  const hasEvidence = (workId: string | null) =>
    a.evidence.some((e) =>
      sources.some(
        (s) =>
          s.id === e.sourceId &&
          s.workId === workId &&
          s.text.includes(e.quote),
      ),
    );
  if (a.proximity !== "unassessed" && !hasEvidence(candidateId))
    add(
      "missing_candidate_evidence",
      "evidence",
      "Supply valid evidence from the candidate.",
    );
  a.relationships.forEach((r, i) => {
    if (!anchors.includes(r.targetId))
      add(
        "unknown_relationship_target",
        `relationships.${i}.targetId`,
        "Relationship target must be a supplied anchor.",
      );
    r.sourceIds.forEach((id, j) => {
      if (!a.evidence.some((e) => e.sourceId === id))
        add(
          "uncited_relationship_source",
          `relationships.${i}.sourceIds.${j}`,
          "Relationship source must appear in evidence.",
        );
    });
  });
  if (a.proximity === "closest") {
    if (facets.length && !a.facetIds.length)
      add("missing_facet", "facetIds", "Closest requires a focal facet.");
    if (!["D2", "D3"].includes(stage))
      add("insufficient_depth", "proximity", "Closest requires D2 or D3.");
    if (!a.anchorId || !hasEvidence(a.anchorId))
      add(
        "missing_anchor_evidence",
        "anchorId",
        "Closest requires an anchor and valid evidence from it.",
      );
  }
  return issues;
}
export function validateAssessment(
  ...args: Parameters<typeof assessmentIssues>
) {
  return assessmentIssues(...args).length === 0;
}
export function nextAudit(
  date: Date,
  kind: "early" | "deep",
  timezone = "UTC",
) {
  const parts = (d: Date) =>
    Object.fromEntries(
      new Intl.DateTimeFormat("en", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(d)
        .filter((p) => p.type !== "literal")
        .map((p) => [p.type, Number(p.value)]),
    );
  const p = parts(date),
    wall = new Date(
      Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!),
    );
  if (kind === "early") wall.setUTCDate(wall.getUTCDate() + 3);
  else {
    const day = wall.getUTCDate();
    wall.setUTCDate(1);
    wall.setUTCMonth(wall.getUTCMonth() + 1);
    wall.setUTCDate(
      Math.min(
        day,
        new Date(
          Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth() + 1, 0),
        ).getUTCDate(),
      ),
    );
  }
  let guess = wall.getTime();
  const tried: number[] = [];
  for (let i = 0; i < 4; i++) {
    tried.push(guess);
    const q = parts(new Date(guess));
    const observed = Date.UTC(
      q.year!,
      q.month! - 1,
      q.day!,
      q.hour!,
      q.minute!,
      q.second!,
    );
    const adjustment = wall.getTime() - observed;
    if (!adjustment) return new Date(guess);
    guess += adjustment;
  }
  // A nonexistent spring-forward wall time advances into the first available hour.
  return new Date(Math.max(guess, ...tried));
}
export function selectScreening<T>(ranked: T[], limit: number, seed: string) {
  const top = Math.floor(limit * 0.9),
    remaining = ranked
      .slice(top)
      .map((item, i) => ({ item, key: hash([seed, i]) }))
      .sort((a, b) => a.key.localeCompare(b.key));
  return [
    ...ranked.slice(0, top),
    ...remaining.slice(0, limit - top).map((x) => x.item),
  ];
}
export function policyGate(evaluation: {
  pairs: number;
  closest: number;
  gain: number;
  lowerBound: number;
  precision: number;
  recall: number;
  humanReviewed: boolean;
  freshHoldout: boolean;
  regressions: number;
}) {
  return (
    evaluation.pairs >= 50 &&
    evaluation.closest >= 10 &&
    evaluation.gain > 0 &&
    evaluation.lowerBound > 0 &&
    evaluation.precision >= 0.85 &&
    evaluation.recall >= 0.9 &&
    evaluation.humanReviewed &&
    evaluation.freshHoldout &&
    evaluation.regressions === 0
  );
}
