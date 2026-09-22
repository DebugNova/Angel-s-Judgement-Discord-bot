import { ChannelType } from 'discord.js';
import type { Client, TextChannel, NewsChannel } from 'discord.js';
import { log } from '../../core/logger.js';
import { auditEvents } from '../../modules/audit/audit.service.js';
import type { AuditEntry } from '../../modules/audit/audit.service.js';
import { getConfig, updateConfig } from '../../modules/configuration/config.service.js';
import { topPlayers } from '../../modules/leaderboard/leaderboard.service.js';
import type { MatchView } from '../../modules/matches/match.types.js';
import type { FinalizeOutcome } from '../../modules/results/finalize.js';
import { themeFor } from '../context.js';
import {
  disputeNotificationEmbed,
  historyRecordEmbed,
  leaderboardPanelEmbed,
  logEmbed,
} from '../ui/embeds.js';
import { reviewNotificationButtons } from '../ui/components.js';

type Sendable = TextChannel | NewsChannel;

export async function sendableChannel(
  client: Client,
  guildId: string,
  channelId: string | null,
): Promise<Sendable | null> {
  if (!channelId) return null;
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return null;
  const ch = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
  if (!ch || (ch.type !== ChannelType.GuildText && ch.type !== ChannelType.GuildAnnouncement)) return null;
  return ch;
}

/** One compact public record per completed match. Never includes server links or evidence. */
export async function postHistoryRecord(client: Client, outcome: FinalizeOutcome): Promise<void> {
  const config = await getConfig(outcome.match.guildId);
  const channel = await sendableChannel(client, outcome.match.guildId, config.historyChannelId);
  if (!channel) return;
  await channel
    .send({ embeds: [historyRecordEmbed(themeFor(config, client), outcome)], allowedMentions: { parse: [] } })
    .catch((err: unknown) => log.warn('HISTORY_POST_FAILED', { matchId: outcome.match.matchId }, err));
}

/** Alerts referees in the staff channel. Returns false when no staff channel is configured. */
export async function notifyDispute(client: Client, match: MatchView): Promise<boolean> {
  const config = await getConfig(match.guildId);
  const channel = await sendableChannel(client, match.guildId, config.staffChannelId);
  if (!channel) return false;
  const roles = [...new Set([...config.refereeRoleIds, ...config.moderatorRoleIds])];
  await channel
    .send({
      content: roles.length > 0 ? roles.map((r) => `<@&${r}>`).join(' ') : undefined,
      embeds: [disputeNotificationEmbed(themeFor(config, client), match)],
      components: reviewNotificationButtons(themeFor(config, client), match.id),
      allowedMentions: { roles },
    })
    .catch((err: unknown) => log.warn('STAFF_NOTIFY_FAILED', { matchId: match.matchId }, err));
  return true;
}

// ───── Persistent leaderboard panel (edited in place, debounced) ─────

const lbTimers = new Map<string, NodeJS.Timeout>();

export function scheduleLeaderboardRefresh(client: Client, guildId: string, delayMs = 5_000): void {
  const existing = lbTimers.get(guildId);
  if (existing) clearTimeout(existing);
  lbTimers.set(
    guildId,
    setTimeout(() => {
      lbTimers.delete(guildId);
      void refreshLeaderboardPanel(client, guildId).catch((err: unknown) =>
        log.warn('LEADERBOARD_PANEL_FAILED', { guild: guildId }, err),
      );
    }, delayMs),
  );
}

export async function refreshLeaderboardPanel(client: Client, guildId: string): Promise<void> {
  const config = await getConfig(guildId);
  const channel = await sendableChannel(client, guildId, config.leaderboardChannelId);
  if (!channel) return;
  const top = await topPlayers(guildId, 10, config.minLeaderboardMatches);
  const payload = {
    embeds: [leaderboardPanelEmbed(themeFor(config, client), top, config.minLeaderboardMatches)],
    allowedMentions: { parse: [] },
  };
  if (config.leaderboardMessageId) {
    const edited = await channel.messages
      .edit(config.leaderboardMessageId, payload)
      .then(() => true)
      .catch(() => false);
    if (edited) return;
  }
  const sent = await channel.send(payload);
  await updateConfig(guildId, { leaderboardMessageId: sent.id });
}

// ───── Log channel mirror of the audit trail ─────

const logQueues = new Map<string, Promise<void>>();

export function startLogMirror(client: Client): void {
  auditEvents.on('entry', (entry: AuditEntry) => {
    // Moderation cases get a full case card from the mod-log instead (moderation/modlog.ts).
    if (entry.action.startsWith('MOD_')) return;
    const prev = logQueues.get(entry.guildId) ?? Promise.resolve();
    const next = prev
      .then(async () => {
        const config = await getConfig(entry.guildId);
        const channel = await sendableChannel(client, entry.guildId, config.logChannelId);
        if (!channel) return;
        await channel.send({
          embeds: [logEmbed(themeFor(config, client), entry)],
          allowedMentions: { parse: [] },
        });
      })
      .catch((err: unknown) =>
        log.warn('LOG_MIRROR_FAILED', { guild: entry.guildId, action: entry.action }, err),
      );
    logQueues.set(entry.guildId, next);
  });
}
