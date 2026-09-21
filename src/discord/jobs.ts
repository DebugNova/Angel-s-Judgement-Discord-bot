import { ChannelType } from 'discord.js';
import type { ChatInputCommandInteraction, Client, Guild } from 'discord.js';
import { log } from '../core/logger.js';
import { RateLimiter } from '../core/rate-limiter.js';
import { AuditAction, audit, SYSTEM_ACTOR } from '../modules/audit/audit.service.js';
import {
  expireChallenge,
  listOverdueChallenges,
  listPendingChallenges,
} from '../modules/challenges/challenge.service.js';
import { purgeExpiredCooldowns } from '../modules/cooldowns/cooldown.service.js';
import { getConfig } from '../modules/configuration/config.service.js';
import {
  claimChannelDeletion,
  knownChannelIds,
  listDueCleanups,
  listLiveMatchesWithChannels,
  listStuckAcceptedMatches,
  replaceChannel,
} from '../modules/matches/match.service.js';
import { themeFor } from './context.js';
import { editChallengeMessage, openMatchRoom } from './flows.js';
import {
  createMatchChannel,
  deleteMatchChannel,
  fetchTextChannel,
  matchChannelIds,
} from './managers/channels.js';
import { refreshLeaderboardPanel } from './managers/notify.js';
import { forgetPanel, refreshPanel } from './managers/panel.js';
import { challengeEmbed } from './ui/embeds.js';

export const commandLimiter = new RateLimiter();

// ───── Challenge expiry ─────

const timers = new Map<string, NodeJS.Timeout>();
/** The slash-command interaction behind a challenge; lets us edit the message even without channel access. */
const origins = new Map<string, ChatInputCommandInteraction<'cached'>>();

export function rememberChallengeOrigin(
  challengeId: string,
  interaction: ChatInputCommandInteraction<'cached'>,
): void {
  origins.set(challengeId, interaction);
}

export function scheduleChallengeExpiry(client: Client, challengeId: string, expiresAt: Date): void {
  clearChallengeTimer(challengeId);
  const delay = Math.max(0, expiresAt.getTime() - Date.now()) + 500;
  timers.set(
    challengeId,
    setTimeout(
      () => {
        timers.delete(challengeId);
        void expireAndAnnounce(client, challengeId);
      },
      Math.min(delay, 2_147_000_000),
    ),
  );
}

export function clearChallengeTimer(challengeId: string): void {
  const t = timers.get(challengeId);
  if (t) clearTimeout(t);
  timers.delete(challengeId);
  origins.delete(challengeId);
}

async function expireAndAnnounce(client: Client, challengeId: string): Promise<void> {
  try {
    const challenge = await expireChallenge(challengeId);
    const origin = origins.get(challengeId);
    origins.delete(challengeId);
    if (!challenge) return;
    const config = await getConfig(challenge.guildId);
    const theme = themeFor(config, client);
    // Interaction tokens are valid for 15 minutes; prefer them, fall back to a channel edit.
    if (origin && Date.now() - origin.createdTimestamp < 14 * 60_000) {
      const ok = await origin
        .editReply({ content: '', embeds: [challengeEmbed(theme, challenge, 'EXPIRED')], components: [] })
        .then(() => true)
        .catch(() => false);
      if (ok) return;
    }
    await editChallengeMessage(client, challenge, 'EXPIRED');
  } catch (err) {
    log.error('CHALLENGE_EXPIRY_FAILED', { challenge: challengeId }, err);
  }
}

// ───── Periodic sweep (backs up timers; restart-safe because it reads the database) ─────

let sweeping = false;
let sweepCount = 0;

async function sweep(client: Client): Promise<void> {
  if (sweeping) return;
  sweeping = true;
  try {
    for (const { id } of await listOverdueChallenges()) await expireAndAnnounce(client, id);

    for (const match of await listDueCleanups()) {
      if (!client.guilds.cache.has(match.guildId) || !match.channelId) continue;
      const gone = await deleteMatchChannel(
        client,
        match.guildId,
        match.channelId,
        `Match ${match.matchId} archived`,
      );
      if (gone && (await claimChannelDeletion(match.id))) {
        forgetPanel(match.id);
        await audit({
          guildId: match.guildId,
          actorId: SYSTEM_ACTOR,
          action: AuditAction.CHANNEL_DELETED,
          matchId: match.matchId,
          metadata: { channel: match.channelName ?? match.channelId },
        });
      }
    }

    // A crash between "match created" and "channel created" leaves an ACCEPTED match: finish opening it.
    for (const stuck of await listStuckAcceptedMatches(new Date(Date.now() - 60_000))) {
      const guild = client.guilds.cache.get(stuck.guildId);
      if (!guild) continue;
      log.warn('MATCH_RECOVERING_ACCEPTED', { matchId: stuck.matchId });
      await openMatchRoom(client, guild, await getConfig(guild.id), stuck.id).catch((err: unknown) =>
        log.warn('MATCH_RECOVERY_FAILED', { matchId: stuck.matchId }, err),
      );
    }

    sweepCount += 1;
    if (sweepCount % 30 === 0) {
      await purgeExpiredCooldowns();
      commandLimiter.sweep();
    }
  } catch (err) {
    log.error('SWEEP_FAILED', undefined, err);
  } finally {
    sweeping = false;
  }
}

let interval: NodeJS.Timeout | null = null;

export function startScheduler(client: Client): void {
  if (interval) return;
  interval = setInterval(() => void sweep(client), 20_000);
  void sweep(client);
}

export function stopScheduler(): void {
  if (interval) clearInterval(interval);
  interval = null;
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
}

// ───── Startup recovery ─────

/**
 * Rebuilds runtime state from the database after a (re)start: re-arms challenge timers, verifies
 * every live match channel still exists (recreating it if it was deleted), refreshes panels and
 * reports orphaned channels. Nothing is ever deleted automatically here.
 */
export async function recoverGuild(client: Client, guild: Guild): Promise<void> {
  const config = await getConfig(guild.id);

  for (const match of await listLiveMatchesWithChannels(guild.id)) {
    const channel = await fetchTextChannel(client, guild.id, match.channelId!);
    if (channel) {
      matchChannelIds.add(channel.id);
      await refreshPanel(client, match.id);
      continue;
    }
    log.warn('MATCH_CHANNEL_MISSING', { matchId: match.matchId, channel: match.channelId ?? undefined });
    try {
      const created = await createMatchChannel(guild, config, {
        matchNumber: match.matchNumber,
        matchId: match.matchId,
        challengerDiscordId: match.challenger.discordId,
        opponentDiscordId: match.opponent.discordId,
        label: `${match.challenger.displayName} vs ${match.opponent.displayName}`,
      });
      await replaceChannel(match.id, { id: created.id, name: created.name, categoryId: created.parentId });
      await refreshPanel(client, match.id, {
        bump: true,
        content: `<@${match.challenger.discordId}> <@${match.opponent.discordId}> — your match channel was restored.`,
        mentionUsers: [match.challenger.discordId, match.opponent.discordId],
      });
      await audit({
        guildId: guild.id,
        actorId: SYSTEM_ACTOR,
        action: AuditAction.CHANNEL_RECREATED,
        matchId: match.matchId,
      });
    } catch (err) {
      log.error('MATCH_CHANNEL_RESTORE_FAILED', { matchId: match.matchId }, err);
      await audit({
        guildId: guild.id,
        actorId: SYSTEM_ACTOR,
        action: AuditAction.ORPHAN_DETECTED,
        matchId: match.matchId,
        metadata: { issue: 'Match is live but its channel is missing and could not be recreated' },
      });
    }
  }

  // Channels inside the match category that no match knows about: report only, never delete.
  if (config.matchCategoryId) {
    const known = await knownChannelIds(guild.id);
    const orphans = guild.channels.cache.filter(
      (c) =>
        c.parentId === config.matchCategoryId &&
        c.type === ChannelType.GuildText &&
        !known.has(c.id) &&
        ![
          config.historyChannelId,
          config.leaderboardChannelId,
          config.staffChannelId,
          config.logChannelId,
        ].includes(c.id),
    );
    for (const orphan of orphans.values()) {
      await audit({
        guildId: guild.id,
        actorId: SYSTEM_ACTOR,
        action: AuditAction.ORPHAN_DETECTED,
        metadata: { issue: 'Channel in the match category has no match record', channel: `#${orphan.name}` },
      });
    }
  }

  await refreshLeaderboardPanel(client, guild.id).catch((err: unknown) =>
    log.warn('LEADERBOARD_PANEL_FAILED', { guild: guild.id }, err),
  );
}

export async function rearmChallengeTimers(client: Client): Promise<void> {
  for (const c of await listPendingChallenges()) {
    scheduleChallengeExpiry(client, c.id, c.expiresAt);
  }
}
