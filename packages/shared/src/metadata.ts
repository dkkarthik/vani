import { z } from "zod";

export const normalizeDoi = (value: string) => {
  let doi = value
    .trim()
    .replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, "");
  try {
    doi = decodeURIComponent(doi);
  } catch {
    /* Validation reports malformed identifiers. */
  }
  return doi.toLowerCase();
};
const text = (max = 1000) => z.string().trim().max(max).default("");
export const MetadataName = z.object({
  given: text(300),
  family: z.string().trim().min(1).max(500),
  orcid: z.string().max(100).nullable().optional(),
});
const date = text(50).refine(
  (value) =>
    !value ||
    (() => {
      if (!/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(value)) return false;
      const [year, month = 1, day = 1] = value.split("-").map(Number);
      if (
        !year ||
        year < 1000 ||
        year > 3000 ||
        month < 1 ||
        month > 12 ||
        day < 1
      )
        return false;
      return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
    })(),
  "Use YYYY, YYYY-MM, or YYYY-MM-DD.",
);
export const MetadataFields = z.object({
  title: z.string().trim().min(1).max(2000),
  abstract: text(30000),
  authors: z.array(MetadataName).max(300).default([]),
  editors: z.array(MetadataName).max(100).default([]),
  year: z.number().int().min(1000).max(3000).nullable().default(null),
  doi: z
    .preprocess(
      (value) =>
        typeof value === "string"
          ? value.trim()
            ? normalizeDoi(value)
            : null
          : value,
      z
        .string()
        .max(300)
        .regex(/^10\.\d{4,9}\/[^\s<>]+$/)
        .nullable(),
    )
    .default(null),
  venue: text(),
  publisher: text(),
  publicationPlace: text(),
  publicationDate: date,
  onlineDate: date,
  printDate: date,
  volume: text(100),
  issue: text(100),
  pages: text(100),
  articleNumber: text(100),
  edition: text(100),
  isbn: text(300),
  issn: text(100),
  language: text(100),
  url: text(4096).refine((value) => {
    if (!value) return true;
    try {
      const url = new URL(value);
      return (
        ["http:", "https:"].includes(url.protocol) &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  }, "Use an HTTP(S) URL without credentials."),
  publicationType: z.string().trim().min(1).max(100).default("article-journal"),
  manifestationType: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .default("version_of_record"),
});
export type MetadataFields = z.infer<typeof MetadataFields>;
export const metadataKeys = Object.keys(MetadataFields.shape) as Array<
  keyof MetadataFields
>;
export const MetadataField = z.enum(
  metadataKeys as [keyof MetadataFields, ...Array<keyof MetadataFields>],
);
// Zod defaults inside optional fields also run for omitted object keys.
// Validate only supplied keys so a title-only patch cannot reset authors/year/etc.
export const MetadataPatch = z
  .partialRecord(MetadataField, z.unknown())
  .transform((input, ctx) => {
    const patch: Partial<MetadataFields> = {};
    for (const key of Object.keys(input) as Array<keyof MetadataFields>) {
      const parsed = MetadataFields.shape[key].safeParse(input[key]);
      if (!parsed.success) {
        for (const issue of parsed.error.issues)
          ctx.addIssue({
            code: "custom",
            message: issue.message,
            path: [key, ...issue.path],
          });
      } else Object.assign(patch, { [key]: parsed.data });
    }
    return patch;
  });
export const metadataLabels: Record<keyof MetadataFields, string> = {
  title: "Title",
  abstract: "Abstract",
  authors: "Authors",
  editors: "Editors",
  year: "Year",
  doi: "DOI",
  venue: "Journal / book / conference",
  publisher: "Publisher",
  publicationPlace: "Publication place",
  publicationDate: "Issued date",
  onlineDate: "Online date",
  printDate: "Print date",
  volume: "Volume",
  issue: "Issue",
  pages: "Pages",
  articleNumber: "Article number",
  edition: "Edition",
  isbn: "ISBN",
  issn: "ISSN",
  language: "Language",
  url: "Source URL",
  publicationType: "Publication type",
  manifestationType: "Version / manifestation",
};
export interface MetadataAssertion {
  id: string;
  source: string;
  externalId: string;
  sourceUrl: string;
  metadata: Partial<MetadataFields>;
  raw: unknown;
  authoritative: boolean;
  createdAt: string;
}
export interface MetadataDecision {
  id: string;
  field: string;
  before: unknown;
  after: unknown;
  origin: string;
  assertionId: string | null;
  reason: string;
  revision: number;
  createdAt: string;
}
export interface MetadataDocument {
  workId: string;
  citationKey: string;
  revision: number;
  verificationStatus: string;
  fields: MetadataFields;
  locks: string[];
  assertions: MetadataAssertion[];
  decisions: MetadataDecision[];
  warnings: string[];
}
export function metadataWarnings(fields: MetadataFields) {
  return [
    !fields.authors.length && "Authors are missing.",
    !fields.year && "Publication year is missing.",
    !fields.venue && !fields.publisher && "Venue and publisher are missing.",
    !fields.doi && !fields.url && "No DOI or source URL is recorded.",
  ].filter((value): value is string => Boolean(value));
}
const words = (value: unknown) =>
  String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
export function metadataEquivalent(
  field: keyof MetadataFields,
  a: unknown,
  b: unknown,
): boolean {
  if (field === "doi")
    return normalizeDoi(String(a ?? "")) === normalizeDoi(String(b ?? ""));
  if (field === "authors" || field === "editors") {
    const left = (a as MetadataFields["authors"]) ?? [],
      right = (b as MetadataFields["authors"]) ?? [];
    return (
      left.length === right.length &&
      left.every((name, index) => {
        const other = right[index]!;
        const x = words(name.given).split(" ").filter(Boolean),
          y = words(other.given).split(" ").filter(Boolean);
        return (
          words(name.family) === words(other.family) &&
          (words(name.given) === words(other.given) ||
            (x.length === y.length &&
              x.length > 0 &&
              x.every(
                (part, i) =>
                  part === y[i] ||
                  ((part.length === 1 || y[i]!.length === 1) &&
                    part[0] === y[i]![0]),
              )))
        );
      })
    );
  }
  if (
    field === "title" ||
    field === "venue" ||
    field === "publisher" ||
    field === "pages"
  )
    return words(a) === words(b);
  return JSON.stringify(a ?? "") === JSON.stringify(b ?? "");
}
export const metadataEmpty = (value: unknown) =>
  value == null || value === "" || (Array.isArray(value) && value.length === 0);
