import { ChannelType, InteractionContextType, SlashCommandBuilder } from 'discord.js';
import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  GuildTextBasedChannel,
  SlashCommandBooleanOption,
  SlashCommandStringOption,
} from 'discord.js';
import { DomainError } from '../../core/errors.js';
import { memberRecord, removeWarning } from '../../modules/moderation/cases.service.js';
import { formatDuration, parseDuration, parseTimeoutDuration } from '../../modules/moderation/duration.js';
import { describePurgeFilter } from '../../modules/moderation/filters.js';
import type { PurgeFilter } from '../../modules/moderation/filters.js';
import { PermissionLevel, hasModerationAccess } from '../../modules/permissions/permissions.js';
import type { Ctx } from '../context.js';
import type { SlashCommand } from '../commands/types.js';
import { pagerRow } from '../ui/components.js';
import { Ids } from '../ids.js';
import { confirmButtons, confirmEmbed, recordEmbed, warningRemovedEmbed } from '../ui/moderation.js';
import { ts, user } from '../ui/theme.js';
import {
  DELETE_WINDOWS,
  banMember,
  changeRole,
  kickMember,
  lockChannel,
  planBan,
  planKick,
  prepareScan,
  purgeMessages,
  setSlowmode,
  timeoutMember,
  unbanUser,
  untimeoutMember,
  unlockChannel,
  warnMember,
} from './actions.js';
import { addPending, cleanReason, requireModeration, runModeration } from './common.js';
import type { Reply } from './common.js';
import { estimateSeconds, prepareMassRole, startMassRole } from './massrole.js';

const guildOnly = [InteractionContextType.Guild];
const CHANNEL_TYPES = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildVoice,
  ChannelType.GuildStageVoice,
] as const;
/** Purges up to this size run straight away; bigger ones show a preview first. */
const PURGE_CONFIRM_ABOVE = 10;

const reasonOpt =
  (required = false) =>
  (o: SlashCommandStringOption) =>
    o
      .setName('reason')
      .setDescription('Why (shown in the mod-log and, if DMs are on, to the member)')
      .setMaxLength(500)
      .setRequired(required);
const dmOpt = (o: SlashCommandBooleanOption) =>
  o.setName('dm').setDescription('Tell the member by DM (default: server setting)');

function wantDm(i: ChatInputCommandInteraction<'cached'>, ctx: Ctx): boolean {
  return i.options.getBoolean('dm') ?? ctx.config.modDmMembers;
}

function reasonOf(i: ChatInputCommandInteraction<'cached'>): string | null {
  return cleanReason(i.options.getString('reason'));
}

async function currentChannel(i: ChatInputCommandInteraction<'cached'>): Promise<GuildTextBasedChannel> {
  const ch = i.channel ?? (await i.guild.channels.fetch(i.channelId).catch(() => null));
  if (!ch || !ch.isTextBased()) {
    throw new DomainError('BAD_CHANNEL', 'Run this in a text channel.', 'Not possible here');
  }
  return ch as GuildTextBasedChannel;
}

function channelOption(i: ChatInputCommandInteraction<'cached'>): GuildTextBasedChannel | null {
  const ch = i.options.getChannel('channel', false, [...CHANNEL_TYPES]);
  return ch ? (ch as GuildTextBasedChannel) : null;
}

async function recordSummary(ctx: Ctx, targetId: string): Promise<string | null> {
  const r = await memberRecord(ctx.guild.id, targetId, 0, 1);
  if (r.total === 0) return null;
  const c = r.counts;
  return `Record: **${r.activeWarnings}** active warning(s) • ${c.TIMEOUT ?? 0} timeout(s) • ${c.KICK ?? 0} kick(s) • ${c.BAN ?? 0} ban(s)`;
}

// ───── Warnings ─────

const warn: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Moderation: warn a member (recorded with a case number)')
    .setContexts(guildOnly)
    .addUserOption((o) => o.setName('member').setDescription('Who to warn').setRequired(true))
    .addStringOption(reasonOpt(true))
    .addBooleanOption(dmOpt)
    .toJSON(),
  level: PermissionLevel.MEMBER,
  async execute(i, ctx) {
    requireModeration(ctx);
    const target = i.options.getUser('member', true);
    await runModeration(i, ctx, async () => ({
      embeds: [await warnMember(ctx, { targetId: target.id, reason: reasonOf(i), dm: wantDm(i, ctx) })],
    }));
  },
};

export async function renderRecord(ctx: Ctx, targetId: string, page: number, owner: string): Promise<Reply> {
  const PAGE = 8;
  const rec = await memberRecord(ctx.guild.id, targetId, page, PAGE);
  const pages = Math.max(1, Math.ceil(rec.total / PAGE));
  const u = await ctx.guild.client.users.fetch(targetId).catch(() => null);
  return {
    embeds: [
      recordEmbed(
        ctx.theme,
        {
          id: targetId,
          name: u?.username ?? targetId,
          avatarURL: u?.displayAvatarURL({ size: 128 }) ?? null,
        },
        rec,
        page,
        pages,
      ),
    ],
    components: pagerRow(ctx.theme, (p) => Ids.mod.record(targetId, p, owner), page, pages),
  };
}

const warnings: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('warnings')
    .setDescription("Moderation: a member's warnings and full moderation record")
    .setContexts(guildOnly)
    .addUserOption((o) => o.setName('member').setDescription('Whose record').setRequired(true))
    .toJSON(),
  level: PermissionLevel.MEMBER,
  async execute(i, ctx) {
    requireModeration(ctx);
    const target = i.options.getUser('member', true);
    await runModeration(i, ctx, async () => ({
      ...(await renderRecord(ctx, target.id, 0, i.user.id)),
      private: true,
    }));
  },
};

const unwarn: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('unwarn')
    .setDescription('Moderation: remove a warning by its case number')
    .setContexts(guildOnly)
    .addIntegerOption((o) =>
      o.setName('case').setDescription('Case number, e.g. 42').setRequired(true).setMinValue(1),
    )
    .addStringOption(reasonOpt())
    .toJSON(),
  level: PermissionLevel.MEMBER,
  async execute(i, ctx) {
    requireModeration(ctx);
    await runModeration(i, ctx, async () => {
      const c = await removeWarning({
        guildId: ctx.guild.id,
        caseNumber: i.options.getInteger('case', true),
        actorId: i.user.id,
        reason: reasonOf(i),
      });
      return { embeds: [warningRemovedEmbed(ctx.theme, c)] };
    });
  },
};

// ───── Timeout ─────

const TIMEOUT_PRESETS: [string, string][] = [
  ['60 seconds', '60s'],
  ['5 minutes', '5m'],
  ['10 minutes', '10m'],
  ['30 minutes', '30m'],
  ['1 hour', '1h'],
  ['6 hours', '6h'],
  ['12 hours', '12h'],
  ['1 day', '1d'],
  ['3 days', '3d'],
  ['1 week', '1w'],
  ['28 days (maximum)', '28d'],
];

async function durationAutocomplete(i: AutocompleteInteraction<'cached'>): Promise<void> {
  const typed = String(i.options.getFocused()).trim();
  const out: { name: string; value: string }[] = [];
  if (typed) {
    try {
      const sec = parseDuration(typed);
      out.push({ name: `${typed} → ${formatDuration(sec)}`.slice(0, 100), value: typed.slice(0, 100) });
    } catch {
      /* not a duration yet; just show the presets */
    }
  }
  for (const [name, value] of TIMEOUT_PRESETS) {
    if (!typed || name.includes(typed.toLowerCase()) || value.startsWith(typed.toLowerCase()))
      out.push({ name, value });
  }
  await i.respond(out.slice(0, 25));
}

const timeout: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Moderation: stop a member from talking for a while')
    .setContexts(guildOnly)
    .addUserOption((o) => o.setName('member').setDescription('Who to time out').setRequired(true))
    .addStringOption((o) =>
      o
        .setName('duration')
        .setDescription('How long, e.g. 10m, 1h, 2d (max 28d)')
        .setRequired(true)
        .setAutocomplete(true)
        .setMaxLength(20),
    )
    .addStringOption(reasonOpt())
    .addBooleanOption(dmOpt)
    .toJSON(),
  level: PermissionLevel.MEMBER,
  async execute(i, ctx) {
    requireModeration(ctx);
    const target = i.options.getUser('member', true);
    const durationSec = parseTimeoutDuration(i.options.getString('duration', true));
    await runModeration(i, ctx, async () => ({
      embeds: [
        await timeoutMember(ctx, {
          targetId: target.id,
          reason: reasonOf(i),
          dm: wantDm(i, ctx),
          durationSec,
        }),
      ],
    }));
  },
  async autocomplete(i) {
    await durationAutocomplete(i);
  },
};

const untimeout: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('untimeout')
    .setDescription("Moderation: end a member's timeout early")
    .setContexts(guildOnly)
    .addUserOption((o) => o.setName('member').setDescription('Who to release').setRequired(true))
    .addStringOption(reasonOpt())
    .addBooleanOption(dmOpt)
    .toJSON(),
  level: PermissionLevel.MEMBER,
  async execute(i, ctx) {
    requireModeration(ctx);
    const target = i.options.getUser('member', true);
    await runModeration(i, ctx, async () => ({
      embeds: [await untimeoutMember(ctx, { targetId: target.id, reason: reasonOf(i), dm: wantDm(i, ctx) })],
    }));
  },
};

// ───── Kick / ban ─────

const kick: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Moderation: remove a member (they can rejoin with an invite)')
    .setContexts(guildOnly)
    .addUserOption((o) => o.setName('member').setDescription('Who to kick').setRequired(true))
    .addStringOption(reasonOpt())
    .addBooleanOption(dmOpt)
    .toJSON(),
  level: PermissionLevel.MEMBER,
  async execute(i, ctx) {
    requireModeration(ctx);
    const targetId = i.options.getUser('member', true).id;
    const reason = reasonOf(i);
    const dm = wantDm(i, ctx);
    await runModeration(i, ctx, async () => {
      const target = await planKick(ctx, targetId);
      const token = addPending({
        guildId: ctx.guild.id,
        userId: i.user.id,
        run: (c) => kickMember(c, { targetId, reason, dm }),
      });
      const record = await recordSummary(ctx, targetId);
      return {
        embeds: [
          confirmEmbed(ctx.theme, {
            action: 'KICK',
            title: 'Confirm kick',
            lines: [
              `Member: ${user(targetId)} · ${target.user.username}${target.joinedAt ? ` · joined ${ts(target.joinedAt, 'R')}` : ''}`,
              `Reason: ${reason ?? '*none given*'}`,
              `Tell them by DM: **${dm ? 'Yes' : 'No'}**`,
              ...(record ? [record] : []),
            ],
          }),
        ],
        components: confirmButtons(token, 'Kick'),
        private: true,
      };
    });
  },
};

const ban: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Moderation: ban someone (works by ID even if they already left)')
    .setContexts(guildOnly)
    .addUserOption((o) =>
      o.setName('user').setDescription('Who to ban (pick, or paste a user ID)').setRequired(true),
    )
    .addStringOption(reasonOpt())
    .addStringOption((o) =>
      o
        .setName('delete_messages')
        .setDescription('Also delete their recent messages')
        .addChoices(
          { name: "Don't delete any", value: 'none' },
          { name: 'Last hour', value: '1h' },
          { name: 'Last 24 hours', value: '24h' },
          { name: 'Last 7 days', value: '7d' },
        ),
    )
    .addBooleanOption(dmOpt)
    .toJSON(),
  level: PermissionLevel.MEMBER,
  async execute(i, ctx) {
    requireModeration(ctx);
    const targetId = i.options.getUser('user', true).id;
    const reason = reasonOf(i);
    const dm = wantDm(i, ctx);
    const deleteWindow = i.options.getString('delete_messages') ?? 'none';
    await runModeration(i, ctx, async () => {
      const { targetUser, target } = await planBan(ctx, targetId);
      const token = addPending({
        guildId: ctx.guild.id,
        userId: i.user.id,
        run: (c) => banMember(c, { targetId, reason, dm, deleteWindow }),
      });
      const record = await recordSummary(ctx, targetId);
      return {
        embeds: [
          confirmEmbed(ctx.theme, {
            action: 'BAN',
            title: 'Confirm ban',
            lines: [
              `Member: ${user(targetId)} · ${targetUser.username}${target?.joinedAt ? ` · joined ${ts(target.joinedAt, 'R')}` : target ? '' : ' · **not in the server** (the ban stops them from joining)'}`,
              `Reason: ${reason ?? '*none given*'}`,
              `Delete their messages: **${DELETE_WINDOWS[deleteWindow]?.label === 'none' ? 'No' : `last ${DELETE_WINDOWS[deleteWindow]?.label}`}**`,
              `Tell them by DM: **${target && dm ? 'Yes' : 'No'}**`,
              ...(record ? [record] : []),
            ],
          }),
        ],
        components: confirmButtons(token, 'Ban'),
        private: true,
      };
    });
  },
};

const banCache = new Map<string, { at: number; list: { id: string; name: string }[] }>();

const unban: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Moderation: lift a ban')
    .setContexts(guildOnly)
    .addStringOption((o) =>
      o
        .setName('user')
        .setDescription('Start typing their name, or paste their user ID')
        .setRequired(true)
        .setAutocomplete(true)
        .setMaxLength(40),
    )
    .addStringOption(reasonOpt())
    .toJSON(),
  level: PermissionLevel.MEMBER,
  async execute(i, ctx) {
    requireModeration(ctx);
    const raw = i.options.getString('user', true).trim();
    const id = raw.match(/\d{17,20}/)?.[0];
    if (!id) throw new DomainError('BAD_USER', 'Pick someone from the list, or paste their user ID.', 'Who?');
    banCache.delete(ctx.guild.id);
    await runModeration(i, ctx, async () => ({
      embeds: [await unbanUser(ctx, { targetId: id, reason: reasonOf(i) })],
    }));
  },
  async autocomplete(i, ctx) {
    if (!hasModerationAccess([...ctx.member.roles.cache.keys()], ctx.config)) {
      await i.respond([]);
      return;
    }
    let hit = banCache.get(ctx.guild.id);
    if (!hit || Date.now() - hit.at > 30_000) {
      const bans = await ctx.guild.bans.fetch({ limit: 1000 }).catch(() => null);
      hit = {
        at: Date.now(),
        list: [...(bans?.values() ?? [])].map((b) => ({ id: b.user.id, name: b.user.username })),
      };
      banCache.set(ctx.guild.id, hit);
    }
    const typed = String(i.options.getFocused()).toLowerCase();
    await i.respond(
      hit.list
        .filter((b) => !typed || b.name.toLowerCase().includes(typed) || b.id.startsWith(typed))
        .slice(0, 25)
        .map((b) => ({ name: `${b.name} (${b.id})`.slice(0, 100), value: b.id })),
    );
  },
};

// ───── Purge ─────

const purge: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Moderation: delete recent messages in this channel')
    .setContexts(guildOnly)
    .addIntegerOption((o) =>
      o
        .setName('amount')
        .setDescription('How many messages (1–500)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(500),
    )
    .addUserOption((o) => o.setName('user').setDescription('Only messages from this person'))
    .addBooleanOption((o) => o.setName('bots').setDescription('Only messages from bots'))
    .addBooleanOption((o) => o.setName('attachments').setDescription('Only messages with files or images'))
    .addStringOption((o) =>
      o.setName('contains').setDescription('Only messages containing this text').setMaxLength(100),
    )
    .addStringOption(reasonOpt())
    .toJSON(),
  level: PermissionLevel.MEMBER,
  async execute(i, ctx) {
    requireModeration(ctx);
    const amount = i.options.getInteger('amount', true);
    const filter: PurgeFilter = {
      userId: i.options.getUser('user')?.id ?? null,
      botsOnly: i.options.getBoolean('bots') ?? false,
      attachmentsOnly: i.options.getBoolean('attachments') ?? false,
      contains: i.options.getString('contains')?.trim() || null,
    };
    const reason = reasonOf(i);
    const channel = await currentChannel(i);
    await runModeration(i, ctx, async () => {
      if (amount <= PURGE_CONFIRM_ABOVE)
        return { embeds: [await purgeMessages(ctx, channel, { amount, filter, reason })] };
      const scan = await prepareScan(ctx, channel, amount, filter);
      const token = addPending({
        guildId: ctx.guild.id,
        userId: i.user.id,
        run: (c) => purgeMessages(c, channel, { amount, filter, reason }),
      });
      return {
        embeds: [
          confirmEmbed(ctx.theme, {
            action: 'PURGE',
            title: 'Confirm purge',
            lines: [
              `Channel: ${channel}`,
              `Messages: **${scan.ids.length}** found (${describePurgeFilter(filter)})`,
              ...(scan.tooOld > 0
                ? [`Skipped: ${scan.tooOld} older than 14 days (Discord can't bulk-delete those)`]
                : []),
              'Pinned messages are never deleted.',
              `Reason: ${reason ?? '*none given*'}`,
            ],
          }),
        ],
        components: confirmButtons(token, `Delete ${scan.ids.length}`),
        private: true,
      };
    });
  },
};

// ───── Roles ─────

const role: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('role')
    .setDescription('Moderation: give or take roles')
    .setContexts(guildOnly)
    .addSubcommand((s) =>
      s
        .setName('give')
        .setDescription('Give a role to one member')
        .addUserOption((o) => o.setName('member').setDescription('Who').setRequired(true))
        .addRoleOption((o) => o.setName('role').setDescription('Which role').setRequired(true))
        .addStringOption(reasonOpt()),
    )
    .addSubcommand((s) =>
      s
        .setName('take')
        .setDescription('Take a role from one member')
        .addUserOption((o) => o.setName('member').setDescription('Who').setRequired(true))
        .addRoleOption((o) => o.setName('role').setDescription('Which role').setRequired(true))
        .addStringOption(reasonOpt()),
    )
    .addSubcommand((s) =>
      s
        .setName('everyone')
        .setDescription('Give or take a role for EVERY member (shows a preview first)')
        .addRoleOption((o) => o.setName('role').setDescription('Which role').setRequired(true))
        .addStringOption((o) =>
          o
            .setName('action')
            .setDescription('Give it or take it')
            .setRequired(true)
            .addChoices(
              { name: 'Give to everyone', value: 'give' },
              { name: 'Take from everyone', value: 'take' },
            ),
        )
        .addBooleanOption((o) => o.setName('include_bots').setDescription('Include bots too (default: no)'))
        .addStringOption(reasonOpt()),
    )
    .toJSON(),
  level: PermissionLevel.MEMBER,
  async execute(i, ctx) {
    requireModeration(ctx);
    const sub = i.options.getSubcommand();
    const roleId = i.options.getRole('role', true).id;
    const reason = reasonOf(i);
    if (sub === 'give' || sub === 'take') {
      const targetId = i.options.getUser('member', true).id;
      await runModeration(i, ctx, async () => ({
        embeds: [await changeRole(ctx, { targetId, roleId, give: sub === 'give', reason })],
      }));
      return;
    }
    const give = i.options.getString('action', true) === 'give';
    const includeBots = i.options.getBoolean('include_bots') ?? false;
    const channel = await currentChannel(i);
    await runModeration(i, ctx, async () => {
      const preview = await prepareMassRole(ctx, { roleId, give, includeBots });
      const n = preview.plan.todo.length;
      const token = addPending({
        guildId: ctx.guild.id,
        userId: i.user.id,
        run: (c) => startMassRole(c, channel, { roleId, give, includeBots, reason }),
      });
      return {
        embeds: [
          confirmEmbed(ctx.theme, {
            action: give ? 'ROLE_ALL_ADD' : 'ROLE_ALL_REMOVE',
            title: give ? 'Give a role to everyone?' : 'Take a role from everyone?',
            lines: [
              `Role: ${preview.role}`,
              `Will ${give ? 'get' : 'lose'} it: **${n}** member(s)`,
              `${give ? 'Already have it' : "Don't have it"}: ${preview.plan.already}`,
              ...(includeBots ? [] : [`Bots left out: ${preview.plan.skippedBots}`]),
              `Time needed: about **${formatDuration(estimateSeconds(n))}** (Discord allows roughly one change per second)`,
              '',
              `Progress will be posted in ${channel} with a **Stop** button. If the bot restarts midway, just run this again: members who are already done are skipped.`,
            ],
          }),
        ],
        components: confirmButtons(token, give ? `Give to ${n}` : `Remove from ${n}`),
        private: true,
      };
    });
  },
};

// ───── Channels ─────

const slowmode: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('slowmode')
    .setDescription('Moderation: limit how often members can send messages')
    .setContexts(guildOnly)
    .addIntegerOption((o) =>
      o
        .setName('delay')
        .setDescription('Time between messages')
        .setRequired(true)
        .addChoices(
          { name: 'Off', value: 0 },
          { name: '5 seconds', value: 5 },
          { name: '10 seconds', value: 10 },
          { name: '30 seconds', value: 30 },
          { name: '1 minute', value: 60 },
          { name: '5 minutes', value: 300 },
          { name: '15 minutes', value: 900 },
          { name: '1 hour', value: 3600 },
          { name: '6 hours', value: 21600 },
        ),
    )
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Default: this channel')
        .addChannelTypes(...CHANNEL_TYPES),
    )
    .addStringOption(reasonOpt())
    .toJSON(),
  level: PermissionLevel.MEMBER,
  async execute(i, ctx) {
    requireModeration(ctx);
    const channel = channelOption(i) ?? (await currentChannel(i));
    await runModeration(i, ctx, async () => ({
      embeds: [
        await setSlowmode(ctx, channel, {
          seconds: i.options.getInteger('delay', true),
          reason: reasonOf(i),
        }),
      ],
    }));
  },
};

function lockCommand(name: 'lock' | 'unlock'): SlashCommand {
  return {
    data: new SlashCommandBuilder()
      .setName(name)
      .setDescription(
        name === 'lock'
          ? 'Moderation: stop members from writing in a channel'
          : 'Moderation: open a locked channel again',
      )
      .setContexts(guildOnly)
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Default: this channel')
          .addChannelTypes(...CHANNEL_TYPES),
      )
      .addStringOption(reasonOpt())
      .toJSON(),
    level: PermissionLevel.MEMBER,
    async execute(i, ctx) {
      requireModeration(ctx);
      const channel = channelOption(i) ?? (await currentChannel(i));
      // The public result lands where the command was typed; if that's another channel, the
      // locked/unlocked channel gets its own notice so its members know too.
      const input = { reason: reasonOf(i), notify: channel.id !== i.channelId };
      await runModeration(i, ctx, async () => ({
        embeds: [
          name === 'lock' ? await lockChannel(ctx, channel, input) : await unlockChannel(ctx, channel, input),
        ],
      }));
    },
  };
}

export const moderationCommands: SlashCommand[] = [
  warn,
  warnings,
  unwarn,
  timeout,
  untimeout,
  kick,
  ban,
  unban,
  purge,
  role,
  slowmode,
  lockCommand('lock'),
  lockCommand('unlock'),
];
