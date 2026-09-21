import type { GuildConfig, MatchStatus, Player, ResolutionMethod } from '@prisma/client';
import { db } from '../../database/client.js';
import { DomainError, Errors } from '../../core/errors.js';
import { AuditAction, auditInTx, publishAudit } from '../audit/audit.service.js';
import type { AuditEntry } from '../audit/audit.service.js';
import { calculateElo, winRate } from '../elo/elo.js';
import type { EloOutcome } from '../elo/elo.js';
import { lockPlayers, requirePlayer } from '../players/player.service.js';
import { cleanupTime, getMatch } from '../matches/match.service.js';
import type { MatchView } from '../matches/match.types.js';

export interface FinalizeInput {
  matchId: string;
  guildId: string;
  winnerPlayerId: string;
  method: ResolutionMethod;
  actorDiscordId: string;
  reason?: string | null;
  /** Only finalize when the match is currently in one of these statuses. */
  allowed: MatchStatus[];
  config: GuildConfig;
  /** For player confirmations: the reported winner must still be this player inside the transaction. */
  expectedReportedWinnerId?: string;
}

export interface FinalizeOutcome {
  match: MatchView;
  elo: EloOutcome;
  winner: Player;
  loser: Player;
}

/**
 * The one and only way a match result becomes official. Idempotent and atomic:
 * the match flips to COMPLETED through a conditional update (so a second call — a double click,
 * a concurrent referee decision, a retry after restart — finds nothing to update and fails with
 * "already finalized"), and stats, streaks, ELO, ELO history, participant outcomes and the result
 * record are written in the same transaction. If anything fails, everything rolls back.
 */
export async function finalizeMatch(input: FinalizeInput): Promise<FinalizeOutcome> {
  const entries: AuditEntry[] = [];
  const out = await db().$transaction(async (tx) => {
    const match = await tx.match.findUnique({ where: { id: input.matchId } });
    if (!match || match.guildId !== input.guildId) throw Errors.stale();
    if (match.status === 'COMPLETED') {
      throw new DomainError(
        'ALREADY_FINALIZED',
        `The match ${match.matchId} has already been finalized.`,
        'Already finalized',
      );
    }
    if (input.winnerPlayerId !== match.challengerId && input.winnerPlayerId !== match.opponentId) {
      throw new DomainError(
        'INVALID_WINNER',
        'The selected winner is not a player in this match.',
        'Invalid winner',
      );
    }
    const loserPlayerId = input.winnerPlayerId === match.challengerId ? match.opponentId : match.challengerId;
    const staffDecided = input.method !== 'PLAYER_CONFIRMATION';
    const now = new Date();

    const flipped = await tx.match.updateMany({
      where: { id: match.id, status: { in: input.allowed }, completedAt: null },
      data: {
        status: 'COMPLETED',
        resultStatus: staffDecided ? 'STAFF_DECIDED' : 'CONFIRMED',
        resolutionMethod: input.method,
        winnerId: input.winnerPlayerId,
        loserId: loserPlayerId,
        completedAt: now,
        cancelRequestedById: null,
        decisionReason: input.reason ?? null,
        ...(staffDecided
          ? { refereeDiscordId: input.actorDiscordId, reviewedAt: match.reviewedAt ?? now }
          : {}),
        cleanupAt: match.channelId ? cleanupTime(input.config, now) : null,
      },
    });
    if (flipped.count !== 1) throw Errors.stale();

    if (input.expectedReportedWinnerId !== undefined) {
      const result = await tx.matchResult.findUnique({ where: { matchId: match.id } });
      if (result?.reportedWinnerId !== input.expectedReportedWinnerId) throw Errors.stale();
    }

    const locked = await lockPlayers(tx, [input.winnerPlayerId, loserPlayerId]);
    const winner = requirePlayer(locked, input.winnerPlayerId);
    const loser = requirePlayer(locked, loserPlayerId);
    const elo = calculateElo(winner.elo, loser.elo, {
      kFactor: input.config.kFactor,
      minElo: input.config.minElo,
      maxElo: input.config.maxElo,
    });

    const winnerWins = winner.wins + 1;
    const winnerPlayed = winner.matchesPlayed + 1;
    const winnerStreak = winner.currentWinStreak + 1;
    const updatedWinner = await tx.player.update({
      where: { id: winner.id },
      data: {
        elo: elo.winnerNew,
        highestElo: Math.max(winner.highestElo, elo.winnerNew),
        wins: winnerWins,
        matchesPlayed: winnerPlayed,
        winRate: winRate(winnerWins, winnerPlayed),
        currentWinStreak: winnerStreak,
        highestWinStreak: Math.max(winner.highestWinStreak, winnerStreak),
        currentMatchId: winner.currentMatchId === match.id ? null : winner.currentMatchId,
      },
    });
    const loserPlayed = loser.matchesPlayed + 1;
    const updatedLoser = await tx.player.update({
      where: { id: loser.id },
      data: {
        elo: elo.loserNew,
        losses: loser.losses + 1,
        matchesPlayed: loserPlayed,
        winRate: winRate(loser.wins, loserPlayed),
        currentWinStreak: 0,
        currentMatchId: loser.currentMatchId === match.id ? null : loser.currentMatchId,
      },
    });

    await tx.eloHistory.createMany({
      data: [
        {
          guildId: match.guildId,
          playerId: winner.id,
          matchId: match.id,
          seasonId: match.seasonId,
          reason: 'MATCH',
          oldElo: elo.winnerOld,
          newElo: elo.winnerNew,
          eloChange: elo.winnerChange,
          opponentElo: elo.loserOld,
        },
        {
          guildId: match.guildId,
          playerId: loser.id,
          matchId: match.id,
          seasonId: match.seasonId,
          reason: 'MATCH',
          oldElo: elo.loserOld,
          newElo: elo.loserNew,
          eloChange: elo.loserChange,
          opponentElo: elo.winnerOld,
        },
      ],
    });

    await tx.matchParticipant.updateMany({
      where: { matchId: match.id, playerId: winner.id },
      data: { outcome: 'WIN' },
    });
    await tx.matchParticipant.updateMany({
      where: { matchId: match.id, playerId: loser.id },
      data: { outcome: 'LOSS' },
    });

    await tx.matchResult.upsert({
      where: { matchId: match.id },
      update: {
        confirmedWinnerId: winner.id,
        confirmedByDiscordId: input.actorDiscordId,
        status: staffDecided ? 'STAFF_DECIDED' : 'CONFIRMED',
        confirmedAt: now,
        finalizedAt: now,
      },
      create: {
        matchId: match.id,
        confirmedWinnerId: winner.id,
        confirmedByDiscordId: input.actorDiscordId,
        status: staffDecided ? 'STAFF_DECIDED' : 'CONFIRMED',
        confirmedAt: now,
        finalizedAt: now,
      },
    });

    const decisionAction =
      input.method === 'PLAYER_CONFIRMATION'
        ? AuditAction.RESULT_CONFIRMED
        : input.method === 'FORCE_COMPLETE'
          ? AuditAction.MATCH_FORCE_COMPLETED
          : AuditAction.MATCH_DECISION;
    entries.push(
      ...(await auditInTx(tx, [
        {
          guildId: match.guildId,
          actorId: input.actorDiscordId,
          action: decisionAction,
          matchId: match.matchId,
          targetId: winner.discordId,
          metadata: { winner: winner.discordId, loser: loser.discordId, reason: input.reason ?? null },
        },
        {
          guildId: match.guildId,
          actorId: input.actorDiscordId,
          action: AuditAction.MATCH_COMPLETED,
          matchId: match.matchId,
          metadata: { winner: winner.discordId, loser: loser.discordId, method: input.method },
        },
        {
          guildId: match.guildId,
          actorId: input.actorDiscordId,
          action: AuditAction.ELO_CHANGE,
          matchId: match.matchId,
          metadata: {
            winner: winner.discordId,
            winnerElo: `${elo.winnerOld}->${elo.winnerNew}`,
            loser: loser.discordId,
            loserElo: `${elo.loserOld}->${elo.loserNew}`,
            eloChange: elo.winnerChange,
          },
        },
      ])),
    );

    return { elo, winner: updatedWinner, loser: updatedLoser };
  });
  publishAudit(entries);
  const match = await getMatch(input.matchId);
  if (!match) throw Errors.stale();
  return { ...out, match };
}
