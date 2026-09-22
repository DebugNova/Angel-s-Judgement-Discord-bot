/**
 * "Give a role to everyone": list every member (REST, 1,000 per page), plan who changes, then walk
 * the list one member at a time. discord.js waits out Discord's rate limits by itself; we only
 * report progress (every 10 s), honour Stop, and record one case at the end.
 */
import { DiscordAPIError, RESTJSONErrorCodes } from 'discord.js';
import type { EmbedBuilder, Guild, GuildTextBasedChannel, Message, Role } from 'discord.js';
import { DomainError } from '../../core/errors.js';
import { log } from '../../core/logger.js';
import { recordCase } from '../../modules/moderation/cases.service.js';
import { planMassRole } from '../../modules/moderation/filters.js';
import type { MassRoleMember, MassRolePlan } from '../../modules/moderation/filters.js';
import { assertCanManageRole } from '../../modules/moderation/safety.js';
import type { Ctx } from '../context.js';
import { themeFor } from '../context.js';
import { massRoleProgressEmbed, stopJobButton } from '../ui/moderation.js';
import type { MassRoleProgress } from '../ui/moderation.js';
import { successEmbed } from '../ui/embeds.js';
import { assertBotCan, auditReason, botMember, memberFacts, roleFacts } from './common.js';

const PROGRESS_EVERY_MS = 10_000;

interface Job {
  progress: MassRoleProgress;
  stop: boolean;
}

/** One mass-role run per server at a time. */
const jobs = new Map<string, Job>();

export function runningJob(guildId: string): MassRoleProgress | null {
  return jobs.get(guildId)?.progress ?? null;
}

/** Asks the running job to stop after the member it is working on. Returns false if none runs. */
export function stopJob(guildId: string): boolean {
  const job = jobs.get(guildId);
  if (!job) return false;
  job.stop = true;
  return true;
}

/** Every member of the server, via REST (needs "Server Members Intent" in the Developer Portal). */
export async function listAllMembers(guild: Guild, roleId: string): Promise<MassRoleMember[]> {
  const out: MassRoleMember[] = [];
  let after: string | undefined;
  for (;;) {
    let page;
    try {
      page = await guild.members.list({ limit: 1000, ...(after ? { after } : {}), cache: false });
    } catch (err) {
      if (
        err instanceof DiscordAPIError &&
        (err.code === RESTJSONErrorCodes.MissingAccess || err.status === 403)
      ) {
        throw new DomainError(
          'MEMBERS_INTENT',
          "Discord won't give me the member list. Turn on **Server Members Intent**: Developer Portal → my application → Bot → Privileged Gateway Intents → Server Members Intent → Save.",
          'I need a Developer Portal switch',
        );
      }
      throw err;
    }
    for (const m of page.values())
      out.push({ id: m.id, isBot: m.user.bot, hasRole: m.roles.cache.has(roleId) });
    if (page.size < 1000) break;
    after = page.lastKey();
  }
  return out;
}

export interface MassRolePreview {
  role: Role;
  plan: MassRolePlan;
  give: boolean;
  includeBots: boolean;
}

export async function prepareMassRole(
  ctx: Ctx,
  input: { roleId: string; give: boolean; includeBots: boolean },
): Promise<MassRolePreview> {
  if (jobs.has(ctx.guild.id)) {
    throw new DomainError(
      'JOB_RUNNING',
      'A role-for-everyone run is already going. Wait for it or press **Stop** on it.',
      'Already running',
    );
  }
  const me = await botMember(ctx.guild);
  assertBotCan(me.permissions, ['ManageRoles']);
  const role = ctx.guild.roles.cache.get(input.roleId);
  if (!role) throw new DomainError('NOT_FOUND', 'That role no longer exists.', 'Role not found');
  assertCanManageRole({
    role: roleFacts(role),
    actor: memberFacts(ctx.member),
    bot: memberFacts(me),
    mass: true,
  });
  const members = await listAllMembers(ctx.guild, role.id);
  const plan = planMassRole(members, { give: input.give, includeBots: input.includeBots });
  if (plan.todo.length === 0) {
    throw new DomainError(
      'NOTHING_TO_DO',
      input.give
        ? `Everyone${input.includeBots ? '' : ' (except bots)'} already has ${role}.`
        : `Nobody${input.includeBots ? '' : ' (except bots)'} has ${role}.`,
      'Nothing to change',
    );
  }
  return { role, plan, give: input.give, includeBots: input.includeBots };
}

/** Rough time Discord needs: role edits are allowed at about one per second. */
export function estimateSeconds(count: number): number {
  return Math.ceil(count * 1.1);
}

/**
 * Starts the run in the background and returns at once. Progress is posted as a normal message in
 * `channel` (interaction replies expire after 15 minutes; a big server can take longer).
 */
export async function startMassRole(
  ctx: Ctx,
  channel: GuildTextBasedChannel,
  input: { roleId: string; give: boolean; includeBots: boolean; reason: string | null },
): Promise<EmbedBuilder> {
  const preview = await prepareMassRole(ctx, input);
  const { role, plan } = preview;
  const theme = themeFor(ctx.config, ctx.guild.client);
  // Listing members takes a moment; another run may have started meanwhile.
  if (jobs.has(ctx.guild.id)) {
    throw new DomainError('JOB_RUNNING', 'A role-for-everyone run is already going.', 'Already running');
  }
  const job: Job = {
    stop: false,
    progress: {
      roleId: role.id,
      give: input.give,
      total: plan.todo.length,
      done: 0,
      failed: 0,
      left: 0,
      startedAt: Date.now(),
      state: 'running',
      moderatorId: ctx.member.id,
    },
  };
  jobs.set(ctx.guild.id, job);
  let message: Message | null = null;
  try {
    message = await channel.send({
      embeds: [massRoleProgressEmbed(theme, job.progress)],
      components: stopJobButton(theme, ctx.guild.id),
      allowedMentions: { parse: [] },
    });
  } catch (err) {
    jobs.delete(ctx.guild.id);
    throw err;
  }
  void runJob(ctx, job, plan.todo, role, message, input.reason).catch((err: unknown) => {
    log.error('MASS_ROLE_FAILED', { guild: ctx.guild.id, role: role.id }, err);
    jobs.delete(ctx.guild.id);
  });
  return successEmbed(
    ctx.theme,
    'Started',
    `${input.give ? 'Giving' : 'Taking'} ${role} ${input.give ? 'to' : 'from'} **${plan.todo.length}** member(s). Follow the progress here: ${message.url}`,
  );
}

async function runJob(
  ctx: Ctx,
  job: Job,
  todo: string[],
  role: Role,
  message: Message,
  reason: string | null,
): Promise<void> {
  const theme = themeFor(ctx.config, ctx.guild.client);
  const why = auditReason(ctx.member.user, reason);
  let lastEdit = Date.now();
  const p = job.progress;
  for (const id of todo) {
    if (job.stop) break;
    try {
      if (p.give) await ctx.guild.members.addRole({ user: id, role: role.id, reason: why });
      else await ctx.guild.members.removeRole({ user: id, role: role.id, reason: why });
      p.done++;
    } catch (err) {
      if (err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.UnknownMember) p.left++;
      else {
        p.failed++;
        log.warn('MASS_ROLE_MEMBER_FAILED', { guild: ctx.guild.id, member: id }, err);
        // The role or the bot's permission vanished mid-run: stop instead of failing 1,000 times.
        if (
          err instanceof DiscordAPIError &&
          (err.code === RESTJSONErrorCodes.UnknownRole || err.code === RESTJSONErrorCodes.MissingPermissions)
        ) {
          job.stop = true;
        }
      }
    }
    if (Date.now() - lastEdit >= PROGRESS_EVERY_MS) {
      lastEdit = Date.now();
      await message.edit({ embeds: [massRoleProgressEmbed(theme, p)] }).catch(() => undefined);
    }
  }
  p.state = job.stop ? 'stopped' : 'finished';
  jobs.delete(ctx.guild.id);
  await message.edit({ embeds: [massRoleProgressEmbed(theme, p)], components: [] }).catch(() => undefined);
  await recordCase({
    guildId: ctx.guild.id,
    action: p.give ? 'ROLE_ALL_ADD' : 'ROLE_ALL_REMOVE',
    moderatorId: ctx.member.id,
    channelId: message.channelId,
    reason,
    details: {
      roleId: role.id,
      roleName: role.name,
      total: p.total,
      done: p.done,
      failed: p.failed,
      left: p.left,
      stopped: job.stop,
    },
  });
}
