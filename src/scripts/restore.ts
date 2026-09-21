/**
 * Restores a JSON backup made by `npm run db:backup`. REPLACES all current data.
 * Stop the bot first, then run:
 *   npm run db:restore -- backups/satan-<timestamp>.json --yes
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { importAll } from '../database/backup.js';
import type { BackupFile } from '../database/backup.js';
import { disconnectDb } from '../database/client.js';
import { runMigrations } from '../database/migrate.js';
import { connectForScript } from './db-connect.js';

const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!file || !process.argv.includes('--yes')) {
  console.error(
    'Usage: npm run db:restore -- <backup.json> --yes\nThis replaces ALL current data. Stop the bot first.',
  );
  process.exit(1);
}

const backup = JSON.parse(readFileSync(resolve(file), 'utf8')) as BackupFile;
const embedded = await connectForScript();
try {
  await runMigrations(process.env.DATABASE_URL ?? '');
  await importAll(backup);
  console.log(`✓ Restored ${file}`);
} finally {
  await disconnectDb();
  await embedded?.stop();
}
