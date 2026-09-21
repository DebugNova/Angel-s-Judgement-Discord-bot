import type { Player, Prisma } from '@prisma/client';
import { db } from '../../database/client.js';
import { RANK_ORDER } from '../players/player.service.js';

export const LEADERBOARD_TYPES = ['elo', 'wins', 'winrate', 'streak', 'matches'] as const;
export type LeaderboardType = (typeof LEADERBOARD_TYPES)[number];

export const LEADERBOARD_LABELS: Record<LeaderboardType, string> = {
  elo: 'ELO',
  wins: 'Wins',
  winrate: 'Win Rate',
  streak: 'Win Streak',
  matches: 'Matches Played',
};

const ORDER: Record<LeaderboardType, Prisma.PlayerOrderByWithRelationInput[]> = {
  elo: RANK_ORDER,
  wins: [{ wins: 'desc' }, { elo: 'desc' }, { discordId: 'asc' }],
  winrate: [{ winRate: 'desc' }, { matchesPlayed: 'desc' }, { elo: 'desc' }, { discordId: 'asc' }],
  streak: [{ currentWinStreak: 'desc' }, { highestWinStreak: 'desc' }, { elo: 'desc' }, { discordId: 'asc' }],
  matches: [{ matchesPlayed: 'desc' }, { elo: 'desc' }, { discordId: 'asc' }],
};

export const PAGE_SIZE = 10;

export interface LeaderboardPage {
  entries: { position: number; player: Player }[];
  page: number;
  pages: number;
  total: number;
}

function eligible(guildId: string, minMatches: number): Prisma.PlayerWhereInput {
  return { guildId, isBanned: false, matchesPlayed: { gte: Math.max(minMatches, 0) } };
}

/**
 * One page of the leaderboard. Only players with at least `minMatches` matches are ranked, so a
 * 1–0 newcomer can never top the win-rate board. `size` caps the total number of ranked entries.
 */
export async function getLeaderboardPage(
  guildId: string,
  type: LeaderboardType,
  size: number,
  page: number,
  minMatches: number,
): Promise<LeaderboardPage> {
  const where = eligible(guildId, minMatches);
  const eligibleCount = await db().player.count({ where });
  const total = Math.min(size, eligibleCount);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 0), pages - 1);
  const skip = safePage * PAGE_SIZE;
  const take = Math.max(0, Math.min(PAGE_SIZE, total - skip));
  const rows = take > 0 ? await db().player.findMany({ where, orderBy: ORDER[type], skip, take }) : [];
  return {
    entries: rows.map((player, i) => ({ position: skip + i + 1, player })),
    page: safePage,
    pages,
    total,
  };
}

export async function topPlayers(guildId: string, count: number, minMatches: number): Promise<Player[]> {
  return db().player.findMany({ where: eligible(guildId, minMatches), orderBy: RANK_ORDER, take: count });
}
