import type { GuildConfig, Prisma } from '@prisma/client';
import { db } from '../../database/client.js';

const TTL_MS = 30_000;
const cache = new Map<string, { value: GuildConfig; at: number }>();

/** Returns the guild's configuration, creating it with defaults on first use. */
export async function getConfig(guildId: string): Promise<GuildConfig> {
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = await db().guildConfig.upsert({ where: { guildId }, update: {}, create: { guildId } });
  cache.set(guildId, { value, at: Date.now() });
  return value;
}

export async function updateConfig(
  guildId: string,
  data: Prisma.GuildConfigUpdateInput,
): Promise<GuildConfig> {
  await getConfig(guildId);
  const value = await db().guildConfig.update({ where: { guildId }, data });
  cache.set(guildId, { value, at: Date.now() });
  return value;
}

export function invalidateConfig(guildId: string): void {
  cache.delete(guildId);
}
