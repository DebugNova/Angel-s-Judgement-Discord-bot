import type { Player, Prisma } from '@prisma/client';
import { db } from '../../database/client.js';
import { RANK_ORDER } from '../players/player.service.js';
import { LIVE_STATUSES } from '../matches/match.types.js';

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

export interface PresenceStats {
  liveMatches: number;
  completedMatches: number;
  players: number;
  champion: Player | null;
  /** The longest current win streak (3 or more), if anyone has one. */
  hotStreak: Player | null;
  /** Matches completed in the last 24 hours. */
  completedToday: number;
}

/** Numbers shown in the bot's rotating status. `guildId` null = across every server. */
export async function presenceStats(guildId: string | null, minMatches: number): Promise<PresenceStats> {
  const scope = guildId ? { guildId } : {};
  const [liveMatches, completedMatches, players, champion, hotStreak, completedToday] = await Promise.all([
    db().match.count({ where: { ...scope, status: { in: LIVE_STATUSES } } }),
    db().match.count({ where: { ...scope, status: 'COMPLETED' } }),
    db().player.count({ where: scope }),
    guildId ? topPlayers(guildId, 1, minMatches).then((p) => p[0] ?? null) : Promise.resolve(null),
    db().player.findFirst({
      where: { ...scope, isBanned: false, currentWinStreak: { gte: 3 } },
      orderBy: [{ currentWinStreak: 'desc' }, { elo: 'desc' }],
    }),
    db().match.count({
      where: { ...scope, status: 'COMPLETED', completedAt: { gte: new Date(Date.now() - 86_400_000) } },
    }),
  ]);
  return { liveMatches, completedMatches, players, champion, hotStreak, completedToday };
}
