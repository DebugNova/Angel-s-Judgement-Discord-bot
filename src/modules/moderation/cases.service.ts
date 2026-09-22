import type { ModCase, Prisma } from '@prisma/client';
import { DomainError } from '../../core/errors.js';
import { db } from '../../database/client.js';
import { AuditAction, auditInTx, publishAudit } from '../audit/audit.service.js';
import { invalidateConfig } from '../configuration/config.service.js';

export const MOD_ACTIONS = [
  'WARN',
  'TIMEOUT',
  'UNTIMEOUT',
  'KICK',
  'BAN',
  'UNBAN',
  'PURGE',
  'ROLE_ADD',
  'ROLE_REMOVE',
  'ROLE_ALL_ADD',
  'ROLE_ALL_REMOVE',
  'SLOWMODE',
  'LOCK',
  'UNLOCK',
] as const;
export type ModAction = (typeof MOD_ACTIONS)[number];

export type CaseDetails = Record<string, string | number | boolean | null>;

export interface NewCase {
  guildId: string;
  action: ModAction;
  moderatorId: string;
  targetId?: string | null;
  targetName?: string | null;
  reason?: string | null;
  durationSec?: number | null;
  channelId?: string | null;
  details?: CaseDetails;
  dmSent?: boolean | null;
}

function cleanReason(reason: string | null | undefined): string | null {
  const r = reason?.trim();
  return r ? r.slice(0, 500) : null;
}

/**
 * Records one moderation action as the next numbered case, plus its AuditLog row, atomically.
 * Call this only after the Discord action succeeded, so every case describes something real.
 */
export async function recordCase(input: NewCase): Promise<ModCase> {
  const { created, entries } = await db().$transaction(async (tx) => {
    // The UPDATE row-locks the config, so two moderators acting at once get different numbers.
    const cfg = await tx.guildConfig.upsert({
      where: { guildId: input.guildId },
      update: { modCaseCounter: { increment: 1 } },
      create: { guildId: input.guildId, modCaseCounter: 1 },
    });
    const created = await tx.modCase.create({
      data: {
        guildId: input.guildId,
        caseNumber: cfg.modCaseCounter,
        action: input.action,
        targetId: input.targetId ?? null,
        targetName: input.targetName?.slice(0, 100) ?? null,
        moderatorId: input.moderatorId,
        reason: cleanReason(input.reason),
        durationSec: input.durationSec ?? null,
        channelId: input.channelId ?? null,
        details: (input.details ?? undefined) as Prisma.InputJsonValue | undefined,
        dmSent: input.dmSent ?? null,
      },
    });
    const entries = await auditInTx(tx, [
      {
        guildId: input.guildId,
        actorId: input.moderatorId,
        action: AuditAction.MOD_CASE,
        targetId: input.targetId ?? null,
        metadata: { case: created.caseNumber, caseId: created.id, type: input.action },
      },
    ]);
    return { created, entries };
  });
  // The cached config holds the old counter; nothing reads it from the cache, but keep it honest.
  invalidateConfig(input.guildId);
  publishAudit(entries);
  return created;
}

export async function getCase(guildId: string, caseNumber: number): Promise<ModCase | null> {
  return db().modCase.findUnique({ where: { guildId_caseNumber: { guildId, caseNumber } } });
}

export async function getCaseById(id: string): Promise<ModCase | null> {
  return db().modCase.findUnique({ where: { id } });
}

export interface MemberRecord {
  cases: ModCase[];
  total: number;
  activeWarnings: number;
  counts: Partial<Record<ModAction, number>>;
}

/** A member's moderation record, newest first, paged. */
export async function memberRecord(
  guildId: string,
  targetId: string,
  page: number,
  pageSize = 8,
): Promise<MemberRecord> {
  const where = { guildId, targetId };
  const [cases, total, activeWarnings, grouped] = await Promise.all([
    db().modCase.findMany({
      where,
      orderBy: { caseNumber: 'desc' },
      take: pageSize,
      skip: page * pageSize,
    }),
    db().modCase.count({ where }),
    db().modCase.count({ where: { ...where, action: 'WARN', active: true } }),
    db().modCase.groupBy({ by: ['action'], where, _count: { _all: true } }),
  ]);
  const counts: Partial<Record<ModAction, number>> = {};
  for (const g of grouped) counts[g.action as ModAction] = g._count._all;
  return { cases, total, activeWarnings, counts };
}

/** Removes (deactivates) a warning. The case stays in the record, marked as removed. */
export async function removeWarning(opts: {
  guildId: string;
  caseNumber: number;
  actorId: string;
  reason?: string | null;
}): Promise<ModCase> {
  const existing = await getCase(opts.guildId, opts.caseNumber);
  if (!existing) {
    throw new DomainError('NOT_FOUND', `There is no case **#${opts.caseNumber}**.`, 'Case not found');
  }
  if (existing.action !== 'WARN') {
    throw new DomainError(
      'NOT_A_WARNING',
      `Case **#${opts.caseNumber}** is a ${existing.action.toLowerCase().replace(/_/g, ' ')}, not a warning.`,
      'Not a warning',
    );
  }
  const { updated, entries } = await db().$transaction(async (tx) => {
    const res = await tx.modCase.updateMany({
      where: { id: existing.id, active: true },
      data: {
        active: false,
        removedById: opts.actorId,
        removedAt: new Date(),
        removedReason: cleanReason(opts.reason),
      },
    });
    if (res.count === 0) {
      throw new DomainError(
        'ALREADY_REMOVED',
        `Warning **#${opts.caseNumber}** was already removed.`,
        'Already removed',
      );
    }
    const entries = await auditInTx(tx, [
      {
        guildId: opts.guildId,
        actorId: opts.actorId,
        action: AuditAction.MOD_WARNING_REMOVED,
        targetId: existing.targetId,
        metadata: { case: existing.caseNumber, caseId: existing.id, reason: cleanReason(opts.reason) },
      },
    ]);
    return { updated: await tx.modCase.findUniqueOrThrow({ where: { id: existing.id } }), entries };
  });
  publishAudit(entries);
  return updated;
}

/** The most recent LOCK of a channel that has not been undone yet (unlock restores its state). */
export async function lastOpenLock(guildId: string, channelId: string): Promise<ModCase | null> {
  return db().modCase.findFirst({
    where: { guildId, channelId, action: 'LOCK', active: true },
    orderBy: { caseNumber: 'desc' },
  });
}

export async function closeLock(id: string): Promise<void> {
  await db().modCase.update({ where: { id }, data: { active: false } });
}
