import type { GuildConfig } from '@prisma/client';
import { db } from '../src/database/client.js';
import { getConfig, invalidateConfig } from '../src/modules/configuration/config.service.js';
import { acceptChallenge, createChallenge } from '../src/modules/challenges/challenge.service.js';
import { activateMatch } from '../src/modules/matches/match.service.js';
import type { Identity } from '../src/modules/players/player.service.js';

export const GUILD = '100000000000000001';

export function who(n: number): Identity {
  const id = `2000000000000000${String(n).padStart(2, '0')}`;
  return { discordId: id, username: `angel${n}`, displayName: `Angel ${n}` };
}

export const A = who(1);
export const B = who(2);
export const C = who(3);
export const REF = who(90);

export async function resetDb(): Promise<void> {
  await db().$executeRawUnsafe(
    'TRUNCATE "ModCase","AuditLog","Cooldown","MatchNote","Evidence","EloHistory","MatchResult","MatchParticipant","Match","Challenge","Season","Player","GuildConfig" CASCADE',
  );
  invalidateConfig(GUILD);
}

export async function config(): Promise<GuildConfig> {
  invalidateConfig(GUILD);
  return getConfig(GUILD);
}

/** Challenge → accept → activate: returns the live match ID. */
export async function startMatch(challenger: Identity, opponent: Identity): Promise<string> {
  const cfg = await config();
  const ch = await createChallenge({ guildId: GUILD, config: cfg, challenger, target: opponent });
  const acc = await acceptChallenge({
    challengeId: ch.id,
    actorDiscordId: opponent.discordId,
    guildId: GUILD,
    config: cfg,
  });
  await activateMatch(acc.matchId, {
    id: `9${acc.matchNumber}`.padEnd(18, '0'),
    name: 'queue-001',
    categoryId: null,
  });
  return acc.matchId;
}

export async function player(identity: Identity) {
  return db().player.findUniqueOrThrow({
    where: { guildId_discordId: { guildId: GUILD, discordId: identity.discordId } },
  });
}
