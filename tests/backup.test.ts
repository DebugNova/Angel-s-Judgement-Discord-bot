import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';
import { pruneLogs } from '../src/core/logger.js';
import {
  exportAll,
  importAll,
  pruneBackups,
  readBackupFile,
  writeBackupFile,
} from '../src/database/backup.js';
import { db } from '../src/database/client.js';
import { confirmResult, reportResult } from '../src/modules/results/result.service.js';
import { A, B, GUILD, config, player, resetDb, startMatch } from './helpers.js';

beforeEach(resetDb);

describe('backup & restore', () => {
  it('round-trips every table through JSON', async () => {
    const id = await startMatch(A, B);
    const a = await player(A);
    await reportResult({ matchId: id, guildId: GUILD, actorDiscordId: A.discordId, winnerPlayerId: a.id });
    await confirmResult({ matchId: id, guildId: GUILD, actorDiscordId: B.discordId, config: await config() });

    const snapshot = JSON.parse(JSON.stringify(await exportAll())) as Awaited<ReturnType<typeof exportAll>>;
    await resetDb();
    expect(await db().match.count()).toBe(0);

    await importAll(snapshot);
    const match = await db().match.findUniqueOrThrow({
      where: { id },
      include: { result: true, eloHistory: true },
    });
    expect(match.status).toBe('COMPLETED');
    expect(match.completedAt).toBeInstanceOf(Date);
    expect(match.eloHistory).toHaveLength(2);
    expect((await player(A)).elo).toBe(1024);
    expect(await db().auditLog.count()).toBe(snapshot.tables.auditLog!.length);
    expect((await db().guildConfig.findUniqueOrThrow({ where: { guildId: GUILD } })).matchCounter).toBe(1);
  });
});

describe('backup files', () => {
  it('writes gzipped backups, reads gzipped and plain ones, and prunes the oldest', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'satan-backups-'));
    try {
      await startMatch(A, B);
      const data = await exportAll();
      const gz = writeBackupFile(dir, data);
      expect(gz.endsWith('.json.gz')).toBe(true);
      expect(readBackupFile(gz)).toEqual(JSON.parse(JSON.stringify(data)));

      const plain = join(dir, 'satan-0000-plain.json');
      writeFileSync(plain, JSON.stringify(data));
      expect(readBackupFile(plain).tables.match).toHaveLength(1);

      for (const stamp of ['2026-01-01', '2026-01-02', '2026-01-03']) {
        writeBackupFile(dir, { ...data, createdAt: `${stamp}T00:00:00.000Z` });
      }
      writeFileSync(join(dir, 'notes.txt'), 'not a backup');
      expect(pruneBackups(dir, 2)).toBe(3);
      const left = readdirSync(dir).sort();
      expect(left).toContain('notes.txt');
      expect(left).toContain(basename(gz));
      expect(left.filter((n) => n.startsWith('satan-'))).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects files that are not backups', () => {
    const dir = mkdtempSync(join(tmpdir(), 'satan-backups-'));
    try {
      const f = join(dir, 'x.json');
      writeFileSync(f, 'null');
      expect(() => readBackupFile(f)).toThrow(/not a backup/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('backup settings', () => {
  const base = {
    DISCORD_TOKEN: `${Buffer.from('100000000000000001').toString('base64')}.${'x'.repeat(60)}`,
    EMBEDDED_DB: 'true',
  };

  it('uses defaults when the backup settings are blank or missing', () => {
    const env = loadEnv({ ...base, BACKUP_INTERVAL_MINUTES: '', BACKUP_KEEP: ' ', BACKUP_CHANNEL_ID: '' });
    expect(env.BACKUP_INTERVAL_MINUTES).toBe(60);
    expect(env.BACKUP_KEEP).toBe(48);
    expect(env.BACKUP_CHANNEL_ID).toBeUndefined();
    expect(loadEnv(base).EMBEDDED_DB_PORT).toBe(54321);
  });

  it('accepts real values and rejects bad channel IDs', () => {
    const env = loadEnv({ ...base, BACKUP_INTERVAL_MINUTES: '0', BACKUP_CHANNEL_ID: '100000000000000099' });
    expect(env.BACKUP_INTERVAL_MINUTES).toBe(0);
    expect(env.BACKUP_CHANNEL_ID).toBe('100000000000000099');
    expect(() => loadEnv({ ...base, BACKUP_CHANNEL_ID: '#backups' })).toThrow(/BACKUP_CHANNEL_ID/);
  });
});

describe('log files', () => {
  it('deletes daily logs older than the retention window and nothing else', () => {
    const dir = mkdtempSync(join(tmpdir(), 'satan-logs-'));
    try {
      for (const n of ['bot-2026-01-01.log', 'bot-2026-01-30.log', 'bot-2026-01-31.log', 'keep.txt']) {
        writeFileSync(join(dir, n), 'x');
      }
      pruneLogs(dir, 30, new Date('2026-03-01T12:00:00Z'));
      expect(readdirSync(dir).sort()).toEqual(['bot-2026-01-30.log', 'bot-2026-01-31.log', 'keep.txt']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
