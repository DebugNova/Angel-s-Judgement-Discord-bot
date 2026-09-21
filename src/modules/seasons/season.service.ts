import type { Season } from '@prisma/client';
import { db } from '../../database/client.js';
import { DomainError } from '../../core/errors.js';
import { AuditAction, audit } from '../audit/audit.service.js';
import { invalidateConfig } from '../configuration/config.service.js';

/**
 * Season groundwork. Matches record the active season so separate seasonal rankings can be built
 * later without migrating data. Starting a season ends the previous one.
 */
export async function startSeason(guildId: string, name: string, actorDiscordId: string): Promise<Season> {
  const season = await db().$transaction(async (tx) => {
    await tx.season.updateMany({
      where: { guildId, status: 'ACTIVE' },
      data: { status: 'ENDED', endDate: new Date() },
    });
    const last = await tx.season.findFirst({ where: { guildId }, orderBy: { number: 'desc' } });
    const created = await tx.season.create({ data: { guildId, name, number: (last?.number ?? 0) + 1 } });
    await tx.guildConfig.upsert({
      where: { guildId },
      update: { activeSeasonId: created.id },
      create: { guildId, activeSeasonId: created.id },
    });
    return created;
  });
  invalidateConfig(guildId);
  await audit({
    guildId,
    actorId: actorDiscordId,
    action: AuditAction.SEASON_STARTED,
    metadata: { season: season.name, number: season.number },
  });
  return season;
}

export async function endSeason(guildId: string, actorDiscordId: string): Promise<Season> {
  const active = await currentSeason(guildId);
  if (!active) throw new DomainError('NO_SEASON', 'There is no active season.', 'No active season');
  const ended = await db().$transaction(async (tx) => {
    const s = await tx.season.update({
      where: { id: active.id },
      data: { status: 'ENDED', endDate: new Date() },
    });
    await tx.guildConfig.update({ where: { guildId }, data: { activeSeasonId: null } });
    return s;
  });
  invalidateConfig(guildId);
  await audit({
    guildId,
    actorId: actorDiscordId,
    action: AuditAction.SEASON_ENDED,
    metadata: { season: ended.name },
  });
  return ended;
}

export async function currentSeason(guildId: string): Promise<Season | null> {
  return db().season.findFirst({ where: { guildId, status: 'ACTIVE' }, orderBy: { number: 'desc' } });
}
