import { createHash } from "node:crypto";
export type Document = {
  id: string;
  title: string;
  abstract?: string;
  label?: "up" | "down";
  seed?: boolean;
};
const stop = new Set(
  "a an the of to in on and or for with from by as at is are was were be this that we our paper study using based".split(
    " ",
  ),
);
export function terms(text: string) {
  const words = (
    text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]+/gu) ?? []
  )
    .filter((w) => !stop.has(w))
    .slice(0, 900);
  return [...words, ...words.slice(1).map((w, i) => words[i] + " " + w)];
}
const digest = (x: unknown) =>
  createHash("sha256").update(JSON.stringify(x)).digest("hex");
type Vector = Array<[number, number]>;
const dot = (v: Vector, w: Float64Array) =>
  v.reduce((sum, [i, x]) => sum + x * w[i]!, 0);
export function rank(documents: Document[], query: string) {
  const docs = [...documents].sort((a, b) => a.id.localeCompare(b.id));
  const counts = docs.map((d) => {
    const m = new Map<string, number>();
    for (const t of terms(d.title + " " + (d.abstract ?? "").slice(0, 6000)))
      m.set(t, (m.get(t) ?? 0) + 1);
    return m;
  });
  const df = new Map<string, number>();
  for (const m of counts)
    for (const t of m.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const vocabulary = [...df]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 20000)
    .map(([t]) => t);
  const index = new Map(vocabulary.map((t, i) => [t, i]));
  const idf = vocabulary.map(
    (t) => 1 + Math.log((1 + docs.length) / (1 + df.get(t)!)),
  );
  const vector = (m: Map<string, number>): Vector => {
    const pairs: Vector = [];
    for (const [t, n] of m) {
      const i = index.get(t);
      if (i !== undefined) pairs.push([i, (1 + Math.log(n)) * idf[i]!]);
    }
    const norm = Math.sqrt(pairs.reduce((s, [, x]) => s + x * x, 0)) || 1;
    return pairs.map(([i, x]) => [i, x / norm]);
  };
  const vectors = counts.map(vector),
    q = new Map<string, number>();
  for (const t of terms(query)) q.set(t, (q.get(t) ?? 0) + 1);
  const queryVector = new Float64Array(vocabulary.length);
  for (const [i, v] of vector(q)) queryVector[i] = v;
  const positive = docs
    .map((d, i) =>
      d.label === "up" || (d.seed && d.label !== "down") ? i : -1,
    )
    .filter((i) => i >= 0);
  const negative = docs
    .map((d, i) => (d.label === "down" ? i : -1))
    .filter((i) => i >= 0);
  const background = docs
    .map((d, i) => (!d.seed && !d.label ? i : -1))
    .filter((i) => i >= 0)
    .sort((a, b) => digest(docs[a]!.id).localeCompare(digest(docs[b]!.id)))
    .slice(0, 1500);
  const trained =
    positive.some((i) => vectors[i]!.length > 0) &&
    negative.length + background.length > 0;
  const weights = new Float64Array(vocabulary.length);
  let bias = 0;
  const samples = [
    ...positive.map((i) => ({ i, y: 1, w: 0.5 / positive.length })),
    ...negative.map((i) => ({
      i,
      y: -1,
      w: (background.length ? 0.4 : 0.5) / negative.length,
    })),
    ...background.map((i) => ({
      i,
      y: -1,
      w: (negative.length ? 0.1 : 0.5) / background.length,
    })),
  ];
  // Full-batch gradient descent on a regularized, class-weighted squared hinge objective.
  // Unlabeled background is distinct from explicit human negatives.
  if (trained)
    for (let epoch = 0; epoch < 80; epoch++) {
      const grad = new Float64Array(weights.length);
      for (let j = 0; j < weights.length; j++) grad[j] = 0.02 * weights[j]!;
      let gb = 0;
      for (const s of samples) {
        const v = vectors[s.i]!,
          margin = 1 - s.y * (dot(v, weights) + bias);
        if (margin <= 0) continue;
        const g = -2 * s.w * s.y * margin;
        for (const [i, x] of v) grad[i]! += g * x;
        gb += g;
      }
      const rate = 0.4 / (1 + epoch / 20);
      for (let j = 0; j < weights.length; j++) weights[j]! -= rate * grad[j]!;
      bias -= rate * gb;
    }
  const used = trained ? weights : queryVector;
  const items = docs
    .map((d, i) => ({
      id: d.id,
      score: dot(vectors[i]!, used) + (trained ? bias : 0),
      cosine: dot(vectors[i]!, queryVector),
      terms: vectors[i]!.map(([j, v]) => ({
        term: vocabulary[j]!,
        contribution: v * used[j]!,
      }))
        .filter((t) => t.contribution !== 0)
        .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
        .slice(0, 8),
    }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return {
    items,
    metadata: {
      algorithm: trained ? "tfidf-linear-svm-v1" : "tfidf-cosine-v1",
      corpusSize: docs.length,
      positive: positive.length,
      negative: negative.length,
      background: background.length,
      features: vocabulary.length,
      fingerprint: digest([docs, query]),
      note: "Signed ranking scores, not probabilities. Unreviewed background is not a human rejection.",
    },
    model: {
      vocabulary,
      idf,
      weights: Array.from(used),
      bias: trained ? bias : 0,
    },
  };
}
