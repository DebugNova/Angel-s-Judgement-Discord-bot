import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/database/client.js';
import { confirmResult, disputeResult, reportResult } from '../src/modules/results/result.service.js';
import { decideMatch, openReview } from '../src/modules/referee/referee.service.js';
import { reopenMatch, requestCancel, staffCancel } from '../src/modules/matches/match.service.js';
import { resetStats } from '../src/modules/reset/reset.service.js';
import { getLeaderboardPage } from '../src/modules/leaderboard/leaderboard.service.js';
import { getRank } from '../src/modules/players/player.service.js';
import { A, B, C, GUILD, REF, config, player, resetDb, startMatch } from './helpers.js';

beforeEach(resetDb);

async function report(matchId: string, by = A, winner = A) {
  const w = await player(winner);
  return reportResult({ matchId, guildId: GUILD, actorDiscordId: by.discordId, winnerPlayerId: w.id });
}

describe('result confirmation', () => {
  it('report → confirm finalizes once with correct ELO, stats and history', async () => {
    const id = await startMatch(A, B);
    const reported = await report(id);
    expect(reported.status).toBe('RESULT_PENDING');
    // Reporting alone must never award anything.
    expect((await player(A)).elo).toBe(1000);

    const out = await confirmResult({
      matchId: id,
      guildId: GUILD,
      actorDiscordId: B.discordId,
      config: await config(),
    });
    expect(out.elo).toMatchObject({ winnerOld: 1000, winnerNew: 1024, loserOld: 1000, loserNew: 976 });

    const [a, b] = [await player(A), await player(B)];
    expect(a).toMatchObject({
      elo: 1024,
      wins: 1,
      losses: 0,
      matchesPlayed: 1,
      currentWinStreak: 1,
      highestWinStreak: 1,
      highestElo: 1024,
      winRate: 100,
      currentMatchId: null,
    });
    expect(b).toMatchObject({
      elo: 976,
      wins: 0,
      losses: 1,
      matchesPlayed: 1,
      currentWinStreak: 0,
      winRate: 0,
      currentMatchId: null,
    });

    const match = await db().match.findUniqueOrThrow({ where: { id }, include: { result: true } });
    expect(match).toMatchObject({
      status: 'COMPLETED',
      resultStatus: 'CONFIRMED',
      resolutionMethod: 'PLAYER_CONFIRMATION',
      winnerId: a.id,
      loserId: b.id,
    });
    expect(match.result?.finalizedAt).toBeTruthy();
    expect(await db().eloHistory.count({ where: { matchId: id } })).toBe(2);
  });

  it('the reporter cannot confirm their own report and outsiders cannot either', async () => {
    const id = await startMatch(A, B);
    await report(id);
    const cfg = await config();
    await expect(
      confirmResult({ matchId: id, guildId: GUILD, actorDiscordId: A.discordId, config: cfg }),
    ).rejects.toMatchObject({ code: 'OWN_REPORT' });
    await expect(
      confirmResult({ matchId: id, guildId: GUILD, actorDiscordId: C.discordId, config: cfg }),
    ).rejects.toMatchObject({ code: 'NOT_OPPONENT' });
  });

  it('simultaneous reports: only one is accepted', async () => {
    const id = await startMatch(A, B);
    const results = await Promise.allSettled([report(id, A, A), report(id, B, B)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('simultaneous confirmations never award ELO twice', async () => {
    const id = await startMatch(A, B);
    await report(id);
    const cfg = await config();
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        confirmResult({ matchId: id, guildId: GUILD, actorDiscordId: B.discordId, config: cfg }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await player(A)).elo).toBe(1024);
    expect((await player(A)).wins).toBe(1);
    expect(await db().eloHistory.count({ where: { matchId: id } })).toBe(2);
  });

  it('winner streaks accumulate and reset on a loss', async () => {
    for (let n = 0; n < 3; n++) {
      const id = await startMatch(A, B);
      await report(id);
      await confirmResult({
        matchId: id,
        guildId: GUILD,
        actorDiscordId: B.discordId,
        config: await config(),
      });
    }
    expect((await player(A)).currentWinStreak).toBe(3);
    const id = await startMatch(A, B);
    await report(id, B, B);
    await confirmResult({ matchId: id, guildId: GUILD, actorDiscordId: A.discordId, config: await config() });
    const a = await player(A);
    expect(a.currentWinStreak).toBe(0);
    expect(a.highestWinStreak).toBe(3);
    expect(a.winRate).toBe(75);
  });
});

describe('disputes & referees', () => {
  it('dispute → review → referee decision → stats applied exactly once', async () => {
    const id = await startMatch(A, B);
    await report(id);
    const disputed = await disputeResult({ matchId: id, guildId: GUILD, actorDiscordId: B.discordId });
    expect(disputed.status).toBe('DISPUTED');

    const reviewed = await openReview({ matchId: id, guildId: GUILD, staffDiscordId: REF.discordId });
    expect(reviewed.status).toBe('UNDER_REVIEW');
    expect(reviewed.refereeDiscordId).toBe(REF.discordId);

    const cfg = await config();
    const a = await player(A);
    const decide = () =>
      decideMatch({
        matchId: id,
        guildId: GUILD,
        staffDiscordId: REF.discordId,
        winnerPlayerId: a.id,
        reason: 'Evidence reviewed',
        mode: 'decide',
        config: cfg,
      });
    const results = await Promise.allSettled([decide(), decide(), decide()]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    await expect(decide()).rejects.toMatchObject({ code: 'ALREADY_FINALIZED' });

    const match = await db().match.findUniqueOrThrow({ where: { id } });
    expect(match).toMatchObject({
      status: 'COMPLETED',
      resultStatus: 'STAFF_DECIDED',
      resolutionMethod: 'REFEREE_DECISION',
      decisionReason: 'Evidence reviewed',
    });
    expect((await player(A)).elo).toBe(1024);
    const audit = await db().auditLog.findFirst({ where: { action: 'MATCH_DECISION' } });
    expect(audit?.actorId).toBe(REF.discordId);
  });

  it('staff cannot rule on their own match', async () => {
    const id = await startMatch(A, B);
    await report(id);
    await disputeResult({ matchId: id, guildId: GUILD, actorDiscordId: B.discordId });
    await expect(
      openReview({ matchId: id, guildId: GUILD, staffDiscordId: A.discordId }),
    ).rejects.toMatchObject({ code: 'CONFLICT_OF_INTEREST' });
  });

  it('decide requires a reported/disputed result; forcecomplete works on active matches', async () => {
    const id = await startMatch(A, B);
    const cfg = await config();
    const b = await player(B);
    await expect(
      decideMatch({
        matchId: id,
        guildId: GUILD,
        staffDiscordId: REF.discordId,
        winnerPlayerId: b.id,
        reason: null,
        mode: 'decide',
        config: cfg,
      }),
    ).rejects.toMatchObject({ code: 'NOT_DECIDABLE' });
    const out = await decideMatch({
      matchId: id,
      guildId: GUILD,
      staffDiscordId: REF.discordId,
      winnerPlayerId: b.id,
      reason: null,
      mode: 'force',
      config: cfg,
    });
    expect(out.match.resolutionMethod).toBe('FORCE_COMPLETE');
  });

  it('completed matches cannot be cancelled or reopened', async () => {
    const id = await startMatch(A, B);
    await report(id);
    await confirmResult({ matchId: id, guildId: GUILD, actorDiscordId: B.discordId, config: await config() });
    await expect(
      staffCancel({
        matchId: id,
        guildId: GUILD,
        staffDiscordId: REF.discordId,
        reason: null,
        config: await config(),
      }),
    ).rejects.toMatchObject({ code: 'COMPLETED' });
    await expect(
      reopenMatch({ matchId: id, guildId: GUILD, staffDiscordId: REF.discordId }),
    ).rejects.toMatchObject({ code: 'COMPLETED' });
  });
});

describe('cancellation & reopen', () => {
  it('needs both players to cancel; players are freed and no stats change', async () => {
    const id = await startMatch(A, B);
    const cfg = await config();
    const first = await requestCancel({
      matchId: id,
      guildId: GUILD,
      actorDiscordId: A.discordId,
      config: cfg,
    });
    expect(first.outcome).toBe('REQUESTED');
    await expect(
      requestCancel({ matchId: id, guildId: GUILD, actorDiscordId: A.discordId, config: cfg }),
    ).rejects.toMatchObject({ code: 'ALREADY_REQUESTED' });
    const second = await requestCancel({
      matchId: id,
      guildId: GUILD,
      actorDiscordId: B.discordId,
      config: cfg,
    });
    expect(second.outcome).toBe('CANCELLED');
    expect((await player(A)).currentMatchId).toBeNull();
    expect((await player(A)).matchesPlayed).toBe(0);
  });

  it('players cannot cancel a disputed match', async () => {
    const id = await startMatch(A, B);
    await report(id);
    await disputeResult({ matchId: id, guildId: GUILD, actorDiscordId: B.discordId });
    await expect(
      requestCancel({ matchId: id, guildId: GUILD, actorDiscordId: A.discordId, config: await config() }),
    ).rejects.toMatchObject({ code: 'DISPUTE_LOCKED' });
  });

  it('reopen puts a disputed match back to active and a cancelled match back in play', async () => {
    const id = await startMatch(A, B);
    await report(id);
    await disputeResult({ matchId: id, guildId: GUILD, actorDiscordId: B.discordId });
    const { match } = await reopenMatch({ matchId: id, guildId: GUILD, staffDiscordId: REF.discordId });
    expect(match.status).toBe('ACTIVE');
    expect(match.result?.reportedWinnerId).toBeNull();

    await staffCancel({
      matchId: id,
      guildId: GUILD,
      staffDiscordId: REF.discordId,
      reason: 'test',
      config: await config(),
    });
    expect((await player(A)).currentMatchId).toBeNull();
    const again = await reopenMatch({ matchId: id, guildId: GUILD, staffDiscordId: REF.discordId });
    expect(again.match.status).toBe('ACTIVE');
    expect((await player(A)).currentMatchId).toBe(id);
  });
});

describe('leaderboard, rank & reset', () => {
  it('only players with enough matches are ranked', async () => {
    const id = await startMatch(A, B);
    await report(id);
    await confirmResult({ matchId: id, guildId: GUILD, actorDiscordId: B.discordId, config: await config() });
    const empty = await getLeaderboardPage(GUILD, 'elo', 10, 0, 5);
    expect(empty.total).toBe(0);
    const lb = await getLeaderboardPage(GUILD, 'elo', 10, 0, 1);
    expect(lb.entries.map((e) => e.player.discordId)).toEqual([A.discordId, B.discordId]);
    expect(await getRank(await player(B), 1)).toBe(2);
    expect(await getRank(await player(B), 5)).toBeNull();
  });

  it('soft reset keeps history and records ELO history entries', async () => {
    const id = await startMatch(A, B);
    await report(id);
    await confirmResult({ matchId: id, guildId: GUILD, actorDiscordId: B.discordId, config: await config() });
    const res = await resetStats({
      guildId: GUILD,
      scope: 'all',
      actorDiscordId: REF.discordId,
      startingElo: 1000,
    });
    expect(res.playersAffected).toBe(2);
    expect(await player(A)).toMatchObject({ elo: 1000, wins: 0, matchesPlayed: 0, highestElo: 1000 });
    expect(await db().match.count({ where: { status: 'COMPLETED' } })).toBe(1);
    expect(await db().eloHistory.count({ where: { reason: 'RESET' } })).toBe(2);
  });
});
