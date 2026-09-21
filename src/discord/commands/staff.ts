import { randomBytes } from 'node:crypto';
import { InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { MatchStatus } from '@prisma/client';
import { DomainError } from '../../core/errors.js';
import { recentAudit } from '../../modules/audit/audit.service.js';
import {
  addNote,
  findCurrentMatch,
  listEvidence,
  listNotes,
  reopenMatch,
  replaceChannel,
  requestCancel,
  searchMatches,
} from '../../modules/matches/match.service.js';
import type { MatchSearch } from '../../modules/matches/match.service.js';
import { isParticipant } from '../../modules/matches/match.types.js';
import {
  ensurePlayer,
  findPlayer,
  getRank,
  searchPlayers,
  setBanned,
} from '../../modules/players/player.service.js';
import { PermissionLevel, hasLevel } from '../../modules/permissions/permissions.js';
import { assertImpartial } from '../../modules/referee/referee.service.js';
import type { Ctx } from '../context.js';
import { identityOf } from '../context.js';
import { afterCancel } from '../flows.js';
import { createMatchChannel } from '../managers/channels.js';
import { scheduleLeaderboardRefresh } from '../managers/notify.js';
import { refreshPanel } from '../managers/panel.js';
import {
  evidenceListEmbed,
  infoEmbed,
  inspectEmbed,
  matchSummaryEmbed,
  resetDangerEmbed,
  searchEmbed,
  successEmbed,
} from '../ui/embeds.js';
import { pagerRow, resetButtons } from '../ui/components.js';
import { num, user } from '../ui/theme.js';
import { Ids } from '../ids.js';
import { requestEvidence, showCancelConfirm, showDecisionConfirm } from '../actions/staff.js';
import { autocompleteMatchId, parseDate, requireLevel, resolveMatchOption } from './shared.js';
import type { SlashCommand } from './types.js';

const guildOnly = [InteractionContextType.Guild];
const EPHEMERAL = MessageFlags.Ephemeral;

const STATUS_CHOICES: MatchStatus[] = [
  'ACTIVE',
  'RESULT_PENDING',
  'DISPUTED',
  'UNDER_REVIEW',
  'COMPLETED',
  'CANCELLED',
];

// ───── Match search sessions (UI-only state; expiring is harmless) ─────

const SEARCH_PAGE = 10;
const searches = new Map<string, { q: MatchSearch; at: number }>();

export async function renderSearch(ctx: Ctx, key: string, page: number, ownerId: string) {
  const session = searches.get(key);
  if (!session || Date.now() - session.at > 30 * 60_000) {
    throw new DomainError(
      'SEARCH_EXPIRED',
      'This search has expired. Run `/match search` again.',
      'Search expired',
    );
  }
  const { rows, total } = await searchMatches(session.q, page, SEARCH_PAGE);
  const pages = Math.max(1, Math.ceil(total / SEARCH_PAGE));
  return {
    embeds: [searchEmbed(ctx.theme, rows, page, pages, total)],
    components: pagerRow(ctx.theme, (p) => Ids.page.search(key, p, ownerId), page, pages),
  };
}

// ───────────────────────────── /match ─────────────────────────────

const matchCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('match')
    .setDescription('View and manage matches')
    .setContexts(guildOnly)
    .addSubcommand((s) =>
      s
        .setName('view')
        .setDescription('View a match (members: your own matches; staff: any match)')
        .addStringOption((o) =>
          o.setName('match_id').setDescription('e.g. SA-000124').setRequired(true).setAutocomplete(true),
        ),
    )
    .addSubcommand((s) => s.setName('current').setDescription('View your match in progress'))
    .addSubcommand((s) =>
      s
        .setName('cancel')
        .setDescription('Players: request to cancel your active match. Staff: cancel any match by ID.')
        .addStringOption((o) =>
          o.setName('match_id').setDescription('Staff only — the match to cancel').setAutocomplete(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('decide')
        .setDescription('Staff: rule on a reported or disputed match')
        .addUserOption((o) => o.setName('winner').setDescription('The official winner').setRequired(true))
        .addStringOption((o) =>
          o.setName('match_id').setDescription('Leave empty inside a match channel').setAutocomplete(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('forcecomplete')
        .setDescription('Moderator: award an in-progress match')
        .addUserOption((o) => o.setName('winner').setDescription('The official winner').setRequired(true))
        .addStringOption((o) =>
          o.setName('match_id').setDescription('Leave empty inside a match channel').setAutocomplete(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('reopen')
        .setDescription('Moderator: reopen a reported, disputed or cancelled match')
        .addStringOption((o) =>
          o.setName('match_id').setDescription('Leave empty inside a match channel').setAutocomplete(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('evidence')
        .setDescription('Staff: list the evidence uploaded for a match')
        .addStringOption((o) =>
          o.setName('match_id').setDescription('Leave empty inside a match channel').setAutocomplete(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('note')
        .setDescription('Staff: add an internal note to a match')
        .addStringOption((o) =>
          o.setName('note').setDescription('The note').setRequired(true).setMaxLength(1000),
        )
        .addStringOption((o) =>
          o.setName('match_id').setDescription('Leave empty inside a match channel').setAutocomplete(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('search')
        .setDescription('Staff: search matches')
        .addUserOption((o) => o.setName('player').setDescription('Matches involving this player'))
        .addStringOption((o) =>
          o
            .setName('status')
            .setDescription('Match status')
            .addChoices(
              ...STATUS_CHOICES.map((s) => ({ name: s.toLowerCase().replace('_', ' '), value: s })),
            ),
        )
        .addUserOption((o) => o.setName('winner').setDescription('Won by this player'))
        .addUserOption((o) => o.setName('loser').setDescription('Lost by this player'))
        .addStringOption((o) => o.setName('from').setDescription('Created on/after (YYYY-MM-DD)'))
        .addStringOption((o) => o.setName('to').setDescription('Created on/before (YYYY-MM-DD)')),
    )
    .toJSON(),
  level: PermissionLevel.MEMBER,
  autocomplete: autocompleteMatchId,
  async execute(i, ctx) {
    const sub = i.options.getSubcommand();
    const staff = hasLevel(ctx.level, PermissionLevel.REFEREE);

    switch (sub) {
      case 'view': {
        const match = await resolveMatchOption(i, ctx, true);
        if (!staff && !isParticipant(match, i.user.id)) {
          throw new DomainError('NOT_YOURS', 'You can only view your own matches.', 'Not your match');
        }
        const notes = staff ? await listNotes(match.id) : [];
        await i.reply({ embeds: [matchSummaryEmbed(ctx.theme, match, { staff, notes })], flags: EPHEMERAL });
        return;
      }
      case 'current': {
        const match = await findCurrentMatch(ctx.guild.id, i.user.id);
        await i.reply({
          embeds: [
            match
              ? matchSummaryEmbed(ctx.theme, match, { viewerDiscordId: i.user.id })
              : infoEmbed(ctx.theme, 'No current match', 'You are not currently in a match.'),
          ],
          flags: EPHEMERAL,
        });
        return;
      }
      case 'cancel': {
        if (i.options.getString('match_id')) {
          requireLevel(ctx, PermissionLevel.REFEREE);
          const match = await resolveMatchOption(i, ctx, true);
          await showCancelConfirm(i, ctx, match);
          return;
        }
        const match = await findCurrentMatch(ctx.guild.id, i.user.id);
        if (!match)
          throw new DomainError('NO_MATCH', 'You are not currently in a match.', 'No current match');
        const { outcome, match: updated } = await requestCancel({
          matchId: match.id,
          guildId: ctx.guild.id,
          actorDiscordId: i.user.id,
          config: ctx.config,
        });
        if (outcome === 'CANCELLED') {
          await i.reply({
            embeds: [
              successEmbed(
                ctx.theme,
                'Match cancelled',
                `Both players agreed. \`${updated.matchId}\` was cancelled.`,
              ),
            ],
            flags: EPHEMERAL,
          });
          await afterCancel(i.client, updated);
        } else {
          const other = updated.challenger.discordId === i.user.id ? updated.opponent : updated.challenger;
          await i.reply({
            embeds: [
              successEmbed(
                ctx.theme,
                'Cancellation requested',
                `Waiting for ${user(other.discordId)} to agree in the match channel.`,
              ),
            ],
            flags: EPHEMERAL,
          });
          await refreshPanel(i.client, updated.id, {
            bump: true,
            content: `${user(other.discordId)}, your opponent asked to cancel this match.`,
            mentionUsers: [other.discordId],
          });
        }
        return;
      }
      case 'decide':
      case 'forcecomplete': {
        const mode = sub === 'forcecomplete' ? 'f' : 'd';
        requireLevel(ctx, mode === 'f' ? PermissionLevel.MODERATOR : PermissionLevel.REFEREE);
        const match = await resolveMatchOption(i, ctx);
        const winnerUser = i.options.getUser('winner', true);
        const winner =
          match.challenger.discordId === winnerUser.id
            ? match.challenger
            : match.opponent.discordId === winnerUser.id
              ? match.opponent
              : null;
        if (!winner)
          throw new DomainError(
            'INVALID_WINNER',
            `${user(winnerUser.id)} is not a player in \`${match.matchId}\`.`,
            'Invalid winner',
          );
        await showDecisionConfirm(i, ctx, match, winner.id, mode);
        return;
      }
      case 'reopen': {
        requireLevel(ctx, PermissionLevel.MODERATOR);
        const match = await resolveMatchOption(i, ctx);
        assertImpartial(match, i.user.id);
        await i.deferReply({ flags: EPHEMERAL });
        const { match: reopened, needsChannel } = await reopenMatch({
          matchId: match.id,
          guildId: ctx.guild.id,
          staffDiscordId: i.user.id,
        });
        if (needsChannel) {
          const channel = await createMatchChannel(ctx.guild, ctx.config, {
            matchNumber: reopened.matchNumber,
            matchId: reopened.matchId,
            challengerDiscordId: reopened.challenger.discordId,
            opponentDiscordId: reopened.opponent.discordId,
            label: `${reopened.challenger.displayName} vs ${reopened.opponent.displayName}`,
          });
          await replaceChannel(reopened.id, {
            id: channel.id,
            name: channel.name,
            categoryId: channel.parentId,
          });
        } else if (reopened.channelId) {
          // Restore posting rights that were removed when the match ended.
          const channel = ctx.guild.channels.cache.get(reopened.channelId);
          if (channel && 'permissionOverwrites' in channel) {
            for (const p of [reopened.challenger, reopened.opponent]) {
              await channel.permissionOverwrites
                .edit(p.discordId, { SendMessages: true, AddReactions: true })
                .catch(() => undefined);
            }
          }
        }
        await refreshPanel(i.client, reopened.id, {
          bump: true,
          content: `${user(reopened.challenger.discordId)} ${user(reopened.opponent.discordId)} — this match was reopened by staff.`,
          mentionUsers: [reopened.challenger.discordId, reopened.opponent.discordId],
        });
        await i.editReply({
          embeds: [successEmbed(ctx.theme, 'Match reopened', `\`${reopened.matchId}\` is active again.`)],
        });
        return;
      }
      case 'evidence': {
        requireLevel(ctx, PermissionLevel.REFEREE);
        const match = await resolveMatchOption(i, ctx);
        await i.reply({
          embeds: [evidenceListEmbed(ctx.theme, match, await listEvidence(match.id))],
          flags: EPHEMERAL,
        });
        return;
      }
      case 'note': {
        requireLevel(ctx, PermissionLevel.REFEREE);
        const match = await resolveMatchOption(i, ctx);
        await addNote(match, i.user.id, i.options.getString('note', true));
        await i.reply({
          embeds: [successEmbed(ctx.theme, 'Note added', `Internal note saved on \`${match.matchId}\`.`)],
          flags: EPHEMERAL,
        });
        return;
      }
      case 'search': {
        requireLevel(ctx, PermissionLevel.REFEREE);
        const idOf = async (option: string) => {
          const u = i.options.getUser(option);
          if (!u) return undefined;
          const p = await findPlayer(ctx.guild.id, u.id);
          return p?.id ?? 'none';
        };
        const q: MatchSearch = {
          guildId: ctx.guild.id,
          playerId: await idOf('player'),
          winnerId: await idOf('winner'),
          loserId: await idOf('loser'),
          status: (i.options.getString('status') as MatchStatus | null) ?? undefined,
          from: parseDate(i.options.getString('from')),
          to: parseDate(i.options.getString('to'), true),
        };
        const key = randomBytes(6).toString('hex');
        searches.set(key, { q, at: Date.now() });
        for (const [k, v] of searches) if (Date.now() - v.at > 30 * 60_000) searches.delete(k);
        await i.reply({ ...(await renderSearch(ctx, key, 0, i.user.id)), flags: EPHEMERAL });
        return;
      }
    }
  },
};

// ───────────────────────────── /requestevidence ─────────────────────────────

const requestEvidenceCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('requestevidence')
    .setDescription('Staff: ask the players of a match to upload evidence')
    .setContexts(guildOnly)
    .addStringOption((o) =>
      o.setName('match_id').setDescription('Leave empty inside a match channel').setAutocomplete(true),
    )
    .toJSON(),
  level: PermissionLevel.REFEREE,
  autocomplete: autocompleteMatchId,
  async execute(i, ctx) {
    const match = await resolveMatchOption(i, ctx);
    await requestEvidence(i, ctx, match);
  },
};

// ───────────────────────────── /player ─────────────────────────────

const playerCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('player')
    .setDescription('Staff: player management')
    .setContexts(guildOnly)
    .addSubcommand((s) =>
      s
        .setName('inspect')
        .setDescription('Moderator: full player details')
        .addUserOption((o) => o.setName('user').setDescription('The player').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('search')
        .setDescription('Moderator: search players by name or ID')
        .addStringOption((o) =>
          o
            .setName('query')
            .setDescription('Name, username or Discord ID')
            .setRequired(true)
            .setMaxLength(50),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('ban')
        .setDescription('Moderator: restrict a player from competitive play')
        .addUserOption((o) => o.setName('user').setDescription('The player').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(300)),
    )
    .addSubcommand((s) =>
      s
        .setName('unban')
        .setDescription('Moderator: lift a competitive restriction')
        .addUserOption((o) => o.setName('user').setDescription('The player').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('reset')
        .setDescription("Admin: reset a player's stats")
        .addUserOption((o) => o.setName('user').setDescription('The player').setRequired(true)),
    )
    .toJSON(),
  level: PermissionLevel.MODERATOR,
  async execute(i, ctx) {
    const sub = i.options.getSubcommand();
    if (sub === 'search') {
      const rows = await searchPlayers(ctx.guild.id, i.options.getString('query', true));
      const body =
        rows.length > 0
          ? rows
              .map(
                (p) =>
                  `${user(p.discordId)} — @${p.username} • **${num(p.elo)}** ELO • ${p.wins}W-${p.losses}L${p.isBanned ? ' • restricted' : ''}`,
              )
              .join('\n')
          : 'No players found.';
      await i.reply({
        embeds: [infoEmbed(ctx.theme, ctx.theme.emojis ? '🔎 PLAYER SEARCH' : 'PLAYER SEARCH', body)],
        flags: EPHEMERAL,
      });
      return;
    }

    const u = i.options.getUser('user', true);
    if (u.bot) throw new DomainError('BOT_TARGET', 'Bots are not players.', 'Invalid player');
    const member = i.options.getMember('user');
    const identity = member
      ? identityOf(member)
      : { discordId: u.id, username: u.username, displayName: u.displayName };

    switch (sub) {
      case 'inspect': {
        const p = await ensurePlayer(ctx.guild.id, identity, ctx.config.startingElo);
        const [current, audit, rank] = await Promise.all([
          findCurrentMatch(ctx.guild.id, u.id),
          recentAudit(ctx.guild.id, { targetId: u.id, take: 6 }),
          getRank(p, ctx.config.minLeaderboardMatches),
        ]);
        await i.reply({
          embeds: [inspectEmbed(ctx.theme, p, { current, audit: audit.rows, rank })],
          flags: EPHEMERAL,
        });
        return;
      }
      case 'ban':
      case 'unban': {
        if (u.id === i.user.id)
          throw new DomainError('SELF', 'You cannot change your own restriction.', 'Not allowed');
        const reason = i.options.getString('reason') ?? null;
        await setBanned(ctx.guild.id, identity, sub === 'ban', i.user.id, reason, ctx.config.startingElo);
        scheduleLeaderboardRefresh(i.client, ctx.guild.id);
        await i.reply({
          embeds: [
            successEmbed(
              ctx.theme,
              sub === 'ban' ? 'Player restricted' : 'Restriction lifted',
              sub === 'ban'
                ? `${user(u.id)} can no longer challenge, accept or report results.${reason ? `\nReason: ${reason}` : ''}`
                : `${user(u.id)} may compete again.`,
            ),
          ],
          flags: EPHEMERAL,
        });
        return;
      }
      case 'reset': {
        requireLevel(ctx, PermissionLevel.ADMIN);
        const p = await findPlayer(ctx.guild.id, u.id);
        if (!p)
          throw new DomainError('NO_PLAYER', `${user(u.id)} has no stats to reset.`, 'Nothing to reset');
        await i.reply({
          embeds: [resetDangerEmbed(ctx.theme, 'user', u.id, false)],
          components: resetButtons(ctx.theme, 'user', p.id, false),
          flags: EPHEMERAL,
        });
        return;
      }
    }
  },
};

export const staffCommands: SlashCommand[] = [matchCommand, requestEvidenceCommand, playerCommand];
