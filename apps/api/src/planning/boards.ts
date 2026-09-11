import { z } from "zod";
import { v7 as uuid } from "uuid";
import type { FastifyInstance } from "fastify";
import { KId as Id, BoardInput, BoardState } from "@vani/shared";
import { pool } from "../db.js";
import { fail } from "../metadata.js";
import { displayRef, resolveRef } from "../knowledge/common.js";
import { layers } from "../knowledge/layers.js";
import { relevance } from "../collection-discovery.js";
const xml = (s: string) =>
  s.replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
export function visibleCards(state: z.infer<typeof BoardState>, cards: any[]) {
  return cards.filter(
    (c) =>
      (!state.filters.visible.length || state.filters.visible.includes(c.id)) &&
      (!c.year ||
        ((!state.filters.yearFrom || c.year >= state.filters.yearFrom) &&
          (!state.filters.yearTo || c.year <= state.filters.yearTo))),
  );
}
async function validate(state: z.infer<typeof BoardState>) {
  const refs = new Set();
  for (const card of state.cards) {
    const r = await resolveRef(card.ref),
      key = r.kind + ":" + r.id;
    if (refs.has(key)) fail(400, "The same canonical object appears twice.");
    refs.add(key);
  }
}
async function details(row: any) {
  const cards = await Promise.all(
    row.state.cards.map(async (c: any) => {
      const source = await displayRef(c.ref);
      const work =
        c.ref.kind === "work"
          ? (
              await pool.query(
                "SELECT year FROM work WHERE id=canonical_work($1)",
                [c.ref.id],
              )
            ).rows[0]
          : null;
      return { ...c, source, year: work?.year ?? null };
    }),
  );
  return { ...row, cards };
}
async function board(id: string) {
  const row = (
    await pool.query("SELECT * FROM research_board WHERE id=$1", [id])
  ).rows[0];
  if (!row) fail(404, "Map not found.");
  return details(row);
}
export function boardSvg(data: any, edges: any[] = []) {
  const cards = visibleCards(data.state, data.cards).filter(
    (c) => !data.state.groups.find((g: any) => g.id === c.groupId)?.collapsed,
  );
  const width = Math.max(900, ...cards.map((c) => c.x + 310)),
    height = Math.max(450, ...cards.map((c) => c.y + 250));
  const positions = new Map(
    cards.map((c) => [c.source.kind + ":" + c.source.id, c]),
  );
  const lines = edges
    .filter((e) => data.state.filters.layers.includes(e.layer))
    .map((e) => {
      const a: any = positions.get(e.source.kind + ":" + e.source.id),
        b: any = positions.get(e.target.kind + ":" + e.target.id);
      return a && b
        ? `<line x1="${a.x + 130}" y1="${a.y + 155}" x2="${b.x + 130}" y2="${b.y + 155}" stroke="#73938b" stroke-dasharray="${e.layer === "citation" ? "0" : "6 4"}"><title>${xml(e.predicate)} · ${xml(e.layer)}</title></line>`
        : "";
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#f7f8f3"/><text x="24" y="35" font-size="23" font-family="sans-serif">${xml(data.title)}</text><text x="24" y="62" font-size="12" font-family="sans-serif">Solid: indexed citation · Dashed: association/interpretation · ${cards.length} visible cards</text>${lines}${cards
    .map((c) => {
      const words = c.source.label.match(/.{1,32}(?:\s|$)|.{1,32}/g) ?? [];
      return `<g><rect x="${c.x + 10}" y="${c.y + 90}" width="270" height="135" rx="10" fill="white" stroke="#356b5d"/><text x="${c.x + 25}" y="${c.y + 115}" font-family="sans-serif" font-size="13">${words
        .slice(0, 4)
        .map(
          (t: string, i: number) =>
            `<tspan x="${c.x + 25}" dy="${i ? 19 : 0}">${xml(t)}</tspan>`,
        )
        .join(
          "",
        )}</text><text x="${c.x + 25}" y="${c.y + 210}" font-family="sans-serif" font-size="11">${xml(c.source.kind)} · ${c.year ?? "undated"}${c.pinned ? " · pinned" : ""}</text></g>`;
    })
    .join("")}</svg>`;
}
export async function registerBoards(app: FastifyInstance) {
  app.get("/api/v1/knowledge/map-edges", async (r) => {
    const { workIds } = z
      .object({ workIds: z.string().optional() })
      .parse(r.query);
    return layers(
      undefined,
      workIds ? z.array(Id).max(100).parse(workIds.split(",")) : undefined,
    );
  });
  app.get("/api/v1/knowledge/boards", async () => ({
    items: (
      await pool.query(
        "SELECT id,title,version,updated_at FROM research_board ORDER BY updated_at DESC LIMIT 100",
      )
    ).rows,
    limit: 100,
  }));
  app.post("/api/v1/knowledge/boards", async (r) => {
    const d = BoardInput.parse(r.body);
    await validate(d.state);
    const id = uuid();
    await pool.query(
      "INSERT INTO research_board(id,title,state) VALUES($1,$2,$3)",
      [id, d.title, JSON.stringify(d.state)],
    );
    return board(id);
  });
  app.post("/api/v1/knowledge/boards/import", async (r) => {
    const d = BoardInput.extend({ schemaVersion: z.literal(1) }).parse(r.body);
    await validate(d.state);
    const id = uuid();
    await pool.query(
      "INSERT INTO research_board(id,title,state) VALUES($1,$2,$3)",
      [id, d.title + " (imported)", JSON.stringify(d.state)],
    );
    return board(id);
  });
  app.get("/api/v1/knowledge/boards/:id", async (r) =>
    board(Id.parse((r.params as any).id)),
  );
  app.patch("/api/v1/knowledge/boards/:id", async (r) => {
    const id = Id.parse((r.params as any).id),
      d = BoardInput.extend({ version: z.number().int().positive() }).parse(
        r.body,
      );
    await validate(d.state);
    if (
      !(
        await pool.query(
          "UPDATE research_board SET title=$2,state=$3,version=version+1,updated_at=now() WHERE id=$1 AND version=$4",
          [id, d.title, JSON.stringify(d.state), d.version],
        )
      ).rowCount
    )
      fail(409, "Map changed. Reload before saving.");
    return board(id);
  });
  app.get("/api/v1/knowledge/boards/:id/export", async (r, reply) => {
    const d = await board(Id.parse((r.params as any).id)),
      { format } = z.object({ format: z.enum(["svg", "json"]) }).parse(r.query);
    if (format === "json")
      return {
        schemaVersion: 1,
        title: d.title,
        state: d.state,
        edges: (
          await layers(
            undefined,
            d.cards
              .filter((c: any) => c.ref.kind === "work")
              .map((c: any) => c.source.id),
          )
        ).edges,
        sourceLabels: d.cards.map((c: any) => ({
          id: c.id,
          label: c.source.label,
        })),
      };
    return reply
      .type("image/svg+xml")
      .header("content-disposition", 'attachment; filename="research-map.svg"')
      .send(
        boardSvg(
          d,
          (
            await layers(
              undefined,
              d.cards
                .filter((c: any) => c.ref.kind === "work")
                .map((c: any) => c.source.id),
            )
          ).edges,
        ),
      );
  });
  app.post("/api/v1/knowledge/boards/neighbors", async (r) => {
    const d = z
      .object({
        ref: z.object({
          kind: z.enum(["work", "note", "passage", "entity"]),
          id: Id,
        }),
        existing: z.array(Id).max(100),
      })
      .parse(r.body);
    const ref = await resolveRef(d.ref),
      neighborIds =
        ref.kind === "work"
          ? (
              await pool.query(
                "SELECT canonical_work(source_work_id) s,canonical_work(target_work_id) t FROM typed_relationship WHERE canonical_work(source_work_id)=$1 OR canonical_work(target_work_id)=$1 LIMIT 100",
                [ref.id],
              )
            ).rows.flatMap((e) => [e.s, e.t])
          : [],
      graph = await layers(
        undefined,
        ref.kind === "work"
          ? [...new Set([ref.id, ...neighborIds])].slice(0, 100)
          : undefined,
      );
    const matches = graph.edges.filter(
      (e) =>
        (e.source.kind === ref.kind && e.source.id === ref.id) ||
        (e.target.kind === ref.kind && e.target.id === ref.id),
    );
    return {
      items: matches
        .map((e) => ({
          ref: e.source.id === ref.id ? e.target : e.source,
          reason: `${e.predicate}: ${e.explanation}`,
          layer: e.layer,
        }))
        .filter((e) => !d.existing.includes(e.ref.id))
        .slice(0, 20),
      coverage: graph.coverage,
    };
  });
  app.post("/api/v1/knowledge/boards/path-suggestions", async (r) => {
    const state = BoardState.parse(r.body),
      graph = await layers(
        undefined,
        state.cards.filter((c) => c.ref.kind === "work").map((c) => c.ref.id),
      ),
      cards = (await details({ state })).cards.filter(
        (c: any) => c.ref.kind === "work",
      );
    return {
      items: cards.map((c: any) => {
        const citation = graph.edges.find(
          (e) =>
            e.layer === "citation" &&
            e.target.id === c.source.id &&
            cards.some((x: any) => x.source.id === e.source.id),
        );
        const similar = graph.edges.find(
          (e) =>
            ["bibliographic", "semantic"].includes(e.layer) &&
            [e.source.id, e.target.id].includes(c.source.id) &&
            cards.some(
              (x: any) =>
                x.source.id ===
                (e.source.id === c.source.id ? e.target.id : e.source.id),
            ),
        );
        return {
          cardId: c.id,
          label: c.source.label,
          role: citation ? "background" : similar ? "comparison" : "next_step",
          rationale: citation
            ? `Indexed background lead: ${citation.source.label} cites this paper; this is not a proven prerequisite.`
            : similar
              ? `Comparison lead from ${similar.layer} association; inspect methods before comparing.`
              : `Question-term match ${relevance(state.question, c.source.label).toFixed(2)} for “${state.question || "unspecified question"}”; editable next-step lead.`,
        };
      }),
      coverage: graph.coverage,
    };
  });
}
