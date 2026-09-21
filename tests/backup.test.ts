import { beforeEach, describe, expect, it } from 'vitest';
import { exportAll, importAll } from '../src/database/backup.js';
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
