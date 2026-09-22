import type { EmbedBuilder } from 'discord.js';
import type { GuildConfig, Player, Season } from '@prisma/client';
import type { ChallengeWithPlayers } from '../../modules/challenges/challenge.service.js';
import type { MatchView } from '../../modules/matches/match.types.js';
import type { FinalizeOutcome } from '../../modules/results/finalize.js';
import type { LeaderboardPage, LeaderboardType } from '../../modules/leaderboard/leaderboard.service.js';
import { LEADERBOARD_LABELS } from '../../modules/leaderboard/leaderboard.service.js';
import type { HeadToHead, HistoryPage } from '../../modules/history/history.service.js';
import {
  BOT_VERSION,
  Colors,
  DIVIDER,
  baseEmbed,
  choir,
  e,
  lore,
  num,
  plural,
  signed,
  statusColor,
  statusLabel,
  ts,
  user,
} from './theme.js';
import type { Theme } from './theme.js';
import { Brand, Lore } from './lore.js';

// ───────────────────────────── Generic ─────────────────────────────

export function errorEmbed(theme: Theme, title: string, message: string): EmbedBuilder {
  return baseEmbed(theme, Colors.danger)
    .setTitle(e(theme, '⚠️', title))
    .setDescription(message);
}

export function successEmbed(theme: Theme, title: string, message: string): EmbedBuilder {
  return baseEmbed(theme, Colors.brand)
    .setTitle(e(theme, '✨', title))
    .setDescription(message);
}

export function infoEmbed(theme: Theme, title: string, message: string): EmbedBuilder {
  return baseEmbed(theme, Colors.ivory).setTitle(title).setDescription(message);
}

export function noPermissionEmbed(theme: Theme): EmbedBuilder {
  return baseEmbed(theme, Colors.danger).setDescription(
    e(theme, '🔒', 'You do not have permission to use this command.'),
  );
}

// ───────────────────────────── Challenges ─────────────────────────────

export type ChallengeState = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED' | 'EXPIRED' | 'SUPERSEDED';

export function challengeEmbed(
  theme: Theme,
  ch: ChallengeWithPlayers,
  state: ChallengeState,
  extra: { matchDisplayId?: string; channelId?: string } = {},
): EmbedBuilder {
  const a = user(ch.challenger.discordId);
  const b = user(ch.challenged.discordId);
  const view: Record<ChallengeState, { color: number; status: string; line: string; title: string }> = {
    PENDING: {
      color: Colors.pending,
      title: e(theme, '⚔️', '1v1 CHALLENGE'),
      status: e(theme, '🟡', 'Awaiting response'),
      line: lore(Lore.challenge(ch.challenger.displayName, ch.challenged.displayName)),
    },
    ACCEPTED: {
      color: Colors.active,
      title: e(theme, '⚔️', 'CHALLENGE ACCEPTED'),
      status: e(theme, '🔵', 'Match started'),
      line: lore(Lore.accepted),
    },
    DECLINED: {
      color: Colors.cancelled,
      title: e(theme, '⚔️', 'CHALLENGE DECLINED'),
      status: e(theme, '⚫', 'Declined'),
      line: `${b} declined the challenge.\n${lore(Lore.declined)}`,
    },
    CANCELLED: {
      color: Colors.cancelled,
      title: e(theme, '⚔️', 'CHALLENGE CANCELLED'),
      status: e(theme, '⚫', 'Cancelled'),
      line: `${a} withdrew the challenge.`,
    },
    EXPIRED: {
      color: Colors.cancelled,
      title: e(theme, '⚔️', 'CHALLENGE EXPIRED'),
      status: e(theme, '⚫', 'Expired'),
      line: `${b} did not respond within the allowed time.\n\nThe challenge has expired.`,
    },
    SUPERSEDED: {
      color: Colors.cancelled,
      title: e(theme, '⚔️', 'CHALLENGE CLOSED'),
      status: e(theme, '⚫', 'Cancelled'),
      line: 'One of the players entered another match, so this challenge was closed.',
    },
  };
  const v = view[state];
  const embed = baseEmbed(theme, v.color)
    .setTitle(v.title)
    .setDescription(state === 'PENDING' ? `${a} has challenged ${b}.\n\n${v.line}` : v.line)
    .addFields(
      { name: 'Challenger', value: `${a}\n\`${num(ch.challenger.elo)} ELO\``, inline: true },
      { name: 'Opponent', value: `${b}\n\`${num(ch.challenged.elo)} ELO\``, inline: true },
      { name: 'Format', value: '1v1', inline: true },
      { name: 'Status', value: v.status, inline: true },
    );
  if (state === 'PENDING') {
    embed.addFields({ name: 'Expires', value: ts(ch.expiresAt, 'R'), inline: true });
  }
  if (state === 'ACCEPTED' && extra.matchDisplayId) {
    embed.addFields(
      { name: 'Match ID', value: `\`${extra.matchDisplayId}\``, inline: true },
      ...(extra.channelId ? [{ name: 'Match Channel', value: `<#${extra.channelId}>`, inline: true }] : []),
    );
  }
  return embed;
}

// ───────────────────────────── Match panel ─────────────────────────────

function sides(match: MatchView): { a: Player; b: Player } {
  return { a: match.challenger, b: match.opponent };
}

function eloFor(match: MatchView, playerId: string): { old: number; next: number; change: number } | null {
  const row = match.eloHistory.find((h) => h.playerId === playerId);
  return row ? { old: row.oldElo, next: row.newElo, change: row.eloChange } : null;
}

function methodLabel(match: MatchView): string {
  switch (match.resolutionMethod) {
    case 'PLAYER_CONFIRMATION':
      return 'Opponent Confirmation';
    case 'REFEREE_DECISION':
      return 'Referee Decision';
    case 'FORCE_COMPLETE':
      return 'Staff Force-Complete';
    default:
      return '—';
  }
}

function staffMentions(config: GuildConfig): string {
  const ids = [...new Set([...config.refereeRoleIds, ...config.moderatorRoleIds])];
  return ids.length > 0 ? ids.map((id) => `<@&${id}>`).join(' ') : 'Server staff';
}

/** The persistent status panel inside a match channel. Its look follows the match state. */
export function matchPanelEmbed(theme: Theme, match: MatchView, config: GuildConfig): EmbedBuilder {
  const { a, b } = sides(match);
  const embed = baseEmbed(theme, statusColor(match.status));
  const header = [
    { name: 'Match ID', value: `\`${match.matchId}\``, inline: true },
    { name: 'Format', value: '1v1', inline: true },
    { name: 'Status', value: statusLabel(theme, match.status), inline: true },
  ];

  switch (match.status) {
    case 'ACCEPTED':
    case 'ACTIVE': {
      const cancelLine = match.cancelRequestedById
        ? `\n\n${e(theme, '⚠️', `**Cancellation requested** by ${user(match.cancelRequestedById === a.id ? a.discordId : b.discordId)}.`)}\n${user(match.cancelRequestedById === a.id ? b.discordId : a.discordId)} can agree or refuse below.`
        : '';
      embed
        .setTitle(e(theme, '⚔️', 'SEVEN ANGELS — 1v1 MATCH'))
        .setDescription(`${lore(Lore.matchActive)}${cancelLine}`)
        .addFields(
          ...header,
          { name: 'Challenger', value: `${user(a.discordId)}\n\`${num(a.elo)} ELO\``, inline: true },
          { name: 'Opponent', value: `${user(b.discordId)}\n\`${num(b.elo)} ELO\``, inline: true },
          { name: 'Started', value: match.startedAt ? ts(match.startedAt, 'R') : '—', inline: true },
          {
            name: 'Private Server',
            value: match.serverLink
              ? `${match.serverLink}\n-# Submitted by ${user(match.serverLinkById ?? a.discordId)}`
              : 'Not submitted yet — use **Submit Server Link** or paste it in chat.',
          },
          {
            name: DIVIDER,
            value: [
              '**How it works**',
              '1. Share your private server link here.',
              '2. Both players join the server.',
              '3. Complete your match.',
              '4. Press **Report Result** when finished.',
              '5. Your opponent confirms the result.',
              match.evidenceRequired
                ? '\n📎 Evidence is required: upload a screenshot of the result before reporting.'
                : '',
            ]
              .filter(Boolean)
              .join('\n'),
          },
          { name: 'Staff', value: staffMentions(config) },
        );
      break;
    }
    case 'RESULT_PENDING': {
      const r = match.result;
      const winner = r?.reportedWinnerId === a.id ? a : b;
      const reporter = r?.reportedByDiscordId ?? a.discordId;
      const waiting = reporter === a.discordId ? b : a;
      embed
        .setTitle(e(theme, '🏆', 'RESULT PENDING'))
        .setDescription(`${user(reporter)} has reported a result.\n\n${lore(Lore.resultPending)}`)
        .addFields(
          ...header,
          { name: 'Reported Winner', value: user(winner.discordId), inline: true },
          { name: 'Reported By', value: user(reporter), inline: true },
          { name: 'Waiting For', value: user(waiting.discordId), inline: true },
          {
            name: DIVIDER,
            value: `${user(waiting.discordId)}, press **Confirm Result** if this is correct, or **Dispute Result** if it is not.\nA dispute sends the match to a referee.`,
          },
        );
      break;
    }
    case 'DISPUTED':
    case 'UNDER_REVIEW': {
      const r = match.result;
      const reported = r?.reportedWinnerId === a.id ? a : b;
      embed
        .setTitle(
          e(
            theme,
            match.status === 'DISPUTED' ? '🚨' : '🟣',
            match.status === 'DISPUTED' ? 'MATCH DISPUTED' : 'UNDER REVIEW',
          ),
        )
        .setDescription(`The players did not agree on the reported result.\n\n${lore(Lore.disputed)}`)
        .addFields(
          ...header,
          { name: 'Players', value: `${user(a.discordId)} vs ${user(b.discordId)}`, inline: true },
          { name: 'Reported Winner', value: user(reported.discordId), inline: true },
          {
            name: 'Referee',
            value: match.refereeDiscordId ? user(match.refereeDiscordId) : 'Awaiting a referee',
            inline: true,
          },
          {
            name: DIVIDER,
            value:
              '**Players:** upload screenshots or clips of the result in this channel.\nA referee will review the evidence and decide the official winner.',
          },
        );
      break;
    }
    case 'COMPLETED': {
      const winner = match.winnerId === a.id ? a : b;
      const loser = winner.id === a.id ? b : a;
      const we = eloFor(match, winner.id);
      const le = eloFor(match, loser.id);
      embed
        .setTitle(e(theme, '🏆', 'MATCH COMPLETED'))
        .setDescription(lore(Lore.completed(winner.displayName, loser.displayName)))
        .addFields(
          ...header,
          { name: 'Winner', value: user(winner.discordId), inline: true },
          { name: 'Loser', value: user(loser.discordId), inline: true },
          { name: 'Method', value: methodLabel(match), inline: true },
          {
            name: 'ELO',
            value:
              [
                we
                  ? `${user(winner.discordId)} \`${num(we.old)} → ${num(we.next)}\` **(${signed(we.change)})**`
                  : '',
                le
                  ? `${user(loser.discordId)} \`${num(le.old)} → ${num(le.next)}\` **(${signed(le.change)})**`
                  : '',
              ]
                .filter(Boolean)
                .join('\n') || '—',
          },
        );
      if (match.refereeDiscordId && match.resolutionMethod !== 'PLAYER_CONFIRMATION') {
        embed.addFields({ name: 'Referee', value: user(match.refereeDiscordId), inline: true });
      }
      if (match.decisionReason)
        embed.addFields({ name: 'Reason', value: match.decisionReason.slice(0, 1000), inline: true });
      if (match.cleanupAt && !match.channelDeletedAt) {
        embed.addFields({
          name: DIVIDER,
          value: `Match completed.\nThis channel will be archived ${ts(match.cleanupAt, 'R')}.`,
        });
      }
      break;
    }
    case 'CANCELLED':
    case 'EXPIRED':
    case 'PENDING': {
      embed
        .setTitle(e(theme, '⚫', 'MATCH CANCELLED'))
        .setDescription(lore(Lore.cancelled))
        .addFields(
          ...header,
          { name: 'Players', value: `${user(a.discordId)} vs ${user(b.discordId)}`, inline: true },
          {
            name: 'Cancelled By',
            value: match.cancelledByDiscordId ? user(match.cancelledByDiscordId) : 'System',
            inline: true,
          },
          { name: 'Reason', value: match.cancelReason?.slice(0, 1000) || 'No reason given', inline: true },
        );
      if (match.cleanupAt && !match.channelDeletedAt) {
        embed.addFields({
          name: DIVIDER,
          value: `No stats or ELO were changed.\nThis channel will be archived ${ts(match.cleanupAt, 'R')}.`,
        });
      }
      break;
    }
  }
  return embed;
}

/** Compact overview used by /currentmatch and /match view. */
export function matchSummaryEmbed(
  theme: Theme,
  match: MatchView,
  opts: {
    viewerDiscordId?: string;
    staff?: boolean;
    notes?: { authorDiscordId: string; content: string; createdAt: Date }[];
  } = {},
): EmbedBuilder {
  const { a, b } = sides(match);
  const embed = baseEmbed(theme, statusColor(match.status))
    .setTitle(e(theme, '⚔️', `MATCH ${match.matchId}`))
    .addFields(
      { name: 'Challenger', value: `${user(a.discordId)}\n\`${num(a.elo)} ELO\``, inline: true },
      { name: 'Opponent', value: `${user(b.discordId)}\n\`${num(b.elo)} ELO\``, inline: true },
      { name: 'Status', value: statusLabel(theme, match.status), inline: true },
      {
        name: 'Channel',
        value: match.channelId && !match.channelDeletedAt ? `<#${match.channelId}>` : 'Archived',
        inline: true,
      },
      { name: 'Created', value: ts(match.createdAt, 'f'), inline: true },
      { name: 'Format', value: '1v1', inline: true },
    );
  if (opts.viewerDiscordId) {
    const opp = a.discordId === opts.viewerDiscordId ? b : a;
    embed.setDescription(`Opponent: ${user(opp.discordId)}\nELO: \`${num(a.elo)}\` vs \`${num(b.elo)}\``);
  }
  if (match.status === 'COMPLETED' && match.winnerId) {
    const winner = match.winnerId === a.id ? a : b;
    const w = eloFor(match, winner.id);
    embed.addFields(
      { name: 'Winner', value: user(winner.discordId), inline: true },
      { name: 'Method', value: methodLabel(match), inline: true },
      { name: 'ELO', value: w ? `${signed(w.change)} / ${signed(-w.change)}` : '—', inline: true },
      { name: 'Completed', value: match.completedAt ? ts(match.completedAt, 'f') : '—', inline: true },
    );
  }
  if (
    match.result?.reportedWinnerId &&
    ['RESULT_PENDING', 'DISPUTED', 'UNDER_REVIEW'].includes(match.status)
  ) {
    const reported = match.result.reportedWinnerId === a.id ? a : b;
    embed.addFields({ name: 'Reported Winner', value: user(reported.discordId), inline: true });
  }
  if (opts.staff) {
    embed.addFields(
      {
        name: 'Evidence',
        value: match._count.evidence > 0 ? `${plural(match._count.evidence, 'file')}` : 'Missing',
        inline: true,
      },
      { name: 'Server Link', value: match.serverLink ? 'Available' : 'Not submitted', inline: true },
      { name: 'Referee', value: match.refereeDiscordId ? user(match.refereeDiscordId) : '—', inline: true },
    );
    if (match.decisionReason)
      embed.addFields({ name: 'Decision Reason', value: match.decisionReason.slice(0, 1000) });
    if (match.cancelReason)
      embed.addFields({ name: 'Cancel Reason', value: match.cancelReason.slice(0, 1000) });
    if (opts.notes && opts.notes.length > 0) {
      embed.addFields({
        name: 'Staff Notes',
        value: opts.notes
          .slice(0, 5)
          .map((n) => `${ts(n.createdAt, 'd')} ${user(n.authorDiscordId)}: ${n.content.slice(0, 180)}`)
          .join('\n')
          .slice(0, 1024),
      });
    }
  }
  return embed;
}

// ───────────────────────────── Result announcements ─────────────────────────────

export function serverLinkEmbed(theme: Theme, match: MatchView): EmbedBuilder {
  return baseEmbed(theme, Colors.active)
    .setTitle(e(theme, '🔗', 'Server Link Submitted'))
    .addFields(
      { name: 'Submitted by', value: user(match.serverLinkById ?? ''), inline: true },
      { name: 'Match', value: `\`${match.matchId}\``, inline: true },
      { name: 'Link', value: match.serverLink ?? '—' },
    );
}

export function evidenceRequestEmbed(theme: Theme, match: MatchView, staffId: string): EmbedBuilder {
  return baseEmbed(theme, Colors.review)
    .setTitle(e(theme, '📎', 'EVIDENCE REQUESTED'))
    .setDescription(
      `${user(staffId)} has requested evidence for \`${match.matchId}\`.\n\nUpload screenshots or clips of the final result **directly in this channel**. Every attachment is recorded for the referee.`,
    );
}

/** Staff-channel notification when a result is disputed. */
export function disputeNotificationEmbed(theme: Theme, match: MatchView): EmbedBuilder {
  const { a, b } = sides(match);
  const reported = match.result?.reportedWinnerId === a.id ? a : b;
  return baseEmbed(theme, Colors.disputed)
    .setTitle(e(theme, '🚨', 'DISPUTED MATCH'))
    .setDescription(lore(Lore.disputed))
    .addFields(
      { name: 'Match', value: `\`${match.matchId}\``, inline: true },
      { name: 'Players', value: `${user(a.discordId)} vs ${user(b.discordId)}`, inline: true },
      { name: 'Reported Winner', value: user(reported.discordId), inline: true },
      { name: 'Opponent Response', value: 'DISPUTED', inline: true },
      { name: 'Status', value: statusLabel(theme, match.status), inline: true },
      { name: 'Channel', value: match.channelId ? `<#${match.channelId}>` : '—', inline: true },
    );
}

/** Ephemeral referee panel with everything needed to rule on a match. */
export function reviewPanelEmbed(theme: Theme, match: MatchView): EmbedBuilder {
  const { a, b } = sides(match);
  const reported = match.result?.reportedWinnerId ? (match.result.reportedWinnerId === a.id ? a : b) : null;
  return baseEmbed(theme, Colors.review)
    .setTitle(e(theme, '⚖️', 'MATCH REVIEW'))
    .addFields(
      { name: 'Match ID', value: `\`${match.matchId}\``, inline: true },
      { name: 'Status', value: statusLabel(theme, match.status), inline: true },
      { name: 'Referee', value: match.refereeDiscordId ? user(match.refereeDiscordId) : '—', inline: true },
      { name: 'Player 1', value: `${user(a.discordId)}\n\`${num(a.elo)} ELO\``, inline: true },
      { name: 'Player 2', value: `${user(b.discordId)}\n\`${num(b.elo)} ELO\``, inline: true },
      { name: 'Reported Winner', value: reported ? user(reported.discordId) : 'None reported', inline: true },
      {
        name: 'Evidence',
        value: match._count.evidence > 0 ? `Available (${plural(match._count.evidence, 'file')})` : 'Missing',
        inline: true,
      },
      {
        name: 'Match Channel',
        value: match.channelId && !match.channelDeletedAt ? `<#${match.channelId}>` : 'Archived',
        inline: true,
      },
      { name: 'Server Link', value: match.serverLink ? 'Available' : 'Not submitted', inline: true },
      { name: 'Created', value: ts(match.createdAt, 'f'), inline: true },
      { name: 'Disputed', value: match.disputedAt ? ts(match.disputedAt, 'R') : '—', inline: true },
    );
}

export function decisionConfirmEmbed(
  theme: Theme,
  match: MatchView,
  winner: Player,
  mode: 'd' | 'f',
): EmbedBuilder {
  return baseEmbed(theme, Colors.pending)
    .setTitle(e(theme, '⚠️', mode === 'f' ? 'Confirm Force-Complete' : 'Confirm Decision'))
    .setDescription(
      [
        'You are awarding the win to:',
        `## ${user(winner.discordId)}`,
        `Match: \`${match.matchId}\``,
        '',
        'This will permanently update:',
        '• Wins',
        '• Losses',
        '• ELO',
        '• Win streak',
        '• Match history',
        '',
        'Press **Confirm Decision** to add an optional reason and apply it.',
      ].join('\n'),
    );
}

export function cancelConfirmEmbed(theme: Theme, match: MatchView): EmbedBuilder {
  return baseEmbed(theme, Colors.pending)
    .setTitle(e(theme, '⚠️', 'Confirm Cancellation'))
    .setDescription(
      `You are cancelling \`${match.matchId}\` (${user(match.challenger.discordId)} vs ${user(match.opponent.discordId)}).\n\nNo stats or ELO will change. Both players will be free to play again.`,
    );
}

/** The single public record per match, posted to the history channel. No links or evidence. */
export function historyRecordEmbed(theme: Theme, outcome: FinalizeOutcome): EmbedBuilder {
  const { match, elo, winner, loser } = outcome;
  const staff = match.resolutionMethod !== 'PLAYER_CONFIRMATION';
  const embed = baseEmbed(theme, Colors.completed)
    .setTitle(e(theme, '🏆', staff ? 'MATCH RESOLVED' : '1v1 MATCH COMPLETE'))
    .setDescription(
      `\`${match.matchId}\`\n\n${user(winner.discordId)}\n**defeated**\n${user(loser.discordId)}`,
    )
    .addFields(
      { name: 'Winner', value: user(winner.discordId), inline: true },
      { name: 'ELO', value: `${signed(elo.winnerChange)} / ${signed(elo.loserChange)}`, inline: true },
      { name: staff ? 'Decision' : 'Method', value: methodLabel(match), inline: true },
      { name: 'Final', value: `${winner.displayName} 1 — 0 ${loser.displayName}`, inline: true },
      { name: 'Result', value: 'Verified', inline: true },
    );
  if (staff && match.refereeDiscordId)
    embed.addFields({ name: 'Referee', value: user(match.refereeDiscordId), inline: true });
  if (staff && match.decisionReason)
    embed.addFields({ name: 'Reason', value: match.decisionReason.slice(0, 1000) });
  embed.addFields({ name: DIVIDER, value: ts(match.completedAt ?? new Date(), 'F') });
  return embed;
}

// ───────────────────────────── Players ─────────────────────────────

export function profileEmbed(
  theme: Theme,
  p: Player,
  opts: {
    rank: number | null;
    minMatches: number;
    form: ('W' | 'L')[];
    avatarURL: string;
    accountCreated: Date;
  },
): EmbedBuilder {
  const rank =
    opts.rank !== null
      ? `#${num(opts.rank)}`
      : p.isBanned
        ? 'Restricted'
        : `Unranked (${p.matchesPlayed}/${opts.minMatches})`;
  const embed = baseEmbed(theme, Colors.brand)
    .setTitle(e(theme, '⚔️', 'SEVEN ANGELS — PLAYER PROFILE'))
    .setThumbnail(opts.avatarURL)
    .setDescription(`${user(p.discordId)} • **${p.displayName}**\n${lore(Lore.choir(choir(p.elo)))}`)
    .addFields(
      { name: 'ELO', value: `**${num(p.elo)}**`, inline: true },
      { name: 'Rank', value: rank, inline: true },
      { name: 'Highest ELO', value: num(p.highestElo), inline: true },
      { name: 'Matches', value: num(p.matchesPlayed), inline: true },
      { name: 'Wins', value: num(p.wins), inline: true },
      { name: 'Losses', value: num(p.losses), inline: true },
      { name: 'Win Rate', value: `${p.winRate.toFixed(2)}%`, inline: true },
      {
        name: 'Current Streak',
        value: p.currentWinStreak > 0 ? plural(p.currentWinStreak, 'Win') : '—',
        inline: true,
      },
      {
        name: 'Best Streak',
        value: p.highestWinStreak > 0 ? plural(p.highestWinStreak, 'Win') : '—',
        inline: true,
      },
      {
        name: DIVIDER,
        value: `**Recent Results**\n${opts.form.length > 0 ? opts.form.map((r) => (theme.emojis ? (r === 'W' ? '🟢 W' : '🔴 L') : r)).join('  ') : 'No matches yet.'}`,
      },
      { name: 'In the Arena Since', value: ts(p.createdAt, 'D'), inline: true },
      { name: 'Discord Account', value: ts(opts.accountCreated, 'D'), inline: true },
      { name: 'Username', value: `@${p.username}`, inline: true },
    );
  return embed;
}

export function inspectEmbed(
  theme: Theme,
  p: Player,
  opts: {
    current: MatchView | null;
    audit: { action: string; actorId: string; createdAt: Date }[];
    rank: number | null;
  },
): EmbedBuilder {
  return baseEmbed(theme, p.isBanned ? Colors.danger : Colors.ivory)
    .setTitle(e(theme, '🔍', 'PLAYER INSPECTION'))
    .setDescription(`${user(p.discordId)} • @${p.username}\nInternal ID: \`${p.id}\``)
    .addFields(
      { name: 'ELO', value: num(p.elo), inline: true },
      { name: 'Rank', value: opts.rank !== null ? `#${num(opts.rank)}` : 'Unranked', inline: true },
      { name: 'Record', value: `${p.wins}W – ${p.losses}L (${p.winRate.toFixed(2)}%)`, inline: true },
      {
        name: 'Status',
        value: p.isBanned ? e(theme, '🔴', 'Restricted') : e(theme, '🟢', 'Eligible'),
        inline: true,
      },
      {
        name: 'Current Match',
        value: opts.current
          ? `\`${opts.current.matchId}\` (${statusLabel(theme, opts.current.status)})`
          : 'None',
        inline: true,
      },
      { name: 'Streak', value: `${p.currentWinStreak} (best ${p.highestWinStreak})`, inline: true },
      ...(p.isBanned
        ? [
            {
              name: 'Restriction',
              value: `By ${p.bannedBy ? user(p.bannedBy) : '—'} ${p.bannedAt ? ts(p.bannedAt, 'R') : ''}\nReason: ${p.banReason ?? 'No reason given'}`,
            },
          ]
        : []),
      {
        name: 'Recent Audit Events',
        value:
          opts.audit.length > 0
            ? opts.audit
                .map(
                  (a) =>
                    `${ts(a.createdAt, 'd')} \`${a.action}\` by ${a.actorId === 'SYSTEM' ? 'System' : user(a.actorId)}`,
                )
                .join('\n')
                .slice(0, 1024)
            : 'None',
      },
    );
}

// ───────────────────────────── Leaderboard & history ─────────────────────────────

function statFor(type: LeaderboardType, p: Player): string {
  switch (type) {
    case 'elo':
      return `${num(p.elo)} ELO`;
    case 'wins':
      return plural(p.wins, 'win');
    case 'winrate':
      return `${p.winRate.toFixed(2)}% (${p.matchesPlayed})`;
    case 'streak':
      return plural(p.currentWinStreak, 'win');
    case 'matches':
      return plural(p.matchesPlayed, 'match', 'matches');
  }
}

function medal(theme: Theme, position: number): string {
  if (!theme.emojis) return `#${position}`;
  return position === 1 ? '🥇' : position === 2 ? '🥈' : position === 3 ? '🥉' : `#${position}`;
}

export function leaderboardEmbed(
  theme: Theme,
  type: LeaderboardType,
  lb: LeaderboardPage,
  minMatches: number,
): EmbedBuilder {
  const lines = lb.entries.map(
    ({ position, player }) =>
      `${medal(theme, position)} ${user(player.discordId)} — **${statFor(type, player)}**`,
  );
  return baseEmbed(theme, Colors.brand)
    .setTitle(e(theme, '🏆', `SEVEN ANGELS — ${LEADERBOARD_LABELS[type].toUpperCase()} LEADERBOARD`))
    .setDescription(
      [
        lore(Lore.leaderboard),
        '',
        lines.length > 0
          ? lines.join('\n')
          : `No ranked angels yet.\nPlay **${minMatches}** matches to qualify.`,
      ].join('\n'),
    )
    .addFields({
      name: DIVIDER,
      value: `Page ${lb.page + 1} / ${lb.pages} • ${plural(lb.total, 'ranked player')} • min. ${minMatches} matches`,
    });
}

export function leaderboardPanelEmbed(theme: Theme, top: Player[], minMatches: number): EmbedBuilder {
  const lines = top.map((p, i) => `${medal(theme, i + 1)} ${user(p.discordId)} — **${num(p.elo)}**`);
  return baseEmbed(theme, Colors.brand)
    .setTitle(e(theme, '🏆', 'SEVEN ANGELS'))
    .setDescription(
      [
        '**CURRENT 1V1 RANKINGS**',
        lore(Lore.leaderboardPanel),
        '',
        lines.length > 0
          ? lines.join('\n')
          : `No ranked angels yet — play **${minMatches}** matches to qualify.`,
      ].join('\n'),
    )
    .addFields({
      name: DIVIDER,
      value: `Updated ${ts(new Date(), 'R')} • \`/leaderboard\` for the full rankings`,
    });
}

export function historyEmbed(theme: Theme, target: Player, page: HistoryPage): EmbedBuilder {
  const lines = page.rows.map((m) => {
    const won = m.winnerId === target.id;
    const change = m.eloHistory.find((h) => h.playerId === target.id)?.eloChange ?? 0;
    const opp = m.challengerId === target.id ? m.opponent : m.challenger;
    const res = theme.emojis ? (won ? '🟢 **W**' : '🔴 **L**') : won ? '**W**' : '**L**';
    return [
      `${res} \`${m.matchId}\` vs ${user(opp.discordId)}`,
      `Winner: ${user(won ? target.discordId : opp.discordId)} • **${signed(change)} ELO** • ${m.completedAt ? ts(m.completedAt, 'd') : '—'}`,
    ].join('\n');
  });
  return baseEmbed(theme, Colors.ivory)
    .setTitle(e(theme, '📜', 'MATCH HISTORY'))
    .setDescription(
      [
        `${user(target.discordId)}`,
        '',
        lines.length > 0 ? lines.join('\n\n') : 'No completed matches yet.',
      ].join('\n'),
    )
    .addFields({
      name: DIVIDER,
      value: `Page ${page.page + 1} / ${page.pages} • ${plural(page.total, 'match', 'matches')}`,
    });
}

export function headToHeadEmbed(theme: Theme, a: Player, b: Player, h: HeadToHead): EmbedBuilder {
  const lastWinner = h.last?.winnerId === a.id ? a : b;
  const series =
    h.total === 0
      ? 'No matches yet'
      : h.aWins === h.bWins
        ? `Tied ${h.aWins}–${h.bWins}`
        : h.aWins > h.bWins
          ? `${a.displayName} leads ${h.aWins}–${h.bWins}`
          : `${b.displayName} leads ${h.bWins}–${h.aWins}`;
  return baseEmbed(theme, Colors.brand)
    .setTitle(e(theme, '⚔️', 'HEAD TO HEAD'))
    .setDescription(`${user(a.discordId)} vs ${user(b.discordId)}`)
    .addFields(
      { name: 'Matches', value: num(h.total), inline: true },
      { name: `${a.displayName} Wins`, value: num(h.aWins), inline: true },
      { name: `${b.displayName} Wins`, value: num(h.bWins), inline: true },
      {
        name: 'Last Match',
        value: h.last ? `${lastWinner.displayName} won (\`${h.last.matchId}\`)` : '—',
        inline: true,
      },
      { name: 'Current Series', value: series, inline: true },
    );
}

export function searchEmbed(
  theme: Theme,
  rows: MatchView[],
  page: number,
  pages: number,
  total: number,
): EmbedBuilder {
  const lines = rows.map(
    (m) =>
      `\`${m.matchId}\` ${statusLabel(theme, m.status)} — ${user(m.challenger.discordId)} vs ${user(m.opponent.discordId)}${m.winner ? ` • won by ${user(m.winner.discordId)}` : ''} • ${ts(m.createdAt, 'd')}`,
  );
  return baseEmbed(theme, Colors.ivory)
    .setTitle(e(theme, '🔎', 'MATCH SEARCH'))
    .setDescription(lines.length > 0 ? lines.join('\n') : 'No matches found.')
    .addFields({ name: DIVIDER, value: `Page ${page + 1} / ${pages} • ${plural(total, 'result')}` });
}

export function evidenceListEmbed(
  theme: Theme,
  match: MatchView,
  items: { submittedByDiscordId: string; attachmentUrl: string; fileName: string; createdAt: Date }[],
): EmbedBuilder {
  return baseEmbed(theme, Colors.review)
    .setTitle(e(theme, '📎', `EVIDENCE — ${match.matchId}`))
    .setDescription(
      items.length > 0
        ? items
            .map(
              (i, n) =>
                `**${n + 1}.** [${i.fileName.slice(0, 60)}](${i.attachmentUrl}) — ${user(i.submittedByDiscordId)} ${ts(i.createdAt, 'R')}`,
            )
            .join('\n')
            .slice(0, 4000)
        : 'No evidence has been uploaded for this match.',
    )
    .addFields({
      name: 'Requested',
      value: match.evidenceRequestedAt ? ts(match.evidenceRequestedAt, 'R') : 'Not requested',
      inline: true,
    });
}

// ───────────────────────────── Info ─────────────────────────────

export const HELP_CATEGORIES = {
  general: {
    label: 'General',
    summary: 'Help, bot info and status',
    lines: [
      '`/help` — This menu.',
      '`/about` — About Angel’s Judgement and the Seven Angels.',
      '`/botstatus` — Bot, database and arena status.',
    ],
  },
  duel: {
    label: '1v1 Duels',
    summary: 'Challenge someone to a ranked duel',
    lines: [
      '`/1v1 @player` — Challenge someone to a ranked duel (`/challenge` does the same).',
      'They press **Accept** or **Decline**; you can **Cancel** your own challenge.',
      'On accept, a private match room opens for the two players and the referees.',
      'Share your private server link, play, then press **Report Result**.',
      'Your opponent **confirms** (ELO updates) or **disputes** (a referee decides).',
    ],
  },
  stats: {
    label: 'Stats & Rankings',
    summary: 'Profiles, leaderboards and history',
    lines: [
      '`/stats [@player]` — Profile: ELO, rank, record, win rate, streaks, recent form.',
      '`/leaderboard [type] [size]` — Rankings by ELO, wins, win rate, streak or matches.',
      '`/history [@player] [limit]` — Completed matches with ELO changes.',
      '`/headtohead @player` — Your record against another player.',
    ],
  },
  matches: {
    label: 'Your Matches',
    summary: 'Your current and past matches',
    lines: [
      '`/currentmatch` — Your match in progress (also `/match current`).',
      '`/match view <id>` — One of your matches.',
      '`/match cancel` — Ask to cancel your active match (both players must agree).',
      'Screenshots uploaded in your match room are saved as evidence automatically.',
    ],
  },
  music: {
    label: 'Music',
    summary: 'Play songs, albums and playlists in voice',
    lines: [
      'Join a voice channel first.',
      '`/play <song or link>` — A song name (plays the best match) or a YouTube, Spotify or SoundCloud link, including albums and playlists. `next:` plays it right after the current song (DJs).',
      '`/search <song>` — Choose from the top 5 results.',
      '`/skip` — Skip the song, or vote to skip. `/stop` — Stop, clear the queue and leave.',
      '`/queue` — Browse the queue and jump to a song. `/nowplaying` — Move the player to the bottom of the chat.',
      '`/music pause · resume · back · shuffle · loop · volume · seek · remove · move · jump · clear · history`',
      '`/music stay` — 24/7 mode: stay in the voice channel when idle (DJs and staff).',
      '`/playlist save · load · list · delete` — Your own saved playlists.',
      'The player has buttons for Back, Pause, Skip, Stop, Shuffle, Loop and Queue.',
    ],
  },
  staff: {
    label: 'Referees & Staff',
    summary: 'Disputes, decisions and ranked-play bans',
    lines: [
      '**Referee** · `/match search` · `/match view` · `/match evidence` · `/match note`',
      '**Referee** · `/match decide <winner> [match_id]` — Rule on a reported or disputed match.',
      '**Referee** · `/match cancel <match_id>` · `/requestevidence [match_id]` — Cancel a match; ask for screenshots.',
      '**Moderator** · `/match forcecomplete <winner> [match_id]` · `/match reopen <match_id>`',
      '**Moderator** · `/player inspect` · `/player search` · `/player ban` · `/player unban` (ranked play only)',
      'Inside a match room, `match_id` can be left out.',
    ],
  },
  moderation: {
    label: 'Moderation',
    summary: 'Warnings, timeouts, bans, purge and roles',
    lines: [
      'Only members with the **moderation role** can use these. Admin or owner rank alone is not enough.',
      '`/warn @member <reason>` · `/warnings @member` (full record) · `/unwarn <case>`',
      '`/timeout @member <duration>` · `/untimeout @member`',
      '`/kick @member` · `/ban @user [delete_messages]` · `/unban <user>` — Kick and ban ask you to confirm.',
      '`/purge <amount> [user] [bots] [attachments] [contains]` — Delete recent messages in this channel.',
      '`/role give|take @member @role` · `/role everyone @role` — Preview, confirm, then live progress.',
      '`/slowmode <delay>` · `/lock` · `/unlock`',
      'Every action gets a case number, is posted in the chat and the mod-log, and can DM the member (`dm:`).',
    ],
  },
  admin: {
    label: 'Admin',
    summary: 'Configuration, resets and maintenance',
    lines: [
      '`/config view` — The current configuration.',
      '`/config channel matches · history · logs · leaderboard · staff · modlog · clear`',
      '`/config roles referee · moderator · admin · moderation · dj` — Admin and moderation: owner only. DJ: who controls the music (none set = everyone in the channel).',
      '`/config elo · cooldown · challenge · matches · leaderboard · display · season · moderation`',
      '`/resetstats` · `/player reset` — Reset stats (typed confirmation required).',
      '`/maintenance` — Pause new challenges.',
    ],
  },
} as const;
export type HelpCategory = keyof typeof HELP_CATEGORIES;

export function helpEmbed(theme: Theme, category: HelpCategory | null): EmbedBuilder {
  const embed = baseEmbed(theme, Colors.ivory).setTitle(`${Brand.name} · Commands`);
  if (!category) {
    return embed.setDescription(
      [
        lore(Lore.help),
        '',
        ...Object.values(HELP_CATEGORIES).map((c) => `**${c.label}** — ${c.summary}`),
        '',
        'Choose a category below.',
      ].join('\n'),
    );
  }
  const c = HELP_CATEGORIES[category];
  return embed.setTitle(`${Brand.name} · ${c.label}`).setDescription(c.lines.join('\n'));
}

export function aboutEmbed(theme: Theme, season: Season | null): EmbedBuilder {
  return baseEmbed(theme, Colors.brand)
    .setTitle(e(theme, '😇', `${Brand.name.toUpperCase()} — SEVEN ANGELS`))
    .setDescription(
      ['**1v1 Matchmaking & Ranking System**', '', lore(Lore.about), '', Brand.tagline].join('\n'),
    )
    .addFields(
      { name: 'Version', value: BOT_VERSION, inline: true },
      { name: 'Game Mode', value: '1v1', inline: true },
      { name: 'Season', value: season ? `${season.name} (#${season.number})` : 'Off-season', inline: true },
      { name: 'Developed for', value: 'Seven Angels', inline: true },
    );
}

export function configEmbed(theme: Theme, c: GuildConfig, season: Season | null): EmbedBuilder {
  const ch = (id: string | null) => (id ? `<#${id}>` : '`not set`');
  const roles = (ids: string[]) => (ids.length > 0 ? ids.map((id) => `<@&${id}>`).join(' ') : '`not set`');
  const dur = (s: number) =>
    s >= 3600 && s % 3600 === 0 ? `${s / 3600}h` : s >= 60 && s % 60 === 0 ? `${s / 60}m` : `${s}s`;
  return baseEmbed(theme, Colors.ivory)
    .setTitle(e(theme, '⚙️', 'CONFIGURATION'))
    .addFields(
      {
        name: 'Channels',
        value: [
          `Match Category: ${ch(c.matchCategoryId)}`,
          `History: ${ch(c.historyChannelId)}`,
          `Leaderboard: ${ch(c.leaderboardChannelId)}`,
          `Logs: ${ch(c.logChannelId)}`,
          `Staff: ${ch(c.staffChannelId)}`,
        ].join('\n'),
      },
      {
        name: 'Roles',
        value: [
          `Referee: ${roles(c.refereeRoleIds)}`,
          `Moderator: ${roles(c.moderatorRoleIds)}`,
          `Admin: ${roles(c.adminRoleIds)}`,
        ].join('\n'),
      },
      {
        name: 'Moderation',
        value: [
          `Allowed roles (only these): ${roles(c.moderationRoleIds)}`,
          `Mod-log: ${c.modLogChannelId ? ch(c.modLogChannelId) : c.logChannelId ? `${ch(c.logChannelId)} (logs channel)` : '`not set`'}`,
          `DM members: **${c.modDmMembers ? 'yes' : 'no'}** • Cases so far: **${c.modCaseCounter}**`,
        ].join('\n'),
      },
      {
        name: 'Music',
        value: `DJ roles: ${c.musicDjRoleIds.length > 0 ? roles(c.musicDjRoleIds) : 'none (everyone in the channel controls it)'} • Volume **${c.musicVolume}%** • 24/7 **${c.music247 ? 'on' : 'off'}**`,
      },
      {
        name: 'ELO',
        value: `Starting **${c.startingElo}** • K **${c.kFactor}** • Min **${c.minElo}** • Max **${c.maxElo}**`,
      },
      {
        name: 'Challenges',
        value: `Timeout **${dur(c.challengeTimeoutSec)}** • Pair cooldown **${dur(c.pairCooldownSec)}** • Global cooldown **${c.globalCooldownSec > 0 ? dur(c.globalCooldownSec) : 'off'}** • Command cooldown **${dur(c.challengeCommandCooldownSec)}** • Max incoming **${c.maxIncomingChallenges}**`,
      },
      {
        name: 'Matches',
        value: `Max active **${c.maxActiveMatches || 'unlimited'}** • Channel names **${c.channelPrefix}-001** • IDs **${c.matchIdPrefix}-000001** • Auto-delete **${c.autoDeleteChannels ? dur(c.autoDeleteDelaySec) : 'off'}** • Evidence required **${c.evidenceRequired ? 'yes' : 'no'}** • Sticky panel **${c.stickyPanel ? 'on' : 'off'}**`,
      },
      {
        name: 'Leaderboard',
        value: `Minimum matches **${c.minLeaderboardMatches}** • Max size **${c.maxLeaderboardSize}**`,
      },
      {
        name: 'Other',
        value: `Emojis **${c.useEmojis ? 'on' : 'off'}** • Maintenance **${c.maintenanceMode ? 'ON' : 'off'}** • Season **${season ? `${season.name} (#${season.number})` : 'none'}**`,
      },
    );
}

export function resetDangerEmbed(
  theme: Theme,
  scope: string,
  targetDiscordId: string | null,
  deleteHistory: boolean,
): EmbedBuilder {
  const what =
    scope === 'elo'
      ? ['• ELO', '• Highest ELO', '• Leaderboards']
      : scope === 'streak'
        ? ['• Current win streaks', '• Best win streaks']
        : ['• Wins', '• Losses', '• Matches', '• ELO', '• Streaks', '• Highest ELO', '• Leaderboards'];
  return baseEmbed(theme, Colors.danger)
    .setTitle(
      e(
        theme,
        '⚠️',
        scope === 'user'
          ? 'DANGER — RESET PLAYER STATS'
          : `DANGER — RESET ${scope === 'all' ? 'ALL STATS' : scope.toUpperCase()}`,
      ),
    )
    .setDescription(
      [
        scope === 'user' && targetDiscordId
          ? `Target: ${user(targetDiscordId)}\n`
          : scope === 'user'
            ? ''
            : 'Target: **every player in this server**\n',
        'This will reset:',
        ...what,
        '',
        `Historical match records will: **${deleteHistory ? 'BE PERMANENTLY DELETED' : 'Remain'}**`,
        '',
        'This action cannot be casually undone.',
        '',
        'Press **Proceed** and type the confirmation:',
        '`RESET SEVEN ANGELS`',
      ].join('\n'),
    );
}

export function statusEmbed(
  theme: Theme,
  s: {
    latency: number;
    dbOk: boolean;
    dbLatency: number | null;
    live: number;
    players: number;
    completed: number;
    uptimeSec: number;
    maintenance: boolean;
    admin?: { memoryMb: number; node: string; guilds: number; env: string };
  },
): EmbedBuilder {
  const up = `${Math.floor(s.uptimeSec / 3600)}h ${Math.floor((s.uptimeSec % 3600) / 60)}m`;
  const embed = baseEmbed(theme, s.dbOk ? Colors.success : Colors.danger)
    .setTitle(e(theme, '📡', 'BOT STATUS'))
    .addFields(
      {
        name: 'Bot Status',
        value: s.maintenance ? e(theme, '🟡', 'Maintenance') : e(theme, '🟢', 'Online'),
        inline: true,
      },
      {
        name: 'Database',
        value: s.dbOk ? e(theme, '🟢', `Connected (${s.dbLatency}ms)`) : e(theme, '🔴', 'Unavailable'),
        inline: true,
      },
      { name: 'Latency', value: s.latency >= 0 ? `${s.latency}ms` : 'measuring…', inline: true },
      { name: 'Active Matches', value: num(s.live), inline: true },
      { name: 'Players', value: num(s.players), inline: true },
      { name: 'Completed Matches', value: num(s.completed), inline: true },
      { name: 'Uptime', value: up, inline: true },
      { name: 'Version', value: BOT_VERSION, inline: true },
    );
  if (s.admin) {
    embed.addFields({
      name: 'Technical (admin only)',
      value: `Memory **${s.admin.memoryMb} MB** • Node **${s.admin.node}** • Servers **${s.admin.guilds}** • Env **${s.admin.env}**`,
    });
  }
  return embed;
}

export function logEmbed(
  theme: Theme,
  entry: {
    action: string;
    actorId: string;
    targetId?: string | null;
    matchId?: string | null;
    metadata?: Record<string, unknown>;
  },
): EmbedBuilder {
  const color =
    entry.action.includes('DISPUTE') ||
    entry.action.includes('ORPHAN') ||
    entry.action.includes('ABORT') ||
    entry.action.includes('BANNED')
      ? Colors.disputed
      : entry.action.includes('RESET') || entry.action.includes('DECISION') || entry.action.includes('FORCE')
        ? Colors.review
        : entry.action.includes('COMPLETED') || entry.action.includes('CONFIRMED')
          ? Colors.completed
          : Colors.ivory;
  const meta = Object.entries(entry.metadata ?? {})
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `**${k}:** ${/^\d{17,20}$/.test(String(v)) ? user(String(v)) : String(v).slice(0, 200)}`)
    .join('\n');
  const embed = baseEmbed(theme, color)
    .setTitle(`\`${entry.action}\``)
    .addFields({
      name: 'Actor',
      value: entry.actorId === 'SYSTEM' ? 'System' : user(entry.actorId),
      inline: true,
    });
  if (entry.targetId) embed.addFields({ name: 'Target', value: user(entry.targetId), inline: true });
  if (entry.matchId) embed.addFields({ name: 'Match', value: `\`${entry.matchId}\``, inline: true });
  if (meta) embed.addFields({ name: 'Details', value: meta.slice(0, 1024) });
  return embed;
}
