import { z } from "zod";
export const Shortlist = z.object({
  enabled: z.boolean().default(false),
  limit: z.number().int().min(5).max(100).default(30),
  focus: z.string().trim().max(1600).default(""),
  requiredTerms: z.array(z.string().trim().min(2).max(120)).max(24).default([]),
});
export const Profile = z.object({
  enabled: z.boolean().default(false),
  daily: z.boolean().default(false),
  sources: z
    .array(z.enum(["openalex", "crossref", "arxiv"]))
    .min(1)
    .max(3)
    .default(["openalex", "crossref", "arxiv"]),
  publicQueries: z.array(z.string().trim().min(2).max(300)).max(8).default([]),
  arxivCategories: z
    .array(
      z
        .string()
        .regex(/^(?:cs|math|stat|eess|physics|q-bio|q-fin)\.[A-Za-z-]+$/),
    )
    .max(12)
    .default(["cs.CV", "cs.LG", "cs.RO"]),
  pagesPerQuery: z.number().int().min(1).max(5).default(2),
  maxRecommendations: z.number().int().min(20).max(1000).default(500),
  shortlist: Shortlist.default({
    enabled: false,
    limit: 30,
    focus: "",
    requiredTerms: [],
  }),
});
export type Settings = z.infer<typeof Profile>;
