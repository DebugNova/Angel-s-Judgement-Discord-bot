import { EventEmitter } from 'node:events';
import type { Prisma } from '@prisma/client';
import { db } from '../../database/client.js';
import type { Tx } from '../../database/client.js';
import { log } from '../../core/logger.js';

export const AuditAction = {
  CHALLENGE_CREATED: 'CHALLENGE_CREATED',
  CHALLENGE_DECLINED: 'CHALLENGE_DECLINED',
  CHALLENGE_CANCELLED: 'CHALLENGE_CANCELLED',
  CHALLENGE_EXPIRED: 'CHALLENGE_EXPIRED',
  MATCH_CREATED: 'MATCH_CREATED',
  MATCH_ABORTED: 'MATCH_ABORTED',
  MATCH_CANCELLED: 'MATCH_CANCELLED',
  MATCH_CANCEL_REQUESTED: 'MATCH_CANCEL_REQUESTED',
  MATCH_REOPENED: 'MATCH_REOPENED',
  MATCH_NOTE: 'MATCH_NOTE',
  SERVER_LINK_SUBMITTED: 'SERVER_LINK_SUBMITTED',
  RESULT_REPORTED: 'RESULT_REPORTED',
  RESULT_CONFIRMED: 'RESULT_CONFIRMED',
  MATCH_DISPUTED: 'MATCH_DISPUTED',
  MATCH_UNDER_REVIEW: 'MATCH_UNDER_REVIEW',
  EVIDENCE_REQUESTED: 'EVIDENCE_REQUESTED',
  EVIDENCE_SUBMITTED: 'EVIDENCE_SUBMITTED',
  MATCH_DECISION: 'MATCH_DECISION',
  MATCH_FORCE_COMPLETED: 'MATCH_FORCE_COMPLETED',
  MATCH_COMPLETED: 'MATCH_COMPLETED',
  ELO_CHANGE: 'ELO_CHANGE',
  STATS_RESET: 'STATS_RESET',
  PLAYER_BANNED: 'PLAYER_BANNED',
  PLAYER_UNBANNED: 'PLAYER_UNBANNED',
  CONFIG_CHANGED: 'CONFIG_CHANGED',
  PERMISSION_CHANGED: 'PERMISSION_CHANGED',
  MAINTENANCE_CHANGED: 'MAINTENANCE_CHANGED',
  SEASON_STARTED: 'SEASON_STARTED',
  SEASON_ENDED: 'SEASON_ENDED',
  CHANNEL_CREATED: 'CHANNEL_CREATED',
  CHANNEL_DELETED: 'CHANNEL_DELETED',
  CHANNEL_RECREATED: 'CHANNEL_RECREATED',
  ORPHAN_DETECTED: 'ORPHAN_DETECTED',
  /** A moderation case (#n); the mod-log shows it as a full case card instead of a generic line. */
  MOD_CASE: 'MOD_CASE',
  MOD_WARNING_REMOVED: 'MOD_WARNING_REMOVED',
} as const;
export type AuditActionName = (typeof AuditAction)[keyof typeof AuditAction];

export const SYSTEM_ACTOR = 'SYSTEM';

export type AuditMetadata = Record<string, string | number | boolean | null>;

export interface AuditEntry {
  guildId: string;
  /** Discord user ID of whoever caused the event, or SYSTEM */
  actorId: string;
  action: AuditActionName;
  /** Discord user ID the action targeted, if any */
  targetId?: string | null;
  /** Readable match ID (e.g. SA-000124) */
  matchId?: string | null;
  metadata?: AuditMetadata;
}

/** Emits every committed entry so the Discord layer can mirror it to the configured log channel. */
export const auditEvents = new EventEmitter();

const WARN_ACTIONS = new Set<string>([
  AuditAction.MATCH_DISPUTED,
  AuditAction.ORPHAN_DETECTED,
  AuditAction.MATCH_ABORTED,
]);

function writeLog(entry: AuditEntry): void {
  const fields = {
    guild: entry.guildId,
    actor: entry.actorId,
    matchId: entry.matchId ?? undefined,
    target: entry.targetId ?? undefined,
    ...entry.metadata,
  };
  if (WARN_ACTIONS.has(entry.action)) log.warn(entry.action, fields);
  else log.info(entry.action, fields);
}

function toRow(entry: AuditEntry): Prisma.AuditLogCreateManyInput {
  return {
    guildId: entry.guildId,
    actorId: entry.actorId,
    action: entry.action,
    targetId: entry.targetId ?? null,
    matchId: entry.matchId ?? null,
    metadata: (entry.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
  };
}

/** Records an audit entry outside of any transaction and publishes it immediately. */
export async function audit(entry: AuditEntry): Promise<void> {
  await db().auditLog.create({ data: toRow(entry) });
  writeLog(entry);
  auditEvents.emit('entry', entry);
}

/**
 * Writes audit rows inside a transaction. The caller must call `publishAudit` after the commit,
 * so nothing is announced for a transaction that rolled back.
 */
export async function auditInTx(tx: Tx, entries: AuditEntry[]): Promise<AuditEntry[]> {
  if (entries.length > 0) await tx.auditLog.createMany({ data: entries.map(toRow) });
  return entries;
}

export function publishAudit(entries: AuditEntry[]): void {
  for (const entry of entries) {
    writeLog(entry);
    auditEvents.emit('entry', entry);
  }
}

export async function recentAudit(
  guildId: string,
  opts: { targetId?: string; take?: number; skip?: number } = {},
) {
  const where = { guildId, ...(opts.targetId ? { targetId: opts.targetId } : {}) };
  const [rows, total] = await Promise.all([
    db().auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: opts.take ?? 10,
      skip: opts.skip ?? 0,
    }),
    db().auditLog.count({ where }),
  ]);
  return { rows, total };
}
