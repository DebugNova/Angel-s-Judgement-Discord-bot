import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/database/client.js';
import {
  acceptChallenge,
  cancelChallenge,
  createChallenge,
  declineChallenge,
  expireChallenge,
} from '../src/modules/challenges/challenge.service.js';
import { setBanned } from '../src/modules/players/player.service.js';
import { updateConfig } from '../src/modules/configuration/config.service.js';
import { A, B, C, GUILD, config, player, resetDb, startMatch } from './helpers.js';

beforeEach(resetDb);

async function challenge(from = A, to = B) {
  return createChallenge({ guildId: GUILD, config: await config(), challenger: from, target: to });
}

describe('challenges', () => {
  it('creates a pending challenge for a valid user', async () => {
    const ch = await challenge();
    expect(ch.status).toBe('PENDING');
    expect(ch.expiresAt.getTime()).toBeGreaterThan(Date.now() + 50_000);
    expect(ch.challenger.elo).toBe(1000);
  });

  it('rejects self-challenges', async () => {
    await expect(challenge(A, A)).rejects.toMatchObject({ code: 'SELF_CHALLENGE' });
  });

  it('rejects challenging a banned user', async () => {
    await setBanned(GUILD, B, true, A.discordId, 'test', 1000);
    await expect(challenge()).rejects.toMatchObject({ code: 'BANNED' });
  });

  it('rejects a banned challenger', async () => {
    await setBanned(GUILD, A, true, B.discordId, null, 1000);
    await expect(challenge()).rejects.toMatchObject({ code: 'BANNED' });
  });

  it('rejects challenging a user already in a match', async () => {
    await startMatch(B, C);
    await expect(challenge(A, B)).rejects.toMatchObject({ code: 'IN_MATCH' });
  });

  it('rejects duplicate challenges in either direction', async () => {
    await challenge(A, B);
    await expect(challenge(A, B)).rejects.toMatchObject({ code: 'DUPLICATE_CHALLENGE' });
    await expect(challenge(B, A)).rejects.toMatchObject({ code: 'DUPLICATE_CHALLENGE' });
  });

  it('allows only one outgoing pending challenge', async () => {
    await challenge(A, B);
    await expect(challenge(A, C)).rejects.toMatchObject({ code: 'OUTGOING_PENDING' });
  });

  it('expires unanswered challenges exactly once', async () => {
    const ch = await challenge();
    await db().challenge.update({ where: { id: ch.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const first = await expireChallenge(ch.id);
    const second = await expireChallenge(ch.id);
    expect(first?.status).toBe('EXPIRED');
    expect(second).toBeNull();
    const cfg = await config();
    await expect(
      acceptChallenge({ challengeId: ch.id, actorDiscordId: B.discordId, guildId: GUILD, config: cfg }),
    ).rejects.toMatchObject({ code: 'STALE' });
  });

  it('lets only the challenger cancel', async () => {
    const ch = await challenge();
    await expect(
      cancelChallenge({ challengeId: ch.id, actorDiscordId: B.discordId, guildId: GUILD }),
    ).rejects.toMatchObject({
      code: 'NOT_YOURS',
    });
    const cancelled = await cancelChallenge({
      challengeId: ch.id,
      actorDiscordId: A.discordId,
      guildId: GUILD,
    });
    expect(cancelled.status).toBe('CANCELLED');
  });

  it('only the challenged player can accept', async () => {
    const ch = await challenge();
    const cfg = await config();
    await expect(
      acceptChallenge({ challengeId: ch.id, actorDiscordId: A.discordId, guildId: GUILD, config: cfg }),
    ).rejects.toMatchObject({ code: 'NOT_YOURS' });
    await expect(
      acceptChallenge({ challengeId: ch.id, actorDiscordId: C.discordId, guildId: GUILD, config: cfg }),
    ).rejects.toMatchObject({ code: 'NOT_YOURS' });
  });

  it('applies the pair cooldown after a decline, but not to unrelated players', async () => {
    const ch = await challenge();
    await declineChallenge({
      challengeId: ch.id,
      actorDiscordId: B.discordId,
      guildId: GUILD,
      config: await config(),
    });
    await expect(challenge(A, B)).rejects.toMatchObject({ code: 'PAIR_COOLDOWN' });
    await expect(challenge(B, A)).rejects.toMatchObject({ code: 'PAIR_COOLDOWN' });
    await expect(challenge(A, C)).resolves.toBeTruthy();
  });

  it('applies the optional global cooldown when enabled', async () => {
    await config();
    await updateConfig(GUILD, { globalCooldownSec: 120 });
    const ch = await challenge();
    await declineChallenge({
      challengeId: ch.id,
      actorDiscordId: B.discordId,
      guildId: GUILD,
      config: await config(),
    });
    await expect(challenge(A, C)).rejects.toMatchObject({ code: 'USER_COOLDOWN' });
  });

  it('blocks challenges during maintenance', async () => {
    await config();
    await updateConfig(GUILD, { maintenanceMode: true });
    await expect(challenge()).rejects.toMatchObject({ code: 'MAINTENANCE' });
  });
});

describe('accepting', () => {
  it('creates a match with a readable ID and locks both players', async () => {
    const ch = await challenge();
    const acc = await acceptChallenge({
      challengeId: ch.id,
      actorDiscordId: B.discordId,
      guildId: GUILD,
      config: await config(),
    });
    expect(acc.displayId).toBe('SA-000001');
    const [a, b] = [await player(A), await player(B)];
    expect(a.currentMatchId).toBe(acc.matchId);
    expect(b.currentMatchId).toBe(acc.matchId);
    const match = await db().match.findUniqueOrThrow({
      where: { id: acc.matchId },
      include: { participants: true },
    });
    expect(match.status).toBe('ACCEPTED');
    expect(match.participants.map((p) => p.team).sort()).toEqual([0, 1]);
  });

  it('double-click / simultaneous accept creates exactly one match', async () => {
    const ch = await challenge();
    const cfg = await config();
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        acceptChallenge({ challengeId: ch.id, actorDiscordId: B.discordId, guildId: GUILD, config: cfg }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db().match.count()).toBe(1);
  });

  it('A→B and C→B: only one can become a match; the other is closed', async () => {
    const ab = await challenge(A, B);
    const cb = await challenge(C, B);
    const cfg = await config();
    const results = await Promise.allSettled([
      acceptChallenge({ challengeId: ab.id, actorDiscordId: B.discordId, guildId: GUILD, config: cfg }),
      acceptChallenge({ challengeId: cb.id, actorDiscordId: B.discordId, guildId: GUILD, config: cfg }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db().match.count()).toBe(1);
    const statuses = (await db().challenge.findMany()).map((c) => c.status).sort();
    expect(statuses).toEqual(['ACCEPTED', 'CANCELLED']);
  });

  it('match numbers increase per guild', async () => {
    await startMatch(A, B);
    const ch = await challenge(C, { discordId: '200000000000000055', username: 'x', displayName: 'X' });
    const acc = await acceptChallenge({
      challengeId: ch.id,
      actorDiscordId: '200000000000000055',
      guildId: GUILD,
      config: await config(),
    });
    expect(acc.displayId).toBe('SA-000002');
  });
});
