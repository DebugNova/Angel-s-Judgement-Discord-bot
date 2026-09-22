/**
 * Moderation screens. Deliberately plain and professional: no emojis in titles, buttons or DMs
 * (owner's wish), just the brand frame, colour and one line of lore.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type { EmbedBuilder } from 'discord.js';
import type { ModCase } from '@prisma/client';
import { formatDuration } from '../../modules/moderation/duration.js';
import type { MemberRecord, ModAction } from '../../modules/moderation/cases.service.js';
import { Ids } from '../ids.js';
import { ModLore } from './lore.js';
import { Colors, baseEmbed, lore, plural, ts, user } from './theme.js';
import type { Theme } from './theme.js';

interface ActionMeta {
  label: string;
  color: number;
  /** Past tense for DMs, e.g. "banned". */
  done: string;
}

export const ACTION_META: Record<ModAction, ActionMeta> = {
  WARN: { label: 'Warning', color: Colors.pending, done: 'warned' },
  TIMEOUT: { label: 'Timeout', color: Colors.review, done: 'timed out' },
  UNTIMEOUT: { label: 'Timeout Removed', color: Colors.success, done: 'released from timeout' },
  KICK: { label: 'Kick', color: Colors.danger, done: 'kicked' },
  BAN: { label: 'Ban', color: Colors.danger, done: 'banned' },
  UNBAN: { label: 'Unban', color: Colors.success, done: 'unbanned' },
  PURGE: { label: 'Purge', color: Colors.ivory, done: 'purged' },
  ROLE_ADD: { label: 'Role Given', color: Colors.active, done: 'given a role' },
  ROLE_REMOVE: { label: 'Role Removed', color: Colors.active, done: 'had a role removed' },
  ROLE_ALL_ADD: { label: 'Role Given to Everyone', color: Colors.active, done: 'given' },
  ROLE_ALL_REMOVE: { label: 'Role Removed from Everyone', color: Colors.active, done: 'removed' },
  SLOWMODE: { label: 'Slowmode', color: Colors.ivory, done: 'slowed' },
  LOCK: { label: 'Channel Locked', color: Colors.disputed, done: 'locked' },
  UNLOCK: { label: 'Channel Unlocked', color: Colors.success, done: 'unlocked' },
};

/** Actions aimed at one member: their public result shows the reason. */
const MEMBER_ACTIONS = new Set<string>([
  'WARN',
  'TIMEOUT',
  'UNTIMEOUT',
  'KICK',
  'BAN',
  'UNBAN',
  'ROLE_ADD',
  'ROLE_REMOVE',
]);

function meta(action: string): ActionMeta {
  return ACTION_META[action as ModAction] ?? { label: action, color: Colors.ivory, done: action };
}

function loreFor(action: string): string | null {
  return (ModLore as Record<string, string>)[action] ?? null;
}

function detailLines(c: ModCase): string[] {
  const d = (c.details ?? {}) as Record<string, unknown>;
  const out: string[] = [];
  if (c.durationSec) out.push(`Duration: **${formatDuration(c.durationSec)}**`);
  if (typeof d.until === 'number') out.push(`Ends: ${ts(new Date(d.until), 'f')}`);
  if (typeof d.deleteMessages === 'string' && d.deleteMessages !== 'none')
    out.push(`Messages deleted: **last ${d.deleteMessages}**`);
  if (typeof d.roleId === 'string') out.push(`Role: <@&${d.roleId}>`);
  if (typeof d.deleted === 'number') out.push(`Deleted: **${d.deleted}** message(s)`);
  if (typeof d.filter === 'string') out.push(`Filter: ${d.filter}`);
  if (typeof d.tooOld === 'number' && d.tooOld > 0) out.push(`Skipped: **${d.tooOld}** older than 14 days`);
  if (typeof d.done === 'number') out.push(`Changed: **${d.done}** member(s)`);
  if (typeof d.failed === 'number' && d.failed > 0) out.push(`Failed: **${d.failed}**`);
  if (d.stopped === true) out.push('**Stopped early** by a moderator');
  if (typeof d.seconds === 'number')
    out.push(`Slowmode: **${d.seconds === 0 ? 'off' : formatDuration(d.seconds)}**`);
  if (c.channelId && !c.targetId) out.push(`Channel: <#${c.channelId}>`);
  if (c.dmSent === true) out.push('DM: delivered');
  if (c.dmSent === false) out.push('DM: could not be delivered (DMs closed)');
  return out;
}

/** The mod-log card for one case. */
export function caseEmbed(theme: Theme, c: ModCase): EmbedBuilder {
  const m = meta(c.action);
  const embed = baseEmbed(theme, m.color).setTitle(`Case #${c.caseNumber} · ${m.label}`);
  if (c.targetId) {
    embed.addFields({
      name: 'Member',
      value: `${user(c.targetId)}${c.targetName ? ` · ${c.targetName}` : ''}\n\`${c.targetId}\``,
      inline: true,
    });
  }
  embed.addFields({ name: 'Moderator', value: user(c.moderatorId), inline: true });
  if (c.channelId && c.targetId)
    embed.addFields({ name: 'Channel', value: `<#${c.channelId}>`, inline: true });
  embed.addFields({ name: 'Reason', value: c.reason ?? '*No reason given*' });
  const details = detailLines(c);
  if (details.length > 0) embed.addFields({ name: 'Details', value: details.join('\n').slice(0, 1024) });
  if (!c.active && c.action === 'WARN') {
    embed.addFields({
      name: 'Removed',
      value: `by ${user(c.removedById ?? '')}${c.removedReason ? ` · ${c.removedReason}` : ''}`,
    });
  }
  const line = loreFor(c.action);
  if (line) embed.setDescription(lore(line));
  return embed.setTimestamp(c.createdAt);
}

export function warningRemovedEmbed(theme: Theme, c: ModCase): EmbedBuilder {
  return baseEmbed(theme, Colors.success)
    .setTitle(`Warning #${c.caseNumber} Removed`)
    .setDescription(lore(ModLore.WARNING_REMOVED))
    .addFields(
      { name: 'Member', value: c.targetId ? user(c.targetId) : '—', inline: true },
      { name: 'Removed by', value: user(c.removedById ?? ''), inline: true },
      { name: 'Original reason', value: c.reason ?? '*No reason given*' },
      ...(c.removedReason ? [{ name: 'Why it was removed', value: c.removedReason }] : []),
    );
}

/** What the member receives by DM. Never names the moderator. */
export function dmEmbed(
  theme: Theme,
  opts: { action: ModAction; guildName: string; reason: string | null; durationSec?: number | null },
): EmbedBuilder {
  const m = meta(opts.action);
  const embed = baseEmbed(theme, m.color)
    .setTitle(`You were ${m.done} in ${opts.guildName}`.slice(0, 250))
    .addFields({ name: 'Reason', value: opts.reason ?? '*No reason given*' });
  if (opts.durationSec) {
    embed.addFields({
      name: 'Duration',
      value: `${formatDuration(opts.durationSec)} · ends ${ts(new Date(Date.now() + opts.durationSec * 1000), 'R')}`,
    });
  }
  const line = loreFor(opts.action);
  return embed.setDescription([line ? lore(line) : '', '', ModLore.dmFooter].join('\n').trim());
}

/** The private "are you sure?" card before ban, kick, big purges and role-for-everyone. */
export function confirmEmbed(
  theme: Theme,
  opts: { action: ModAction; title: string; lines: string[] },
): EmbedBuilder {
  return baseEmbed(theme, Colors.danger)
    .setTitle(opts.title)
    .setDescription(
      [...opts.lines, '', lore(ModLore.confirm), 'This request expires in 2 minutes.'].join('\n'),
    );
}

export function confirmButtons(token: string, label: string) {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(Ids.mod.confirm(token)).setLabel(label).setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(Ids.mod.cancel(token))
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

/** The public result posted in the channel where the moderator acted. */
export function doneEmbed(theme: Theme, c: ModCase, summary: string): EmbedBuilder {
  const m = meta(c.action);
  const line = loreFor(c.action);
  const embed = baseEmbed(theme, m.color)
    .setTitle(`${m.label} · Case #${c.caseNumber}`)
    .setDescription([summary, ...(line ? ['', lore(line)] : [])].join('\n'));
  if (MEMBER_ACTIONS.has(c.action) || c.reason) {
    embed.addFields({ name: 'Reason', value: c.reason ?? '*No reason given*' });
  }
  return embed;
}

/** A moderation error, shown only to the moderator. */
export function modErrorEmbed(theme: Theme, title: string, message: string): EmbedBuilder {
  return baseEmbed(theme, Colors.danger).setTitle(title).setDescription(message);
}

export function recordEmbed(
  theme: Theme,
  target: { id: string; name: string; avatarURL: string | null },
  rec: MemberRecord,
  page: number,
  pages: number,
): EmbedBuilder {
  const c = rec.counts;
  const summary = [
    `Active warnings: **${rec.activeWarnings}**`,
    `Timeouts **${c.TIMEOUT ?? 0}** • Kicks **${c.KICK ?? 0}** • Bans **${c.BAN ?? 0}**`,
  ].join('\n');
  const rows = rec.cases.map((x) => {
    const m = meta(x.action);
    const removed = x.action === 'WARN' && !x.active ? ' ~~removed~~' : '';
    const dur = x.durationSec ? ` (${formatDuration(x.durationSec)})` : '';
    return `**#${x.caseNumber}** ${m.label}${dur}${removed} · ${ts(x.createdAt, 'R')} by ${user(x.moderatorId)}\n> ${(x.reason ?? 'No reason given').slice(0, 120)}`;
  });
  const embed = baseEmbed(theme, rec.activeWarnings > 0 ? Colors.pending : Colors.ivory)
    .setTitle(`Record of ${target.name}`.slice(0, 250))
    .setDescription([`${user(target.id)} · \`${target.id}\``, '', summary].join('\n'))
    .addFields({
      name:
        rec.total === 0
          ? 'Cases'
          : `Cases (${plural(rec.total, 'case')}) · page ${page + 1}/${Math.max(pages, 1)}`,
      value: rows.length > 0 ? rows.join('\n').slice(0, 1024) : '*A clean record. No cases.*',
    });
  if (target.avatarURL) embed.setThumbnail(target.avatarURL);
  return embed;
}

export interface MassRoleProgress {
  roleId: string;
  give: boolean;
  total: number;
  done: number;
  failed: number;
  left: number;
  startedAt: number;
  state: 'running' | 'finished' | 'stopped';
  moderatorId: string;
}

export function massRoleProgressEmbed(theme: Theme, p: MassRoleProgress): EmbedBuilder {
  const processed = p.done + p.failed + p.left;
  const width = 12;
  const filled = p.total === 0 ? width : Math.round((processed / p.total) * width);
  const bar = '▰'.repeat(filled) + '▱'.repeat(width - filled);
  const elapsed = (Date.now() - p.startedAt) / 1000;
  const eta = processed > 0 && p.state === 'running' ? ((p.total - processed) * elapsed) / processed : null;
  const title =
    p.state === 'running'
      ? `${p.give ? 'Giving a role to' : 'Removing a role from'} everyone`
      : p.state === 'stopped'
        ? 'Role Update Stopped'
        : 'Role Update Finished';
  const color =
    p.state === 'running' ? Colors.active : p.state === 'stopped' ? Colors.pending : Colors.success;
  return baseEmbed(theme, color)
    .setTitle(title)
    .setDescription(
      [
        `Role: <@&${p.roleId}> · started by ${user(p.moderatorId)}`,
        '',
        `${bar}  **${processed} / ${p.total}**`,
        `${p.give ? 'Given' : 'Removed'} **${p.done}** • Failed **${p.failed}** • Left the server **${p.left}**`,
        eta !== null
          ? `About **${formatDuration(Math.max(eta, 1))}** left`
          : `Took **${formatDuration(elapsed)}**`,
        ...(p.state === 'running' ? ['', lore(p.give ? ModLore.ROLE_ALL_ADD : ModLore.ROLE_ALL_REMOVE)] : []),
      ].join('\n'),
    );
}

export function stopJobButton(guildId: string) {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(Ids.mod.stopJob(guildId)).setLabel('Stop').setStyle(ButtonStyle.Danger),
    ),
  ];
}

/** Posted in a locked/unlocked channel when the moderator ran the command from somewhere else. */
export function lockNoticeEmbed(theme: Theme, locked: boolean, reason: string | null): EmbedBuilder {
  return baseEmbed(theme, locked ? Colors.disputed : Colors.success)
    .setTitle(locked ? 'This Channel Is Locked' : 'This Channel Is Open Again')
    .setDescription(
      [lore(locked ? ModLore.LOCK : ModLore.UNLOCK), ...(reason ? ['', `Reason: ${reason}`] : [])].join('\n'),
    );
}
