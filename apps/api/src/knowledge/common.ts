import type { PoolClient } from "pg";
import { pool } from "../db.js";
import { fail } from "../metadata.js";
import { Ref, type KnowledgeRef } from "@vani/shared";
export type DB = Pick<PoolClient, "query">;
export async function resolveRef(input: KnowledgeRef, db: DB = pool) {
  const r = Ref.parse(input);
  let row: any;
  if (r.kind === "work")
    row = (
      await db.query(
        "SELECT id,title label,citation_key FROM work WHERE id=canonical_work($1) AND deleted_at IS NULL",
        [r.id],
      )
    ).rows[0];
  if (r.kind === "note")
    row = (
      await db.query(
        "SELECT id,title label FROM note WHERE id=$1 AND deleted_at IS NULL",
        [r.id],
      )
    ).rows[0];
  if (r.kind === "entity")
    row = (
      await db.query(
        "SELECT id,name label,entity_type FROM knowledge_entity WHERE id=canonical_entity($1)",
        [r.id],
      )
    ).rows[0];
  if (r.kind === "passage")
    row = (
      await db.query(
        `SELECT a.id,w.title||' · p. '||a.page_start label,a.selector->>'quote' quote,w.citation_key,a.page_start page FROM annotation a JOIN attachment at ON at.id=a.attachment_id JOIN work w ON w.id=canonical_work(at.work_id) WHERE a.id=$1 AND a.deleted_at IS NULL AND w.deleted_at IS NULL`,
        [r.id],
      )
    ).rows[0];
  if (!row) fail(404, `${r.kind} is unavailable.`);
  return {
    ...r,
    ...row,
    url:
      r.kind === "work"
        ? `/read/${row.id}`
        : r.kind === "passage"
          ? `/passages/${row.id}`
          : r.kind === "note"
            ? `/notes/${row.id}`
            : `/knowledge?tab=entities&entity=${row.id}`,
  };
}
export async function displayRef(r: KnowledgeRef, db: DB = pool) {
  try {
    return await resolveRef(r, db);
  } catch {
    return { ...r, label: "Unavailable " + r.kind, unavailable: true };
  }
}
export async function refs(
  ids: string[],
  kind: KnowledgeRef["kind"],
  db: DB = pool,
) {
  for (const id of ids) await resolveRef({ kind, id }, db);
}
export async function noteRecord(id: string, db: DB = pool) {
  const row = (
    await db.query("SELECT * FROM note WHERE id=$1 AND deleted_at IS NULL", [
      id,
    ])
  ).rows[0];
  if (!row) fail(404, "Note not found.");
  return row;
}
export const esc = (text: string) =>
  text.replaceAll("\\", "\\\\").replaceAll("|", "\\|").replaceAll("\n", "<br>");
export async function passageMarkdown(id: string) {
  try {
    const p = await resolveRef({ kind: "passage", id });
    return `> ${String(p.quote ?? "Area annotation").replaceAll("\n", "\n> ")}\n\n[${p.citation_key}, p. ${p.page}](${p.url})`;
  } catch {
    return `[Unavailable passage ${id}](/passages/${id})`;
  }
}
