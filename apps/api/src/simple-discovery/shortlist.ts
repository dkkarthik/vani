import { createHash } from "node:crypto";
import type { Document } from "./ranker.js";

export type ShortlistOptions = {
  enabled: boolean;
  limit: number;
  focus: string;
  requiredTerms?: string[];
};
export type SparseVector = Array<[number, number]>;
const stop = new Set(
  "a about above across after again against all almost alone along already also although always am among an and another any anyhow anyone anything anywhere are around as at back be became because become becomes becoming been before behind being below beside besides between beyond both but by can cannot could did do does doing done down due during each either else enough especially even ever every everyone everything everywhere few for former formerly from further get give go had has have having he hence her here hereby herein hers herself him himself his how however i if in indeed into is it its itself just keep last latter least less made make many may me meanwhile might mine more moreover most mostly much must my myself name namely neither never nevertheless next no nobody none nor not nothing now nowhere of off often on once one only onto or other others otherwise our ours ourselves out over own part per perhaps rather same say see seem seemed seeming seems several she should since so some somehow someone something sometimes somewhere still such take than that the their them themselves then thence there thereby therefore therein these they this those though through throughout thus to together too toward towards under unless until up upon us use used using various very via was we well were what whatever when whence whenever where whereby whereas wherein wherever whether which while who whoever whom whose why will with within without would yet you your yours yourself yourselves paper study propose proposed result results approach method methods present based including respectively".split(
    /\s+/,
  ),
);
function singular(word: string) {
  if (word.length > 5 && word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (/(?:ches|shes|xes|zes|sses)$/.test(word)) return word.slice(0, -2);
  if (word.length > 4 && /s$/.test(word) && !/(?:ss|is|us)$/.test(word))
    return word.slice(0, -1);
  return word;
}
export function shortlistWords(text: string) {
  return (
    text
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .match(/\b[a-z_][a-z0-9_]+\b/g) ?? []
  )
    .filter((w) => !stop.has(w))
    .slice(0, 1600)
    .map(singular);
}
function counts(text: string) {
  const words = shortlistWords(text),
    map = new Map<string, number>();
  for (const term of [
    ...words,
    ...words.slice(1).map((w, i) => words[i] + " " + w),
  ])
    map.set(term, (map.get(term) ?? 0) + 1);
  return map;
}
const dot = (v: SparseVector, w: Float64Array) =>
  v.reduce((s, [i, x]) => s + x * w[i]!, 0);

// L2-loss linear SVM dual coordinate descent. The intercept is an augmented,
// regularized feature of value 1, matching LinearSVC's default intercept scaling.
// Primal: 0.5 * (||w||² + b²) + sum_i C_i * max(0, 1-y_i*(w*x_i+b))².
export function fitLinearSvm(
  vectors: SparseVector[],
  labels: number[],
  costs: number[],
  dimensions: number,
) {
  const weights = new Float64Array(dimensions),
    alpha = new Float64Array(vectors.length);
  const diagonal = costs.map((c) => 1 / (2 * c));
  const qd = vectors.map(
    (v, i) => 1 + diagonal[i]! + v.reduce((s, [, x]) => s + x * x, 0),
  );
  let bias = 0,
    residual = Infinity,
    iterations = 0;
  for (; iterations < 10000; iterations++) {
    residual = 0;
    for (let i = 0; i < vectors.length; i++) {
      const gradient =
        labels[i]! * (dot(vectors[i]!, weights) + bias) -
        1 +
        diagonal[i]! * alpha[i]!;
      const projected = alpha[i] === 0 ? Math.min(gradient, 0) : gradient;
      residual = Math.max(residual, Math.abs(projected));
      if (Math.abs(projected) <= 1e-12) continue;
      const next = Math.max(0, alpha[i]! - gradient / qd[i]!);
      const delta = (next - alpha[i]!) * labels[i]!;
      alpha[i] = next;
      for (const [j, x] of vectors[i]!) weights[j]! += delta * x;
      bias += delta;
    }
    if (residual < 1e-6) {
      iterations++;
      break;
    }
  }
  return { weights, bias, iterations, residual, converged: residual < 1e-6 };
}

export function shortlist(
  documents: Document[],
  candidateIds: string[],
  options: ShortlistOptions,
) {
  const started = Date.now(),
    docs = [...documents].sort((a, b) => a.id.localeCompare(b.id));
  const focus = new Set(shortlistWords(options.focus));
  const bags = docs.map((d) =>
    counts(d.title + " " + (d.abstract ?? "").slice(0, 12000)),
  );
  const df = new Map<string, number>(),
    tf = new Map<string, number>();
  for (const bag of bags)
    for (const [term, n] of bag) {
      df.set(term, (df.get(term) ?? 0) + 1);
      tf.set(term, (tf.get(term) ?? 0) + n);
    }
  const minDf = docs.length < 100 ? 1 : 5,
    maxDf = docs.length < 100 ? 0.8 : 0.1;
  const focused = (term: string) => term.split(" ").some((w) => focus.has(w));
  const vocabulary = [...df]
    .filter(
      ([term, n]) => n >= minDf && (n <= docs.length * maxDf || focused(term)),
    )
    .sort((a, b) => tf.get(b[0])! - tf.get(a[0])! || a[0].localeCompare(b[0]))
    .slice(0, 20000)
    .map(([t]) => t);
  const index = new Map(vocabulary.map((t, i) => [t, i]));
  const idf = vocabulary.map(
    (t) => 1 + Math.log((1 + docs.length) / (1 + df.get(t)!)),
  );
  const vectors: SparseVector[] = bags.map((bag) => {
    const v: SparseVector = [];
    for (const [term, n] of bag) {
      const i = index.get(term);
      if (i !== undefined)
        v.push([i, (1 + Math.log(n)) * idf[i]! * (focused(term) ? 3 : 1)]);
    }
    const norm = Math.sqrt(v.reduce((s, [, x]) => s + x * x, 0)) || 1;
    return v.map(([i, x]) => [i, x / norm]);
  });
  const positive = docs
    .map((d, i) =>
      (d.label === "up" || (d.seed && d.label !== "down")) && vectors[i]!.length
        ? i
        : -1,
    )
    .filter((i) => i >= 0);
  const pos = new Set(positive),
    training = vectors.map((v, i) => (v.length ? i : -1)).filter((i) => i >= 0),
    negativeWeight = training.reduce(
      (s, i) => s + (pos.has(i) ? 0 : docs[i]!.label === "down" ? 10 : 1),
      0,
    );
  // Empty vectors carry no discriminative evidence; never turn an unusable
  // positive seed/thumb into a negative training example.
  const labels = training.map((i) => (pos.has(i) ? 1 : -1));
  const costs = training.map(
    (i) =>
      ((0.01 * training.length) / 2) *
      (pos.has(i)
        ? 1 / positive.length
        : (docs[i]!.label === "down" ? 10 : 1) / negativeWeight),
  );
  const canTrain =
    positive.length > 0 && negativeWeight > 0 && vocabulary.length > 0;
  const fit = canTrain
    ? fitLinearSvm(
        training.map((i) => vectors[i]!),
        labels,
        costs,
        vocabulary.length,
      )
    : null;
  const status = !positive.length
    ? "needs_positive_examples"
    : !vocabulary.length || !negativeWeight
      ? "insufficient_features"
      : !fit?.converged
        ? "not_converged"
        : "ready";
  const referenceIds = positive.slice(0, 256),
    references = referenceIds.map((i) => new Map(vectors[i]));
  const candidates = new Set(candidateIds);
  const items = docs
    .flatMap((d, i) => {
      if (!candidates.has(d.id)) return [];
      const v = vectors[i]!,
        matchedFocus = [...focus].filter((w) => bags[i]!.has(w));
      const words =
        " " +
        shortlistWords(d.title + " " + (d.abstract ?? "").slice(0, 12000)).join(
          " ",
        ) +
        " ";
      const matchedContext = (options.requiredTerms ?? []).filter((term) => {
        const normalized = shortlistWords(term).join(" ");
        return normalized.length > 0 && words.includes(" " + normalized + " ");
      });
      let overlap = 0,
        nearest = -1;
      references.forEach((reference, p) => {
        const similarity = v.reduce(
          (s, [j, x]) => s + x * (reference.get(j) ?? 0),
          0,
        );
        if (similarity > overlap) {
          overlap = similarity;
          nearest = referenceIds[p]!;
        }
      });
      const reason =
        d.label === "down"
          ? "negative_feedback"
          : status !== "ready"
            ? status
            : !v.length
              ? "no_features"
              : d.label !== "up" &&
                  options.requiredTerms?.length &&
                  !matchedContext.length
                ? "context_mismatch"
                : d.label !== "up" &&
                    focus.size &&
                    matchedFocus.length < Math.min(2, focus.size)
                  ? "focus_mismatch"
                  : d.label !== "up" && overlap <= 0
                    ? "no_positive_overlap"
                    : "eligible";
      return [
        {
          id: d.id,
          score: fit ? dot(v, fit.weights) + fit.bias : 0,
          selected: false,
          reason,
          overlap,
          nearest:
            nearest >= 0
              ? { id: docs[nearest]!.id, title: docs[nearest]!.title }
              : null,
          matchedFocus,
          matchedContext,
          terms: fit
            ? v
                .map(([j, x]) => ({
                  term: vocabulary[j]!,
                  contribution: x * fit.weights[j]!,
                }))
                .filter((t) => t.contribution !== 0)
                .sort(
                  (a, b) => Math.abs(b.contribution) - Math.abs(a.contribution),
                )
                .slice(0, 8)
            : [],
        },
      ];
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  let selected = 0;
  for (const item of items)
    if (item.reason === "eligible") {
      if (selected < options.limit) {
        item.selected = true;
        item.reason = "shortlisted";
        selected++;
      } else item.reason = "outside_limit";
    }
  return {
    items,
    metadata: {
      algorithm: "sanity-shortlist-v1",
      status,
      selected,
      candidates: candidateIds.length,
      focus: options.focus,
      requiredTerms: options.requiredTerms ?? [],
      limit: options.limit,
      positive: positive.length,
      negative: docs.filter((d) => d.label === "down").length,
      background: training.filter(
        (i) => !pos.has(i) && docs[i]!.label !== "down",
      ).length,
      trainingSamples: training.length,
      unusable: docs.length - training.length,
      features: vocabulary.length,
      minDf,
      maxDf,
      C: 0.01,
      focusBoost: 3,
      explicitNegativeWeight: 10,
      iterations: fit?.iterations ?? 0,
      residual: fit?.residual ?? null,
      converged: fit?.converged ?? false,
      referenceLimit: 256,
      durationMs: Date.now() - started,
      fingerprint: createHash("sha256")
        .update(JSON.stringify([docs, candidateIds, options]))
        .digest("hex"),
    },
    model: {
      vocabulary,
      idf,
      weights: fit ? Array.from(fit.weights) : [],
      bias: fit?.bias ?? 0,
    },
  };
}
