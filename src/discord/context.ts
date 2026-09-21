import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import type {
  BaseInteraction,
  Client,
  EmbedBuilder,
  Guild,
  GuildMember,
  InteractionReplyOptions,
  RepliableInteraction,
} from 'discord.js';
import type { GuildConfig } from '@prisma/client';
import { getConfig } from '../modules/configuration/config.service.js';
import type { PermissionLevel } from '../modules/permissions/permissions.js';
import { resolveLevel } from '../modules/permissions/permissions.js';
import type { Env } from '../config/env.js';
import type { Theme } from './ui/theme.js';

let env: Env | undefined;

export function setRuntimeEnv(value: Env): void {
  env = value;
}

export function runtimeEnv(): Env {
  if (!env) throw new Error('Runtime environment not initialised');
  return env;
}

export interface Ctx {
  guild: Guild;
  member: GuildMember;
  config: GuildConfig;
  level: PermissionLevel;
  theme: Theme;
}

export function themeFor(config: GuildConfig, client: Client): Theme {
  return { emojis: config.useEmojis, iconURL: client.user?.displayAvatarURL({ size: 128 }) ?? null };
}

export function levelOf(member: GuildMember, config: GuildConfig): PermissionLevel {
  return resolveLevel(
    {
      userId: member.id,
      roleIds: [...member.roles.cache.keys()],
      isGuildOwner: member.guild.ownerId === member.id,
      hasAdministrator: member.permissions.has(PermissionFlagsBits.Administrator),
    },
    config,
    runtimeEnv().ownerIds,
  );
}

export async function buildCtx(interaction: BaseInteraction<'cached'>): Promise<Ctx> {
  const config = await getConfig(interaction.guildId);
  const member = interaction.member;
  return {
    guild: interaction.guild,
    member,
    config,
    level: levelOf(member, config),
    theme: themeFor(config, interaction.client),
  };
}

export function identityOf(member: GuildMember) {
  return { discordId: member.id, username: member.user.username, displayName: member.displayName };
}

/** Replies ephemerally whatever state the interaction is in (fresh, deferred or already replied). */
export async function replyEphemeral(
  interaction: RepliableInteraction,
  payload: { embeds?: EmbedBuilder[]; content?: string; components?: InteractionReplyOptions['components'] },
): Promise<void> {
  const body = { ...payload, flags: MessageFlags.Ephemeral as const, allowedMentions: { parse: [] } };
  if (interaction.deferred || interaction.replied) await interaction.followUp(body);
  else await interaction.reply(body);
}
