// Starts the embedded PostgreSQL in the foreground (for `prisma migrate dev` / `prisma studio`).
// Usage: node scripts/dev-db.mjs   → prints DATABASE_URL, Ctrl+C to stop.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import EmbeddedPostgres from 'embedded-postgres';

const dir =
  process.env.EMBEDDED_DB_DIR ||
  join(process.env.LOCALAPPDATA ?? join(homedir(), '.local', 'share'), 'SatanBot', 'postgres');
const port = Number(process.env.EMBEDDED_DB_PORT || 54321);
mkdirSync(dir, { recursive: true });
const pg = new EmbeddedPostgres({
  databaseDir: dir,
  port,
  user: 'satan',
  password: 'satan-local',
  persistent: true,
  onLog: () => {},
});
if (!existsSync(join(dir, 'PG_VERSION'))) await pg.initialise();
await pg.start();
const c = pg.getPgClient('postgres', '127.0.0.1');
await c.connect();
const r = await c.query("SELECT 1 FROM pg_database WHERE datname = 'satan'");
if (r.rowCount === 0) await c.query('CREATE DATABASE "satan"');
await c.end();
console.log(`DATABASE_URL=postgresql://satan:satan-local@127.0.0.1:${port}/satan`);
console.log('Embedded PostgreSQL running. Press Ctrl+C to stop.');
process.on('SIGINT', async () => {
  await pg.stop();
  process.exit(0);
});
setInterval(() => {}, 1 << 30);
