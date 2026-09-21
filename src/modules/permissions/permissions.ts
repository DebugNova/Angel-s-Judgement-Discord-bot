export enum PermissionLevel {
  MEMBER = 0,
  REFEREE = 1,
  MODERATOR = 2,
  ADMIN = 3,
  OWNER = 4,
}

export const LEVEL_NAMES: Record<PermissionLevel, string> = {
  [PermissionLevel.MEMBER]: 'Member',
  [PermissionLevel.REFEREE]: 'Referee',
  [PermissionLevel.MODERATOR]: 'Moderator',
  [PermissionLevel.ADMIN]: 'Administrator',
  [PermissionLevel.OWNER]: 'Owner',
};

export interface AuthSubject {
  userId: string;
  roleIds: readonly string[];
  isGuildOwner: boolean;
  /** Holds Discord's "Administrator" permission in the server. */
  hasAdministrator: boolean;
}

export interface RoleConfig {
  refereeRoleIds: readonly string[];
  moderatorRoleIds: readonly string[];
  adminRoleIds: readonly string[];
}

/**
 * Resolves a member's bot permission level from Discord role IDs (never role names).
 * Owner: the server owner or a BOT_OWNER_IDS user. Admin: Discord Administrator or a configured admin role.
 */
export function resolveLevel(
  subject: AuthSubject,
  roles: RoleConfig,
  ownerIds: readonly string[],
): PermissionLevel {
  if (subject.isGuildOwner || ownerIds.includes(subject.userId)) return PermissionLevel.OWNER;
  const has = (ids: readonly string[]) => ids.some((id) => subject.roleIds.includes(id));
  if (subject.hasAdministrator || has(roles.adminRoleIds)) return PermissionLevel.ADMIN;
  if (has(roles.moderatorRoleIds)) return PermissionLevel.MODERATOR;
  if (has(roles.refereeRoleIds)) return PermissionLevel.REFEREE;
  return PermissionLevel.MEMBER;
}

export function hasLevel(actual: PermissionLevel, required: PermissionLevel): boolean {
  return actual >= required;
}
