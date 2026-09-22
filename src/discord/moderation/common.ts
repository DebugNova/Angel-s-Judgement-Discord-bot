import { randomBytes } from 'node:crypto';
import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import type {
  ChatInputCommandInteraction,
  EmbedBuilder,
  Guild,
  GuildMember,
  InteractionEditReplyOptions,
  PermissionResolvable,
  Role,
  User,
} from 'discord.js';
import { DomainError, isDomainError } from '../../core/errors.js';
import { log } from '../../core/logger.js';
import { hasModerationAccess } from '../../modules/permissions/permissions.js';
import type { MemberFacts, RoleFacts } from '../../modules/moderation/safety.js';
import type { Ctx } from '../context.js';
import { errorEmbed } from '../ui/embeds.js';

/** Only members holding a configured moderation role pass — nobody else, whatever their rank. */
export function requireModeration(ctx: Ctx): void {
  const roleIds = [...ctx.member.roles.cache.keys()];
  if (hasModerationAccess(roleIds, ctx.config)) return;
  const roles = ctx.config.moderationRoleIds;
  throw new DomainError(
    'NOT_MODERATOR',
    roles.length > 0
      ? `Moderation is reserved for ${roles.map((r) => `<@&${r}>`).join(' ')}.`
      : 'No moderation role has been chosen yet. The server owner can pick one with `/config roles level:moderation`.',
    'Moderators only',
  );
}

export function memberFacts(m: GuildMember): MemberFacts {
  return {
    id: m.id,
    topRolePosition: m.roles.highest.position,
    isGuildOwner: m.guild.ownerId === m.id,
    isAdministrator: m.permissions.has(PermissionFlagsBits.Administrator),
  };
}

const STAFF_POWERS: PermissionResolvable[] = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.MentionEveryone,
];

export function roleFacts(r: Role): RoleFacts {
  return {
    id: r.id,
    name: r.name,
    position: r.position,
    managed: r.managed,
    isEveryone: r.id === r.guild.id,
    dangerous: r.permissions.any(STAFF_POWERS),
  };
}

export async function botMember(guild: Guild): Promise<GuildMember> {
  return guild.members.me ?? guild.members.fetchMe();
}

/** Fresh copy of a member (roles may have changed since the command was typed); null if not in the server. */
export async function fetchMemberFresh(guild: Guild, userId: string): Promise<GuildMember | null> {
  return guild.members.fetch({ user: userId, force: true }).catch(() => null);
}

const PERMISSION_NAMES: Record<string, string> = {
  BanMembers: 'Ban Members',
  KickMembers: 'Kick Members',
  ModerateMembers: 'Timeout Members',
  ManageRoles: 'Manage Roles',
  ManageMessages: 'Manage Messages',
  ManageChannels: 'Manage Channels',
  ManageThreads: 'Manage Threads',
  ReadMessageHistory: 'Read Message History',
  ViewChannel: 'View Channels',
  SendMessages: 'Send Messages',
};

export type PermName = keyof typeof PermissionFlagsBits;

/** Friendly error when the bot itself lacks a Discord permission (server-wide or in one channel). */
export function assertBotCan(
  have: { has: (bit: bigint) => boolean } | null,
  perms: readonly PermName[],
  where?: string,
): void {
  const missing = perms.filter((p) => !have?.has(PermissionFlagsBits[p]));
  if (missing.length === 0) return;
  const names = missing.map((p) => `**${PERMISSION_NAMES[p] ?? p}**`).join(', ');
  const them = missing.length > 1 ? 'them' : 'it';
  const fix = where
    ? `Fix: open the channel's settings → Permissions → my role → allow ${them}.`
    : `Fix: Server Settings → Roles → my role → turn ${them} on.`;
  throw new DomainError(
    'BOT_PERMISSIONS',
    `I'm missing ${names}${where ? ` ${where}` : ''}.\n${fix}`,
    'I need a permission',
  );
}

/** Sends the member a DM. Returns false when their DMs are closed (never throws). */
export async function tryDm(target: User, embed: EmbedBuilder): Promise<boolean> {
  if (target.bot) return false;
  return target
    .send({ embeds: [embed] })
    .then(() => true)
    .catch(() => false);
}

/** "moderator: reason" for Discord's own audit log (max 512 characters). */
export function auditReason(actor: User, reason: string | null): string {
  return `${actor.username}: ${reason ?? 'no reason given'}`.slice(0, 512);
}

export function cleanReason(raw: string | null): string | null {
  const r = raw?.trim();
  return r ? r.slice(0, 500) : null;
}

// ───── Pending confirmations (in memory; a restart simply expires them) ─────

export interface Pending {
  guildId: string;
  userId: string;
  expiresAt: number;
  /** Runs with the context of the click, so the moderator is re-checked as they are right now. */
  run: (ctx: Ctx) => Promise<EmbedBuilder>;
}

const PENDING_TTL_MS = 120_000;
const pending = new Map<string, Pending>();

export function addPending(p: Omit<Pending, 'expiresAt'>): string {
  const now = Date.now();
  for (const [k, v] of pending) if (v.expiresAt < now) pending.delete(k);
  const token = randomBytes(6).toString('base64url');
  pending.set(token, { ...p, expiresAt: now + PENDING_TTL_MS });
  return token;
}

/** Looks a request up without consuming it (used to check ownership before acting). */
export function peekPending(token: string): Pending | null {
  const p = pending.get(token);
  if (!p || p.expiresAt < Date.now()) {
    pending.delete(token);
    return null;
  }
  return p;
}

/** Removes the request, so a double click can never run it twice. */
export function takePending(token: string): Pending | null {
  const p = peekPending(token);
  pending.delete(token);
  return p;
}

export interface Reply {
  embeds: EmbedBuilder[];
  components?: InteractionEditReplyOptions['components'];
}

/**
 * Runs a moderation command with a private "thinking…" reply, and turns rule violations into a
 * friendly error in that same reply (instead of leaving it stuck on "thinking").
 */
export async function runPrivately(
  i: ChatInputCommandInteraction<'cached'>,
  ctx: Ctx,
  fn: () => Promise<Reply>,
): Promise<void> {
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const out = await fn();
    await i.editReply({ ...out, allowedMentions: { parse: [] } });
  } catch (err) {
    await i
      .editReply({ embeds: [friendlyError(ctx, err, i.commandName)], components: [] })
      .catch((e: unknown) => log.debug('MOD_ERROR_REPLY_FAILED', { error: String(e) }));
  }
}

/** A DomainError as-is; anything else is logged in full and shown as a generic message. */
export function friendlyError(ctx: Ctx, err: unknown, what: string): EmbedBuilder {
  if (isDomainError(err)) return errorEmbed(ctx.theme, err.title, err.message);
  log.error('MODERATION_FAILED', { action: what, guild: ctx.guild.id, user: ctx.member.id }, err);
  return errorEmbed(
    ctx.theme,
    'Something went wrong',
    'Discord refused or the action failed. Nothing was recorded. The error has been logged for the staff.',
  );
}
