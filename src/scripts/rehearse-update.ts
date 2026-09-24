/**
 * Update rehearsal: proves an update keeps every row of real data, before it goes live.
 *
 *   npm run rehearse -- backups/<a real backup>.json.gz        (compares with GitHub's main branch)
 *   … --allow-setting=kFactor   when the update deliberately changes that GuildConfig setting
 *
 * 1. A throw-away PostgreSQL gets ONLY the database changes the live bot already has (the migrations
 *    in origin/main), so it looks exactly like the live database today.
 * 2. The backup is loaded into it as-is.
 * 3. The new version's database changes are applied, the same way the bot does on start.
 * 4. Every table is compared before/after (row counts plus ELO/stat totals), and the new code must
 *    be able to read everything back (a full export).
 * Nothing touches your real bot or your PC's own database.
 */
import 'dotenv/config';
import { spawn, execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { describeBackup, exportAll, readBackupFile } from '../database/backup.js';
import { disconnectDb } from '../database/client.js';
import { startEmbeddedDatabase } from '../database/embedded.js';
import { setLogLevel } from '../core/logger.js';

const file = process.argv[2];
const liveRef =
  process.argv.find((a) => a.startsWith('--live-ref='))?.slice('--live-ref='.length) ?? 'origin/main';
/** GuildConfig settings this update is meant to change: reported, but not counted as a failure. */
const allowedSettings = (
  process.argv.find((a) => a.startsWith('--allow-setting='))?.slice('--allow-setting='.length) ?? ''
)
  .split(',')
  .filter(Boolean);
const INTENDED = ' (intended change)';
if (!file) {
  console.error(
    'Usage: npm run rehearse -- backups/<file>.json.gz [--live-ref=origin/main] [--allow-setting=kFactor,…]',
  );
  process.exit(1);
}
setLogLevel('error');

/** Backup key → table name, parents before children. */
const TABLES: [string, string][] = [
  ['guildConfig', 'GuildConfig'],
  ['player', 'Player'],
  ['season', 'Season'],
  ['challenge', 'Challenge'],
  ['match', 'Match'],
  ['matchParticipant', 'MatchParticipant'],
  ['matchResult', 'MatchResult'],
  ['eloHistory', 'EloHistory'],
  ['evidence', 'Evidence'],
  ['matchNote', 'MatchNote'],
  ['cooldown', 'Cooldown'],
  ['auditLog', 'AuditLog'],
  ['modCase', 'ModCase'],
  ['musicPlaylist', 'MusicPlaylist'],
  ['musicSession', 'MusicSession'],
];

function prismaCli(): string {
  const require = createRequire(import.meta.url);
  return join(dirname(require.resolve('prisma/package.json')), 'build', 'index.js');
}

function migrate(url: string, schema: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [prismaCli(), 'migrate', 'deploy', '--schema', schema], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (out += d.toString()));
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`migrate deploy failed:\n${out}`)),
    );
  });
}

type Fingerprint = Record<string, string>;

async function fingerprint(c: PrismaClient, tables: string[]): Promise<Fingerprint> {
  const fp: Fingerprint = {};
  for (const t of tables) {
    const [row] = await c.$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(*) AS n FROM "${t}"`);
    fp[`${t} rows`] = String(row?.n ?? 0);
  }
  const sums = await c.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT SUM(elo) AS elo, SUM(wins) AS wins, SUM(losses) AS losses, SUM("matchesPlayed") AS played,
            SUM("highestWinStreak") AS streaks, COUNT(*) FILTER (WHERE "isBanned") AS banned FROM "Player"`,
  );
  for (const [k, v] of Object.entries(sums[0] ?? {})) fp[`Player ${k}`] = String(v ?? 0);
  const elo = await c.$queryRawUnsafe<{ s: unknown }[]>(`SELECT SUM("eloChange") AS s FROM "EloHistory"`);
  fp['EloHistory total change'] = String(elo[0]?.s ?? 0);
  const statuses = await c.$queryRawUnsafe<{ status: string; n: bigint }[]>(
    `SELECT status::text, COUNT(*) AS n FROM "Match" GROUP BY status ORDER BY status`,
  );
  for (const s of statuses) fp[`Match ${s.status}`] = String(s.n);
  const cfg = await c.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT "guildId", "matchCategoryId", "logChannelId", "refereeRoleIds", "moderatorRoleIds", "adminRoleIds",
            "startingElo", "kFactor", "matchCounter" FROM "GuildConfig" ORDER BY "guildId"`,
  );
  for (const col of allowedSettings) {
    fp[`GuildConfig ${col}${INTENDED}`] = JSON.stringify(cfg.map((r) => r[col]));
    for (const r of cfg) delete r[col];
  }
  fp['GuildConfig settings'] = JSON.stringify(cfg);
  return fp;
}

const backup = readBackupFile(file);
console.log(`Backup: ${file}\n  made ${backup.createdAt} · ${describeBackup(backup)}\n`);

const live = execFileSync('git', ['ls-tree', '--name-only', `${liveRef}:prisma/migrations`], {
  encoding: 'utf8',
})
  .split('\n')
  .filter((n) => /^\d{14}_/.test(n));
console.log(`Live database changes (${liveRef}): ${live.join(', ')}`);

const work = mkdtempSync(join(tmpdir(), 'aj-rehearsal-'));
const oldPrisma = join(work, 'prisma');
mkdirSync(join(oldPrisma, 'migrations'), { recursive: true });
copyFileSync('prisma/schema.prisma', join(oldPrisma, 'schema.prisma'));
copyFileSync('prisma/migrations/migration_lock.toml', join(oldPrisma, 'migrations', 'migration_lock.toml'));
for (const m of live)
  cpSync(join('prisma', 'migrations', m), join(oldPrisma, 'migrations', m), { recursive: true });

const pg = await startEmbeddedDatabase(join(work, 'db'), 54343);
let ok = false;
try {
  await migrate(pg.url, join(oldPrisma, 'schema.prisma'));
  const client = new PrismaClient({ datasources: { db: { url: pg.url } } });
  const existing = new Set(
    (
      await client.$queryRawUnsafe<{ t: string }[]>(
        `SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public'`,
      )
    ).map((r) => r.t),
  );
  const loaded: string[] = [];
  for (const [key, table] of TABLES) {
    const rows = backup.tables[key];
    if (!rows || !existing.has(table)) continue;
    if (rows.length > 0) {
      await client.$executeRawUnsafe(
        `INSERT INTO "${table}" SELECT * FROM json_populate_recordset(NULL::"${table}", $1::json)`,
        JSON.stringify(rows),
      );
    }
    loaded.push(table);
  }
  console.log(`Loaded into a copy of today's live database: ${loaded.join(', ')}\n`);
  const before = await fingerprint(client, loaded);

  console.log('Applying the new version’s database changes…');
  await migrate(pg.url, 'prisma/schema.prisma');
  const after = await fingerprint(client, loaded);

  let same = true;
  for (const [k, v] of Object.entries(before)) {
    const a = after[k];
    const intended = k.endsWith(INTENDED);
    const mark = a === v ? 'same' : intended ? 'wanted' : 'CHANGED';
    if (a !== v && !intended) same = false;
    console.log(
      `  ${mark.padEnd(7)} ${k}: ${v.length > 60 ? `${v.slice(0, 57)}…` : v}${a !== v ? `  →  ${a}` : ''}`,
    );
  }
  const newCols = await client.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT "guildId", "moderationRoleIds", "modDmMembers", "musicVolume", "music247" FROM "GuildConfig"`,
  );
  console.log(`\nNew settings per server: ${JSON.stringify(newCols)}`);
  await client.$disconnect();

  process.env.DATABASE_URL = pg.url;
  const exported = await exportAll();
  console.log(`The new code reads everything back: ${describeBackup(exported)}`);
  await disconnectDb();

  ok = same;
  console.log(
    same
      ? `\nREHEARSAL PASSED: every row and total is identical after the update${
          allowedSettings.length ? ` (apart from the intended ${allowedSettings.join(', ')} change)` : ''
        }.`
      : '\nREHEARSAL FAILED: something changed. Do NOT update; send this output to Claude.',
  );
} finally {
  await pg.stop().catch(() => undefined);
  rmSync(work, { recursive: true, force: true });
}
process.exit(ok ? 0 : 1);
