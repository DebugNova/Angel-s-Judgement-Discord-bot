import {
  ChannelType,
  OverwriteType,
  PermissionFlagsBits,
  RESTJSONErrorCodes,
  PermissionsBitField,
} from 'discord.js';
import type {
  CategoryChannel,
  Client,
  Guild,
  GuildMember,
  GuildTextBasedChannel,
  OverwriteResolvable,
  TextChannel,
} from 'discord.js';
import type { GuildConfig } from '@prisma/client';
import { DomainError } from '../../core/errors.js';
import { log } from '../../core/logger.js';
import { formatChannelName } from '../../modules/matches/match.types.js';
import { Brand } from '../ui/lore.js';
import type { MatchView } from '../../modules/matches/match.types.js';

const PLAYER_ALLOW = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AddReactions,
];

const BOT_ALLOW = [...PLAYER_ALLOW, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages];

/** Everything the bot needs inside the match category (Manage Roles is needed to write channel overwrites). */
export const REQUIRED_CATEGORY_PERMISSIONS = [...BOT_ALLOW, PermissionFlagsBits.ManageRoles];

/** Tracks channel IDs that belong to matches, so message handling can skip everything else cheaply. */
export const matchChannelIds = new Set<string>();

export function permissionNames(bits: bigint[]): string[] {
  return new PermissionsBitField(bits).toArray().map((n) => n.replace(/([a-z])([A-Z])/g, '$1 $2'));
}

/** Validates the configured category and the bot's permissions in it. Throws a readable error. */
export async function resolveMatchCategory(guild: Guild, config: GuildConfig): Promise<CategoryChannel> {
  if (!config.matchCategoryId) {
    throw new DomainError(
      'NO_CATEGORY',
      'The match category has not been configured yet.\nAn admin must run `/config channel matches` first.',
      'Arena not ready',
    );
  }
  const channel =
    guild.channels.cache.get(config.matchCategoryId) ??
    (await guild.channels.fetch(config.matchCategoryId).catch(() => null));
  if (!channel || channel.type !== ChannelType.GuildCategory) {
    throw new DomainError(
      'CATEGORY_MISSING',
      'The configured match category no longer exists.\nAn admin must run `/config channel matches` again.',
      'Arena not ready',
    );
  }
  const me = guild.members.me ?? (await guild.members.fetchMe());
  const missing = channel.permissionsFor(me).missing(REQUIRED_CATEGORY_PERMISSIONS);
  if (missing.length > 0) {
    throw new DomainError(
      'BOT_PERMISSIONS',
      `I am missing permissions in the match category: **${missing.map((m) => m.replace(/([a-z])([A-Z])/g, '$1 $2')).join(', ')}**.\nAn admin must grant them before matches can start.`,
      'Arena not ready',
    );
  }
  if (channel.children.cache.size >= 50) {
    throw new DomainError(
      'CATEGORY_FULL',
      'The match category is full (Discord allows 50 channels per category).\nPlease try again once a match channel is archived.',
      'Arena full',
    );
  }
  return channel;
}

export async function fetchMember(guild: Guild, id: string): Promise<GuildMember | null> {
  return guild.members.cache.get(id) ?? (await guild.members.fetch(id).catch(() => null));
}

export function staffRoleIds(guild: Guild, config: GuildConfig): string[] {
  return [...new Set([...config.refereeRoleIds, ...config.moderatorRoleIds, ...config.adminRoleIds])].filter(
    (id) => guild.roles.cache.has(id),
  );
}

/**
 * Creates the private match channel. Only the two players, configured staff roles and the bot can
 * see it; @everyone is denied through a permission overwrite.
 */
export async function createMatchChannel(
  guild: Guild,
  config: GuildConfig,
  match: {
    matchNumber: number;
    matchId: string;
    challengerDiscordId: string;
    opponentDiscordId: string;
    label: string;
  },
): Promise<TextChannel> {
  const category = await resolveMatchCategory(guild, config);
  const me = guild.members.me ?? (await guild.members.fetchMe());
  const overwrites: OverwriteResolvable[] = [
    { id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
    { id: me.id, type: OverwriteType.Member, allow: BOT_ALLOW },
    { id: match.challengerDiscordId, type: OverwriteType.Member, allow: PLAYER_ALLOW },
    { id: match.opponentDiscordId, type: OverwriteType.Member, allow: PLAYER_ALLOW },
    ...staffRoleIds(guild, config).map((id) => ({ id, type: OverwriteType.Role, allow: PLAYER_ALLOW })),
  ];
  const channel = await guild.channels.create({
    name: formatChannelName(config.channelPrefix, match.matchNumber),
    type: ChannelType.GuildText,
    parent: category.id,
    topic: `${match.matchId} • ${match.label} • ${Brand.channelTopic}`,
    permissionOverwrites: overwrites,
    reason: `Seven Angels match ${match.matchId}`,
  });
  matchChannelIds.add(channel.id);
  return channel;
}

export async function fetchTextChannel(
  client: Client,
  guildId: string,
  channelId: string,
): Promise<TextChannel | null> {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return null;
  const channel =
    guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
  return channel && channel.type === ChannelType.GuildText ? channel : null;
}

/** Any guild channel that holds messages (text, announcement, thread, voice chat). */
export async function fetchMessageChannel(
  client: Client,
  channelId: string,
): Promise<GuildTextBasedChannel | null> {
  const channel =
    client.channels.cache.get(channelId) ?? (await client.channels.fetch(channelId).catch(() => null));
  return channel && channel.isTextBased() && !channel.isDMBased() ? channel : null;
}

/** Players keep read access after the match but can no longer post. Best effort. */
export async function lockMatchChannel(client: Client, match: MatchView): Promise<void> {
  if (!match.channelId) return;
  const channel = await fetchTextChannel(client, match.guildId, match.channelId);
  if (!channel) return;
  for (const p of [match.challenger, match.opponent]) {
    await channel.permissionOverwrites
      .edit(
        p.discordId,
        { SendMessages: false, AddReactions: false },
        { reason: `Match ${match.matchId} finished` },
      )
      .catch((err: unknown) => log.warn('CHANNEL_LOCK_FAILED', { matchId: match.matchId }, err));
  }
}

/** Deletes a match channel. Returns true when the channel is gone (including "already deleted"). */
export async function deleteMatchChannel(
  client: Client,
  guildId: string,
  channelId: string,
  reason: string,
): Promise<boolean> {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return false;
  try {
    await guild.channels.delete(channelId, reason);
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code !== RESTJSONErrorCodes.UnknownChannel) {
      log.warn('CHANNEL_DELETE_FAILED', { channelId }, err);
      return false;
    }
  }
  matchChannelIds.delete(channelId);
  return true;
}
