// An extractive search query, not a claim that the papers share a scientific theme.
const stop = new Set(
  "a an the and or for of to in on with by from using based study paper approach research this that we our propose present introduce show results method work new pdf uploaded document abstract introduction conclusion references".split(
    " ",
  ),
);
export function seedFocus(
  papers: Array<{ title: string; abstract: string; localExcerpt: string }>,
) {
  const words = (text: string) =>
    text
      .toLowerCase()
      .match(/[\p{L}][\p{L}-]{2,}/gu)
      ?.filter((w) => !stop.has(w)) ?? [];
  if (papers.length === 1) {
    const title = papers[0]!.title.trim();
    if (words(title).length >= 2 && !/\.pdf$|^\d|^[a-f\d-]{20,}$/i.test(title))
      return title.slice(0, 500);
  }
  const scores = new Map<string, { documents: number; weight: number }>();
  for (const paper of papers) {
    const title = words(paper.title),
      body = words(paper.abstract + " " + paper.localExcerpt.slice(0, 6000)),
      seen = new Set([...title, ...body]);
    for (const word of seen) {
      const old = scores.get(word) ?? { documents: 0, weight: 0 };
      scores.set(word, {
        documents: old.documents + 1,
        weight:
          old.weight +
          (title.includes(word) ? 5 : 0) +
          Math.min(3, body.filter((w) => w === word).length),
      });
    }
  }
  const terms = [...scores]
    .filter(([, s]) => s.documents >= Math.min(2, papers.length))
    .sort(
      (a, b) =>
        b[1].documents - a[1].documents ||
        b[1].weight - a[1].weight ||
        a[0].localeCompare(b[0]),
    )
    .slice(0, 8)
    .map(([word]) => word);
  return terms.length >= 2 ? terms.join(" ") : "";
}
