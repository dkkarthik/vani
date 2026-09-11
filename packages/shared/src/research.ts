import { z } from "zod";
export const ResearchId = z.string().uuid();
export const ReadingState = z.enum([
  "inbox",
  "to_read",
  "skimming",
  "reading",
  "read",
  "foundational",
  "cited",
  "rejected",
  "archived",
]);
export const Tags = z
  .array(z.string().trim().min(1).max(80))
  .max(100)
  .transform((values) =>
    [...new Set(values.map((value) => value.toLowerCase()))].sort(),
  );
export const LibraryRule = z.object({
  text: z.string().max(500).default(""),
  tag: z.string().max(80).default(""),
  yearFrom: z.number().int().min(1000).max(3000).optional(),
  yearTo: z.number().int().min(1000).max(3000).optional(),
  status: ReadingState.optional(),
  unfiled: z.boolean().default(false),
});
export type LibraryRule = z.infer<typeof LibraryRule>;
export const Rectangle = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .refine(
    (r) => r.x + r.width <= 1.001 && r.y + r.height <= 1.001,
    "Rectangle must fit the page.",
  );
export const PassageSelector = z.object({
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  page: z.number().int().min(1).max(2000),
  quote: z.string().max(20000).default(""),
  rects: z.array(Rectangle).min(1).max(200),
});
export const AnnotationInput = z.object({
  type: z.enum(["highlight", "comment", "area"]),
  body: z.string().max(20000).default(""),
  color: z
    .string()
    .regex(/^#[a-fA-F0-9]{6}$/)
    .default("#f5c451"),
  tags: Tags.default([]),
  selector: PassageSelector,
});
export type PassageSelector = z.infer<typeof PassageSelector>;
export const CleanupOperation = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("field"),
    field: z.enum([
      "title",
      "venue",
      "publisher",
      "year",
      "language",
      "publicationType",
    ]),
    value: z.union([z.string().max(2000), z.number().int(), z.null()]),
  }),
  z.object({
    type: z.enum(["add_tag", "remove_tag"]),
    tag: z.string().trim().min(1).max(80),
  }),
  z.object({
    type: z.literal("merge_tag"),
    from: z.string().trim().min(1).max(80),
    to: z.string().trim().min(1).max(80),
  }),
  z.object({ type: z.literal("normalize_names") }),
]);
export type CleanupOperation = z.infer<typeof CleanupOperation>;
