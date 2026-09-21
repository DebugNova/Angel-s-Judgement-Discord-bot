import { RESTJSONErrorCodes } from 'discord.js';
import type { Client } from 'discord.js';
import { log } from '../../core/logger.js';
import { getConfig } from '../../modules/configuration/config.service.js';
import { getMatch, setPanelMessage } from '../../modules/matches/match.service.js';
import { themeFor } from '../context.js';
import { matchPanelEmbed } from '../ui/embeds.js';
import { panelButtons } from '../ui/components.js';
import { fetchTextChannel } from './channels.js';

export interface PanelOptions {
  /** Re-post the panel as the newest message instead of editing it in place. */
  bump?: boolean;
  /** Text shown above the panel when (re)posted — used to ping the players that must act. */
  content?: string;
  mentionUsers?: string[];
  mentionRoles?: string[];
}

// Per-match queue so concurrent updates never interleave (e.g. two quick button presses).
const queues = new Map<string, Promise<void>>();
const lastBump = new Map<string, number>();
const activity = new Map<string, { count: number; timer: NodeJS.Timeout | null }>();

const STICKY_MIN_MESSAGES = 4;
const STICKY_QUIET_MS = 6_000;
const STICKY_COOLDOWN_MS = 20_000;
const STICKY_STATUSES = new Set(['ACTIVE', 'RESULT_PENDING', 'DISPUTED', 'UNDER_REVIEW']);

function enqueue(matchId: string, task: () => Promise<void>): Promise<void> {
  const prev = queues.get(matchId) ?? Promise.resolve();
  const next = prev
    .then(task, task)
    .catch((err: unknown) => log.error('PANEL_UPDATE_FAILED', { match: matchId }, err));
  queues.set(matchId, next);
  void next.finally(() => {
    if (queues.get(matchId) === next) queues.delete(matchId);
  });
  return next;
}

/**
 * Keeps one persistent status panel per match channel. Normally the existing message is edited;
 * on important state changes it is re-posted so the current controls stay at the bottom.
 * The database always holds the panel's message ID, so this survives restarts.
 */
export function refreshPanel(client: Client, matchId: string, opts: PanelOptions = {}): Promise<void> {
  return enqueue(matchId, async () => {
    const match = await getMatch(matchId);
    if (!match?.channelId || match.channelDeletedAt) return;
    const channel = await fetchTextChannel(client, match.guildId, match.channelId);
    if (!channel) return;
    const config = await getConfig(match.guildId);
    const theme = themeFor(config, client);
    const embeds = [matchPanelEmbed(theme, match, config)];
    const components = panelButtons(theme, match);

    if (!opts.bump && match.panelMessageId) {
      try {
        await channel.messages.edit(match.panelMessageId, { embeds, components });
        return;
      } catch (err) {
        if ((err as { code?: number }).code !== RESTJSONErrorCodes.UnknownMessage) throw err;
      }
    }

    const sent = await channel.send({
      ...(opts.content ? { content: opts.content } : {}),
      embeds,
      components,
      allowedMentions: { users: opts.mentionUsers ?? [], roles: opts.mentionRoles ?? [] },
    });
    await setPanelMessage(match.id, sent.id);
    lastBump.set(match.id, Date.now());
    activity.delete(match.id);
    if (match.panelMessageId && match.panelMessageId !== sent.id) {
      await channel.messages.delete(match.panelMessageId).catch(() => undefined);
    }
  });
}

/**
 * Sticky panel: after a burst of chat in a live match channel, re-post the panel so the controls
 * stay the latest message. Debounced and rate-limited — never loops (bot messages are ignored).
 */
export function noteChannelActivity(client: Client, matchId: string, status: string, enabled: boolean): void {
  if (!enabled || !STICKY_STATUSES.has(status)) return;
  const state = activity.get(matchId) ?? { count: 0, timer: null };
  state.count += 1;
  if (state.timer) clearTimeout(state.timer);
  const fire = () => {
    const current = activity.get(matchId);
    if (!current || current.count < STICKY_MIN_MESSAGES) return;
    const wait = STICKY_COOLDOWN_MS - (Date.now() - (lastBump.get(matchId) ?? 0));
    if (wait > 0) {
      current.timer = setTimeout(fire, wait);
      return;
    }
    activity.delete(matchId);
    void refreshPanel(client, matchId, { bump: true });
  };
  state.timer = setTimeout(fire, STICKY_QUIET_MS);
  activity.set(matchId, state);
}

export function forgetPanel(matchId: string): void {
  const state = activity.get(matchId);
  if (state?.timer) clearTimeout(state.timer);
  activity.delete(matchId);
  lastBump.delete(matchId);
}
