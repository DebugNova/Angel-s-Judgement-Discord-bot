import type { GuildConfig } from '@prisma/client';
import { db } from '../../database/client.js';
import { DomainError, Errors } from '../../core/errors.js';
import { AuditAction, audit } from '../audit/audit.service.js';
import { getMatch, requireMatch } from '../matches/match.service.js';
import { LIVE_STATUSES, isParticipant } from '../matches/match.types.js';
import type { MatchView } from '../matches/match.types.js';
import { finalizeMatch } from '../results/finalize.js';
import type { FinalizeOutcome } from '../results/finalize.js';

export type DecisionMode = 'decide' | 'force';

/** Staff may never rule on a match they are playing in. */
export function assertImpartial(match: MatchView, staffDiscordId: string): void {
  if (isParticipant(match, staffDiscordId)) {
    throw new DomainError(
      'CONFLICT_OF_INTEREST',
      'You cannot perform staff actions on a match you are playing in.',
      'Conflict of interest',
    );
  }
}

/** A referee opens the review: DISPUTED → UNDER_REVIEW. Other live states are reviewable without a state change. */
export async function openReview(input: {
  matchId: string;
  guildId: string;
  staffDiscordId: string;
}): Promise<MatchView> {
  const match = await requireMatch(input.matchId, input.guildId);
  assertImpartial(match, input.staffDiscordId);
  if (!LIVE_STATUSES.includes(match.status)) {
    throw new DomainError(
      'NOT_LIVE',
      `${match.matchId} is already ${match.status.toLowerCase()}.`,
      'Review unavailable',
    );
  }
  if (match.status === 'DISPUTED') {
    const now = new Date();
    const res = await db().match.updateMany({
      where: { id: match.id, status: 'DISPUTED' },
      data: { status: 'UNDER_REVIEW', refereeDiscordId: input.staffDiscordId, reviewedAt: now },
    });
    if (res.count === 1) {
      await audit({
        guildId: match.guildId,
        actorId: input.staffDiscordId,
        action: AuditAction.MATCH_UNDER_REVIEW,
        matchId: match.matchId,
      });
    }
  }
  const fresh = await getMatch(match.id);
  if (!fresh) throw Errors.stale();
  return fresh;
}

export function allowedStatusesFor(mode: DecisionMode) {
  return mode === 'force'
    ? (['ACTIVE', 'RESULT_PENDING', 'DISPUTED', 'UNDER_REVIEW'] as const)
    : (['RESULT_PENDING', 'DISPUTED', 'UNDER_REVIEW'] as const);
}

/** Validates that a decision is possible right now (used before showing the confirmation). */
export function assertDecidable(match: MatchView, mode: DecisionMode): void {
  if (match.status === 'COMPLETED') {
    throw new DomainError(
      'ALREADY_FINALIZED',
      `The match ${match.matchId} has already been finalized.`,
      'Already finalized',
    );
  }
  const allowed: readonly string[] = allowedStatusesFor(mode);
  if (!allowed.includes(match.status)) {
    throw new DomainError(
      'NOT_DECIDABLE',
      mode === 'decide'
        ? `${match.matchId} has no reported or disputed result to decide.\nUse \`/match forcecomplete\` to award an in-progress match.`
        : `${match.matchId} cannot be completed from its current state (${match.status.toLowerCase().replace('_', ' ')}).`,
      'Decision unavailable',
    );
  }
}

/** Official staff decision. Stats and ELO are applied exactly once through finalizeMatch. */
export async function decideMatch(input: {
  matchId: string;
  guildId: string;
  staffDiscordId: string;
  winnerPlayerId: string;
  reason: string | null;
  mode: DecisionMode;
  config: GuildConfig;
}): Promise<FinalizeOutcome> {
  const match = await requireMatch(input.matchId, input.guildId);
  assertImpartial(match, input.staffDiscordId);
  assertDecidable(match, input.mode);
  return finalizeMatch({
    matchId: match.id,
    guildId: match.guildId,
    winnerPlayerId: input.winnerPlayerId,
    method: input.mode === 'force' ? 'FORCE_COMPLETE' : 'REFEREE_DECISION',
    actorDiscordId: input.staffDiscordId,
    reason: input.reason,
    allowed: [...allowedStatusesFor(input.mode)],
    config: input.config,
  });
}
