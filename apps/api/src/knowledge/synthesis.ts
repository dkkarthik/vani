import { v7 as uuid } from "uuid";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { KId as Id, Outline, ComparisonColumn, CellSource } from "@vani/shared";
import { pool, transaction } from "../db.js";
import { fail } from "../metadata.js";
import {
  displayRef,
  resolveRef,
  refs,
  passageMarkdown,
  esc,
} from "./common.js";
async function argument(id: string) {
  const row = (await pool.query("SELECT * FROM argument WHERE id=$1", [id]))
    .rows[0];
  if (!row) fail(404, "Argument not found.");
  return row;
}
async function comparison(id: string) {
  const row = (await pool.query("SELECT * FROM comparison WHERE id=$1", [id]))
    .rows[0];
  if (!row) fail(404, "Comparison not found.");
  return {
    ...row,
    works: await Promise.all(
      row.work_ids.map((id: string) => displayRef({ kind: "work", id })),
    ),
    cells: (
      await pool.query("SELECT * FROM comparison_cell WHERE comparison_id=$1", [
        id,
      ])
    ).rows,
  };
}
export async function registerSynthesis(app: FastifyInstance) {
  app.get("/api/v1/knowledge/argument-options", async () => ({
    items: (
      await pool.query(
        "SELECT id,title,description FROM argument ORDER BY title LIMIT 500",
      )
    ).rows,
  }));
  app.get("/api/v1/knowledge/arguments/:id", async (r) => {
    const a = await argument(Id.parse((r.params as any).id));
    return {
      ...a,
      outline: await Promise.all(
        a.outline.map(async (b: any) => ({
          ...b,
          passages: await Promise.all(
            b.passageIds.map((id: string) =>
              displayRef({ kind: "passage", id }),
            ),
          ),
          notes: await Promise.all(
            b.noteIds.map((id: string) => displayRef({ kind: "note", id })),
          ),
        })),
      ),
    };
  });
  app.patch("/api/v1/knowledge/arguments/:id", async (r) => {
    const id = Id.parse((r.params as any).id),
      d = z
        .object({
          version: z.number().int().positive(),
          title: z.string().trim().min(1).max(300),
          description: z.string().max(10000),
          outline: Outline,
        })
        .parse(r.body);
    return transaction(async (db) => {
      for (const b of d.outline) {
        await refs(b.passageIds, "passage", db);
        await refs(b.noteIds, "note", db);
      }
      const result = await db.query(
        "UPDATE argument SET title=$2,description=$3,outline=$4,version=version+1 WHERE id=$1 AND version=$5 RETURNING *",
        [id, d.title, d.description, JSON.stringify(d.outline), d.version],
      );
      if (!result.rowCount)
        fail(409, "Argument changed or is unavailable. Reload before saving.");
      for (const passageId of new Set(d.outline.flatMap((b) => b.passageIds)))
        await db.query(
          "INSERT INTO argument_evidence(argument_id,annotation_id,rationale) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
          [id, passageId, "Used in argument outline"],
        );
      return result.rows[0];
    });
  });
  app.get("/api/v1/knowledge/arguments/:id/export", async (r) => {
    const a = await argument(Id.parse((r.params as any).id));
    let markdown = `# ${a.title}\n\n${a.description}\n`;
    for (const b of a.outline) {
      markdown += `\n## ${b.kind}: ${b.text}\n`;
      for (const id of b.passageIds)
        markdown += "\n" + (await passageMarkdown(id)) + "\n";
      for (const id of b.noteIds) {
        const n = await displayRef({ kind: "note", id });
        markdown += `\n[${n.label}](/notes/${id})\n`;
      }
    }
    return { markdown };
  });
  app.get("/api/v1/knowledge/comparisons", async () => ({
    items: (
      await pool.query(
        "SELECT * FROM comparison ORDER BY created_at DESC LIMIT 100",
      )
    ).rows,
    limit: 100,
  }));
  app.post("/api/v1/knowledge/comparisons", async (r) => {
    const d = z
      .object({
        title: z.string().trim().min(1).max(300),
        workIds: z.array(Id).min(1).max(20),
      })
      .parse(r.body);
    const workIds = [
      ...new Set(
        await Promise.all(
          d.workIds.map(
            async (id) => (await resolveRef({ kind: "work", id })).id,
          ),
        ),
      ),
    ];
    const id = uuid();
    await pool.query(
      "INSERT INTO comparison(id,title,work_ids) VALUES($1,$2,$3)",
      [id, d.title, workIds],
    );
    return { id };
  });
  app.get("/api/v1/knowledge/comparisons/:id", async (r) =>
    comparison(Id.parse((r.params as any).id)),
  );
  app.put("/api/v1/knowledge/comparisons/:id/cells", async (r) => {
    const id = Id.parse((r.params as any).id),
      d = z
        .object({
          workId: Id,
          column: ComparisonColumn,
          text: z.string().max(10000),
          source: CellSource.nullable(),
          version: z.number().int().min(0),
        })
        .parse(r.body);
    return transaction(async (db) => {
      const table = (
        await db.query("SELECT * FROM comparison WHERE id=$1 FOR UPDATE", [id])
      ).rows[0];
      if (!table) fail(404, "Comparison not found.");
      if (!table.work_ids.includes(d.workId))
        fail(400, "Paper is not in this comparison.");
      const work = await resolveRef({ kind: "work", id: d.workId }, db);
      if (d.text.trim() && !d.source)
        fail(
          400,
          "A finding needs a supporting passage or abstract quotation.",
        );
      let source: any = d.source;
      if (d.source?.kind === "passage") {
        await resolveRef({ kind: "passage", id: d.source.passageId }, db);
        const p = (
          await db.query(
            `SELECT canonical_work(at.work_id) work_id,a.selector->>'quote' quote,a.page_start page,at.object_hash FROM annotation a JOIN attachment at ON at.id=a.attachment_id WHERE a.id=$1`,
            [d.source.passageId],
          )
        ).rows[0];
        if (p.work_id !== work.id)
          fail(400, "Passage belongs to another paper.");
        source = { ...d.source, ...p, citationKey: work.citation_key };
      }
      if (d.source?.kind === "abstract") {
        const abstract = (
          await db.query("SELECT abstract FROM work WHERE id=$1", [work.id])
        ).rows[0].abstract;
        if (!abstract.includes(d.source.quote))
          fail(400, "Quotation does not occur in the current abstract.");
        source = {
          ...d.source,
          citationKey: work.citation_key,
          workId: work.id,
        };
      }
      const old = (
        await db.query(
          "SELECT * FROM comparison_cell WHERE comparison_id=$1 AND work_id=$2 AND column_name=$3",
          [id, d.workId, d.column],
        )
      ).rows[0];
      if ((old?.version ?? 0) !== d.version)
        fail(409, "Cell changed. Reload before saving.");
      const history = old
        ? [
            ...old.history,
            {
              text: old.text,
              source: old.source,
              version: old.version,
              replacedAt: new Date().toISOString(),
            },
          ]
        : [];
      await db.query(
        `INSERT INTO comparison_cell(comparison_id,work_id,column_name,text,source,history) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(comparison_id,work_id,column_name) DO UPDATE SET text=$4,source=$5,history=$6,version=comparison_cell.version+1`,
        [
          id,
          d.workId,
          d.column,
          d.text,
          source ? JSON.stringify(source) : null,
          JSON.stringify(history),
        ],
      );
      await db.query("UPDATE comparison SET version=version+1 WHERE id=$1", [
        id,
      ]);
      return { saved: true };
    });
  });
  app.get("/api/v1/knowledge/comparisons/:id/export", async (r) => {
    const c = await comparison(Id.parse((r.params as any).id)),
      columns = ComparisonColumn.options;
    let markdown = `# ${c.title}\n\n| Paper | ${columns.join(" | ")} |\n| --- | ${columns.map(() => "---").join(" | ")} |\n`;
    for (let i = 0; i < c.work_ids.length; i++) {
      markdown += `| [${esc(c.works[i].label)}](/read/${c.work_ids[i]}) | `;
      markdown +=
        columns
          .map((col) => {
            const cell = c.cells.find(
              (x: any) => x.work_id === c.work_ids[i] && x.column_name === col,
            );
            if (!cell?.text) return "Unrecorded";
            const s = cell.source;
            return (
              esc(cell.text) +
              (s?.kind === "passage"
                ? ` [${s.citationKey}, p. ${s.page}](/passages/${s.passageId})`
                : s
                  ? ` — abstract: “${esc(s.quote)}” [${s.citationKey}](/read/${s.workId})`
                  : "")
            );
          })
          .join(" | ") + " |\n";
    }
    return { markdown };
  });
}
