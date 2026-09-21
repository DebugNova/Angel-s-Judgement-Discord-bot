import type { GuildConfig } from '@prisma/client';
import { db } from '../../database/client.js';
import { DomainError, Errors } from '../../core/errors.js';
import { AuditAction, auditInTx, publishAudit } from '../audit/audit.service.js';
import type { AuditEntry } from '../audit/audit.service.js';
import { getMatch, requireMatch } from '../matches/match.service.js';
import { isParticipant } from '../matches/match.types.js';
import type { MatchView } from '../matches/match.types.js';
import { finalizeMatch } from './finalize.js';
import type { FinalizeOutcome } from './finalize.js';

function statusGuard(match: MatchView): void {
  if (match.status === 'RESULT_PENDING') {
    throw new DomainError(
      'ALREADY_REPORTED',
      'A result has already been reported and is awaiting confirmation.',
      'Result pending',
    );
  }
  if (match.status === 'DISPUTED' || match.status === 'UNDER_REVIEW') {
    throw new DomainError(
      'UNDER_DISPUTE',
      'This match is disputed and awaiting a referee decision.',
      'Under review',
    );
  }
  if (match.status !== 'ACTIVE') throw Errors.stale();
}

/**
 * A player reports the winner. Nothing is awarded yet — the opponent must confirm (Rule 4),
 * otherwise the match escalates to staff.
 */
export async function reportResult(input: {
  matchId: string;
  guildId: string;
  actorDiscordId: string;
  winnerPlayerId: string;
}): Promise<MatchView> {
  const match = await requireMatch(input.matchId, input.guildId);
  if (!isParticipant(match, input.actorDiscordId)) {
    throw new DomainError(
      'NOT_PARTICIPANT',
      'Only the players in this match can report the result.',
      'Not your match',
    );
  }
  const actor = match.challenger.discordId === input.actorDiscordId ? match.challenger : match.opponent;
  if (actor.isBanned) {
    throw new DomainError(
      'BANNED',
      'You are currently restricted and cannot report results. A referee will resolve this match.',
      'Restricted',
    );
  }
  statusGuard(match);
  if (input.winnerPlayerId !== match.challengerId && input.winnerPlayerId !== match.opponentId) {
    throw new DomainError(
      'INVALID_WINNER',
      'The selected winner is not a player in this match.',
      'Invalid winner',
    );
  }
  if (match.evidenceRequired) {
    const uploaded = await db().evidence.count({
      where: { matchId: match.id, submittedByDiscordId: input.actorDiscordId },
    });
    if (uploaded === 0) {
      throw new DomainError(
        'EVIDENCE_REQUIRED',
        'This server requires evidence before reporting.\nUpload a screenshot of the final result in this channel, then report again.',
        'Evidence required',
      );
    }
  }

  const entries: AuditEntry[] = [];
  await db().$transaction(async (tx) => {
    const now = new Date();
    const res = await tx.match.updateMany({
      where: { id: match.id, status: 'ACTIVE' },
      data: { status: 'RESULT_PENDING', resultStatus: 'PLAYER_REPORTED', cancelRequestedById: null },
    });
    if (res.count !== 1) throw Errors.stale();
    await tx.matchResult.upsert({
      where: { matchId: match.id },
      update: {
        reportedWinnerId: input.winnerPlayerId,
        reportedByDiscordId: input.actorDiscordId,
        status: 'PLAYER_REPORTED',
        submittedAt: now,
        disputedAt: null,
      },
      create: {
        matchId: match.id,
        reportedWinnerId: input.winnerPlayerId,
        reportedByDiscordId: input.actorDiscordId,
        status: 'PLAYER_REPORTED',
        submittedAt: now,
      },
    });
    const winner = input.winnerPlayerId === match.challengerId ? match.challenger : match.opponent;
    entries.push(
      ...(await auditInTx(tx, [
        {
          guildId: match.guildId,
          actorId: input.actorDiscordId,
          action: AuditAction.RESULT_REPORTED,
          matchId: match.matchId,
          targetId: winner.discordId,
          metadata: { reportedWinner: winner.discordId },
        },
      ])),
    );
  });
  publishAudit(entries);
  const fresh = await getMatch(match.id);
  if (!fresh) throw Errors.stale();
  return fresh;
}

function assertResponder(match: MatchView, actorDiscordId: string): void {
  if (
    match.status !== 'RESULT_PENDING' ||
    !match.result?.reportedByDiscordId ||
    !match.result.reportedWinnerId
  ) {
    throw Errors.stale();
  }
  const reporter = match.result.reportedByDiscordId;
  const responder = match.challenger.discordId === reporter ? match.opponent : match.challenger;
  if (actorDiscordId === reporter) {
    throw new DomainError(
      'OWN_REPORT',
      `You reported this result. Waiting for <@${responder.discordId}> to confirm.`,
      'Awaiting opponent',
    );
  }
  if (actorDiscordId !== responder.discordId) {
    throw new DomainError(
      'NOT_OPPONENT',
      `Only <@${responder.discordId}> can confirm or dispute this result.`,
      'Not your decision',
    );
  }
}

/** The opponent confirms the reported result → the match is finalized (exactly once). */
export async function confirmResult(input: {
  matchId: string;
  guildId: string;
  actorDiscordId: string;
  config: GuildConfig;
}): Promise<FinalizeOutcome> {
  const match = await requireMatch(input.matchId, input.guildId);
  if (match.status === 'COMPLETED') {
    throw new DomainError(
      'ALREADY_FINALIZED',
      `The match ${match.matchId} has already been finalized.`,
      'Already finalized',
    );
  }
  assertResponder(match, input.actorDiscordId);
  const winnerId = match.result!.reportedWinnerId!;
  return finalizeMatch({
    matchId: match.id,
    guildId: match.guildId,
    winnerPlayerId: winnerId,
    method: 'PLAYER_CONFIRMATION',
    actorDiscordId: input.actorDiscordId,
    allowed: ['RESULT_PENDING'],
    config: input.config,
    expectedReportedWinnerId: winnerId,
  });
}

/** The opponent disputes → the match escalates to staff review. */
export async function disputeResult(input: {
  matchId: string;
  guildId: string;
  actorDiscordId: string;
}): Promise<MatchView> {
  const match = await requireMatch(input.matchId, input.guildId);
  assertResponder(match, input.actorDiscordId);
  const entries: AuditEntry[] = [];
  await db().$transaction(async (tx) => {
    const now = new Date();
    const res = await tx.match.updateMany({
      where: { id: match.id, status: 'RESULT_PENDING' },
      data: { status: 'DISPUTED', resultStatus: 'DISPUTED', disputedAt: now },
    });
    if (res.count !== 1) throw Errors.stale();
    await tx.matchResult.update({
      where: { matchId: match.id },
      data: { status: 'DISPUTED', disputedAt: now },
    });
    entries.push(
      ...(await auditInTx(tx, [
        {
          guildId: match.guildId,
          actorId: input.actorDiscordId,
          action: AuditAction.MATCH_DISPUTED,
          matchId: match.matchId,
        },
      ])),
    );
  });
  publishAudit(entries);
  const fresh = await getMatch(match.id);
  if (!fresh) throw Errors.stale();
  return fresh;
}
