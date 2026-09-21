import type { Challenge, GuildConfig, Player } from '@prisma/client';
import { db } from '../../database/client.js';
import { DomainError, Errors } from '../../core/errors.js';
import { AuditAction, audit, auditInTx, publishAudit, SYSTEM_ACTOR } from '../audit/audit.service.js';
import type { AuditEntry } from '../audit/audit.service.js';
import { activeCooldown, cooldownKeys, makePairKey, setCooldown } from '../cooldowns/cooldown.service.js';
import { ensurePlayer, lockPlayers, requirePlayer } from '../players/player.service.js';
import type { Identity } from '../players/player.service.js';
import { LIVE_STATUSES, formatMatchId } from '../matches/match.types.js';

export type ChallengeWithPlayers = Challenge & { challenger: Player; challenged: Player };

const withPlayers = { challenger: true, challenged: true } as const;

function mention(p: { discordId: string }): string {
  return `<@${p.discordId}>`;
}

function ts(date: Date): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:R>`;
}

function assertNotBanned(p: Player, self: boolean): void {
  if (p.isBanned) {
    throw new DomainError(
      'BANNED',
      self
        ? 'You are currently restricted from competitive play.'
        : `${mention(p)} is currently restricted from competitive play.`,
      'Unable to start the match',
    );
  }
}

function assertFree(p: Player, self: boolean): void {
  if (p.currentMatchId) {
    throw new DomainError(
      'IN_MATCH',
      self
        ? 'You are already participating in another 1v1.\nFinish it before starting a new one.'
        : `${mention(p)} is already participating in another 1v1.\n\nPlease try again later.`,
      'Unable to start the match',
    );
  }
}

async function assertCapacity(guildId: string, config: GuildConfig): Promise<void> {
  if (config.maxActiveMatches <= 0) return;
  const live = await db().match.count({ where: { guildId, status: { in: LIVE_STATUSES } } });
  if (live >= config.maxActiveMatches) {
    throw new DomainError(
      'ARENA_FULL',
      `The arena is full — ${live} matches are already in progress.\nPlease try again once a match finishes.`,
      'Arena full',
    );
  }
}

export interface CreateChallengeInput {
  guildId: string;
  config: GuildConfig;
  challenger: Identity;
  target: Identity;
}

/** Validates every matchmaking rule under row locks and creates a PENDING challenge. */
export async function createChallenge(input: CreateChallengeInput): Promise<ChallengeWithPlayers> {
  const { guildId, config } = input;
  if (input.challenger.discordId === input.target.discordId) {
    throw new DomainError('SELF_CHALLENGE', 'You cannot challenge yourself.', 'Invalid challenge');
  }
  if (config.maintenanceMode) {
    throw new DomainError(
      'MAINTENANCE',
      config.maintenanceMessage ?? 'Matchmaking is temporarily closed for maintenance.',
      'Maintenance',
    );
  }

  const c0 = await ensurePlayer(guildId, input.challenger, config.startingElo);
  const t0 = await ensurePlayer(guildId, input.target, config.startingElo);
  await assertCapacity(guildId, config);

  const entries: AuditEntry[] = [];
  const challenge = await db().$transaction(async (tx) => {
    const locked = await lockPlayers(tx, [c0.id, t0.id]);
    const challenger = requirePlayer(locked, c0.id);
    const target = requirePlayer(locked, t0.id);

    assertNotBanned(challenger, true);
    assertNotBanned(target, false);
    assertFree(challenger, true);
    assertFree(target, false);

    const now = new Date();
    const pairKey = makePairKey(challenger.id, target.id);

    const pairCd = await activeCooldown(tx, guildId, cooldownKeys.pair(pairKey));
    if (pairCd) {
      throw new DomainError(
        'PAIR_COOLDOWN',
        `You and ${mention(target)} are on a challenge cooldown.\nYou can challenge each other again ${ts(pairCd)}.`,
        'Cooldown active',
      );
    }
    const userCd = await activeCooldown(tx, guildId, cooldownKeys.user(challenger.id));
    if (userCd) {
      throw new DomainError(
        'USER_COOLDOWN',
        `You can issue a new challenge ${ts(userCd)}.`,
        'Cooldown active',
      );
    }

    const live = { status: 'PENDING' as const, expiresAt: { gt: now } };
    const duplicate = await tx.challenge.findFirst({ where: { guildId, pairKey, ...live } });
    if (duplicate) {
      throw new DomainError(
        'DUPLICATE_CHALLENGE',
        `There is already a pending challenge between you and ${mention(target)}.`,
        'Duplicate challenge',
      );
    }
    const outgoing = await tx.challenge.findFirst({
      where: { guildId, challengerId: challenger.id, ...live },
    });
    if (outgoing) {
      throw new DomainError(
        'OUTGOING_PENDING',
        'You already have a pending challenge.\nWait for a response or cancel it before issuing another.',
        'Challenge pending',
      );
    }
    const incoming = await tx.challenge.count({ where: { guildId, challengedId: target.id, ...live } });
    if (config.maxIncomingChallenges > 0 && incoming >= config.maxIncomingChallenges) {
      throw new DomainError(
        'TARGET_FLOODED',
        `${mention(target)} already has too many pending challenges.\nPlease try again shortly.`,
        'Too many challenges',
      );
    }

    const created = await tx.challenge.create({
      data: {
        guildId,
        challengerId: challenger.id,
        challengedId: target.id,
        pairKey,
        expiresAt: new Date(now.getTime() + config.challengeTimeoutSec * 1000),
      },
      include: withPlayers,
    });
    entries.push(
      ...(await auditInTx(tx, [
        {
          guildId,
          actorId: challenger.discordId,
          action: AuditAction.CHALLENGE_CREATED,
          targetId: target.discordId,
          metadata: { challengeId: created.id },
        },
      ])),
    );
    return created;
  });
  publishAudit(entries);
  return challenge;
}

export async function attachChallengeMessage(
  challengeId: string,
  channelId: string,
  messageId: string,
): Promise<void> {
  await db().challenge.update({ where: { id: challengeId }, data: { channelId, messageId } });
}

export async function getChallenge(challengeId: string): Promise<ChallengeWithPlayers | null> {
  return db().challenge.findUnique({ where: { id: challengeId }, include: withPlayers });
}

export interface AcceptResult {
  challenge: ChallengeWithPlayers;
  matchId: string;
  displayId: string;
  matchNumber: number;
  /** Other pending challenges involving either player that were auto-cancelled. */
  cancelled: ChallengeWithPlayers[];
}

/**
 * Accepts a challenge and creates the match (status ACCEPTED) in a single transaction.
 * Double clicks and simultaneous accepts are safe: the challenge flips PENDING → ACCEPTED with a
 * conditional update and both players are locked + marked busy, so only one match can ever be created.
 */
export async function acceptChallenge(input: {
  challengeId: string;
  actorDiscordId: string;
  guildId: string;
  config: GuildConfig;
}): Promise<AcceptResult> {
  const { config, guildId } = input;
  const existing = await getChallenge(input.challengeId);
  if (!existing || existing.guildId !== guildId) throw Errors.stale();
  if (existing.challenged.discordId !== input.actorDiscordId) {
    throw new DomainError(
      'NOT_YOURS',
      `Only ${mention(existing.challenged)} can respond to this challenge.`,
      'Not your challenge',
    );
  }
  if (existing.status !== 'PENDING') throw Errors.stale();
  if (existing.expiresAt <= new Date()) {
    await expireChallenge(existing.id);
    throw new DomainError('EXPIRED', 'This challenge has expired.', 'Challenge expired');
  }
  if (config.maintenanceMode) {
    throw new DomainError(
      'MAINTENANCE',
      config.maintenanceMessage ?? 'Matchmaking is temporarily closed for maintenance.',
      'Maintenance',
    );
  }
  await assertCapacity(guildId, config);

  const entries: AuditEntry[] = [];
  const result = await db().$transaction(async (tx) => {
    const locked = await lockPlayers(tx, [existing.challengerId, existing.challengedId]);
    const challenger = requirePlayer(locked, existing.challengerId);
    const challenged = requirePlayer(locked, existing.challengedId);
    assertNotBanned(challenged, true);
    assertNotBanned(challenger, false);
    assertFree(challenged, true);
    assertFree(challenger, false);

    const now = new Date();
    const flipped = await tx.challenge.updateMany({
      where: { id: existing.id, status: 'PENDING', expiresAt: { gt: now } },
      data: { status: 'ACCEPTED', respondedAt: now },
    });
    if (flipped.count !== 1) throw Errors.stale();

    const counter = await tx.guildConfig.update({
      where: { guildId },
      data: { matchCounter: { increment: 1 } },
      select: { matchCounter: true, matchIdPrefix: true },
    });
    const displayId = formatMatchId(counter.matchIdPrefix, counter.matchCounter);

    const match = await tx.match.create({
      data: {
        guildId,
        matchNumber: counter.matchCounter,
        matchId: displayId,
        gameMode: existing.gameMode,
        status: 'ACCEPTED',
        challengeId: existing.id,
        challengerId: challenger.id,
        opponentId: challenged.id,
        evidenceRequired: config.evidenceRequired,
        seasonId: config.activeSeasonId,
        acceptedAt: now,
        participants: {
          create: [
            { playerId: challenger.id, team: 0 },
            { playerId: challenged.id, team: 1 },
          ],
        },
        result: { create: { status: 'NONE' } },
      },
    });

    const occupied = await tx.player.updateMany({
      where: { id: { in: [challenger.id, challenged.id] }, currentMatchId: null },
      data: { currentMatchId: match.id },
    });
    if (occupied.count !== 2) throw Errors.stale();

    const others = await tx.challenge.findMany({
      where: {
        guildId,
        status: 'PENDING',
        id: { not: existing.id },
        OR: [
          { challengerId: { in: [challenger.id, challenged.id] } },
          { challengedId: { in: [challenger.id, challenged.id] } },
        ],
      },
      include: withPlayers,
    });
    if (others.length > 0) {
      await tx.challenge.updateMany({
        where: { id: { in: others.map((o) => o.id) }, status: 'PENDING' },
        data: { status: 'CANCELLED', respondedAt: now },
      });
    }

    entries.push(
      ...(await auditInTx(tx, [
        {
          guildId,
          actorId: challenged.discordId,
          action: AuditAction.MATCH_CREATED,
          matchId: displayId,
          targetId: challenger.discordId,
          metadata: { challenger: challenger.discordId, opponent: challenged.discordId },
        },
        ...others.map((o) => ({
          guildId,
          actorId: SYSTEM_ACTOR,
          action: AuditAction.CHALLENGE_CANCELLED,
          targetId: o.challenged.discordId,
          metadata: { challengeId: o.id, reason: 'player entered another match' },
        })),
      ])),
    );

    const fresh = await tx.challenge.findUniqueOrThrow({ where: { id: existing.id }, include: withPlayers });
    return {
      challenge: fresh,
      matchId: match.id,
      displayId,
      matchNumber: counter.matchCounter,
      cancelled: others.map((o) => ({ ...o, status: 'CANCELLED' as const })),
    };
  });
  publishAudit(entries);
  return result;
}

/** Declines a challenge and applies the pair cooldown (and the optional global cooldown). */
export async function declineChallenge(input: {
  challengeId: string;
  actorDiscordId: string;
  guildId: string;
  config: GuildConfig;
}): Promise<ChallengeWithPlayers> {
  const existing = await getChallenge(input.challengeId);
  if (!existing || existing.guildId !== input.guildId) throw Errors.stale();
  if (existing.challenged.discordId !== input.actorDiscordId) {
    throw new DomainError(
      'NOT_YOURS',
      `Only ${mention(existing.challenged)} can respond to this challenge.`,
      'Not your challenge',
    );
  }
  const entries: AuditEntry[] = [];
  const updated = await db().$transaction(async (tx) => {
    const now = new Date();
    const res = await tx.challenge.updateMany({
      where: { id: existing.id, status: 'PENDING' },
      data: { status: 'DECLINED', respondedAt: now },
    });
    if (res.count !== 1) throw Errors.stale();
    await setCooldown(tx, input.guildId, cooldownKeys.pair(existing.pairKey), input.config.pairCooldownSec);
    if (input.config.globalCooldownSec > 0) {
      await setCooldown(
        tx,
        input.guildId,
        cooldownKeys.user(existing.challengerId),
        input.config.globalCooldownSec,
      );
      await setCooldown(
        tx,
        input.guildId,
        cooldownKeys.user(existing.challengedId),
        input.config.globalCooldownSec,
      );
    }
    entries.push(
      ...(await auditInTx(tx, [
        {
          guildId: input.guildId,
          actorId: input.actorDiscordId,
          action: AuditAction.CHALLENGE_DECLINED,
          targetId: existing.challenger.discordId,
          metadata: { challengeId: existing.id },
        },
      ])),
    );
    return tx.challenge.findUniqueOrThrow({ where: { id: existing.id }, include: withPlayers });
  });
  publishAudit(entries);
  return updated;
}

/** The challenger withdraws their own pending challenge. */
export async function cancelChallenge(input: {
  challengeId: string;
  actorDiscordId: string;
  guildId: string;
}): Promise<ChallengeWithPlayers> {
  const existing = await getChallenge(input.challengeId);
  if (!existing || existing.guildId !== input.guildId) throw Errors.stale();
  if (existing.challenger.discordId !== input.actorDiscordId) {
    throw new DomainError(
      'NOT_YOURS',
      `Only ${mention(existing.challenger)} can cancel this challenge.`,
      'Not your challenge',
    );
  }
  const entries: AuditEntry[] = [];
  const updated = await db().$transaction(async (tx) => {
    const res = await tx.challenge.updateMany({
      where: { id: existing.id, status: 'PENDING' },
      data: { status: 'CANCELLED', respondedAt: new Date() },
    });
    if (res.count !== 1) throw Errors.stale();
    entries.push(
      ...(await auditInTx(tx, [
        {
          guildId: input.guildId,
          actorId: input.actorDiscordId,
          action: AuditAction.CHALLENGE_CANCELLED,
          targetId: existing.challenged.discordId,
          metadata: { challengeId: existing.id },
        },
      ])),
    );
    return tx.challenge.findUniqueOrThrow({ where: { id: existing.id }, include: withPlayers });
  });
  publishAudit(entries);
  return updated;
}

/** Idempotently expires a challenge. Returns the challenge only if this call performed the expiry. */
export async function expireChallenge(challengeId: string): Promise<ChallengeWithPlayers | null> {
  const res = await db().challenge.updateMany({
    where: { id: challengeId, status: 'PENDING', expiresAt: { lte: new Date() } },
    data: { status: 'EXPIRED', respondedAt: new Date() },
  });
  if (res.count !== 1) return null;
  const challenge = await getChallenge(challengeId);
  if (challenge) {
    await audit({
      guildId: challenge.guildId,
      actorId: SYSTEM_ACTOR,
      action: AuditAction.CHALLENGE_EXPIRED,
      targetId: challenge.challenged.discordId,
      metadata: { challengeId },
    });
  }
  return challenge;
}

export async function listOverdueChallenges(): Promise<{ id: string }[]> {
  return db().challenge.findMany({
    where: { status: 'PENDING', expiresAt: { lte: new Date() } },
    select: { id: true },
    take: 100,
  });
}

export async function listPendingChallenges(): Promise<{ id: string; expiresAt: Date }[]> {
  return db().challenge.findMany({ where: { status: 'PENDING' }, select: { id: true, expiresAt: true } });
}

export async function findOutgoingPending(
  guildId: string,
  discordId: string,
): Promise<ChallengeWithPlayers | null> {
  return db().challenge.findFirst({
    where: { guildId, status: 'PENDING', expiresAt: { gt: new Date() }, challenger: { discordId } },
    include: withPlayers,
  });
}
