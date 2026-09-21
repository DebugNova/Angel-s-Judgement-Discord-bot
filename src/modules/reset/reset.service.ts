import type { Prisma } from '@prisma/client';
import { db } from '../../database/client.js';
import { DomainError } from '../../core/errors.js';
import { AuditAction, auditInTx, publishAudit } from '../audit/audit.service.js';
import type { AuditEntry } from '../audit/audit.service.js';
import { FINAL_STATUSES } from '../matches/match.types.js';

export const RESET_SCOPES = ['all', 'elo', 'streak', 'user'] as const;
export type ResetScope = (typeof RESET_SCOPES)[number];
export const RESET_PHRASE = 'RESET SEVEN ANGELS';

export interface ResetInput {
  guildId: string;
  scope: ResetScope;
  actorDiscordId: string;
  startingElo: number;
  /** Required for scope "user" */
  playerId?: string;
  /** Only for scope "all": also permanently delete finished matches, challenges and ELO history. */
  deleteHistory?: boolean;
}

export interface ResetResult {
  playersAffected: number;
  matchesDeleted: number;
}

/**
 * Soft reset by default: competitive stats return to their starting values while match history
 * stays intact. Every ELO change caused by a reset is itself recorded in ELO history (Rule 8).
 */
export async function resetStats(input: ResetInput): Promise<ResetResult> {
  if (input.scope === 'user' && !input.playerId) {
    throw new DomainError('MISSING_USER', 'Choose the player to reset.', 'Missing player');
  }
  const where: Prisma.PlayerWhereInput =
    input.scope === 'user' ? { guildId: input.guildId, id: input.playerId } : { guildId: input.guildId };
  const entries: AuditEntry[] = [];

  const result = await db().$transaction(
    async (tx) => {
      const now = new Date();
      const touchesElo = input.scope !== 'streak';
      let matchesDeleted = 0;

      if (touchesElo) {
        const changed = await tx.player.findMany({
          where: { ...where, elo: { not: input.startingElo } },
          select: { id: true, elo: true },
        });
        if (changed.length > 0) {
          await tx.eloHistory.createMany({
            data: changed.map((p) => ({
              guildId: input.guildId,
              playerId: p.id,
              reason: 'RESET' as const,
              oldElo: p.elo,
              newElo: input.startingElo,
              eloChange: input.startingElo - p.elo,
            })),
          });
        }
      }

      const data: Prisma.PlayerUpdateManyMutationInput =
        input.scope === 'elo'
          ? { elo: input.startingElo, highestElo: input.startingElo }
          : input.scope === 'streak'
            ? { currentWinStreak: 0, highestWinStreak: 0 }
            : {
                elo: input.startingElo,
                highestElo: input.startingElo,
                wins: 0,
                losses: 0,
                draws: 0,
                matchesPlayed: 0,
                winRate: 0,
                currentWinStreak: 0,
                highestWinStreak: 0,
                statsResetAt: now,
              };
      const updated = await tx.player.updateMany({ where, data });

      if (input.scope === 'all' && input.deleteHistory) {
        const del = await tx.match.deleteMany({
          where: { guildId: input.guildId, status: { in: FINAL_STATUSES } },
        });
        matchesDeleted = del.count;
        await tx.challenge.deleteMany({
          where: { guildId: input.guildId, status: { not: 'PENDING' }, match: null },
        });
        await tx.eloHistory.deleteMany({
          where: { guildId: input.guildId, matchId: null, reason: { not: 'RESET' } },
        });
      }

      entries.push(
        ...(await auditInTx(tx, [
          {
            guildId: input.guildId,
            actorId: input.actorDiscordId,
            action: AuditAction.STATS_RESET,
            targetId: null,
            metadata: {
              scope: input.scope,
              playerId: input.playerId ?? null,
              deleteHistory: Boolean(input.deleteHistory),
              playersAffected: updated.count,
              matchesDeleted,
            },
          },
        ])),
      );
      return { playersAffected: updated.count, matchesDeleted };
    },
    { timeout: 60_000 },
  );
  publishAudit(entries);
  return result;
}
