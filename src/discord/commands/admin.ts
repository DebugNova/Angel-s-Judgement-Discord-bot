import { ChannelType, InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import type { GuildConfig, Prisma } from '@prisma/client';
import { DomainError } from '../../core/errors.js';
import { AuditAction, audit } from '../../modules/audit/audit.service.js';
import { updateConfig } from '../../modules/configuration/config.service.js';
import { findPlayer } from '../../modules/players/player.service.js';
import { PermissionLevel } from '../../modules/permissions/permissions.js';
import { currentSeason, endSeason, startSeason } from '../../modules/seasons/season.service.js';
import type { Ctx } from '../context.js';
import { themeFor } from '../context.js';
import { REQUIRED_CATEGORY_PERMISSIONS } from '../managers/channels.js';
import { refreshLeaderboardPanel } from '../managers/notify.js';
import { configEmbed, resetDangerEmbed, successEmbed } from '../ui/embeds.js';
import { resetButtons, roleSelect } from '../ui/components.js';
import { requireLevel } from './shared.js';
import type { SlashCommand } from './types.js';

const guildOnly = [InteractionContextType.Guild];
const EPHEMERAL = MessageFlags.Ephemeral;
const TEXT_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement] as const;

type ChannelKey =
  'historyChannelId' | 'logChannelId' | 'leaderboardChannelId' | 'staffChannelId' | 'modLogChannelId';
const CHANNEL_KEYS: Record<string, ChannelKey> = {
  modlog: 'modLogChannelId',
  history: 'historyChannelId',
  logs: 'logChannelId',
  leaderboard: 'leaderboardChannelId',
  staff: 'staffChannelId',
};

async function saveConfig(
  i: ChatInputCommandInteraction<'cached'>,
  ctx: Ctx,
  data: Prisma.GuildConfigUpdateInput,
  summary: string,
): Promise<GuildConfig> {
  const updated = await updateConfig(ctx.guild.id, data);
  const metadata: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) metadata[k] = Array.isArray(v) ? v.join(',') : String(v);
  await audit({ guildId: ctx.guild.id, actorId: i.user.id, action: AuditAction.CONFIG_CHANGED, metadata });
  await i.reply({
    embeds: [successEmbed(themeFor(updated, i.client), 'Configuration updated', summary)],
    flags: EPHEMERAL,
    allowedMentions: { parse: [] },
  });
  return updated;
}

function nothingChanged(): DomainError {
  return new DomainError('NO_OPTIONS', 'Provide at least one option to change.', 'Nothing to update');
}

const configCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Admin: configure the arena')
    .setContexts(guildOnly)
    .addSubcommand((s) => s.setName('view').setDescription('Show the current configuration'))
    .addSubcommandGroup((g) =>
      g
        .setName('channel')
        .setDescription('Choose the channels the bot uses')
        .addSubcommand((s) =>
          s
            .setName('matches')
            .setDescription('The category where private match channels are created')
            .addChannelOption((o) =>
              o
                .setName('category')
                .setDescription('A category')
                .addChannelTypes(ChannelType.GuildCategory)
                .setRequired(true),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName('history')
            .setDescription('Public match history records')
            .addChannelOption((o) =>
              o
                .setName('channel')
                .setDescription('A text channel')
                .addChannelTypes(...TEXT_TYPES)
                .setRequired(true),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName('logs')
            .setDescription('Staff log of every important event')
            .addChannelOption((o) =>
              o
                .setName('channel')
                .setDescription('A text channel')
                .addChannelTypes(...TEXT_TYPES)
                .setRequired(true),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName('leaderboard')
            .setDescription('A live, auto-updating leaderboard')
            .addChannelOption((o) =>
              o
                .setName('channel')
                .setDescription('A text channel')
                .addChannelTypes(...TEXT_TYPES)
                .setRequired(true),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName('staff')
            .setDescription('Where referees are alerted about disputes')
            .addChannelOption((o) =>
              o
                .setName('channel')
                .setDescription('A text channel')
                .addChannelTypes(...TEXT_TYPES)
                .setRequired(true),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName('modlog')
            .setDescription('Where every moderation case is posted (default: the logs channel)')
            .addChannelOption((o) =>
              o
                .setName('channel')
                .setDescription('A text channel (keep it staff-only)')
                .addChannelTypes(...TEXT_TYPES)
                .setRequired(true),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName('clear')
            .setDescription('Unset one of the channels')
            .addStringOption((o) =>
              o
                .setName('type')
                .setDescription('Which channel to unset')
                .setRequired(true)
                .addChoices(
                  { name: 'matches (category)', value: 'matches' },
                  { name: 'history', value: 'history' },
                  { name: 'logs', value: 'logs' },
                  { name: 'leaderboard', value: 'leaderboard' },
                  { name: 'staff', value: 'staff' },
                  { name: 'modlog', value: 'modlog' },
                ),
            ),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('roles')
        .setDescription('Choose which roles get staff powers')
        .addStringOption((o) =>
          o.setName('level').setDescription('Permission level').setRequired(true).addChoices(
            { name: 'referee — review disputes, decide results', value: 'referee' },
            { name: 'moderator — cancel, force-complete, restrict players', value: 'moderator' },
            { name: 'admin — configuration and resets (owner only)', value: 'admin' },
            {
              name: 'moderation — the ONLY roles allowed to /ban /kick /warn… (owner only)',
              value: 'moderation',
            },
          ),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('moderation')
        .setDescription('Moderation settings')
        .addBooleanOption((o) =>
          o
            .setName('dm_members')
            .setDescription(
              'By default, tell members by DM when they are warned, timed out, kicked or banned',
            )
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('elo')
        .setDescription('Rating settings')
        .addIntegerOption((o) =>
          o
            .setName('starting')
            .setDescription('Starting ELO (default 1000)')
            .setMinValue(0)
            .setMaxValue(10000),
        )
        .addIntegerOption((o) =>
          o.setName('kfactor').setDescription('K-factor (default 48)').setMinValue(1).setMaxValue(200),
        )
        .addIntegerOption((o) =>
          o
            .setName('minimum')
            .setDescription('Lowest possible ELO (default 0)')
            .setMinValue(0)
            .setMaxValue(10000),
        )
        .addIntegerOption((o) =>
          o
            .setName('maximum')
            .setDescription('Highest possible ELO (default 5000)')
            .setMinValue(1)
            .setMaxValue(100000),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('cooldown')
        .setDescription('Cooldowns (seconds)')
        .addIntegerOption((o) =>
          o
            .setName('pair')
            .setDescription('After a decline, same pair (default 60)')
            .setMinValue(0)
            .setMaxValue(86400),
        )
        .addIntegerOption((o) =>
          o
            .setName('global')
            .setDescription('After a decline, any challenge (0 = off)')
            .setMinValue(0)
            .setMaxValue(86400),
        )
        .addIntegerOption((o) =>
          o
            .setName('command')
            .setDescription('Between /1v1 uses (default 10)')
            .setMinValue(0)
            .setMaxValue(3600),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('challenge')
        .setDescription('Challenge settings')
        .addIntegerOption((o) =>
          o
            .setName('timeout')
            .setDescription('Seconds to respond (default 60)')
            .setMinValue(15)
            .setMaxValue(900),
        )
        .addIntegerOption((o) =>
          o
            .setName('max_incoming')
            .setDescription('Pending challenges a player can receive (default 3)')
            .setMinValue(1)
            .setMaxValue(10),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('matches')
        .setDescription('Match settings')
        .addIntegerOption((o) =>
          o
            .setName('max_active')
            .setDescription('Max simultaneous matches (0 = unlimited)')
            .setMinValue(0)
            .setMaxValue(45),
        )
        .addBooleanOption((o) =>
          o.setName('auto_delete').setDescription('Delete match channels after completion'),
        )
        .addIntegerOption((o) =>
          o
            .setName('delete_after')
            .setDescription('Delay before deleting a finished match channel')
            .addChoices(
              { name: '5 minutes', value: 300 },
              { name: '10 minutes', value: 600 },
              { name: '30 minutes', value: 1800 },
              { name: '1 hour', value: 3600 },
            ),
        )
        .addStringOption((o) =>
          o
            .setName('channel_prefix')
            .setDescription('Channel names, e.g. "queue" → queue-001')
            .setMaxLength(20),
        )
        .addStringOption((o) =>
          o.setName('id_prefix').setDescription('Match IDs, e.g. "SA" → SA-000001').setMaxLength(6),
        )
        .addBooleanOption((o) =>
          o.setName('evidence_required').setDescription('Require a screenshot before reporting'),
        )
        .addBooleanOption((o) =>
          o.setName('sticky_panel').setDescription('Keep the match panel as the latest message'),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('leaderboard')
        .setDescription('Leaderboard settings')
        .addIntegerOption((o) =>
          o
            .setName('min_matches')
            .setDescription('Matches needed to be ranked (default 5)')
            .setMinValue(0)
            .setMaxValue(100),
        )
        .addIntegerOption((o) =>
          o
            .setName('max_size')
            .setDescription('Largest /leaderboard size (default 30)')
            .setMinValue(10)
            .setMaxValue(50),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('display')
        .setDescription('Display settings')
        .addBooleanOption((o) =>
          o.setName('emojis').setDescription('Use emojis in embeds and buttons').setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('season')
        .setDescription('Seasons')
        .addStringOption((o) =>
          o
            .setName('action')
            .setDescription('What to do')
            .setRequired(true)
            .addChoices(
              { name: 'start a new season', value: 'start' },
              { name: 'end the current season', value: 'end' },
              { name: 'view', value: 'view' },
            ),
        )
        .addStringOption((o) => o.setName('name').setDescription('Name for a new season').setMaxLength(50)),
    )
    .toJSON(),
  level: PermissionLevel.ADMIN,
  async execute(i, ctx) {
    const group = i.options.getSubcommandGroup(false);
    const sub = i.options.getSubcommand();

    if (group === 'channel') {
      if (sub === 'matches') {
        const category = i.options.getChannel('category', true, [ChannelType.GuildCategory]);
        const me = ctx.guild.members.me ?? (await ctx.guild.members.fetchMe());
        const missing = category.permissionsFor(me).missing(REQUIRED_CATEGORY_PERMISSIONS);
        const warn =
          missing.length > 0
            ? `\n\n⚠️ I am missing these permissions in that category: **${missing.join(', ')}**. Matches cannot start until they are granted.`
            : '';
        await saveConfig(
          i,
          ctx,
          { matchCategoryId: category.id },
          `Match channels will be created in **${category.name}**.${warn}`,
        );
        return;
      }
      if (sub === 'clear') {
        const type = i.options.getString('type', true);
        const data: Prisma.GuildConfigUpdateInput =
          type === 'matches'
            ? { matchCategoryId: null }
            : type === 'leaderboard'
              ? { leaderboardChannelId: null, leaderboardMessageId: null }
              : { [CHANNEL_KEYS[type]!]: null };
        await saveConfig(i, ctx, data, `The **${type}** channel was unset.`);
        return;
      }
      const key = CHANNEL_KEYS[sub];
      if (!key) return;
      const channel = i.options.getChannel('channel', true, [...TEXT_TYPES]);
      const me = ctx.guild.members.me ?? (await ctx.guild.members.fetchMe());
      const missing = channel.permissionsFor(me).missing(['ViewChannel', 'SendMessages', 'EmbedLinks']);
      if (missing.length > 0) {
        throw new DomainError(
          'BOT_PERMISSIONS',
          `I need **${missing.join(', ')}** in ${channel} before it can be used.`,
          'Missing permissions',
        );
      }
      const data: Prisma.GuildConfigUpdateInput = {
        [key]: channel.id,
        ...(sub === 'leaderboard' ? { leaderboardMessageId: null } : {}),
      };
      await saveConfig(i, ctx, data, `The **${sub}** channel is now ${channel}.`);
      if (sub === 'leaderboard') await refreshLeaderboardPanel(i.client, ctx.guild.id);
      return;
    }

    switch (sub) {
      case 'view': {
        await i.reply({
          embeds: [configEmbed(ctx.theme, ctx.config, await currentSeason(ctx.guild.id))],
          flags: EPHEMERAL,
          allowedMentions: { parse: [] },
        });
        return;
      }
      case 'roles': {
        const level = i.options.getString('level', true);
        if (level === 'admin' || level === 'moderation') requireLevel(ctx, PermissionLevel.OWNER);
        const current =
          level === 'referee'
            ? ctx.config.refereeRoleIds
            : level === 'moderator'
              ? ctx.config.moderatorRoleIds
              : level === 'moderation'
                ? ctx.config.moderationRoleIds
                : ctx.config.adminRoleIds;
        await i.reply({
          content: `Select the **${level}** roles. Your selection replaces the current list.`,
          components: roleSelect(level, current),
          flags: EPHEMERAL,
        });
        return;
      }
      case 'elo': {
        const starting = i.options.getInteger('starting') ?? ctx.config.startingElo;
        const kFactor = i.options.getInteger('kfactor') ?? ctx.config.kFactor;
        const minElo = i.options.getInteger('minimum') ?? ctx.config.minElo;
        const maxElo = i.options.getInteger('maximum') ?? ctx.config.maxElo;
        if (!['starting', 'kfactor', 'minimum', 'maximum'].some((o) => i.options.get(o)))
          throw nothingChanged();
        if (minElo >= maxElo)
          throw new DomainError('BAD_RANGE', 'Minimum ELO must be lower than maximum ELO.', 'Invalid values');
        if (starting < minElo || starting > maxElo)
          throw new DomainError(
            'BAD_RANGE',
            'Starting ELO must be between the minimum and maximum.',
            'Invalid values',
          );
        await saveConfig(
          i,
          ctx,
          { startingElo: starting, kFactor, minElo, maxElo },
          `Starting **${starting}** • K **${kFactor}** • Min **${minElo}** • Max **${maxElo}**\nStarting ELO applies to new players; use \`/resetstats elo\` to re-baseline everyone.`,
        );
        return;
      }
      case 'cooldown': {
        const data: Prisma.GuildConfigUpdateInput = {};
        const pair = i.options.getInteger('pair');
        const global = i.options.getInteger('global');
        const command = i.options.getInteger('command');
        if (pair !== null) data.pairCooldownSec = pair;
        if (global !== null) data.globalCooldownSec = global;
        if (command !== null) data.challengeCommandCooldownSec = command;
        if (Object.keys(data).length === 0) throw nothingChanged();
        await saveConfig(i, ctx, data, 'Cooldowns updated.');
        return;
      }
      case 'challenge': {
        const data: Prisma.GuildConfigUpdateInput = {};
        const timeout = i.options.getInteger('timeout');
        const maxIncoming = i.options.getInteger('max_incoming');
        if (timeout !== null) data.challengeTimeoutSec = timeout;
        if (maxIncoming !== null) data.maxIncomingChallenges = maxIncoming;
        if (Object.keys(data).length === 0) throw nothingChanged();
        await saveConfig(i, ctx, data, 'Challenge settings updated.');
        return;
      }
      case 'matches': {
        const data: Prisma.GuildConfigUpdateInput = {};
        const maxActive = i.options.getInteger('max_active');
        const autoDelete = i.options.getBoolean('auto_delete');
        const deleteAfter = i.options.getInteger('delete_after');
        const channelPrefix = i.options.getString('channel_prefix');
        const idPrefix = i.options.getString('id_prefix');
        const evidence = i.options.getBoolean('evidence_required');
        const sticky = i.options.getBoolean('sticky_panel');
        if (maxActive !== null) data.maxActiveMatches = maxActive;
        if (autoDelete !== null) data.autoDeleteChannels = autoDelete;
        if (deleteAfter !== null) data.autoDeleteDelaySec = deleteAfter;
        if (channelPrefix !== null) {
          const clean = channelPrefix.toLowerCase().replace(/[^a-z0-9-]/g, '');
          if (!clean)
            throw new DomainError(
              'BAD_PREFIX',
              'Channel prefix may only contain letters, numbers and dashes.',
              'Invalid prefix',
            );
          data.channelPrefix = clean;
        }
        if (idPrefix !== null) {
          const clean = idPrefix.toUpperCase().replace(/[^A-Z0-9]/g, '');
          if (!clean)
            throw new DomainError(
              'BAD_PREFIX',
              'Match ID prefix may only contain letters and numbers.',
              'Invalid prefix',
            );
          data.matchIdPrefix = clean;
        }
        if (evidence !== null) data.evidenceRequired = evidence;
        if (sticky !== null) data.stickyPanel = sticky;
        if (Object.keys(data).length === 0) throw nothingChanged();
        await saveConfig(i, ctx, data, 'Match settings updated. They apply to new matches.');
        return;
      }
      case 'leaderboard': {
        const data: Prisma.GuildConfigUpdateInput = {};
        const min = i.options.getInteger('min_matches');
        const max = i.options.getInteger('max_size');
        if (min !== null) data.minLeaderboardMatches = min;
        if (max !== null) data.maxLeaderboardSize = max;
        if (Object.keys(data).length === 0) throw nothingChanged();
        await saveConfig(i, ctx, data, 'Leaderboard settings updated.');
        await refreshLeaderboardPanel(i.client, ctx.guild.id);
        return;
      }
      case 'moderation': {
        const dm = i.options.getBoolean('dm_members', true);
        await saveConfig(
          i,
          ctx,
          { modDmMembers: dm },
          `Members ${dm ? '**will**' : 'will **not**'} be told by DM by default. Moderators can still choose per action with the \`dm\` option.`,
        );
        return;
      }
      case 'display': {
        const emojis = i.options.getBoolean('emojis', true);
        await saveConfig(i, ctx, { useEmojis: emojis }, `Emojis are now **${emojis ? 'on' : 'off'}**.`);
        return;
      }
      case 'season': {
        const action = i.options.getString('action', true);
        if (action === 'view') {
          const s = await currentSeason(ctx.guild.id);
          await i.reply({
            embeds: [
              successEmbed(
                ctx.theme,
                'Season',
                s
                  ? `**${s.name}** (#${s.number}) — started <t:${Math.floor(s.startDate.getTime() / 1000)}:D>`
                  : 'No season is active.',
              ),
            ],
            flags: EPHEMERAL,
          });
          return;
        }
        if (action === 'start') {
          const name = i.options.getString('name')?.trim();
          if (!name)
            throw new DomainError('NO_NAME', 'Provide a `name` for the new season.', 'Name required');
          const s = await startSeason(ctx.guild.id, name, i.user.id);
          await i.reply({
            embeds: [
              successEmbed(
                ctx.theme,
                'Season started',
                `**${s.name}** (#${s.number}) has begun. New matches belong to this season.`,
              ),
            ],
            flags: EPHEMERAL,
          });
          return;
        }
        const s = await endSeason(ctx.guild.id, i.user.id);
        await i.reply({
          embeds: [successEmbed(ctx.theme, 'Season ended', `**${s.name}** has ended.`)],
          flags: EPHEMERAL,
        });
        return;
      }
    }
  },
};

const resetCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('resetstats')
    .setDescription('Admin: reset competitive stats (requires typed confirmation)')
    .setContexts(guildOnly)
    .addStringOption((o) =>
      o
        .setName('scope')
        .setDescription('What to reset')
        .setRequired(true)
        .addChoices(
          { name: 'all — every stat for every player', value: 'all' },
          { name: 'elo — ratings only', value: 'elo' },
          { name: 'streak — win streaks only', value: 'streak' },
          { name: 'user — one player', value: 'user' },
        ),
    )
    .addUserOption((o) => o.setName('player').setDescription('Required when scope is "user"'))
    .addBooleanOption((o) =>
      o
        .setName('delete_history')
        .setDescription('Scope "all" only: also permanently delete finished match records'),
    )
    .toJSON(),
  level: PermissionLevel.ADMIN,
  async execute(i, ctx) {
    const scope = i.options.getString('scope', true);
    const target = i.options.getUser('player');
    const del = scope === 'all' && (i.options.getBoolean('delete_history') ?? false);
    let playerId = '-';
    if (scope === 'user') {
      if (!target) throw new DomainError('MISSING_USER', 'Choose the `player` to reset.', 'Missing player');
      const p = await findPlayer(ctx.guild.id, target.id);
      if (!p)
        throw new DomainError('NO_PLAYER', `<@${target.id}> has no stats to reset.`, 'Nothing to reset');
      playerId = p.id;
    }
    await i.reply({
      embeds: [resetDangerEmbed(ctx.theme, scope, target?.id ?? null, del)],
      components: resetButtons(ctx.theme, scope, playerId, del),
      flags: EPHEMERAL,
    });
  },
};

const maintenanceCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('maintenance')
    .setDescription('Admin: pause or resume new challenges')
    .setContexts(guildOnly)
    .addBooleanOption((o) =>
      o.setName('enabled').setDescription('true = pause matchmaking').setRequired(true),
    )
    .addStringOption((o) =>
      o.setName('message').setDescription('Message shown to players while paused').setMaxLength(200),
    )
    .toJSON(),
  level: PermissionLevel.ADMIN,
  async execute(i, ctx) {
    const enabled = i.options.getBoolean('enabled', true);
    const message = i.options.getString('message');
    await updateConfig(ctx.guild.id, {
      maintenanceMode: enabled,
      maintenanceMessage: enabled ? message : null,
    });
    await audit({
      guildId: ctx.guild.id,
      actorId: i.user.id,
      action: AuditAction.MAINTENANCE_CHANGED,
      metadata: { enabled, message },
    });
    await i.reply({
      embeds: [
        successEmbed(
          ctx.theme,
          enabled ? 'Maintenance enabled' : 'Maintenance disabled',
          enabled
            ? 'New challenges and accepts are paused. Matches in progress continue normally.'
            : 'The arena is open again.',
        ),
      ],
      flags: EPHEMERAL,
    });
  },
};

export const adminCommands: SlashCommand[] = [configCommand, resetCommand, maintenanceCommand];
