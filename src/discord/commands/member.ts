import { InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { DomainError } from '../../core/errors.js';
import { db } from '../../database/client.js';
import { attachChallengeMessage, createChallenge } from '../../modules/challenges/challenge.service.js';
import { ensurePlayer, getRank, countPlayers } from '../../modules/players/player.service.js';
import { LEADERBOARD_TYPES, getLeaderboardPage } from '../../modules/leaderboard/leaderboard.service.js';
import type { LeaderboardType } from '../../modules/leaderboard/leaderboard.service.js';
import { headToHead, playerHistory, recentForm } from '../../modules/history/history.service.js';
import {
  countCompletedMatches,
  countLiveMatches,
  findCurrentMatch,
} from '../../modules/matches/match.service.js';
import { currentSeason } from '../../modules/seasons/season.service.js';
import { PermissionLevel, hasLevel } from '../../modules/permissions/permissions.js';
import type { Ctx } from '../context.js';
import { identityOf, runtimeEnv } from '../context.js';
import { rememberChallengeOrigin, scheduleChallengeExpiry } from '../jobs.js';
import { resolveMatchCategory } from '../managers/channels.js';
import {
  aboutEmbed,
  challengeEmbed,
  headToHeadEmbed,
  helpEmbed,
  historyEmbed,
  infoEmbed,
  leaderboardEmbed,
  matchSummaryEmbed,
  profileEmbed,
  statusEmbed,
} from '../ui/embeds.js';
import { challengeButtons, helpSelect, pagerRow } from '../ui/components.js';
import { Ids } from '../ids.js';
import type { SlashCommand } from './types.js';
import { Brand } from '../ui/lore.js';

const guildOnly = [InteractionContextType.Guild];

// ───────────────────────────── /1v1 and /challenge ─────────────────────────────

async function runChallenge(i: ChatInputCommandInteraction<'cached'>, ctx: Ctx): Promise<void> {
  const targetUser = i.options.getUser('opponent', true);
  const target = i.options.getMember('opponent');
  if (targetUser.bot) throw new DomainError('BOT_TARGET', 'Bots cannot be challenged.', 'Invalid challenge');
  if (targetUser.id === i.user.id)
    throw new DomainError('SELF_CHALLENGE', 'You cannot challenge yourself.', 'Invalid challenge');
  if (!target)
    throw new DomainError(
      'NOT_MEMBER',
      `<@${targetUser.id}> is not a member of this server.`,
      'Invalid challenge',
    );

  // Make sure a match could actually be hosted before anyone is asked to accept.
  await resolveMatchCategory(ctx.guild, ctx.config);

  const challenge = await createChallenge({
    guildId: ctx.guild.id,
    config: ctx.config,
    challenger: identityOf(ctx.member),
    target: identityOf(target),
  });
  await i.reply({
    content: `<@${target.id}>, you have been challenged.`,
    embeds: [challengeEmbed(ctx.theme, challenge, 'PENDING')],
    components: challengeButtons(ctx.theme, challenge.id),
    allowedMentions: { users: [target.id] },
  });
  const message = await i.fetchReply();
  await attachChallengeMessage(challenge.id, message.channelId, message.id);
  rememberChallengeOrigin(challenge.id, i);
  scheduleChallengeExpiry(i.client, challenge.id, challenge.expiresAt);
}

function challengeCommand(name: string, description: string): SlashCommand {
  return {
    data: new SlashCommandBuilder()
      .setName(name)
      .setDescription(description)
      .setContexts(guildOnly)
      .addUserOption((o) =>
        o.setName('opponent').setDescription('The angel you want to duel').setRequired(true),
      )
      .toJSON(),
    level: PermissionLevel.MEMBER,
    cooldown: (c) => c.challengeCommandCooldownSec,
    execute: runChallenge,
  };
}

// ───────────────────────────── /stats ─────────────────────────────

const stats: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('View a player profile')
    .setContexts(guildOnly)
    .addUserOption((o) => o.setName('player').setDescription('Leave empty for your own profile'))
    .toJSON(),
  level: PermissionLevel.MEMBER,
  cooldown: () => 3,
  async execute(i, ctx) {
    const member = i.options.getMember('player') ?? ctx.member;
    const u = i.options.getUser('player') ?? i.user;
    if (u.bot) throw new DomainError('BOT_TARGET', 'Bots do not fight in the arena.', 'No profile');
    const player = await ensurePlayer(
      ctx.guild.id,
      member ? identityOf(member) : { discordId: u.id, username: u.username, displayName: u.displayName },
      ctx.config.startingElo,
    );
    const [rank, form] = await Promise.all([
      getRank(player, ctx.config.minLeaderboardMatches),
      recentForm(player, 5),
    ]);
    await i.reply({
      embeds: [
        profileEmbed(ctx.theme, player, {
          rank,
          minMatches: ctx.config.minLeaderboardMatches,
          form,
          avatarURL: (member ?? u).displayAvatarURL({ size: 256 }),
          accountCreated: u.createdAt,
        }),
      ],
      allowedMentions: { parse: [] },
    });
  },
};

// ───────────────────────────── /leaderboard ─────────────────────────────

export async function renderLeaderboard(
  ctx: Ctx,
  type: LeaderboardType,
  size: number,
  page: number,
  ownerId: string,
) {
  const lb = await getLeaderboardPage(ctx.guild.id, type, size, page, ctx.config.minLeaderboardMatches);
  return {
    embeds: [leaderboardEmbed(ctx.theme, type, lb, ctx.config.minLeaderboardMatches)],
    components: pagerRow(ctx.theme, (p) => Ids.page.leaderboard(type, size, p, ownerId), lb.page, lb.pages),
    allowedMentions: { parse: [] as never[] },
  };
}

const leaderboard: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('View the Seven Angels rankings')
    .setContexts(guildOnly)
    .addStringOption((o) =>
      o
        .setName('type')
        .setDescription('Ranking type (default: ELO)')
        .addChoices(
          { name: 'ELO', value: 'elo' },
          { name: 'Wins', value: 'wins' },
          { name: 'Win Rate', value: 'winrate' },
          { name: 'Win Streak', value: 'streak' },
          { name: 'Matches Played', value: 'matches' },
        ),
    )
    .addIntegerOption((o) =>
      o
        .setName('size')
        .setDescription('How many players to rank (default 10)')
        .setMinValue(5)
        .setMaxValue(50),
    )
    .toJSON(),
  level: PermissionLevel.MEMBER,
  cooldown: () => 3,
  async execute(i, ctx) {
    const raw = i.options.getString('type') ?? 'elo';
    const type = (LEADERBOARD_TYPES as readonly string[]).includes(raw) ? (raw as LeaderboardType) : 'elo';
    const size = Math.min(i.options.getInteger('size') ?? 10, ctx.config.maxLeaderboardSize);
    await i.reply(await renderLeaderboard(ctx, type, size, 0, i.user.id));
  },
};

// ───────────────────────────── /history ─────────────────────────────

export async function renderHistory(
  ctx: Ctx,
  targetDiscordId: string,
  limit: number,
  page: number,
  ownerId: string,
) {
  const player = await db().player.findUnique({
    where: { guildId_discordId: { guildId: ctx.guild.id, discordId: targetDiscordId } },
  });
  if (!player)
    throw new DomainError(
      'NO_PLAYER',
      `<@${targetDiscordId}> has not played in the arena yet.`,
      'No history',
    );
  const h = await playerHistory(player, limit, page);
  return {
    embeds: [historyEmbed(ctx.theme, player, h)],
    components: pagerRow(
      ctx.theme,
      (p) => Ids.page.history(targetDiscordId, limit, p, ownerId),
      h.page,
      h.pages,
    ),
    allowedMentions: { parse: [] as never[] },
  };
}

const history: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('history')
    .setDescription('View completed matches')
    .setContexts(guildOnly)
    .addUserOption((o) => o.setName('player').setDescription('Leave empty for your own history'))
    .addIntegerOption((o) =>
      o
        .setName('limit')
        .setDescription('How many matches (default 10, max 50)')
        .setMinValue(1)
        .setMaxValue(50),
    )
    .toJSON(),
  level: PermissionLevel.MEMBER,
  cooldown: () => 3,
  async execute(i, ctx) {
    const target = i.options.getUser('player') ?? i.user;
    const limit = i.options.getInteger('limit') ?? 10;
    await i.reply(await renderHistory(ctx, target.id, limit, 0, i.user.id));
  },
};

// ───────────────────────────── /currentmatch ─────────────────────────────

const currentmatch: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('currentmatch')
    .setDescription('View your match in progress')
    .setContexts(guildOnly)
    .toJSON(),
  level: PermissionLevel.MEMBER,
  async execute(i, ctx) {
    const match = await findCurrentMatch(ctx.guild.id, i.user.id);
    if (!match) {
      await i.reply({
        embeds: [infoEmbed(ctx.theme, 'No current match', 'You are not currently in a match.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await i.reply({
      embeds: [
        matchSummaryEmbed(ctx.theme, match, { viewerDiscordId: i.user.id }).setTitle(
          ctx.theme.emojis ? '⚔️ CURRENT MATCH' : 'CURRENT MATCH',
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  },
};

// ───────────────────────────── /headtohead ─────────────────────────────

const headtohead: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('headtohead')
    .setDescription('Compare your record against another angel')
    .setContexts(guildOnly)
    .addUserOption((o) => o.setName('opponent').setDescription('The other player').setRequired(true))
    .addUserOption((o) => o.setName('player').setDescription('Compare someone else instead of yourself'))
    .toJSON(),
  level: PermissionLevel.MEMBER,
  cooldown: () => 3,
  async execute(i, ctx) {
    const aUser = i.options.getUser('player') ?? i.user;
    const bUser = i.options.getUser('opponent', true);
    if (aUser.id === bUser.id)
      throw new DomainError('SAME_PLAYER', 'Choose two different players.', 'Invalid players');
    const find = (id: string) =>
      db().player.findUnique({ where: { guildId_discordId: { guildId: ctx.guild.id, discordId: id } } });
    const [a, b] = await Promise.all([find(aUser.id), find(bUser.id)]);
    if (!a || !b)
      throw new DomainError('NO_PLAYER', 'Both players need to have played in the arena.', 'No record');
    await i.reply({
      embeds: [headToHeadEmbed(ctx.theme, a, b, await headToHead(a, b))],
      allowedMentions: { parse: [] },
    });
  },
};

// ───────────────────────────── /help /about /botstatus ─────────────────────────────

const help: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription(`How to use ${Brand.name}`)
    .setContexts(guildOnly)
    .toJSON(),
  level: PermissionLevel.MEMBER,
  async execute(i, ctx) {
    await i.reply({
      embeds: [helpEmbed(ctx.theme, null)],
      components: helpSelect(ctx.theme, null),
      flags: MessageFlags.Ephemeral,
    });
  },
};

const about: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('about')
    .setDescription(`About ${Brand.name} and the Seven Angels`)
    .setContexts(guildOnly)
    .toJSON(),
  level: PermissionLevel.MEMBER,
  async execute(i, ctx) {
    await i.reply({ embeds: [aboutEmbed(ctx.theme, await currentSeason(ctx.guild.id))] });
  },
};

const startedAt = Date.now();

const botstatus: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('botstatus')
    .setDescription('Bot, database and arena status')
    .setContexts(guildOnly)
    .toJSON(),
  level: PermissionLevel.MEMBER,
  cooldown: () => 5,
  async execute(i, ctx) {
    let dbOk = true;
    let dbLatency: number | null = null;
    const t = Date.now();
    try {
      await db().$queryRaw`SELECT 1`;
      dbLatency = Date.now() - t;
    } catch {
      dbOk = false;
    }
    const [live, players, completed] = dbOk
      ? await Promise.all([
          countLiveMatches(ctx.guild.id),
          countPlayers(ctx.guild.id),
          countCompletedMatches(ctx.guild.id),
        ])
      : [0, 0, 0];
    const admin = hasLevel(ctx.level, PermissionLevel.ADMIN)
      ? {
          memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
          node: process.version,
          guilds: i.client.guilds.cache.size,
          env: runtimeEnv().NODE_ENV,
        }
      : undefined;
    await i.reply({
      embeds: [
        statusEmbed(ctx.theme, {
          latency: Math.round(i.client.ws.ping),
          dbOk,
          dbLatency,
          live,
          players,
          completed,
          uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
          maintenance: ctx.config.maintenanceMode,
          admin,
        }),
      ],
      flags: admin ? MessageFlags.Ephemeral : undefined,
    });
  },
};

export const memberCommands: SlashCommand[] = [
  challengeCommand('1v1', 'Challenge another angel to a 1v1 duel'),
  challengeCommand('challenge', 'Challenge another angel to a 1v1 duel (alias of /1v1)'),
  stats,
  leaderboard,
  history,
  currentmatch,
  headtohead,
  help,
  about,
  botstatus,
];
