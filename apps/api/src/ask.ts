import { v7 as uuid } from "uuid";
import { z } from "zod";
import type { Answer, Work } from "@vani/shared";
import { generate } from "./models/router.js";
export type ConversationSource = {
  id: string;
  workId?: string;
  kind: string;
  label: string;
  text: string;
  url?: string;
  page?: number;
  hash?: string;
};
const Output = z.object({
  claims: z
    .array(
      z.object({
        text: z.string().min(2).max(3000),
        kind: z.enum(["synthesis", "inference", "quotation"]),
        citations: z
          .array(
            z.object({
              sourceId: z.string(),
              quote: z.string().min(12).max(1200),
            }),
          )
          .min(1)
          .max(8),
      }),
    )
    .max(12),
  limitations: z.array(z.string().max(1500)).max(10),
});
export async function answerQuestion(
  question: string,
  works: Work[],
  notes: Array<{ title: string; markdown: string }>,
  options: {
    collectionId?: string;
    sources?: ConversationSource[];
    history?: unknown[];
    signal?: AbortSignal;
    extractive?: boolean;
  } = {},
): Promise<Answer> {
  const sources: ConversationSource[] =
    options.sources ??
    works
      .filter((w) => w.abstract)
      .slice(0, 12)
      .map((w) => ({
        id: w.id,
        workId: w.id,
        kind: "abstract",
        label: w.citationKey,
        text: w.abstract,
      }));
  const base = {
    id: uuid(),
    createdAt: new Date().toISOString(),
    claims: [],
    limitations: [],
  };
  if (!sources.length)
    return {
      ...base,
      status: "insufficient_evidence",
      markdown:
        "No usable source evidence is available in this conversation scope.",
      limitations: ["Add a PDF or abstract to the selected collection."],
      modelProvenance: { provider: "none" },
    };
  if (options.extractive)
    return {
      ...base,
      status: "complete",
      markdown: "Retrieved excerpts — not a synthesized answer.",
      claims: sources.slice(0, 6).map((s) => ({
        id: uuid(),
        text: s.text.slice(0, 500),
        supportStatus: "directly_supported" as const,
        evidence: [
          {
            type: s.kind,
            sourceId: s.workId ?? s.id,
            label: s.label,
            exactText: s.text.slice(0, 500),
          },
        ],
      })),
      limitations: ["Explicit extractive mode; no model synthesis."],
      modelProvenance: { provider: "extractive-local" },
    };
  try {
    const result = await generate(
      "Answer the question using only original supplied evidence. Prior turns provide conversational context, not independent evidence. If a reference is ambiguous ask for clarification. Return {claims:[{text,kind:synthesis|inference|quotation,citations:[{sourceId,quote}]}],limitations:[]}. Quote exact source text. Clearly distinguish author statements, your inference, stored VANI decisions and user notes. Missing comparisons must remain unresolved.",
      { question, history: options.history ?? [], sources },
      Output,
      {
        task: "collection_conversation",
        collectionId: options.collectionId,
        privateEvidence: true,
        signal: options.signal,
      },
    );
    if (
      result.value.claims.some(
        (c) =>
          c.citations.some(
            (e) =>
              !sources.some(
                (s) => s.id === e.sourceId && s.text.includes(e.quote),
              ),
          ) ||
          (c.kind === "quotation" &&
            !c.citations.some((e) => e.quote === c.text)),
      )
    )
      throw Error("The answer cited unavailable or mismatched evidence.");
    const claims = result.value.claims.map((c) => ({
      id: uuid(),
      text: c.text,
      supportStatus:
        c.kind === "quotation"
          ? ("directly_supported" as const)
          : c.kind === "inference"
            ? ("inferred" as const)
            : ("indirectly_supported" as const),
      evidence: c.citations.map((e) => {
        const s = sources.find((s) => s.id === e.sourceId)!;
        return {
          type: s.kind,
          sourceId: s.workId ?? s.id,
          label: s.label,
          exactText: e.quote,
        };
      }),
    }));
    return {
      ...base,
      status: claims.length ? "complete" : "insufficient_evidence",
      markdown:
        claims.map((c) => c.text).join("\n\n") ||
        "The supplied evidence does not support an answer.",
      claims,
      limitations: [
        ...result.value.limitations,
        "Synthesis is limited to the retrieved excerpts; citations are checked against stored text.",
      ],
      modelProvenance: {
        ...result.provenance,
        scope: "local-only",
        sourceSnapshot: sources.map((s) => ({
          id: s.id,
          workId: s.workId,
          kind: s.kind,
          label: s.label,
          page: s.page,
          hash: s.hash,
        })),
      },
    };
  } catch (e) {
    return {
      ...base,
      status: options.signal?.aborted ? "cancelled" : "local_model_unavailable",
      markdown: options.signal?.aborted
        ? "Generation cancelled."
        : "Local synthesis is unavailable or did not pass evidence validation.",
      limitations: [
        String(e),
        "Run the local model health check, retry, or explicitly choose source excerpts. No cloud fallback was used.",
      ],
      modelProvenance: { provider: "none", routing: "local-only" },
    };
  }
}
