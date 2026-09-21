/**
 * Full logical backup of every table to one gzipped JSON file (works with the embedded database and
 * any PostgreSQL — no pg_dump required).
 *   npm run db:backup                → backups/satan-<timestamp>.json.gz
 *   npm run db:backup -- some/folder → some/folder/satan-<timestamp>.json.gz
 */
import { describeBackup, exportAll, writeBackupFile } from '../database/backup.js';
import { disconnectDb } from '../database/client.js';
import { connectForScript } from './db-connect.js';

const embedded = await connectForScript();
try {
  const data = await exportAll();
  const file = writeBackupFile(process.argv[2] ?? 'backups', data);
  console.log(`✓ Backup written to ${file}\n  ${describeBackup(data)}`);
} finally {
  await disconnectDb();
  await embedded?.stop();
}
