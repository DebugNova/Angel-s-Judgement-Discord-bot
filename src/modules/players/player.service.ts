import type { Player, Prisma } from '@prisma/client';
import { Prisma as PrismaNs } from '@prisma/client';
import { db } from '../../database/client.js';
import type { Tx } from '../../database/client.js';
import { DomainError } from '../../core/errors.js';
import { AuditAction, audit } from '../audit/audit.service.js';

/** The minimal identity the Discord layer passes in. Discord usernames are display data only. */
export interface Identity {
  discordId: string;
  username: string;
  displayName: string;
}

type Client = Tx | ReturnType<typeof db>;

/** Creates the player on first contact and keeps their display names fresh. */
export async function ensurePlayer(
  guildId: string,
  who: Identity,
  startingElo: number,
  client: Client = db(),
): Promise<Player> {
  return client.player.upsert({
    where: { guildId_discordId: { guildId, discordId: who.discordId } },
    update: { username: who.username, displayName: who.displayName },
    create: {
      guildId,
      discordId: who.discordId,
      username: who.username,
      displayName: who.displayName,
      elo: startingElo,
      highestElo: startingElo,
    },
  });
}

export async function findPlayer(
  guildId: string,
  discordId: string,
  client: Client = db(),
): Promise<Player | null> {
  return client.player.findUnique({ where: { guildId_discordId: { guildId, discordId } } });
}

/**
 * Row-locks the given players (SELECT … FOR UPDATE, in a stable order to avoid deadlocks) and returns
 * their fresh state. Every check that decides whether a player may start a match runs under this lock,
 * so two concurrent challenges/accepts can never both succeed.
 */
export async function lockPlayers(tx: Tx, ids: string[]): Promise<Map<string, Player>> {
  const sorted = [...new Set(ids)].sort();
  await tx.$queryRaw(
    PrismaNs.sql`SELECT "id" FROM "Player" WHERE "id" IN (${PrismaNs.join(sorted)}) ORDER BY "id" FOR UPDATE`,
  );
  const rows = await tx.player.findMany({ where: { id: { in: sorted } } });
  return new Map(rows.map((p) => [p.id, p]));
}

export function requirePlayer(map: Map<string, Player>, id: string): Player {
  const p = map.get(id);
  if (!p) throw new DomainError('PLAYER_MISSING', 'A player in this action no longer exists.');
  return p;
}

/** Sort order shared by the leaderboard and rank calculation, so both always agree. */
export const RANK_ORDER: Prisma.PlayerOrderByWithRelationInput[] = [
  { elo: 'desc' },
  { wins: 'desc' },
  { discordId: 'asc' },
];

/**
 * Global rank computed live from current ELO (never stored). Returns null when the player is not
 * eligible (banned, or fewer matches than the leaderboard minimum).
 */
export async function getRank(player: Player, minMatches: number): Promise<number | null> {
  if (player.isBanned || player.matchesPlayed < minMatches) return null;
  const ahead = await db().player.count({
    where: {
      guildId: player.guildId,
      isBanned: false,
      matchesPlayed: { gte: minMatches },
      OR: [
        { elo: { gt: player.elo } },
        { elo: player.elo, wins: { gt: player.wins } },
        { elo: player.elo, wins: player.wins, discordId: { lt: player.discordId } },
      ],
    },
  });
  return ahead + 1;
}

export async function setBanned(
  guildId: string,
  target: Identity,
  banned: boolean,
  actorId: string,
  reason: string | null,
  startingElo: number,
): Promise<Player> {
  const player = await ensurePlayer(guildId, target, startingElo);
  if (player.isBanned === banned) {
    throw new DomainError(
      'NO_CHANGE',
      banned ? `<@${target.discordId}> is already restricted.` : `<@${target.discordId}> is not restricted.`,
    );
  }
  const updated = await db().player.update({
    where: { id: player.id },
    data: banned
      ? { isBanned: true, banReason: reason, bannedAt: new Date(), bannedBy: actorId }
      : { isBanned: false, banReason: null, bannedAt: null, bannedBy: null },
  });
  await audit({
    guildId,
    actorId,
    action: banned ? AuditAction.PLAYER_BANNED : AuditAction.PLAYER_UNBANNED,
    targetId: target.discordId,
    metadata: reason ? { reason } : undefined,
  });
  return updated;
}

export async function searchPlayers(guildId: string, query: string, take = 10): Promise<Player[]> {
  const q = query.trim();
  return db().player.findMany({
    where: {
      guildId,
      OR: [
        { discordId: q },
        { username: { contains: q, mode: 'insensitive' } },
        { displayName: { contains: q, mode: 'insensitive' } },
      ],
    },
    orderBy: RANK_ORDER,
    take,
  });
}

export async function countPlayers(guildId: string): Promise<number> {
  return db().player.count({ where: { guildId } });
}
