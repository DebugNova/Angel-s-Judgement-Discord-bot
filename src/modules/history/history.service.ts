import type { Player } from '@prisma/client';
import { db } from '../../database/client.js';
import { matchInclude } from '../matches/match.types.js';
import type { MatchView } from '../matches/match.types.js';

export const HISTORY_PAGE_SIZE = 5;

export interface HistoryPage {
  rows: MatchView[];
  page: number;
  pages: number;
  total: number;
}

/** Completed matches of a player, newest first, capped at `limit` and paginated. */
export async function playerHistory(player: Player, limit: number, page: number): Promise<HistoryPage> {
  const where = {
    guildId: player.guildId,
    status: 'COMPLETED' as const,
    participants: { some: { playerId: player.id } },
  };
  const count = await db().match.count({ where });
  const total = Math.min(count, limit);
  const pages = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 0), pages - 1);
  const skip = safePage * HISTORY_PAGE_SIZE;
  const take = Math.max(0, Math.min(HISTORY_PAGE_SIZE, total - skip));
  const rows =
    take > 0
      ? await db().match.findMany({
          where,
          orderBy: { completedAt: 'desc' },
          skip,
          take,
          include: matchInclude,
        })
      : [];
  return { rows, page: safePage, pages, total };
}

/** Last `n` results as W/L, newest first. Ignores matches from before the player's last stats reset. */
export async function recentForm(player: Player, n = 5): Promise<('W' | 'L')[]> {
  const rows = await db().matchParticipant.findMany({
    where: {
      playerId: player.id,
      outcome: { in: ['WIN', 'LOSS'] },
      match: {
        status: 'COMPLETED',
        ...(player.statsResetAt ? { completedAt: { gt: player.statsResetAt } } : {}),
      },
    },
    orderBy: { match: { completedAt: 'desc' } },
    take: n,
    select: { outcome: true },
  });
  return rows.map((r) => (r.outcome === 'WIN' ? 'W' : 'L'));
}

export interface HeadToHead {
  total: number;
  aWins: number;
  bWins: number;
  last: MatchView | null;
}

export async function headToHead(a: Player, b: Player): Promise<HeadToHead> {
  const where = {
    guildId: a.guildId,
    status: 'COMPLETED' as const,
    AND: [{ participants: { some: { playerId: a.id } } }, { participants: { some: { playerId: b.id } } }],
  };
  const [total, aWins, last] = await Promise.all([
    db().match.count({ where }),
    db().match.count({ where: { ...where, winnerId: a.id } }),
    db().match.findFirst({ where, orderBy: { completedAt: 'desc' }, include: matchInclude }),
  ]);
  return { total, aWins, bWins: total - aWins, last };
}

export async function lastEloChange(playerId: string, matchId: string): Promise<number | null> {
  const row = await db().eloHistory.findFirst({ where: { playerId, matchId }, select: { eloChange: true } });
  return row?.eloChange ?? null;
}
