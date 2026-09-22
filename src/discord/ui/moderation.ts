import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type { EmbedBuilder } from 'discord.js';
import type { ModCase } from '@prisma/client';
import { formatDuration } from '../../modules/moderation/duration.js';
import type { MemberRecord, ModAction } from '../../modules/moderation/cases.service.js';
import { Ids } from '../ids.js';
import { ModLore } from './lore.js';
import { Colors, baseEmbed, e, lore, plural, ts, user } from './theme.js';
import type { Theme } from './theme.js';

interface ActionMeta {
  label: string;
  emoji: string;
  color: number;
  /** Past tense for result messages and DMs, e.g. "banned". */
  done: string;
}

export const ACTION_META: Record<ModAction, ActionMeta> = {
  WARN: { label: 'Warning', emoji: '⚠️', color: Colors.pending, done: 'warned' },
  TIMEOUT: { label: 'Timeout', emoji: '🔇', color: Colors.review, done: 'timed out' },
  UNTIMEOUT: { label: 'Timeout removed', emoji: '🔊', color: Colors.success, done: 'released from timeout' },
  KICK: { label: 'Kick', emoji: '👢', color: Colors.danger, done: 'kicked' },
  BAN: { label: 'Ban', emoji: '🔨', color: Colors.danger, done: 'banned' },
  UNBAN: { label: 'Unban', emoji: '🕊️', color: Colors.success, done: 'unbanned' },
  PURGE: { label: 'Purge', emoji: '🧹', color: Colors.ivory, done: 'purged' },
  ROLE_ADD: { label: 'Role given', emoji: '➕', color: Colors.active, done: 'given a role' },
  ROLE_REMOVE: { label: 'Role taken', emoji: '➖', color: Colors.active, done: 'had a role taken' },
  ROLE_ALL_ADD: { label: 'Role given to everyone', emoji: '🕊️', color: Colors.active, done: 'given' },
  ROLE_ALL_REMOVE: { label: 'Role taken from everyone', emoji: '🕊️', color: Colors.active, done: 'taken' },
  SLOWMODE: { label: 'Slowmode', emoji: '🐢', color: Colors.ivory, done: 'slowed' },
  LOCK: { label: 'Channel locked', emoji: '🔒', color: Colors.disputed, done: 'locked' },
  UNLOCK: { label: 'Channel unlocked', emoji: '🔓', color: Colors.success, done: 'unlocked' },
};

function meta(action: string): ActionMeta {
  return (
    ACTION_META[action as ModAction] ?? { label: action, emoji: '📋', color: Colors.ivory, done: action }
  );
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
  const embed = baseEmbed(theme, m.color).setTitle(e(theme, m.emoji, `Case #${c.caseNumber} · ${m.label}`));
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
  const line = ModLore[c.action as keyof typeof ModLore];
  if (line) embed.setDescription(lore(line));
  return embed.setTimestamp(c.createdAt);
}

export function warningRemovedEmbed(theme: Theme, c: ModCase): EmbedBuilder {
  return baseEmbed(theme, Colors.success)
    .setTitle(e(theme, '🕊️', `Warning #${c.caseNumber} removed`))
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
    .setTitle(e(theme, m.emoji, `You were ${m.done} in ${opts.guildName}`.slice(0, 250)))
    .addFields({ name: 'Reason', value: opts.reason ?? '*No reason given*' });
  if (opts.durationSec) {
    embed.addFields({
      name: 'Duration',
      value: `${formatDuration(opts.durationSec)} · ends ${ts(new Date(Date.now() + opts.durationSec * 1000), 'R')}`,
    });
  }
  const line = ModLore[opts.action as keyof typeof ModLore];
  return embed.setDescription([line ? lore(line) : '', '', ModLore.dmFooter].join('\n').trim());
}

/** The ephemeral "are you sure?" card before ban, kick, big purges and role-for-everyone. */
export function confirmEmbed(
  theme: Theme,
  opts: { action: ModAction; title: string; lines: string[] },
): EmbedBuilder {
  const m = meta(opts.action);
  return baseEmbed(theme, Colors.danger)
    .setTitle(e(theme, m.emoji, opts.title))
    .setDescription(
      [...opts.lines, '', lore(ModLore.confirm), 'This request expires in 2 minutes.'].join('\n'),
    );
}

export function confirmButtons(theme: Theme, token: string, label: string, emoji?: string) {
  const ok = new ButtonBuilder()
    .setCustomId(Ids.mod.confirm(token))
    .setLabel(label)
    .setStyle(ButtonStyle.Danger);
  if (emoji && theme.emojis) ok.setEmoji(emoji);
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      ok,
      new ButtonBuilder()
        .setCustomId(Ids.mod.cancel(token))
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

/** The moderator's private "done" message. */
export function doneEmbed(theme: Theme, c: ModCase, summary: string): EmbedBuilder {
  const m = meta(c.action);
  const line = ModLore[c.action as keyof typeof ModLore];
  return baseEmbed(theme, m.color)
    .setTitle(e(theme, m.emoji, `${m.label} · Case #${c.caseNumber}`))
    .setDescription([summary, ...(line ? ['', lore(line)] : [])].join('\n'));
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
    return `${theme.emojis ? `${m.emoji} ` : ''}**#${x.caseNumber}** ${m.label}${dur}${removed} · ${ts(x.createdAt, 'R')} by ${user(x.moderatorId)}\n> ${(x.reason ?? 'No reason given').slice(0, 120)}`;
  });
  const embed = baseEmbed(theme, rec.activeWarnings > 0 ? Colors.pending : Colors.ivory)
    .setTitle(e(theme, '📜', `Record of ${target.name}`.slice(0, 250)))
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
  const verb = p.give ? 'Giving' : 'Taking';
  const title =
    p.state === 'running'
      ? `${verb} a role ${p.give ? 'to' : 'from'} everyone`
      : p.state === 'stopped'
        ? 'Stopped'
        : 'Finished';
  const color =
    p.state === 'running' ? Colors.active : p.state === 'stopped' ? Colors.pending : Colors.success;
  return baseEmbed(theme, color)
    .setTitle(e(theme, p.state === 'running' ? '🕊️' : p.state === 'stopped' ? '⏹️' : '✨', title))
    .setDescription(
      [
        `Role: <@&${p.roleId}> · started by ${user(p.moderatorId)}`,
        '',
        `${bar}  **${processed} / ${p.total}**`,
        `${p.give ? 'Given' : 'Taken'} **${p.done}** • Failed **${p.failed}** • Left the server **${p.left}**`,
        eta !== null
          ? `About **${formatDuration(Math.max(eta, 1))}** left`
          : `Took **${formatDuration(elapsed)}**`,
        ...(p.state === 'running' ? ['', lore(p.give ? ModLore.ROLE_ALL_ADD : ModLore.ROLE_ALL_REMOVE)] : []),
      ].join('\n'),
    );
}

export function stopJobButton(theme: Theme, guildId: string) {
  const b = new ButtonBuilder()
    .setCustomId(Ids.mod.stopJob(guildId))
    .setLabel('Stop')
    .setStyle(ButtonStyle.Danger);
  if (theme.emojis) b.setEmoji('⏹️');
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(b)];
}

/** Posted in a channel when it is locked or unlocked, so members know what happened. */
export function lockNoticeEmbed(theme: Theme, locked: boolean, reason: string | null): EmbedBuilder {
  return baseEmbed(theme, locked ? Colors.disputed : Colors.success)
    .setTitle(
      e(theme, locked ? '🔒' : '🔓', locked ? 'This channel is locked' : 'This channel is open again'),
    )
    .setDescription(
      [lore(locked ? ModLore.LOCK : ModLore.UNLOCK), ...(reason ? ['', `Reason: ${reason}`] : [])].join('\n'),
    );
}
