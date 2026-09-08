import { z } from "zod";

export const CaptureUrl = z
  .string()
  .max(4096)
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  }, "Use an HTTP or HTTPS URL without credentials.");

export const CaptureMetadata = z.object({
  title: z.string().trim().min(1).max(2000),
  abstract: z.string().max(30000).default(""),
  authors: z
    .array(
      z.object({
        given: z.string().max(300).default(""),
        family: z.string().trim().min(1).max(500),
      }),
    )
    .max(300)
    .default([]),
  doi: z
    .string()
    .max(300)
    .regex(/^10\.\d{4,9}\/[^\s<>]+$/i)
    .nullable()
    .default(null),
  year: z.number().int().min(1000).max(3000).nullable().default(null),
  venue: z.string().max(1000).default(""),
  publisher: z.string().max(1000).default(""),
  publicationDate: z.string().max(50).default(""),
  volume: z.string().max(100).default(""),
  issue: z.string().max(100).default(""),
  pages: z.string().max(100).default(""),
  extractionMethod: z.string().max(100).default("page"),
});
export type CaptureMetadata = z.infer<typeof CaptureMetadata>;

export const BrowserCaptureInput = z
  .object({
    id: z.string().uuid(),
    collectionId: z.string().uuid(),
    sourceUrl: CaptureUrl,
    canonicalUrl: CaptureUrl,
    metadata: CaptureMetadata,
    pdfUrl: CaptureUrl.nullable().default(null),
    savePdf: z.boolean().default(false),
  })
  .refine(
    (value) => !value.savePdf || Boolean(value.pdfUrl),
    "Choose a PDF to attach.",
  );
export type BrowserCaptureInput = z.infer<typeof BrowserCaptureInput>;

export interface CaptureResult {
  id: string;
  workId: string;
  collectionId: string;
  title: string;
  citationKey: string;
  sourceUrl: string;
  canonicalUrl: string;
  pdfUrl: string | null;
  pdfStatus: "not_requested" | "pending" | "saved" | "failed";
  pdfMessage: string;
  attachmentId: string | null;
  duplicate: boolean;
  createdAt: string;
}

export const MAX_CAPTURE_PDF_BYTES = 50 * 1024 * 1024;
