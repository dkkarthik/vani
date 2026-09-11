import type { PoolClient } from "pg";
import { v7 as uuid } from "uuid";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  LibraryRule,
  ResearchId as Id,
  Tags,
  ReadingState,
} from "@vani/shared";
import { pool, transaction } from "../db.js";
import { fail } from "../metadata.js";

export async function activeWork(client: PoolClient | typeof pool, id: string) {
  const row = (
    await client.query(
      "SELECT * FROM work WHERE id=$1 AND deleted_at IS NULL AND merged_into IS NULL",
      [id],
    )
  ).rows[0];
  if (!row) fail(404, "Canonical paper not found. Reload the library.");
  return row;
}
export async function manualCollection(
  client: PoolClient | typeof pool,
  id: string,
) {
  const row = (
    await client.query(
      "SELECT * FROM collection WHERE id=$1 AND deleted_at IS NULL",
      [id],
    )
  ).rows[0];
  if (!row) fail(404, "Collection not found.");
  if (row.collection_type === "saved_search")
    fail(
      409,
      "Saved-search membership is computed automatically. Choose a manual collection.",
    );
  return row;
}
export async function libraryWhere(rule: LibraryRule, collectionId?: string) {
  let manualScope: string | undefined;
  const values: unknown[] = [];
  const where = ["w.deleted_at IS NULL", "w.merged_into IS NULL"];
  const add = (value: unknown) => {
    values.push(value);
    return "$" + values.length;
  };
  if (collectionId) {
    const collection = (
      await pool.query(
        "SELECT * FROM collection WHERE id=$1 AND deleted_at IS NULL",
        [collectionId],
      )
    ).rows[0];
    if (!collection) fail(404, "Collection not found.");
    if (collection.collection_type === "saved_search") {
      const saved = LibraryRule.parse(collection.search_rule);
      const nested = await libraryWhere(saved);
      where.push(...nested.where);
      values.push(...nested.values);
    } else {
      manualScope = collectionId;
      where.push(
        `EXISTS(SELECT 1 FROM collection_membership cm WHERE cm.work_id=w.id AND cm.collection_id=${add(collectionId)})`,
      );
    }
  }
  if (rule.text) {
    const key = add("%" + rule.text + "%");
    where.push(
      `(w.title ILIKE ${key} OR w.abstract ILIKE ${key} OR w.doi ILIKE ${key} OR w.citation_key ILIKE ${key} OR EXISTS(SELECT 1 FROM work alias WHERE canonical_work(alias.id)=w.id AND alias.citation_key ILIKE ${key}) OR EXISTS(SELECT 1 FROM authorship au JOIN person p ON p.id=au.person_id WHERE au.work_id=w.id AND p.display_name ILIKE ${key}))`,
    );
  }
  if (rule.tag) where.push(`${add(rule.tag.toLowerCase())}=ANY(w.tags)`);
  if (rule.yearFrom) where.push(`w.year>=${add(rule.yearFrom)}`);
  if (rule.yearTo) where.push(`w.year<=${add(rule.yearTo)}`);
  if (rule.status)
    where.push(
      `EXISTS(SELECT 1 FROM collection_membership cm JOIN collection c ON c.id=cm.collection_id WHERE cm.work_id=w.id AND c.deleted_at IS NULL AND cm.status=${add(rule.status)}${manualScope ? ` AND cm.collection_id=${add(manualScope)}` : ""})`,
    );
  if (rule.unfiled)
    where.push(
      "NOT EXISTS(SELECT 1 FROM collection_membership cm JOIN collection c ON c.id=cm.collection_id WHERE cm.work_id=w.id AND c.deleted_at IS NULL AND c.collection_type='manual')",
    );
  return { where, values };
}
export async function organizationWorks(
  rule: LibraryRule,
  collectionId?: string,
  offset = 0,
) {
  const { where, values } = await libraryWhere(rule, collectionId);
  const clause = where.join(" AND ");
  const count = (
    await pool.query(
      `SELECT count(*)::int AS total FROM work w WHERE ${clause}`,
      values,
    )
  ).rows[0].total;
  const rows = (
    await pool.query(
      `SELECT w.id,w.title,w.year,w.citation_key,w.version,w.tags,w.manifestation_type,COALESCE((SELECT jsonb_agg(jsonb_build_object('collectionId',cm.collection_id,'status',cm.status,'priority',cm.priority,'rationale',cm.rationale)) FROM collection_membership cm JOIN collection c ON c.id=cm.collection_id WHERE cm.work_id=w.id AND c.deleted_at IS NULL),'[]') AS memberships FROM work w WHERE ${clause} ORDER BY w.updated_at DESC,w.id LIMIT 100 OFFSET $${values.length + 1}`,
      [...values, offset],
    )
  ).rows;
  return { items: rows, total: count, offset };
}
export async function registerOrganization(app: FastifyInstance) {
  app.get("/api/v1/organization/collections", async () => ({
    items: (
      await pool.query(
        "SELECT * FROM collection WHERE deleted_at IS NULL ORDER BY name,id",
      )
    ).rows,
  }));
  const collectionInput = z.object({
    name: z.string().trim().min(1).max(200),
    description: z.string().max(5000).default(""),
    parentId: Id.nullable().default(null),
    rule: LibraryRule.nullable().default(null),
  });
  app.post("/api/v1/organization/collections", async (request) => {
    const input = collectionInput.parse(request.body);
    return transaction(async (client) => {
      if (
        input.parentId &&
        !(
          await client.query(
            "SELECT 1 FROM collection WHERE id=$1 AND deleted_at IS NULL",
            [input.parentId],
          )
        ).rowCount
      )
        fail(404, "Parent collection not found.");
      const id = uuid();
      await client.query(
        "INSERT INTO collection(id,name,description,parent_id,collection_type,search_rule) VALUES($1,$2,$3,$4,$5,$6)",
        [
          id,
          input.name,
          input.description,
          input.parentId,
          input.rule ? "saved_search" : "manual",
          input.rule ? JSON.stringify(input.rule) : null,
        ],
      );
      return { id };
    });
  });
  app.patch("/api/v1/organization/collections/:id", async (request) => {
    const id = Id.parse((request.params as any).id);
    const input = collectionInput
      .extend({ revision: z.number().int().positive() })
      .parse(request.body);
    return transaction(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('vani-collections'))",
      );
      const row = (
        await client.query(
          "SELECT * FROM collection WHERE id=$1 AND deleted_at IS NULL FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (!row) fail(404, "Collection not found.");
      if (row.version !== input.revision)
        fail(409, "Collection changed. Reload it.");
      if ((row.collection_type === "saved_search") !== Boolean(input.rule))
        fail(
          409,
          "Create a new collection to change manual/saved-search type.",
        );
      if (input.parentId) {
        const parent = (
          await client.query(
            "SELECT id FROM collection WHERE id=$1 AND deleted_at IS NULL",
            [input.parentId],
          )
        ).rows[0];
        if (!parent) fail(404, "Parent not found.");
        const cycle = await client.query(
          "WITH RECURSIVE descendants AS (SELECT id FROM collection WHERE id=$1 UNION SELECT c.id FROM collection c JOIN descendants d ON c.parent_id=d.id) SELECT 1 FROM descendants WHERE id=$2",
          [id, input.parentId],
        );
        if (cycle.rowCount)
          fail(
            409,
            "A collection cannot be nested inside itself or its descendants.",
          );
      }
      await client.query(
        "UPDATE collection SET name=$2,description=$3,parent_id=$4,search_rule=$5,version=version+1,updated_at=now() WHERE id=$1",
        [
          id,
          input.name,
          input.description,
          input.parentId,
          input.rule ? JSON.stringify(input.rule) : null,
        ],
      );
      return { id };
    });
  });
  app.post("/api/v1/organization/works", (request) => {
    const input = z
      .object({
        rule: LibraryRule.default(LibraryRule.parse({})),
        collectionId: Id.optional(),
        offset: z.number().int().min(0).default(0),
      })
      .parse(request.body ?? {});
    return organizationWorks(input.rule, input.collectionId, input.offset);
  });
  app.put("/api/v1/organization/memberships", async (request) => {
    const input = z
      .object({
        collectionId: Id,
        workIds: z.array(Id).min(1).max(100),
        status: ReadingState.default("inbox"),
        priority: z.number().int().min(0).max(5).default(0),
        rationale: z.string().max(5000).default(""),
      })
      .parse(request.body);
    return transaction(async (client) => {
      await manualCollection(client, input.collectionId);
      for (const id of [...new Set(input.workIds)]) {
        await activeWork(client, id);
        await client.query(
          "INSERT INTO collection_membership(collection_id,work_id,status,priority,rationale) VALUES($1,$2,$3,$4,$5) ON CONFLICT(collection_id,work_id) DO UPDATE SET status=$3,priority=$4,rationale=$5,updated_at=now()",
          [
            input.collectionId,
            id,
            input.status,
            input.priority,
            input.rationale,
          ],
        );
      }
      return { updated: input.workIds.length };
    });
  });
  app.delete(
    "/api/v1/organization/memberships/:collectionId/:workId",
    async (request) => {
      const { collectionId, workId } = z
        .object({ collectionId: Id, workId: Id })
        .parse(request.params);
      await manualCollection(pool, collectionId);
      await pool.query(
        "DELETE FROM collection_membership WHERE collection_id=$1 AND canonical_work(work_id)=$2",
        [collectionId, workId],
      );
      return { removed: true };
    },
  );
  app.put("/api/v1/organization/works/:id/tags", async (request) => {
    const id = Id.parse((request.params as any).id);
    const input = z
      .object({ tags: Tags, revision: z.number().int().positive() })
      .parse(request.body);
    const result = await pool.query(
      "UPDATE work SET tags=$2,version=version+1,updated_at=now() WHERE id=$1 AND version=$3 AND merged_into IS NULL AND deleted_at IS NULL RETURNING id",
      [id, input.tags, input.revision],
    );
    if (!result.rowCount)
      fail(409, "Paper changed. Reload before updating tags.");
    return { id };
  });
}
