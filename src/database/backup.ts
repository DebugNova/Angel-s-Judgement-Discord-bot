import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { db } from './client.js';

export const BACKUP_VERSION = 1;

type Rows = Record<string, unknown>[];
export interface BackupFile {
  version: number;
  createdAt: string;
  tables: Record<string, Rows>;
}

const ALL_TABLES =
  '"AuditLog","Cooldown","MatchNote","Evidence","EloHistory","MatchResult","MatchParticipant","Match","Challenge","Season","Player","GuildConfig"';

/** Logical export of every table (portable JSON; no pg_dump needed). */
export async function exportAll(): Promise<BackupFile> {
  const c = db();
  return {
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    tables: {
      guildConfig: await c.guildConfig.findMany(),
      player: await c.player.findMany(),
      season: await c.season.findMany(),
      challenge: await c.challenge.findMany(),
      match: await c.match.findMany(),
      matchParticipant: await c.matchParticipant.findMany(),
      matchResult: await c.matchResult.findMany(),
      eloHistory: await c.eloHistory.findMany(),
      evidence: await c.evidence.findMany(),
      matchNote: await c.matchNote.findMany(),
      cooldown: await c.cooldown.findMany(),
      auditLog: await c.auditLog.findMany(),
    },
  };
}

/** Replaces ALL data with the backup, atomically (parents inserted before children). */
export async function importAll(backup: BackupFile): Promise<void> {
  if (backup.version !== BACKUP_VERSION) throw new Error(`Unsupported backup version ${backup.version}`);
  const rows = (name: string): Rows => backup.tables[name] ?? [];
  await db().$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`TRUNCATE ${ALL_TABLES} CASCADE`);
      await tx.guildConfig.createMany({ data: rows('guildConfig') as never });
      await tx.player.createMany({ data: rows('player') as never });
      await tx.season.createMany({ data: rows('season') as never });
      await tx.challenge.createMany({ data: rows('challenge') as never });
      await tx.match.createMany({ data: rows('match') as never });
      await tx.matchParticipant.createMany({ data: rows('matchParticipant') as never });
      await tx.matchResult.createMany({ data: rows('matchResult') as never });
      await tx.eloHistory.createMany({ data: rows('eloHistory') as never });
      await tx.evidence.createMany({ data: rows('evidence') as never });
      await tx.matchNote.createMany({ data: rows('matchNote') as never });
      await tx.cooldown.createMany({ data: rows('cooldown') as never });
      await tx.auditLog.createMany({
        data: rows('auditLog').map((r) => ({ ...r, metadata: r.metadata ?? undefined })) as never,
      });
    },
    { timeout: 300_000 },
  );
}

/** "player=12 match=40 …" — row counts, to compare a backup with a restore at a glance. */
export function describeBackup(backup: BackupFile): string {
  return Object.entries(backup.tables)
    .map(([k, v]) => `${k}=${v.length}`)
    .join(' ');
}

export function serializeBackup(backup: BackupFile): Buffer {
  return gzipSync(JSON.stringify(backup));
}

/** Writes `<dir>/satan-<timestamp>.json.gz` and returns its full path. */
export function writeBackupFile(dir: string, backup: BackupFile): string {
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, `satan-${backup.createdAt.replace(/[:.]/g, '-')}.json.gz`);
  writeFileSync(file, serializeBackup(backup));
  return file;
}

/** Reads a backup made by any version of the tools: plain `.json` or gzipped `.json.gz`. */
export function readBackupFile(file: string): BackupFile {
  const raw = readFileSync(resolve(file));
  const text = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw).toString('utf8') : raw.toString('utf8');
  const backup = JSON.parse(text) as BackupFile;
  if (typeof backup !== 'object' || backup === null || typeof backup.tables !== 'object') {
    throw new Error(`${file} is not a backup file`);
  }
  return backup;
}

/** Deletes the oldest `satan-*` backups in `dir`, keeping the newest `keep`. Returns how many were removed. */
export function pruneBackups(dir: string, keep: number): number {
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.startsWith('satan-') && /\.json(\.gz)?$/.test(n));
  } catch {
    return 0;
  }
  const old = names.sort().reverse().slice(Math.max(keep, 1));
  for (const n of old) rmSync(join(dir, n), { force: true });
  return old.length;
}
