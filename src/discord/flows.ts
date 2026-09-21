import type { Client, Guild } from 'discord.js';
import type { GuildConfig } from '@prisma/client';
import { DomainError } from '../core/errors.js';
import { log } from '../core/logger.js';
import type { ChallengeWithPlayers } from '../modules/challenges/challenge.service.js';
import { getConfig } from '../modules/configuration/config.service.js';
import { abortMatch, activateMatch, getMatch } from '../modules/matches/match.service.js';
import type { MatchView } from '../modules/matches/match.types.js';
import type { FinalizeOutcome } from '../modules/results/finalize.js';
import { themeFor } from './context.js';
import { createMatchChannel, fetchMessageChannel, lockMatchChannel } from './managers/channels.js';
import { postHistoryRecord, scheduleLeaderboardRefresh } from './managers/notify.js';
import { forgetPanel, refreshPanel } from './managers/panel.js';
import { challengeEmbed } from './ui/embeds.js';
import type { ChallengeState } from './ui/embeds.js';
import { challengeButtons } from './ui/components.js';
import { ts } from './ui/theme.js';

/**
 * Second half of accepting a challenge: the match row exists (ACCEPTED); create its private channel,
 * activate it and post the panel. If the channel cannot be created, the match is rolled back so
 * neither player is left stuck.
 */
export async function openMatchRoom(
  client: Client,
  guild: Guild,
  config: GuildConfig,
  matchId: string,
): Promise<MatchView> {
  const match = await getMatch(matchId);
  if (!match) throw new DomainError('STALE', 'The match could not be found.');
  let channel;
  try {
    channel = await createMatchChannel(guild, config, {
      matchNumber: match.matchNumber,
      matchId: match.matchId,
      challengerDiscordId: match.challenger.discordId,
      opponentDiscordId: match.opponent.discordId,
      label: `${match.challenger.displayName} vs ${match.opponent.displayName}`,
    });
  } catch (err) {
    log.error('MATCH_CHANNEL_CREATE_FAILED', { matchId: match.matchId }, err);
    await abortMatch(match.id, 'Match channel could not be created');
    if (err instanceof DomainError) throw err;
    throw new DomainError(
      'CHANNEL_FAILED',
      'I could not create the private match channel, so the match was called off.\nPlease ask an admin to check my permissions in the match category.',
      'Unable to start the match',
    );
  }
  const active = await activateMatch(match.id, {
    id: channel.id,
    name: channel.name,
    categoryId: channel.parentId,
  });
  await refreshPanel(client, active.id, {
    bump: true,
    content: `<@${active.challenger.discordId}> <@${active.opponent.discordId}> — your arena is ready.`,
    mentionUsers: [active.challenger.discordId, active.opponent.discordId],
  });
  return active;
}

/** Everything that happens after a result becomes official. Each step is best-effort and logged. */
export async function afterFinalize(client: Client, outcome: FinalizeOutcome): Promise<void> {
  const { match } = outcome;
  await lockMatchChannel(client, match);
  const archive = match.cleanupAt ? ` This channel will be archived ${ts(match.cleanupAt, 'R')}.` : '';
  await refreshPanel(client, match.id, {
    bump: true,
    content: `<@${match.challenger.discordId}> <@${match.opponent.discordId}> — the match is complete.${archive}`,
    mentionUsers: [match.challenger.discordId, match.opponent.discordId],
  });
  forgetPanel(match.id);
  await postHistoryRecord(client, outcome);
  scheduleLeaderboardRefresh(client, match.guildId);
}

export async function afterCancel(client: Client, match: MatchView): Promise<void> {
  await lockMatchChannel(client, match);
  const archive = match.cleanupAt ? ` This channel will be archived ${ts(match.cleanupAt, 'R')}.` : '';
  await refreshPanel(client, match.id, {
    bump: true,
    content: `<@${match.challenger.discordId}> <@${match.opponent.discordId}> — the match was cancelled.${archive}`,
    mentionUsers: [match.challenger.discordId, match.opponent.discordId],
  });
  forgetPanel(match.id);
}

/** Updates the public challenge message to a final state. Best effort: the message may be gone. */
export async function editChallengeMessage(
  client: Client,
  challenge: ChallengeWithPlayers,
  state: ChallengeState,
  extra: { matchDisplayId?: string; channelId?: string } = {},
): Promise<void> {
  if (!challenge.channelId || !challenge.messageId) return;
  const channel = await fetchMessageChannel(client, challenge.channelId);
  if (!channel) return;
  const config = await getConfig(challenge.guildId);
  const theme = themeFor(config, client);
  await channel.messages
    .edit(challenge.messageId, {
      content: '',
      embeds: [challengeEmbed(theme, challenge, state, extra)],
      components: state === 'PENDING' ? challengeButtons(theme, challenge.id) : [],
    })
    .catch((err: unknown) => log.warn('CHALLENGE_MESSAGE_EDIT_FAILED', { challenge: challenge.id }, err));
}
