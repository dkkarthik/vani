import { Cite, plugins } from "@citation-js/core";
import "@citation-js/plugin-bibtex";
import "@citation-js/plugin-ris";
import { fromCsl, plain } from "./normalize.js";
import { hash } from "../metadata.js";
import { parseIdentifier } from "../metadata-sources.js";
import type { ImportItem } from "@vani/shared";
export type ParsedItem = Omit<ImportItem, "id" | "ordinal" | "fileId"> & {
  references: string[];
  identifier?: string;
};
export const emptyItem = (label: string): ParsedItem => ({
  label,
  metadata: null,
  raw: null,
  source: "import",
  externalId: "",
  sourceUrl: "",
  authoritative: false,
  fingerprint: "",
  notes: [],
  attachments: [],
  warnings: [],
  error: "",
  included: true,
  status: "pending",
  workId: null,
  matchId: null,
  matchTitle: null,
  references: [],
});
const bibMapped = new Set(
  "title author editor year date journal journaltitle booktitle publisher address location volume number pages doi isbn issn url language langid edition abstract note annote file type eprint eprinttype archiveprefix".split(
    " ",
  ),
);
const risMapped = new Set(
  "TY ER TI T1 AU A1 A2 ED PY Y1 DA JO JF T2 J2 JA BT PB CY VL IS SP EP DO SN UR LA ET AB N2 N1 L1".split(
    " ",
  ),
);
export function attachmentNames(value: unknown): string[] {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return [...text.matchAll(/([^/\\:;"\n]+\.pdf)(?=[:;"\s]|$)/gi)].map((match) =>
    match[1]!.trim(),
  );
}
export function parseBibliography(name: string, text: string): ParsedItem[] {
  if (Buffer.byteLength(text) > 10 * 1024 * 1024)
    throw new Error("Text bibliography exceeds 10 MB.");
  text = text.replace(/^\uFEFF/, "");
  const extension = name.toLowerCase().split(".").at(-1);
  if (extension === "txt") {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length > 500)
      throw new Error("Identifier list exceeds 500 records.");
    return lines.map((line) => {
      const result = emptyItem(line);
      result.raw = line;
      result.identifier = line;
      try {
        const parsed = parseIdentifier(line);
        result.externalId = parsed.id;
        result.source = parsed.kind;
        result.fingerprint = hash(parsed);
      } catch (error) {
        result.error = (error as Error).message;
        result.included = false;
      }
      return result;
    });
  }
  let rawRecords: any[], format: string;
  if (extension === "bib") {
    format = "biblatex";
    rawRecords = plugins.input.data(text, "@biblatex/text");
  } else if (extension === "ris") {
    format = "ris";
    const starts = (text.match(/^TY {2}- /gm) || []).length,
      ends = (text.match(/^ER {2}-(?:\s|$)/gm) || []).length;
    if (!starts || starts !== ends)
      throw new Error("RIS needs one TY and ER delimiter per record.");
    rawRecords = plugins.input.data(text, "@ris/file");
  } else if (extension === "json") {
    format = "csl";
    const json = JSON.parse(text);
    rawRecords = Array.isArray(json) ? json : [json];
  } else
    throw new Error(
      "Unsupported input. Choose .bib, .ris, CSL .json, identifier .txt, or .pdf.",
    );
  if (!rawRecords.length) throw new Error("No records found in this file.");
  if (rawRecords.length > 500)
    throw new Error("Bibliography exceeds 500 records.");
  return rawRecords.map((raw, index) => {
    const result = emptyItem(
      String(raw?.label || raw?.id || `${name} record ${index + 1}`),
    );
    result.raw = raw;
    result.source = `import_${format}`;
    result.externalId = String(raw?.label || raw?.id || index + 1);
    try {
      const csl =
        format === "csl"
          ? raw
          : new Cite(raw, {
              forceType:
                format === "biblatex"
                  ? "@biblatex/entry+object"
                  : "@ris/record",
            }).data[0];
      if (!csl) throw new Error("The parser could not convert this record.");
      const normalized = fromCsl(csl);
      result.metadata = normalized.metadata;
      result.warnings.push(...normalized.warnings);
      result.sourceUrl = result.metadata.url;
      const properties = format === "biblatex" ? raw.properties : raw;
      const unsupported = Object.keys(properties ?? {}).filter((key) =>
        format === "biblatex"
          ? !bibMapped.has(key)
          : format === "ris"
            ? !risMapped.has(key)
            : false,
      );
      result.warnings.push(
        ...unsupported.map(
          (key) =>
            `Field “${key}” retained in original/source data; not mapped to a native field.`,
        ),
      );
      result.notes = [
        format === "ris" ? raw.N1 : csl.note,
        format === "biblatex" ? properties?.annote : null,
      ]
        .flat()
        .filter(Boolean)
        .map((value) => plain(value));
      result.references = attachmentNames(
        format === "biblatex"
          ? properties?.file
          : format === "ris"
            ? raw.L1
            : (raw.file ?? raw.attachments),
      );
      if (csl.note && /<[^>]+>/.test(String(csl.note)))
        result.warnings.push(
          "Note HTML formatting is flattened to plain text; the original is retained.",
        );
      if (
        format === "biblatex" &&
        properties?.eprint &&
        (properties.eprinttype === "arxiv" ||
          properties.archiveprefix === "arXiv")
      ) {
        result.metadata.manifestationType = "preprint";
        result.metadata.publicationType = "preprint";
        result.metadata.url = `https://arxiv.org/abs/${encodeURIComponent(properties.eprint)}`;
      }
      result.fingerprint = hash(result.metadata);
    } catch (error) {
      result.error =
        error instanceof Error ? error.message : "Could not parse record.";
      result.included = false;
    }
    return result;
  });
}
