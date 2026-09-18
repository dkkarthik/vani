import { XMLParser } from "fast-xml-parser";
const array = (v: any): any[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
export function pdfPages(xml: string): any[] {
  const parsed = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
  }).parse(xml);
  return array(parsed.html?.body?.doc?.page ?? parsed.html?.body?.page);
}
export function pageWords(page: any) {
  return array(page.flow)
    .flatMap((f) => array(f.block))
    .flatMap((b) => array(b.line))
    .flatMap((l) => array(l.word))
    .map((w) => ({
      text: String(w["#text"] ?? ""),
      x: Number(w["@_xMin"]),
      right: Number(w["@_xMax"]),
      y: Number(w["@_yMin"]),
      bottom: Number(w["@_yMax"]),
    }));
}
// Detect a repeated central gutter from word geometry, then read each column in
// order. Full-width headings delimit sections; single-column pages stay linear.
export function logicalPdfPages(xml: string) {
  return pdfPages(xml).map((page, index) => {
    const width = Number(page["@_width"]),
      words = pageWords(page).sort((a, b) => a.y - b.y || a.x - b.x);
    const originalText = array(page.flow)
      .flatMap((f) => array(f.block))
      .flatMap((b) => array(b.line))
      .map((l) =>
        array(l.word)
          .map((w) => String(w["#text"] ?? ""))
          .join(" "),
      )
      .join("\n");
    if (
      words.filter(
        (w) => w.text.length > 3 && w.bottom - w.y > (w.right - w.x) * 1.5,
      ).length >
      words.length * 0.3
    )
      return { page: index + 1, text: originalText };
    const rows: Array<typeof words> = [];
    for (const word of words) {
      const row = rows.at(-1);
      if (row && Math.abs(row[0]!.y - word.y) < 3) row.push(word);
      else rows.push([word]);
    }
    rows.forEach((row) => row.sort((a, b) => a.x - b.x));
    const gaps = rows.flatMap((row) =>
      row.slice(1).flatMap((w, i) => {
        const prev = row[i]!;
        return w.x - prev.right >= 10 &&
          prev.right > width * 0.25 &&
          w.x < width * 0.75 &&
          prev.right < width * 0.6 &&
          w.x > width * 0.4
          ? [(prev.right + w.x) / 2]
          : [];
      }),
    );
    if (gaps.length < 3)
      return {
        page: index + 1,
        text: originalText,
      };
    const sorted = gaps.sort((a, b) => a - b),
      cut = sorted[Math.floor(sorted.length / 2)]!;
    if (gaps.filter((g) => Math.abs(g - cut) < width * 0.08).length < 3)
      return {
        page: index + 1,
        text: originalText,
      };
    const output: string[] = [],
      left: string[] = [],
      right: string[] = [];
    const flush = () => {
      output.push(...left, ...right);
      left.length = 0;
      right.length = 0;
    };
    for (const row of rows) {
      const a = row.filter((w) => (w.x + w.right) / 2 < cut),
        b = row.filter((w) => (w.x + w.right) / 2 >= cut);
      const spanning = a.length && b.length && b[0]!.x - a.at(-1)!.right < 10;
      if (spanning) {
        flush();
        output.push(row.map((w) => w.text).join(" "));
      } else {
        if (a.length) left.push(a.map((w) => w.text).join(" "));
        if (b.length) right.push(b.map((w) => w.text).join(" "));
      }
    }
    flush();
    return { page: index + 1, text: output.join("\n") };
  });
}
