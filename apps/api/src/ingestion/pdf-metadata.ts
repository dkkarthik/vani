import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { XMLParser } from "fast-xml-parser";
import { logicalPdfPages } from "../research/pdf-text.js";
const execute = promisify(execFile);
const array = (v: any): any[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const clean = (s: string) =>
  s
    .replace(/(\p{L})-\s*\n\s*(\p{Ll})/gu, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
export function parsePdfMetadata(text: string, bbox: string) {
  const xml = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
  }).parse(bbox);
  const page = array(xml.html?.body?.doc?.page ?? xml.html?.body?.page)[0];
  const lines = array(page?.flow)
    .flatMap((f) => array(f.block))
    .flatMap((b) => array(b.line))
    .map((l) => {
      const words = array(l.word);
      return {
        text: words
          .map((w) => (typeof w === "string" ? w : (w["#text"] ?? "")))
          .join(" "),
        y: Number(l["@_yMin"]),
        height:
          words.reduce(
            (s, w) => s + Number(w["@_yMax"]) - Number(w["@_yMin"]),
            0,
          ) / Math.max(1, words.length),
      };
    })
    .filter(
      (l) =>
        l.text.length > 3 && l.y < Number(page?.["@_height"] ?? 800) * 0.45,
    );
  const max = Math.max(0, ...lines.map((l) => l.height));
  const title = clean(
    lines
      .filter((l) => l.height >= max * 0.9)
      .sort((a, b) => a.y - b.y)
      .map((l) => l.text)
      .join(" "),
  );
  const logical = logicalPdfPages(bbox)
    .map((p) => p.text)
    .join("\n");
  const match = (logical || text).match(
    /\bAbstract\s*[.\u2014:-]?\s*([\s\S]*?)(?=\b(?:Index Terms|Keywords|Key words)\b|\n\s*(?:(?:I|1)\.?\s+)?INTRODUCTION\b)/i,
  );
  return {
    title: title.length >= 12 && title.length <= 1000 ? title : "",
    abstract:
      match && clean(match[1]!).length >= 80
        ? clean(match[1]!).slice(0, 12000)
        : "",
  };
}
export async function extractPdfMetadata(bytes: Buffer) {
  const dir = await mkdtemp(join(tmpdir(), "vani-pdf-"));
  try {
    const path = join(dir, "paper.pdf");
    await writeFile(path, bytes, { mode: 0o600 });
    const opts = { timeout: 30000, maxBuffer: 4 * 1024 * 1024 };
    const [text, bbox] = await Promise.all([
      execute(
        "pdftotext",
        ["-f", "1", "-l", "2", "-enc", "UTF-8", path, "-"],
        opts,
      ),
      execute(
        "pdftotext",
        ["-f", "1", "-l", "2", "-bbox-layout", path, "-"],
        opts,
      ),
    ]);
    const result = parsePdfMetadata(text.stdout, bbox.stdout);
    return {
      ...result,
      extraction: {
        method: "poppler-logical-v1",
        warnings: [
          ...(!result.title
            ? ["PDF title could not be extracted; check the upload title."]
            : []),
          ...(!result.abstract
            ? [
                "PDF abstract could not be extracted; add metadata or inspect the local text.",
              ]
            : []),
        ],
      },
    };
  } catch (e) {
    return {
      title: "",
      abstract: "",
      extraction: {
        method: "poppler-logical-v1",
        warnings: [
          "PDF metadata extraction failed: " + String(e).slice(0, 300),
        ],
      },
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
