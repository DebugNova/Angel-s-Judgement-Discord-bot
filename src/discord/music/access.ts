/**
 * Who may control the music:
 *  - Everyone in the bot's voice channel may add songs and view the queue.
 *  - With no DJ role set (the default), everyone in the channel controls playback.
 *  - With DJ roles set, only DJs, moderators (moderation role) and admins control it; others can
 *    vote to skip, skip or remove their own songs, and anyone alone with the bot controls it.
 */
import { DomainError } from '../../core/errors.js';
import { PermissionLevel, hasLevel, hasModerationAccess } from '../../modules/permissions/permissions.js';
import type { Ctx } from '../context.js';
import type { GuildPlayer } from './player.js';

function roleIds(ctx: Ctx): string[] {
  return [...ctx.member.roles.cache.keys()];
}

/** Staff-level music power: admins, moderators, or an explicit DJ role. */
export function isMusicStaff(ctx: Ctx): boolean {
  const roles = roleIds(ctx);
  return (
    hasLevel(ctx.level, PermissionLevel.ADMIN) ||
    hasModerationAccess(roles, ctx.config) ||
    ctx.config.musicDjRoleIds.some((r) => roles.includes(r))
  );
}

export function isDj(ctx: Ctx): boolean {
  return ctx.config.musicDjRoleIds.length === 0 || isMusicStaff(ctx);
}

export function requireInVoice(ctx: Ctx) {
  const ch = ctx.member.voice.channel;
  if (!ch) {
    throw new DomainError(
      'NOT_IN_VOICE',
      'Join a voice channel first, then try again.',
      'Join a voice channel',
    );
  }
  return ch;
}

/** The member must be listening in the bot's channel (staff may control it from anywhere). */
export function requireListener(ctx: Ctx, p: GuildPlayer): void {
  if (ctx.member.voice.channelId === p.voiceChannelId || isMusicStaff(ctx)) return;
  throw new DomainError(
    'NOT_LISTENING',
    `Join <#${p.voiceChannelId}> to control the music.`,
    'Join the voice channel',
  );
}

export function requireControl(ctx: Ctx, p: GuildPlayer, what: string): void {
  requireListener(ctx, p);
  if (isDj(ctx)) return;
  if (p.listeners() <= 1 && ctx.member.voice.channelId === p.voiceChannelId) return;
  const roles = ctx.config.musicDjRoleIds.map((r) => `<@&${r}>`).join(' ');
  throw new DomainError('DJ_ONLY', `Only ${roles} can ${what}.`, 'DJs only');
}
