import { v7 as uuid } from "uuid";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import {
  CleanupOperation,
  MetadataFields,
  ResearchId as Id,
  Tags,
  metadataKeys,
} from "@vani/shared";
import { Repository } from "../repository.js";
import { MetadataRepository, canonical, fail } from "../metadata.js";
import { pool, transaction } from "../db.js";
import { activeWork } from "./organization.js";
export function cleanupValues(
  before: MetadataFields,
  tags: string[],
  operation: CleanupOperation,
) {
  const after = structuredClone(before);
  let next = [...tags];
  if (operation.type === "field")
    Object.assign(after, { [operation.field]: operation.value });
  if (operation.type === "add_tag") next.push(operation.tag);
  if (operation.type === "remove_tag")
    next = next.filter((tag) => tag !== operation.tag.toLowerCase());
  if (operation.type === "merge_tag")
    next = next.map((tag) =>
      tag === operation.from.toLowerCase() ? operation.to : tag,
    );
  if (operation.type === "normalize_names")
    for (const field of ["authors", "editors"] as const)
      after[field] = after[field].map((name) => ({
        ...name,
        given: name.given.replace(/\s+/g, " ").trim(),
        family: name.family.replace(/\s+/g, " ").trim(),
      }));
  return { fields: MetadataFields.parse(after), tags: Tags.parse(next) };
}
export class CleanupRepository {
  private repo = new Repository();
  private metadata = new MetadataRepository(this.repo);
  async get(id: string) {
    const row = (
      await pool.query("SELECT * FROM cleanup_batch WHERE id=$1", [id])
    ).rows[0];
    if (!row) fail(404, "Cleanup preview not found.");
    return row;
  }
  async preview(ids: string[], operation: CleanupOperation) {
    const items = await transaction(async (client) => {
      const result = [];
      for (const id of [...new Set(ids)].sort()) {
        const state = await activeWork(client, id);
        const work = await this.repo.getWork(id, client);
        const before = canonical(work);
        result.push({
          id,
          title: work!.title,
          revision: state.version,
          before: {
            fields: before,
            tags: state.tags,
            locks: state.metadata_locks,
            status: state.verification_status,
          },
          after: cleanupValues(before, state.tags, operation),
        });
      }
      return result;
    });
    const id = uuid();
    await pool.query(
      "INSERT INTO cleanup_batch(id,operation,items) VALUES($1,$2,$3)",
      [id, JSON.stringify(operation), JSON.stringify(items)],
    );
    return this.get(id);
  }
  async apply(id: string, undo = false) {
    await transaction(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('vani-browser-capture'))",
      );
      const batch = (
        await client.query(
          "SELECT * FROM cleanup_batch WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (!batch) fail(404, "Cleanup not found.");
      if (batch.state === (undo ? "undone" : "applied")) return;
      if (batch.state !== (undo ? "applied" : "preview"))
        fail(409, "This batch cannot be applied in its current state.");
      for (const item of batch.items) {
        await client.query("SELECT id FROM work WHERE id=$1 FOR UPDATE", [
          item.id,
        ]);
        const state = await activeWork(client, item.id);
        const expected = undo ? item.appliedRevision : item.revision;
        if (state.version !== expected)
          fail(
            409,
            `“${item.title}” changed. ${undo ? "Undo would overwrite later edits." : "Create a fresh preview."}`,
          );
      }
      for (const item of batch.items) {
        const state = await activeWork(client, item.id);
        await this.metadata.baseline(item.id, client);
        const before = canonical(await this.repo.getWork(item.id, client));
        const after = undo ? item.before.fields : item.after.fields;
        const changed = metadataKeys.filter(
          (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
        );
        await this.metadata.write(
          client,
          item.id,
          before,
          after,
          undo
            ? item.before.locks
            : [...new Set([...state.metadata_locks, ...changed])],
          state.version,
          undo
            ? item.before.status
            : changed.length
              ? "unverified"
              : state.verification_status,
          undo ? "batch_undo" : "batch_user",
          null,
          `Cleanup ${id}`,
          changed,
        );
        await client.query("UPDATE work SET tags=$2 WHERE id=$1", [
          item.id,
          undo ? item.before.tags : item.after.tags,
        ]);
        if (!undo) item.appliedRevision = state.version + 1;
        else item.undoRevision = state.version + 1;
      }
      await client.query(
        "UPDATE cleanup_batch SET state=$2,items=$3,updated_at=now() WHERE id=$1",
        [id, undo ? "undone" : "applied", JSON.stringify(batch.items)],
      );
    });
    return this.get(id);
  }
}
export async function registerCleanup(app: FastifyInstance) {
  const repo = new CleanupRepository();
  app.get("/api/v1/cleanup", async () => ({
    items: (
      await pool.query(
        "SELECT * FROM cleanup_batch ORDER BY created_at DESC LIMIT 50",
      )
    ).rows,
  }));
  app.get("/api/v1/cleanup/:id", (r) =>
    repo.get(Id.parse((r.params as any).id)),
  );
  app.post("/api/v1/cleanup/preview", (r) => {
    const input = z
      .object({
        workIds: z.array(Id).min(1).max(100),
        operation: CleanupOperation,
      })
      .parse(r.body);
    return repo.preview(input.workIds, input.operation);
  });
  app.post("/api/v1/cleanup/:id/apply", (r) =>
    repo.apply(Id.parse((r.params as any).id)),
  );
  app.post("/api/v1/cleanup/:id/undo", (r) =>
    repo.apply(Id.parse((r.params as any).id), true),
  );
}
