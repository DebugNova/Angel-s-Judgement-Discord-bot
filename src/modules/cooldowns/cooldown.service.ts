import type { Tx } from '../../database/client.js';
import { db } from '../../database/client.js';

export const cooldownKeys = {
  pair: (pairKey: string) => `pair:${pairKey}`,
  user: (playerId: string) => `user:${playerId}`,
};

/** Order-independent key for a pair of player IDs. */
export function makePairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export async function setCooldown(tx: Tx, guildId: string, key: string, seconds: number): Promise<void> {
  if (seconds <= 0) return;
  const expiresAt = new Date(Date.now() + seconds * 1000);
  await tx.cooldown.upsert({
    where: { guildId_key: { guildId, key } },
    update: { expiresAt },
    create: { guildId, key, expiresAt },
  });
}

/** Returns the expiry of an active cooldown, or null when none is active. */
export async function activeCooldown(tx: Tx, guildId: string, key: string): Promise<Date | null> {
  const row = await tx.cooldown.findUnique({ where: { guildId_key: { guildId, key } } });
  return row && row.expiresAt > new Date() ? row.expiresAt : null;
}

export async function purgeExpiredCooldowns(): Promise<number> {
  const res = await db().cooldown.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  return res.count;
}
