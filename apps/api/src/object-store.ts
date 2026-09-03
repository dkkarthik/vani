import { createHash } from 'node:crypto';
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { v7 as uuidv7 } from 'uuid';
import { config } from './config.js';
import { query } from './db.js';

export class ObjectStore {
  async put(data: Buffer, mimeType: string) {
    const hash = createHash('sha256').update(data).digest('hex');
    const path = join(config.dataDir, 'objects', 'sha256', hash.slice(0, 2), hash.slice(2, 4), hash);
    try { await stat(path); } catch {
      const temp = join(config.dataDir, 'tmp', uuidv7());
      await mkdir(dirname(temp), { recursive: true }); await mkdir(dirname(path), { recursive: true });
      await writeFile(temp, data, { flag: 'wx' }); await rename(temp, path);
    }
    await query(`INSERT INTO object_store(hash_sha256,byte_size,mime_type,storage_path) VALUES($1,$2,$3,$4)
      ON CONFLICT(hash_sha256) DO NOTHING`, [hash, data.length, mimeType, path]);
    return { hash, path, byteSize: data.length, mimeType };
  }
}
