/**
 * Restores a JSON backup made by `npm run db:backup`. REPLACES all current data.
 * Stop the bot first, then run:
 *   npm run db:restore -- backups/satan-<timestamp>.json.gz --yes   (plain .json works too)
 */
import { describeBackup, exportAll, importAll, readBackupFile, writeBackupFile } from '../database/backup.js';
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

const backup = readBackupFile(file);
const embedded = await connectForScript();
try {
  await runMigrations(process.env.DATABASE_URL ?? '');
  // Safety net: whatever is in the database right now is saved before it gets replaced.
  const current = await exportAll();
  const saved = writeBackupFile('backups/before-restore', current);
  console.log(`• Current data saved first to ${saved}`);
  await importAll(backup);
  console.log(`✓ Restored ${file}\n  ${describeBackup(backup)}`);
} finally {
  await disconnectDb();
  await embedded?.stop();
}
