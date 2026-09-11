import { z } from "zod";
export const KId = z.string().uuid();
export const Ref = z.object({
  kind: z.enum(["work", "passage", "note", "entity"]),
  id: KId,
});
export const EntityType = z.enum([
  "concept",
  "method",
  "dataset",
  "task",
  "author",
]);
export const Predicate = z.enum([
  "relates_to",
  "supports",
  "challenges",
  "compares_against",
  "uses_method",
  "evaluates_on",
  "extends",
  "read_before",
  "explains",
]);
export const EdgeInput = z.object({
  source: Ref,
  target: Ref,
  predicate: Predicate,
  rationale: z.string().trim().min(1).max(10000),
  passageIds: z.array(KId).max(20).default([]),
});
export const NoteInput = z.object({
  title: z.string().trim().min(1).max(300),
  markdown: z.string().max(200000).default(""),
  noteType: z
    .enum(["source", "topic", "argument", "claim", "synthesis"])
    .default("source"),
  workId: KId.nullable().default(null),
  collectionId: KId.nullable().default(null),
  argumentId: KId.nullable().default(null),
});
export const Outline = z
  .array(
    z.object({
      id: KId,
      kind: z.enum(["claim", "evidence", "caveat", "question"]),
      text: z.string().max(20000),
      passageIds: z.array(KId).max(30).default([]),
      noteIds: z.array(KId).max(30).default([]),
    }),
  )
  .max(100)
  .refine(
    (a) => new Set(a.map((b) => b.id)).size === a.length,
    "Block IDs must be unique",
  );
export const ComparisonColumn = z.enum([
  "question",
  "method",
  "dataset_population",
  "results",
  "assumptions",
  "limitations",
]);
export const CellSource = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("passage"), passageId: KId }),
  z.object({
    kind: z.literal("abstract"),
    quote: z.string().trim().min(1).max(10000),
  }),
]);
export type KnowledgeRef = z.infer<typeof Ref>;
