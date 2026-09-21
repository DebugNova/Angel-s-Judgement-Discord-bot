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
