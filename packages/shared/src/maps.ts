import { z } from "zod";
import { KId, Ref } from "./knowledge.js";
export const MapLayers = z.enum([
  "citation",
  "bibliographic",
  "semantic",
  "evidence",
  "personal",
]);
const Filters = z
  .object({
    view: z.enum(["spatial", "timeline", "list"]).default("spatial"),
    visible: z.array(KId).max(100).default([]),
    yearFrom: z.number().int().min(1000).max(3000).nullable().default(null),
    yearTo: z.number().int().min(1000).max(3000).nullable().default(null),
    layers: z.array(MapLayers).default(MapLayers.options),
  })
  .refine(
    (v) => !v.yearFrom || !v.yearTo || v.yearFrom <= v.yearTo,
    "Year range is reversed",
  );
export const BoardState = z
  .object({
    question: z.string().max(2000).default(""),
    cards: z
      .array(
        z.object({
          id: KId,
          ref: Ref,
          x: z.number().min(0).max(5000),
          y: z.number().min(0).max(5000),
          pinned: z.boolean().default(false),
          groupId: KId.nullable().default(null),
          explanation: z.string().max(5000).default(""),
        }),
      )
      .max(100),
    groups: z
      .array(
        z.object({
          id: KId,
          name: z.string().trim().min(1).max(100),
          collapsed: z.boolean().default(false),
        }),
      )
      .max(30)
      .default([]),
    path: z
      .array(
        z.object({
          cardId: KId,
          role: z.enum(["background", "comparison", "next_step"]),
          rationale: z.string().max(3000),
          complete: z.boolean().default(false),
        }),
      )
      .max(100)
      .default([]),
    filters: Filters.default(() => Filters.parse({})),
    history: z.array(Filters).max(20).default([]),
  })
  .superRefine((s, c) => {
    const ids = new Set(s.cards.map((x) => x.id)),
      groups = new Set(s.groups.map((x) => x.id));
    if (
      ids.size !== s.cards.length ||
      groups.size !== s.groups.length ||
      new Set(s.path.map((x) => x.cardId)).size !== s.path.length
    )
      c.addIssue({ code: "custom", message: "IDs must be unique" });
    if (
      s.cards.some((x) => x.groupId && !groups.has(x.groupId)) ||
      s.path.some((x) => !ids.has(x.cardId)) ||
      [s.filters, ...s.history].some((f) =>
        f.visible.some((id) => !ids.has(id)),
      )
    )
      c.addIssue({
        code: "custom",
        message: "Unknown card or group reference",
      });
  });
export const BoardInput = z.object({
  title: z.string().trim().min(1).max(300),
  state: BoardState,
});
export const InsightSection = z.object({
  id: KId,
  label: z.string().trim().min(1).max(200),
  kind: z.enum([
    "quotation",
    "synthesis",
    "inference",
    "interpretation",
    "unavailable",
  ]),
  text: z.string().max(15000),
  citations: z
    .array(
      z.object({ sourceId: KId, quote: z.string().trim().min(1).max(10000) }),
    )
    .max(20)
    .default([]),
});
