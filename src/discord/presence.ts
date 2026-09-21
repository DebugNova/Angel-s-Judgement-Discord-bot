import { ActivityType } from 'discord.js';
import type { ActivityOptions, Client } from 'discord.js';
import { log } from '../core/logger.js';
import { getConfig } from '../modules/configuration/config.service.js';
import { presenceStats } from '../modules/leaderboard/leaderboard.service.js';
import { runtimeEnv } from './context.js';
import { Bio, StatusLines } from './ui/lore.js';
import type { StatusKind, StatusStats } from './ui/lore.js';

const ROTATE_MS = 10_000;
const STATS_MAX_AGE_MS = 60_000;

const TYPES: Record<StatusKind, ActivityType> = {
  watching: ActivityType.Watching,
  competing: ActivityType.Competing,
  playing: ActivityType.Playing,
  listening: ActivityType.Listening,
  custom: ActivityType.Custom,
};

let interval: NodeJS.Timeout | null = null;
let index = 0;
let stats: StatusStats = { liveMatches: 0, completedMatches: 0, players: 0, champion: null };
let statsAt = 0;

/** The server whose champion is shown: the configured one, or the only one the bot is in. */
function homeGuildId(client: Client<true>): string | null {
  const only = runtimeEnv().DISCORD_GUILD_ID;
  if (only) return only;
  return client.guilds.cache.size === 1 ? (client.guilds.cache.first()?.id ?? null) : null;
}

async function refreshStats(client: Client<true>): Promise<void> {
  if (Date.now() - statsAt < STATS_MAX_AGE_MS) return;
  statsAt = Date.now();
  const guildId = homeGuildId(client);
  const minMatches = guildId ? (await getConfig(guildId)).minLeaderboardMatches : 0;
  const s = await presenceStats(guildId, minMatches);
  stats = {
    liveMatches: s.liveMatches,
    completedMatches: s.completedMatches,
    players: s.players,
    champion: s.champion ? { name: s.champion.displayName, elo: s.champion.elo } : null,
  };
}

function toActivity(kind: StatusKind, text: string): ActivityOptions {
  const name = text.slice(0, 128);
  // Custom statuses show `state`; `name` is required but hidden.
  return kind === 'custom'
    ? { type: ActivityType.Custom, name: 'Custom Status', state: name }
    : { type: TYPES[kind], name };
}

async function rotate(client: Client<true>): Promise<void> {
  await refreshStats(client).catch((err: unknown) => log.warn('PRESENCE_STATS_FAILED', undefined, err));
  for (let tries = 0; tries < StatusLines.length; tries++) {
    const line = StatusLines[index % StatusLines.length]?.(stats) ?? null;
    index = (index + 1) % StatusLines.length;
    if (!line) continue;
    client.user.setPresence({ activities: [toActivity(line.kind, line.text)], status: 'online' });
    return;
  }
}

/** Keeps the profile "About Me" in sync with `Bio` (only writes when it differs). */
async function syncBio(client: Client<true>): Promise<void> {
  if (!Bio) return;
  const app = await client.application.fetch();
  if (app.description === Bio) return;
  await app.edit({ description: Bio.slice(0, 400) });
  log.info('BIO_UPDATED');
}

export function startPresence(client: Client<true>): void {
  if (interval) return;
  void rotate(client);
  interval = setInterval(() => void rotate(client), ROTATE_MS);
  void syncBio(client).catch((err: unknown) => log.warn('BIO_UPDATE_FAILED', undefined, err));
}

export function stopPresence(): void {
  if (interval) clearInterval(interval);
  interval = null;
}
