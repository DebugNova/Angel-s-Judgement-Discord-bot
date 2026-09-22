import { DomainError } from '../../core/errors.js';

/** What the safety rules need to know about a member (no discord.js types here). */
export interface MemberFacts {
  id: string;
  /** Position of the member's highest role (0 = @everyone only). */
  topRolePosition: number;
  isGuildOwner: boolean;
  isAdministrator: boolean;
}

export interface RoleFacts {
  id: string;
  name: string;
  position: number;
  /** Managed by an integration (bot roles, Server Booster): Discord refuses to assign these. */
  managed: boolean;
  isEveryone: boolean;
  /** Carries staff powers (Administrator, Ban, Kick, Manage Roles/Channels/Server/Messages, Timeout). */
  dangerous: boolean;
}

export type MemberAction = 'warn' | 'timeout' | 'untimeout' | 'kick' | 'ban' | 'role';

const VERB: Record<MemberAction, string> = {
  warn: 'warn',
  timeout: 'time out',
  untimeout: 'remove the timeout of',
  kick: 'kick',
  ban: 'ban',
  role: 'change the roles of',
};

function refuse(message: string): never {
  throw new DomainError('MOD_REFUSED', message, 'Action refused');
}

/**
 * The rules every action on a member must pass. `target` is null when the user is not in the
 * server (ban/unban by ID), in which case only the identity rules apply.
 */
export function assertCanActOn(opts: {
  action: MemberAction;
  actor: MemberFacts;
  target: MemberFacts | null;
  targetId: string;
  bot: MemberFacts;
  guildOwnerId: string;
}): void {
  const { action, actor, target, targetId, bot } = opts;
  const verb = VERB[action];
  if (targetId === actor.id) refuse(`You can't ${verb} yourself.`);
  if (targetId === bot.id) refuse(`I can't ${verb} myself.`);
  if (targetId === opts.guildOwnerId) refuse(`Nobody can ${verb} the server owner.`);
  if (!target) return;
  if (!actor.isGuildOwner && target.topRolePosition >= actor.topRolePosition) {
    refuse(
      `<@${targetId}>'s highest role is equal to or above yours, so you can't ${verb} them.\nAsk someone higher up.`,
    );
  }
  if (target.topRolePosition >= bot.topRolePosition) {
    refuse(
      `<@${targetId}>'s highest role is equal to or above mine, so Discord won't let me ${verb} them.\nFix: Server Settings → Roles → drag my role above theirs.`,
    );
  }
  if (action === 'timeout' && target.isAdministrator) {
    refuse(`<@${targetId}> is an Administrator. Discord does not allow timing out administrators.`);
  }
}

/** Rules for giving or taking a role (single member or everyone). */
export function assertCanManageRole(opts: {
  role: RoleFacts;
  actor: MemberFacts;
  bot: MemberFacts;
  mass: boolean;
}): void {
  const { role, actor, bot, mass } = opts;
  if (role.isEveryone) refuse('The @everyone role belongs to everybody already.');
  if (role.managed) {
    refuse(
      `<@&${role.id}> is managed by Discord or another app (bot or booster role). It can't be given by hand.`,
    );
  }
  if (!actor.isGuildOwner && role.position >= actor.topRolePosition) {
    refuse(`<@&${role.id}> is equal to or above your highest role, so you can't hand it out.`);
  }
  if (role.position >= bot.topRolePosition) {
    refuse(
      `<@&${role.id}> is equal to or above my highest role, so Discord won't let me hand it out.\nFix: Server Settings → Roles → drag my role above it.`,
    );
  }
  if (mass && role.dangerous) {
    refuse(
      `<@&${role.id}> has staff powers (for example Ban, Kick, Manage Roles or Administrator). For safety it can't be given to everyone at once.`,
    );
  }
}
