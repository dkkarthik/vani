import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../db.js';

export async function migrate() {
  const here = dirname(fileURLToPath(import.meta.url));
  const directory = resolve(here, '../../migrations');
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migration (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  for (const file of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) {
    const exists = await pool.query('SELECT 1 FROM schema_migration WHERE version = $1', [file]);
    if (exists.rowCount) continue;
    const sql = await readFile(resolve(directory, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migration(version) VALUES($1) ON CONFLICT DO NOTHING', [file]);
      await client.query('COMMIT');
      console.log(`Applied ${file}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  migrate().then(() => pool.end()).catch((error) => { console.error(error); process.exitCode = 1; });
}
