/**
 * Every moderation action, as plain functions: re-check the rules → act on Discord → DM → record
 * the case. Slash commands and Confirm buttons both call these, so the checks can't be skipped.
 */
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import type { EmbedBuilder, GuildMember, GuildTextBasedChannel, User } from 'discord.js';
import { DomainError } from '../../core/errors.js';
import { memberRecord, recordCase, lastOpenLock, closeLock } from '../../modules/moderation/cases.service.js';
import type { ModAction } from '../../modules/moderation/cases.service.js';
import { formatDuration } from '../../modules/moderation/duration.js';
import {
  describePurgeFilter,
  purgeVerdict,
  BULK_DELETE_MAX_AGE_MS,
} from '../../modules/moderation/filters.js';
import type { PurgeFilter } from '../../modules/moderation/filters.js';
import { assertCanActOn, assertCanManageRole } from '../../modules/moderation/safety.js';
import type { MemberAction } from '../../modules/moderation/safety.js';
import type { Ctx } from '../context.js';
import { dmEmbed, doneEmbed, lockNoticeEmbed } from '../ui/moderation.js';
import { user } from '../ui/theme.js';
import {
  assertBotCan,
  auditReason,
  botMember,
  fetchMemberFresh,
  memberFacts,
  roleFacts,
  tryDm,
} from './common.js';
import type { PermName } from './common.js';

function notInServer(targetId: string): DomainError {
  return new DomainError('NOT_MEMBER', `${user(targetId)} is not in this server.`, 'Member not found');
}

/** Loads the bot and the target fresh and applies the safety rules. */
async function checkTarget(
  ctx: Ctx,
  action: MemberAction,
  targetId: string,
): Promise<{ me: GuildMember; target: GuildMember | null }> {
  const me = await botMember(ctx.guild);
  const target = await fetchMemberFresh(ctx.guild, targetId);
  assertCanActOn({
    action,
    actor: memberFacts(ctx.member),
    target: target ? memberFacts(target) : null,
    targetId,
    bot: memberFacts(me),
    guildOwnerId: ctx.guild.ownerId,
  });
  return { me, target };
}

async function dmIf(
  ctx: Ctx,
  wanted: boolean,
  target: User,
  action: ModAction,
  reason: string | null,
  durationSec?: number,
) {
  if (!wanted || target.bot) return null;
  return tryDm(target, dmEmbed(ctx.theme, { action, guildName: ctx.guild.name, reason, durationSec }));
}

function dmNote(sent: boolean | null): string {
  return sent === true
    ? '\nThey were told by DM.'
    : sent === false
      ? '\nTheir DMs are closed, so they were not told.'
      : '';
}

export interface MemberInput {
  targetId: string;
  reason: string | null;
  dm: boolean;
}

// ───── Warn ─────

export async function warnMember(ctx: Ctx, input: MemberInput): Promise<EmbedBuilder> {
  const { target } = await checkTarget(ctx, 'warn', input.targetId);
  if (!target) throw notInServer(input.targetId);
  const dmSent = await dmIf(ctx, input.dm, target.user, 'WARN', input.reason);
  const c = await recordCase({
    guildId: ctx.guild.id,
    action: 'WARN',
    moderatorId: ctx.member.id,
    targetId: target.id,
    targetName: target.user.username,
    reason: input.reason,
    dmSent,
  });
  const rec = await memberRecord(ctx.guild.id, target.id, 0, 1);
  return doneEmbed(
    ctx.theme,
    c,
    `${user(target.id)} was warned. They now have **${rec.activeWarnings}** active warning${rec.activeWarnings === 1 ? '' : 's'}.${dmNote(dmSent)}`,
  );
}

// ───── Timeout ─────

export async function timeoutMember(
  ctx: Ctx,
  input: MemberInput & { durationSec: number },
): Promise<EmbedBuilder> {
  const { me, target } = await checkTarget(ctx, 'timeout', input.targetId);
  if (!target) throw notInServer(input.targetId);
  assertBotCan(me.permissions, ['ModerateMembers']);
  if (!target.moderatable) {
    throw new DomainError(
      'MOD_REFUSED',
      `Discord won't let me time out ${user(target.id)}.`,
      'Action refused',
    );
  }
  await target.timeout(input.durationSec * 1000, auditReason(ctx.member.user, input.reason));
  const dmSent = await dmIf(ctx, input.dm, target.user, 'TIMEOUT', input.reason, input.durationSec);
  const until = Date.now() + input.durationSec * 1000;
  const c = await recordCase({
    guildId: ctx.guild.id,
    action: 'TIMEOUT',
    moderatorId: ctx.member.id,
    targetId: target.id,
    targetName: target.user.username,
    reason: input.reason,
    durationSec: input.durationSec,
    details: { until },
    dmSent,
  });
  return doneEmbed(
    ctx.theme,
    c,
    `${user(target.id)} is timed out for **${formatDuration(input.durationSec)}** (until <t:${Math.floor(until / 1000)}:f>).${dmNote(dmSent)}`,
  );
}

export async function untimeoutMember(ctx: Ctx, input: MemberInput): Promise<EmbedBuilder> {
  const { me, target } = await checkTarget(ctx, 'untimeout', input.targetId);
  if (!target) throw notInServer(input.targetId);
  assertBotCan(me.permissions, ['ModerateMembers']);
  if (!target.isCommunicationDisabled()) {
    throw new DomainError('NOT_TIMED_OUT', `${user(target.id)} is not timed out.`, 'Nothing to remove');
  }
  await target.timeout(null, auditReason(ctx.member.user, input.reason));
  const dmSent = await dmIf(ctx, input.dm, target.user, 'UNTIMEOUT', input.reason);
  const c = await recordCase({
    guildId: ctx.guild.id,
    action: 'UNTIMEOUT',
    moderatorId: ctx.member.id,
    targetId: target.id,
    targetName: target.user.username,
    reason: input.reason,
    dmSent,
  });
  return doneEmbed(ctx.theme, c, `${user(target.id)} can talk again.${dmNote(dmSent)}`);
}

// ───── Kick ─────

export async function planKick(ctx: Ctx, targetId: string): Promise<GuildMember> {
  const { me, target } = await checkTarget(ctx, 'kick', targetId);
  if (!target) throw notInServer(targetId);
  assertBotCan(me.permissions, ['KickMembers']);
  if (!target.kickable) {
    throw new DomainError('MOD_REFUSED', `Discord won't let me kick ${user(target.id)}.`, 'Action refused');
  }
  return target;
}

export async function kickMember(ctx: Ctx, input: MemberInput): Promise<EmbedBuilder> {
  const target = await planKick(ctx, input.targetId);
  // DM first: once they are gone the bot usually can't reach them any more.
  const dmSent = await dmIf(ctx, input.dm, target.user, 'KICK', input.reason);
  await target.kick(auditReason(ctx.member.user, input.reason));
  const c = await recordCase({
    guildId: ctx.guild.id,
    action: 'KICK',
    moderatorId: ctx.member.id,
    targetId: target.id,
    targetName: target.user.username,
    reason: input.reason,
    dmSent,
  });
  return doneEmbed(ctx.theme, c, `${user(target.id)} (${target.user.username}) was kicked.${dmNote(dmSent)}`);
}

// ───── Ban / unban ─────

export const DELETE_WINDOWS: Record<string, { seconds: number; label: string }> = {
  none: { seconds: 0, label: 'none' },
  '1h': { seconds: 3600, label: '1 hour' },
  '24h': { seconds: 86400, label: '24 hours' },
  '7d': { seconds: 604800, label: '7 days' },
};

export async function planBan(
  ctx: Ctx,
  targetId: string,
): Promise<{ targetUser: User; target: GuildMember | null }> {
  const { me, target } = await checkTarget(ctx, 'ban', targetId);
  assertBotCan(me.permissions, ['BanMembers']);
  if (target && !target.bannable) {
    throw new DomainError('MOD_REFUSED', `Discord won't let me ban ${user(target.id)}.`, 'Action refused');
  }
  const targetUser = target?.user ?? (await ctx.guild.client.users.fetch(targetId).catch(() => null));
  if (!targetUser) {
    throw new DomainError(
      'NOT_FOUND',
      `There is no Discord user with the ID \`${targetId}\`.`,
      'User not found',
    );
  }
  const existing = await ctx.guild.bans.fetch({ user: targetId, force: true }).catch(() => null);
  if (existing)
    throw new DomainError('ALREADY_BANNED', `${user(targetId)} is already banned.`, 'Already banned');
  return { targetUser, target };
}

export async function banMember(
  ctx: Ctx,
  input: MemberInput & { deleteWindow: string },
): Promise<EmbedBuilder> {
  const { targetUser, target } = await planBan(ctx, input.targetId);
  const window = DELETE_WINDOWS[input.deleteWindow] ?? DELETE_WINDOWS.none!;
  const dmSent = target ? await dmIf(ctx, input.dm, targetUser, 'BAN', input.reason) : null;
  await ctx.guild.bans.create(targetUser.id, {
    reason: auditReason(ctx.member.user, input.reason),
    deleteMessageSeconds: window.seconds,
  });
  const c = await recordCase({
    guildId: ctx.guild.id,
    action: 'BAN',
    moderatorId: ctx.member.id,
    targetId: targetUser.id,
    targetName: targetUser.username,
    reason: input.reason,
    details: { deleteMessages: window.label, wasMember: target !== null },
    dmSent,
  });
  return doneEmbed(
    ctx.theme,
    c,
    `${user(targetUser.id)} (${targetUser.username}) is banned.${window.seconds > 0 ? ` Their messages from the last **${window.label}** were deleted.` : ''}${dmNote(dmSent)}`,
  );
}

export async function unbanUser(
  ctx: Ctx,
  input: { targetId: string; reason: string | null },
): Promise<EmbedBuilder> {
  const me = await botMember(ctx.guild);
  assertBotCan(me.permissions, ['BanMembers']);
  const ban = await ctx.guild.bans.fetch({ user: input.targetId, force: true }).catch(() => null);
  if (!ban) throw new DomainError('NOT_BANNED', `${user(input.targetId)} is not banned.`, 'Not banned');
  await ctx.guild.bans.remove(input.targetId, auditReason(ctx.member.user, input.reason));
  const c = await recordCase({
    guildId: ctx.guild.id,
    action: 'UNBAN',
    moderatorId: ctx.member.id,
    targetId: input.targetId,
    targetName: ban.user.username,
    reason: input.reason,
  });
  return doneEmbed(
    ctx.theme,
    c,
    `${user(input.targetId)} (${ban.user.username}) is unbanned and may rejoin with a new invite.`,
  );
}

// ───── Roles (one member) ─────

export async function changeRole(
  ctx: Ctx,
  input: { targetId: string; roleId: string; give: boolean; reason: string | null },
): Promise<EmbedBuilder> {
  const { me, target } = await checkTarget(ctx, 'role', input.targetId);
  if (!target) throw notInServer(input.targetId);
  assertBotCan(me.permissions, ['ManageRoles']);
  const role =
    ctx.guild.roles.cache.get(input.roleId) ?? (await ctx.guild.roles.fetch(input.roleId).catch(() => null));
  if (!role) throw new DomainError('NOT_FOUND', 'That role no longer exists.', 'Role not found');
  assertCanManageRole({
    role: roleFacts(role),
    actor: memberFacts(ctx.member),
    bot: memberFacts(me),
    mass: false,
  });
  const has = target.roles.cache.has(role.id);
  if (input.give && has)
    throw new DomainError('NO_CHANGE', `${user(target.id)} already has ${role}.`, 'Nothing to change');
  if (!input.give && !has)
    throw new DomainError('NO_CHANGE', `${user(target.id)} doesn't have ${role}.`, 'Nothing to change');
  const why = auditReason(ctx.member.user, input.reason);
  if (input.give) await target.roles.add(role, why);
  else await target.roles.remove(role, why);
  const c = await recordCase({
    guildId: ctx.guild.id,
    action: input.give ? 'ROLE_ADD' : 'ROLE_REMOVE',
    moderatorId: ctx.member.id,
    targetId: target.id,
    targetName: target.user.username,
    reason: input.reason,
    details: { roleId: role.id, roleName: role.name },
  });
  return doneEmbed(
    ctx.theme,
    c,
    input.give ? `${user(target.id)} now has ${role}.` : `${role} was taken from ${user(target.id)}.`,
  );
}

// ───── Purge ─────

const PURGE_SCAN_LIMIT = 1000;

export interface PurgeScan {
  ids: string[];
  tooOld: number;
  scanned: number;
}

/** Finds up to `amount` matching messages, newest first, looking back at most 1,000 messages. */
export async function scanPurge(
  channel: GuildTextBasedChannel,
  amount: number,
  filter: PurgeFilter,
): Promise<PurgeScan> {
  const out: PurgeScan = { ids: [], tooOld: 0, scanned: 0 };
  let before: string | undefined;
  while (out.ids.length < amount && out.scanned < PURGE_SCAN_LIMIT) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}), cache: false });
    if (batch.size === 0) break;
    for (const m of batch.values()) {
      out.scanned++;
      const verdict = purgeVerdict(
        {
          authorId: m.author.id,
          authorIsBot: m.author.bot,
          hasAttachments: m.attachments.size > 0,
          content: m.content,
          pinned: m.pinned,
          createdAt: m.createdAt,
        },
        filter,
      );
      if (verdict === 'delete' && out.ids.length < amount) out.ids.push(m.id);
      else if (verdict === 'too-old') out.tooOld++;
    }
    const oldest = batch.last();
    before = oldest?.id;
    // Everything further back is older still — Discord can't bulk-delete it.
    if (batch.size < 100 || !oldest || Date.now() - oldest.createdTimestamp > BULK_DELETE_MAX_AGE_MS) break;
  }
  return out;
}

export async function prepareScan(
  ctx: Ctx,
  channel: GuildTextBasedChannel,
  amount: number,
  filter: PurgeFilter,
): Promise<PurgeScan> {
  const me = await botMember(ctx.guild);
  assertBotCan(
    channel.permissionsFor(me),
    ['ViewChannel', 'ReadMessageHistory', 'ManageMessages'],
    `in ${channel}`,
  );
  const scan = await scanPurge(channel, amount, filter);
  if (scan.ids.length === 0) {
    throw new DomainError(
      'NOTHING_TO_PURGE',
      `No messages ${describePurgeFilter(filter)} were found in the last ${scan.scanned} messages${scan.tooOld > 0 ? ` (${scan.tooOld} matching ones are older than 14 days, which Discord can't bulk-delete)` : ''}.`,
      'Nothing to delete',
    );
  }
  return scan;
}

export async function purgeMessages(
  ctx: Ctx,
  channel: GuildTextBasedChannel,
  input: { amount: number; filter: PurgeFilter; reason: string | null },
): Promise<EmbedBuilder> {
  const scan = await prepareScan(ctx, channel, input.amount, input.filter);
  let deleted = 0;
  for (let k = 0; k < scan.ids.length; k += 100) {
    const chunk = scan.ids.slice(k, k + 100);
    if (chunk.length === 1) {
      const ok = await channel.messages
        .delete(chunk[0]!)
        .then(() => true)
        .catch(() => false);
      if (ok) deleted++;
    } else {
      const res = await channel.bulkDelete(chunk, true);
      deleted += res.size;
    }
  }
  const c = await recordCase({
    guildId: ctx.guild.id,
    action: 'PURGE',
    moderatorId: ctx.member.id,
    channelId: channel.id,
    reason: input.reason,
    details: { deleted, filter: describePurgeFilter(input.filter), tooOld: scan.tooOld },
  });
  return doneEmbed(
    ctx.theme,
    c,
    `Deleted **${deleted}** message${deleted === 1 ? '' : 's'} (${describePurgeFilter(input.filter)}) in ${channel}.${scan.tooOld > 0 ? `\n${scan.tooOld} matching message(s) were older than 14 days and were left alone.` : ''}`,
  );
}

// ───── Channels: slowmode, lock, unlock ─────

const LOCK_PERMS = [
  'SendMessages',
  'SendMessagesInThreads',
  'CreatePublicThreads',
  'CreatePrivateThreads',
] as const;

type LockableChannel = Extract<GuildTextBasedChannel, { permissionOverwrites: unknown }>;

function asLockable(channel: GuildTextBasedChannel): LockableChannel {
  if (channel.isThread()) {
    throw new DomainError(
      'BAD_CHANNEL',
      'Threads follow their parent channel. Lock the parent channel instead.',
      'Not possible here',
    );
  }
  return channel as LockableChannel;
}

function assertChannelPerms(channel: GuildTextBasedChannel, me: GuildMember, perms: PermName[]): void {
  assertBotCan(channel.permissionsFor(me), perms, `in ${channel}`);
}

export async function setSlowmode(
  ctx: Ctx,
  channel: GuildTextBasedChannel,
  input: { seconds: number; reason: string | null },
): Promise<EmbedBuilder> {
  const me = await botMember(ctx.guild);
  if (!('setRateLimitPerUser' in channel) || channel.type === ChannelType.GuildAnnouncement) {
    throw new DomainError('BAD_CHANNEL', `${channel} doesn't support slowmode.`, 'Not possible here');
  }
  assertChannelPerms(channel, me, channel.isThread() ? ['ManageThreads'] : ['ManageChannels']);
  await channel.setRateLimitPerUser(input.seconds, auditReason(ctx.member.user, input.reason));
  const c = await recordCase({
    guildId: ctx.guild.id,
    action: 'SLOWMODE',
    moderatorId: ctx.member.id,
    channelId: channel.id,
    reason: input.reason,
    details: { seconds: input.seconds },
  });
  return doneEmbed(
    ctx.theme,
    c,
    input.seconds === 0
      ? `Slowmode is off in ${channel}.`
      : `Members in ${channel} can now send one message every **${formatDuration(input.seconds)}**.`,
  );
}

type OverwriteState = 'allow' | 'deny' | 'neutral';

export async function lockChannel(
  ctx: Ctx,
  raw: GuildTextBasedChannel,
  input: { reason: string | null; notify: boolean },
): Promise<EmbedBuilder> {
  const channel = asLockable(raw);
  const me = await botMember(ctx.guild);
  assertChannelPerms(channel, me, ['ManageChannels', 'ManageRoles']);
  const everyone = ctx.guild.roles.everyone;
  const current = channel.permissionOverwrites.cache.get(everyone.id);
  if (current?.deny.has(PermissionFlagsBits.SendMessages)) {
    throw new DomainError('ALREADY_LOCKED', `${channel} is already locked.`, 'Already locked');
  }
  const previous: Record<string, OverwriteState> = {};
  for (const p of LOCK_PERMS) {
    const bit = PermissionFlagsBits[p];
    previous[p] = current?.allow.has(bit) ? 'allow' : current?.deny.has(bit) ? 'deny' : 'neutral';
  }
  // Tell the channel first: once locked, the bot may not be able to post there itself.
  if (input.notify) {
    await channel.send({ embeds: [lockNoticeEmbed(ctx.theme, true, input.reason)] }).catch(() => undefined);
  }
  await channel.permissionOverwrites.edit(everyone, Object.fromEntries(LOCK_PERMS.map((p) => [p, false])), {
    reason: auditReason(ctx.member.user, input.reason),
  });
  const c = await recordCase({
    guildId: ctx.guild.id,
    action: 'LOCK',
    moderatorId: ctx.member.id,
    channelId: channel.id,
    reason: input.reason,
    details: Object.fromEntries(LOCK_PERMS.map((p) => [`prev_${p}`, previous[p]!])),
  });
  return doneEmbed(
    ctx.theme,
    c,
    `${channel} is locked. Members can read it but not write.\nUse \`/unlock\` to open it again.`,
  );
}

export async function unlockChannel(
  ctx: Ctx,
  raw: GuildTextBasedChannel,
  input: { reason: string | null; notify: boolean },
): Promise<EmbedBuilder> {
  const channel = asLockable(raw);
  const me = await botMember(ctx.guild);
  assertChannelPerms(channel, me, ['ManageChannels', 'ManageRoles']);
  const everyone = ctx.guild.roles.everyone;
  const current = channel.permissionOverwrites.cache.get(everyone.id);
  if (!current?.deny.has(PermissionFlagsBits.SendMessages)) {
    throw new DomainError('NOT_LOCKED', `${channel} is not locked.`, 'Not locked');
  }
  // Restore exactly what was there before the lock; without a record, go back to neutral.
  const lock = await lastOpenLock(ctx.guild.id, channel.id);
  const before = (lock?.details ?? {}) as Record<string, unknown>;
  const restore = Object.fromEntries(
    LOCK_PERMS.map((p) => {
      const prev = before[`prev_${p}`];
      return [p, prev === 'allow' ? true : prev === 'deny' ? false : null];
    }),
  );
  await channel.permissionOverwrites.edit(everyone, restore, {
    reason: auditReason(ctx.member.user, input.reason),
  });
  if (lock) await closeLock(lock.id);
  if (input.notify) {
    await channel.send({ embeds: [lockNoticeEmbed(ctx.theme, false, input.reason)] }).catch(() => undefined);
  }
  const c = await recordCase({
    guildId: ctx.guild.id,
    action: 'UNLOCK',
    moderatorId: ctx.member.id,
    channelId: channel.id,
    reason: input.reason,
    details: lock ? { lockCase: lock.caseNumber } : {},
  });
  return doneEmbed(ctx.theme, c, `${channel} is open again.`);
}
