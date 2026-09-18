import { it, expect, afterAll } from "vitest";
import { readFile } from "node:fs/promises";
import { v7 as uuid } from "uuid";
import { pool } from "../db.js";
import { migrate } from "../cli/migrate.js";
const enabled = process.env.VANI_INTEGRATION_TEST === "true";
afterAll(async () => {
  if (enabled) await pool.end();
});
it.skipIf(!enabled)(
  "upgrades default budgets with history and preserves custom budgets and old snapshots",
  async () => {
    await migrate();
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const ids = [uuid(), uuid(), uuid()];
      const budgets = [
        { d2: 40, d3: 10 },
        { d2: 6, d3: 3 },
        { d2: 40, d3: 3 },
      ];
      for (let i = 0; i < ids.length; i++) {
        await db.query(
          "INSERT INTO collection(id,name) VALUES($1,'Budget test')",
          [ids[i]],
        );
        await db.query(
          "INSERT INTO core_focus(collection_id,profile) VALUES($1,$2)",
          [
            ids[i],
            JSON.stringify({
              question: "Navigation",
              budgets: { d0: 20000, d1: 2000, ...budgets[i] },
            }),
          ],
        );
        await db.query(
          "INSERT INTO core_run(id,collection_id,focus_version,snapshot) SELECT $1,collection_id,version,profile FROM core_focus WHERE collection_id=$2",
          [uuid(), ids[i]],
        );
      }
      await db.query(
        await readFile(
          new URL(
            "../../migrations/015_expanded_reading_budgets.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      for (let i = 0; i < ids.length; i++) {
        const focus = (
          await db.query("SELECT * FROM core_focus WHERE collection_id=$1", [
            ids[i],
          ])
        ).rows[0];
        const run = (
          await db.query("SELECT * FROM core_run WHERE collection_id=$1", [
            ids[i],
          ])
        ).rows[0];
        expect(focus.profile.budgets).toMatchObject(
          i === 0
            ? { d2: 200, d3: 50 }
            : i === 1
              ? { d2: 6, d3: 3 }
              : { d2: 200, d3: 3 },
        );
        expect(focus.version).toBe(i === 1 ? 1 : 2);
        expect(focus.history.length).toBe(i === 1 ? 0 : 1);
        expect(run.snapshot.budgets).toMatchObject(budgets[i]!);
        expect(run.status).toBe(i === 1 ? "queued" : "superseded");
      }
    } finally {
      await db.query("ROLLBACK");
      db.release();
    }
  },
);
