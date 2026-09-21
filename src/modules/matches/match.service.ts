import type { GuildConfig, MatchStatus, Prisma } from '@prisma/client';
import { db } from '../../database/client.js';
import type { Tx } from '../../database/client.js';
import { DomainError, Errors } from '../../core/errors.js';
import { AuditAction, audit, auditInTx, publishAudit, SYSTEM_ACTOR } from '../audit/audit.service.js';
import type { AuditEntry } from '../audit/audit.service.js';
import { lockPlayers, requirePlayer } from '../players/player.service.js';
import { LIVE_STATUSES, isParticipant, matchInclude, parseMatchNumber } from './match.types.js';
import type { MatchView } from './match.types.js';

export async function getMatch(
  id: string,
  client: Tx | ReturnType<typeof db> = db(),
): Promise<MatchView | null> {
  return client.match.findUnique({ where: { id }, include: matchInclude });
}

export async function requireMatch(id: string, guildId: string): Promise<MatchView> {
  const match = await getMatch(id);
  if (!match || match.guildId !== guildId) throw Errors.stale();
  return match;
}

/** Looks a match up by its readable ID ("SA-000124", "124", "#124"). */
export async function findMatchByDisplayId(guildId: string, input: string): Promise<MatchView | null> {
  const n = parseMatchNumber(input);
  if (n === null) return null;
  return db().match.findUnique({
    where: { guildId_matchNumber: { guildId, matchNumber: n } },
    include: matchInclude,
  });
}

export async function findMatchByChannel(channelId: string): Promise<MatchView | null> {
  return db().match.findFirst({
    where: { channelId, channelDeletedAt: null },
    orderBy: { createdAt: 'desc' },
    include: matchInclude,
  });
}

export async function findCurrentMatch(guildId: string, discordId: string): Promise<MatchView | null> {
  const player = await db().player.findUnique({ where: { guildId_discordId: { guildId, discordId } } });
  if (!player?.currentMatchId) return null;
  const match = await getMatch(player.currentMatchId);
  return match && LIVE_STATUSES.includes(match.status) ? match : null;
}

export function cleanupTime(config: GuildConfig, from = new Date()): Date | null {
  return config.autoDeleteChannels ? new Date(from.getTime() + config.autoDeleteDelaySec * 1000) : null;
}

/** ACCEPTED → ACTIVE once the private channel exists. */
export async function activateMatch(
  matchId: string,
  channel: { id: string; name: string; categoryId: string | null },
): Promise<MatchView> {
  const now = new Date();
  const res = await db().match.updateMany({
    where: { id: matchId, status: 'ACCEPTED' },
    data: {
      status: 'ACTIVE',
      startedAt: now,
      channelId: channel.id,
      channelName: channel.name,
      categoryId: channel.categoryId,
    },
  });
  if (res.count !== 1) throw Errors.stale();
  const match = await getMatch(matchId);
  if (!match) throw Errors.stale();
  await audit({
    guildId: match.guildId,
    actorId: SYSTEM_ACTOR,
    action: AuditAction.CHANNEL_CREATED,
    matchId: match.matchId,
    metadata: { channel: channel.name },
  });
  return match;
}

export async function setPanelMessage(matchId: string, messageId: string | null): Promise<void> {
  await db().match.update({ where: { id: matchId }, data: { panelMessageId: messageId } });
}

async function releasePlayers(tx: Tx, matchId: string): Promise<void> {
  await tx.player.updateMany({ where: { currentMatchId: matchId }, data: { currentMatchId: null } });
}

/** Rolls back a match whose channel could not be created. Players are freed; data is kept. */
export async function abortMatch(matchId: string, reason: string): Promise<void> {
  const entries: AuditEntry[] = [];
  await db().$transaction(async (tx) => {
    const match = await tx.match.findUnique({ where: { id: matchId } });
    if (!match) return;
    const res = await tx.match.updateMany({
      where: { id: matchId, status: 'ACCEPTED' },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason },
    });
    if (res.count !== 1) return;
    await releasePlayers(tx, matchId);
    entries.push(
      ...(await auditInTx(tx, [
        {
          guildId: match.guildId,
          actorId: SYSTEM_ACTOR,
          action: AuditAction.MATCH_ABORTED,
          matchId: match.matchId,
          metadata: { reason },
        },
      ])),
    );
  });
  publishAudit(entries);
}

async function cancelInTx(
  tx: Tx,
  match: MatchView,
  opts: { byDiscordId: string; reason: string | null; allowed: MatchStatus[]; config: GuildConfig },
): Promise<void> {
  const now = new Date();
  const res = await tx.match.updateMany({
    where: { id: match.id, status: { in: opts.allowed } },
    data: {
      status: 'CANCELLED',
      cancelledAt: now,
      cancelledByDiscordId: opts.byDiscordId,
      cancelReason: opts.reason,
      cancelRequestedById: null,
      cleanupAt: match.channelId ? cleanupTime(opts.config, now) : null,
    },
  });
  if (res.count !== 1) throw Errors.stale();
  await releasePlayers(tx, match.id);
}

export type CancelRequestOutcome = 'REQUESTED' | 'CANCELLED';

/**
 * Player-side cancellation of an ACTIVE match: requires both players. The first call records the
 * request; the opponent agreeing cancels the match. Disputes can only be cancelled by staff.
 */
export async function requestCancel(input: {
  matchId: string;
  guildId: string;
  actorDiscordId: string;
  config: GuildConfig;
}): Promise<{ outcome: CancelRequestOutcome; match: MatchView }> {
  const match = await requireMatch(input.matchId, input.guildId);
  if (!isParticipant(match, input.actorDiscordId)) {
    throw new DomainError(
      'NOT_PARTICIPANT',
      'Only the players in this match can request a cancellation.',
      'Not your match',
    );
  }
  if (match.status === 'DISPUTED' || match.status === 'UNDER_REVIEW') {
    throw new DomainError(
      'DISPUTE_LOCKED',
      'This match is under dispute. Only staff can cancel it now.',
      'Cancellation unavailable',
    );
  }
  if (match.status === 'RESULT_PENDING') {
    throw new DomainError(
      'RESULT_LOCKED',
      'A result has already been reported. Confirm or dispute it instead of cancelling.',
      'Cancellation unavailable',
    );
  }
  if (match.status !== 'ACTIVE') throw Errors.stale();

  const actor = match.challenger.discordId === input.actorDiscordId ? match.challenger : match.opponent;
  const other = actor.id === match.challenger.id ? match.opponent : match.challenger;

  if (match.cancelRequestedById === actor.id) {
    throw new DomainError(
      'ALREADY_REQUESTED',
      `You already requested a cancellation. Waiting for <@${other.discordId}> to agree.`,
      'Request pending',
    );
  }

  const entries: AuditEntry[] = [];
  const outcome = await db().$transaction(async (tx): Promise<CancelRequestOutcome> => {
    if (match.cancelRequestedById === other.id) {
      await cancelInTx(tx, match, {
        byDiscordId: actor.discordId,
        reason: 'Both players agreed to cancel',
        allowed: ['ACTIVE'],
        config: input.config,
      });
      entries.push(
        ...(await auditInTx(tx, [
          {
            guildId: match.guildId,
            actorId: actor.discordId,
            action: AuditAction.MATCH_CANCELLED,
            matchId: match.matchId,
            metadata: { method: 'mutual' },
          },
        ])),
      );
      return 'CANCELLED';
    }
    const res = await tx.match.updateMany({
      where: { id: match.id, status: 'ACTIVE', cancelRequestedById: null },
      data: { cancelRequestedById: actor.id },
    });
    if (res.count !== 1) throw Errors.stale();
    entries.push(
      ...(await auditInTx(tx, [
        {
          guildId: match.guildId,
          actorId: actor.discordId,
          action: AuditAction.MATCH_CANCEL_REQUESTED,
          matchId: match.matchId,
        },
      ])),
    );
    return 'REQUESTED';
  });
  publishAudit(entries);
  const fresh = await getMatch(match.id);
  if (!fresh) throw Errors.stale();
  return { outcome, match: fresh };
}

/** Either player withdraws / refuses a pending cancellation request. */
export async function clearCancelRequest(input: {
  matchId: string;
  guildId: string;
  actorDiscordId: string;
}): Promise<MatchView> {
  const match = await requireMatch(input.matchId, input.guildId);
  if (!isParticipant(match, input.actorDiscordId)) {
    throw new DomainError(
      'NOT_PARTICIPANT',
      'Only the players in this match can respond to a cancellation request.',
      'Not your match',
    );
  }
  const res = await db().match.updateMany({
    where: { id: match.id, status: 'ACTIVE', cancelRequestedById: { not: null } },
    data: { cancelRequestedById: null },
  });
  if (res.count !== 1) throw Errors.stale();
  const fresh = await getMatch(match.id);
  if (!fresh) throw Errors.stale();
  return fresh;
}

/** Staff cancellation of any unfinished match. Completed matches can never be cancelled. */
export async function staffCancel(input: {
  matchId: string;
  guildId: string;
  staffDiscordId: string;
  reason: string | null;
  config: GuildConfig;
}): Promise<MatchView> {
  const match = await requireMatch(input.matchId, input.guildId);
  if (match.status === 'COMPLETED') {
    throw new DomainError(
      'COMPLETED',
      `${match.matchId} is already completed and cannot be cancelled.`,
      'Cancellation unavailable',
    );
  }
  if (!LIVE_STATUSES.includes(match.status)) {
    throw new DomainError(
      'NOT_LIVE',
      `${match.matchId} is already ${match.status.toLowerCase()}.`,
      'Cancellation unavailable',
    );
  }
  const entries: AuditEntry[] = [];
  await db().$transaction(async (tx) => {
    await cancelInTx(tx, match, {
      byDiscordId: input.staffDiscordId,
      reason: input.reason,
      allowed: LIVE_STATUSES,
      config: input.config,
    });
    entries.push(
      ...(await auditInTx(tx, [
        {
          guildId: match.guildId,
          actorId: input.staffDiscordId,
          action: AuditAction.MATCH_CANCELLED,
          matchId: match.matchId,
          metadata: { method: 'staff', reason: input.reason },
        },
      ])),
    );
  });
  publishAudit(entries);
  const fresh = await getMatch(match.id);
  if (!fresh) throw Errors.stale();
  return fresh;
}

/**
 * Staff reopen. A reported/disputed match goes back to ACTIVE with the report cleared.
 * A cancelled match is revived only if both players are free. Completed matches are never reopened
 * (stats/ELO were already applied — Rule 6).
 */
export async function reopenMatch(input: {
  matchId: string;
  guildId: string;
  staffDiscordId: string;
}): Promise<{ match: MatchView; needsChannel: boolean }> {
  const match = await requireMatch(input.matchId, input.guildId);
  if (match.status === 'COMPLETED') {
    throw new DomainError(
      'COMPLETED',
      `${match.matchId} is completed — its result, stats and ELO are final and cannot be reopened.`,
      'Reopen unavailable',
    );
  }
  const entries: AuditEntry[] = [];
  let needsChannel = false;
  await db().$transaction(async (tx) => {
    const reset = { resultStatus: 'NONE' as const, cancelRequestedById: null, disputedAt: null };
    if (['RESULT_PENDING', 'DISPUTED', 'UNDER_REVIEW'].includes(match.status)) {
      const res = await tx.match.updateMany({
        where: { id: match.id, status: { in: ['RESULT_PENDING', 'DISPUTED', 'UNDER_REVIEW'] } },
        data: { status: 'ACTIVE', ...reset },
      });
      if (res.count !== 1) throw Errors.stale();
    } else if (match.status === 'CANCELLED') {
      const locked = await lockPlayers(tx, [match.challengerId, match.opponentId]);
      for (const id of [match.challengerId, match.opponentId]) {
        const p = requirePlayer(locked, id);
        if (p.currentMatchId) {
          throw new DomainError(
            'IN_MATCH',
            `<@${p.discordId}> is already in another match, so ${match.matchId} cannot be reopened.`,
            'Reopen unavailable',
          );
        }
      }
      needsChannel = !match.channelId || match.channelDeletedAt !== null;
      const res = await tx.match.updateMany({
        where: { id: match.id, status: 'CANCELLED' },
        data: {
          status: 'ACTIVE',
          ...reset,
          cancelledAt: null,
          cancelReason: null,
          cancelledByDiscordId: null,
          cleanupAt: null,
          startedAt: match.startedAt ?? new Date(),
        },
      });
      if (res.count !== 1) throw Errors.stale();
      await tx.player.updateMany({
        where: { id: { in: [match.challengerId, match.opponentId] } },
        data: { currentMatchId: match.id },
      });
    } else {
      throw new DomainError(
        'NOT_REOPENABLE',
        `${match.matchId} is ${match.status.toLowerCase().replace('_', ' ')} and does not need reopening.`,
        'Reopen unavailable',
      );
    }
    await tx.matchResult.updateMany({
      where: { matchId: match.id },
      data: {
        status: 'NONE',
        reportedWinnerId: null,
        reportedByDiscordId: null,
        submittedAt: null,
        disputedAt: null,
      },
    });
    entries.push(
      ...(await auditInTx(tx, [
        {
          guildId: match.guildId,
          actorId: input.staffDiscordId,
          action: AuditAction.MATCH_REOPENED,
          matchId: match.matchId,
          metadata: { from: match.status },
        },
      ])),
    );
  });
  publishAudit(entries);
  const fresh = await getMatch(match.id);
  if (!fresh) throw Errors.stale();
  return { match: fresh, needsChannel };
}

/** Points a match at a (re)created channel. */
export async function replaceChannel(
  matchId: string,
  channel: { id: string; name: string; categoryId: string | null },
): Promise<void> {
  await db().match.update({
    where: { id: matchId },
    data: {
      channelId: channel.id,
      channelName: channel.name,
      categoryId: channel.categoryId,
      channelDeletedAt: null,
      panelMessageId: null,
    },
  });
}

const LINK_RE = /^https?:\/\/[^\s<>]{3,}$/i;

export async function setServerLink(input: {
  matchId: string;
  guildId: string;
  actorDiscordId: string;
  link: string;
}): Promise<MatchView> {
  const match = await requireMatch(input.matchId, input.guildId);
  if (!isParticipant(match, input.actorDiscordId)) {
    throw new DomainError(
      'NOT_PARTICIPANT',
      'Only the players in this match can submit the server link.',
      'Not your match',
    );
  }
  if (!['ACTIVE', 'RESULT_PENDING'].includes(match.status)) throw Errors.stale();
  const link = input.link.trim();
  if (link.length > 500 || !LINK_RE.test(link)) {
    throw new DomainError(
      'INVALID_LINK',
      'That does not look like a valid link. It must start with https://',
      'Invalid link',
    );
  }
  await db().match.update({
    where: { id: match.id },
    data: { serverLink: link, serverLinkById: input.actorDiscordId },
  });
  await audit({
    guildId: match.guildId,
    actorId: input.actorDiscordId,
    action: AuditAction.SERVER_LINK_SUBMITTED,
    matchId: match.matchId,
  });
  const fresh = await getMatch(match.id);
  if (!fresh) throw Errors.stale();
  return fresh;
}

export async function markEvidenceRequested(match: MatchView, staffDiscordId: string): Promise<void> {
  await db().match.update({ where: { id: match.id }, data: { evidenceRequestedAt: new Date() } });
  await audit({
    guildId: match.guildId,
    actorId: staffDiscordId,
    action: AuditAction.EVIDENCE_REQUESTED,
    matchId: match.matchId,
  });
}

export interface EvidenceInput {
  submittedByDiscordId: string;
  channelId: string;
  messageId: string;
  attachmentUrl: string;
  fileName: string;
  contentType: string | null;
}

export async function addEvidence(match: MatchView, items: EvidenceInput[]): Promise<number> {
  if (items.length === 0) return 0;
  const res = await db().evidence.createMany({ data: items.map((i) => ({ ...i, matchId: match.id })) });
  await audit({
    guildId: match.guildId,
    actorId: items[0]!.submittedByDiscordId,
    action: AuditAction.EVIDENCE_SUBMITTED,
    matchId: match.matchId,
    metadata: { files: res.count },
  });
  return res.count;
}

export async function listEvidence(matchId: string) {
  return db().evidence.findMany({ where: { matchId }, orderBy: { createdAt: 'asc' }, take: 50 });
}

export async function addNote(match: MatchView, authorDiscordId: string, content: string) {
  const note = await db().matchNote.create({
    data: { matchId: match.id, authorDiscordId, content: content.slice(0, 1000) },
  });
  await audit({
    guildId: match.guildId,
    actorId: authorDiscordId,
    action: AuditAction.MATCH_NOTE,
    matchId: match.matchId,
  });
  return note;
}

export async function listNotes(matchId: string) {
  return db().matchNote.findMany({ where: { matchId }, orderBy: { createdAt: 'desc' }, take: 10 });
}

export async function countLiveMatches(guildId: string): Promise<number> {
  return db().match.count({ where: { guildId, status: { in: LIVE_STATUSES } } });
}

export async function countCompletedMatches(guildId: string): Promise<number> {
  return db().match.count({ where: { guildId, status: 'COMPLETED' } });
}

export interface MatchSearch {
  guildId: string;
  playerId?: string;
  winnerId?: string;
  loserId?: string;
  status?: MatchStatus;
  from?: Date;
  to?: Date;
}

export async function searchMatches(q: MatchSearch, page: number, pageSize: number) {
  const where: Prisma.MatchWhereInput = {
    guildId: q.guildId,
    ...(q.status ? { status: q.status } : {}),
    ...(q.winnerId ? { winnerId: q.winnerId } : {}),
    ...(q.loserId ? { loserId: q.loserId } : {}),
    ...(q.playerId ? { participants: { some: { playerId: q.playerId } } } : {}),
    ...(q.from || q.to
      ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } }
      : {}),
  };
  const [rows, total] = await Promise.all([
    db().match.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: page * pageSize,
      take: pageSize,
      include: matchInclude,
    }),
    db().match.count({ where }),
  ]);
  return { rows, total };
}

/** Autocomplete source: recent matches, optionally restricted to one player's matches. */
export async function suggestMatches(guildId: string, query: string, discordId?: string) {
  const n = parseMatchNumber(query);
  return db().match.findMany({
    where: {
      guildId,
      ...(n !== null ? { matchNumber: n } : {}),
      ...(discordId ? { participants: { some: { player: { discordId } } } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 25,
    include: { challenger: true, opponent: true },
  });
}

// ───── Cleanup / recovery helpers ─────

export async function listDueCleanups(): Promise<MatchView[]> {
  return db().match.findMany({
    where: {
      cleanupAt: { lte: new Date() },
      channelDeletedAt: null,
      channelId: { not: null },
      status: { in: ['COMPLETED', 'CANCELLED'] },
    },
    include: matchInclude,
    take: 25,
  });
}

/** Claims the channel deletion so it runs exactly once, even across restarts. */
export async function claimChannelDeletion(matchId: string): Promise<boolean> {
  const res = await db().match.updateMany({
    where: { id: matchId, channelDeletedAt: null, status: { in: ['COMPLETED', 'CANCELLED'] } },
    data: { channelDeletedAt: new Date(), panelMessageId: null },
  });
  return res.count === 1;
}

export async function listLiveMatchesWithChannels(guildId: string): Promise<MatchView[]> {
  return db().match.findMany({
    where: { guildId, status: { in: LIVE_STATUSES }, channelId: { not: null } },
    include: matchInclude,
  });
}

export async function listStuckAcceptedMatches(
  olderThan: Date,
): Promise<{ id: string; guildId: string; matchId: string }[]> {
  return db().match.findMany({
    where: { status: 'ACCEPTED', acceptedAt: { lt: olderThan } },
    select: { id: true, guildId: true, matchId: true },
  });
}

export async function knownChannelIds(guildId: string): Promise<Set<string>> {
  const rows = await db().match.findMany({
    where: { guildId, channelId: { not: null }, channelDeletedAt: null },
    select: { channelId: true },
  });
  return new Set(rows.map((r) => r.channelId!).filter(Boolean));
}
