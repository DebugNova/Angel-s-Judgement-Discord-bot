/**
 * Full logical backup of every table to a single JSON file (works with the embedded database and
 * any PostgreSQL — no pg_dump required).
 *   npm run db:backup                → backups/satan-<timestamp>.json
 *   npm run db:backup -- my-file.json
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { exportAll } from '../database/backup.js';
import { disconnectDb } from '../database/client.js';
import { connectForScript } from './db-connect.js';

const embedded = await connectForScript();
try {
  const data = await exportAll();
  const stamp = data.createdAt.replace(/[:.]/g, '-');
  const file = resolve(process.argv[2] ?? `backups/satan-${stamp}.json`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data));
  const counts = Object.entries(data.tables)
    .map(([k, v]) => `${k}=${v.length}`)
    .join(' ');
  console.log(`✓ Backup written to ${file}\n  ${counts}`);
} finally {
  await disconnectDb();
  await embedded?.stop();
}
