import { describe, expect, it } from 'vitest';
import { PermissionLevel, hasLevel, resolveLevel } from '../src/modules/permissions/permissions.js';

const roles = { refereeRoleIds: ['r1'], moderatorRoleIds: ['m1'], adminRoleIds: ['a1'] };
const base = { userId: 'u', roleIds: [] as string[], isGuildOwner: false, hasAdministrator: false };

describe('permissions', () => {
  it('member without roles is a member and cannot referee', () => {
    const lvl = resolveLevel(base, roles, []);
    expect(lvl).toBe(PermissionLevel.MEMBER);
    expect(hasLevel(lvl, PermissionLevel.REFEREE)).toBe(false);
  });

  it('referee role can review but not moderate', () => {
    const lvl = resolveLevel({ ...base, roleIds: ['r1'] }, roles, []);
    expect(hasLevel(lvl, PermissionLevel.REFEREE)).toBe(true);
    expect(hasLevel(lvl, PermissionLevel.MODERATOR)).toBe(false);
  });

  it('moderator role can moderate and referee', () => {
    const lvl = resolveLevel({ ...base, roleIds: ['m1'] }, roles, []);
    expect(lvl).toBe(PermissionLevel.MODERATOR);
    expect(hasLevel(lvl, PermissionLevel.REFEREE)).toBe(true);
  });

  it('admin role and Discord Administrator can configure', () => {
    expect(resolveLevel({ ...base, roleIds: ['a1'] }, roles, [])).toBe(PermissionLevel.ADMIN);
    expect(resolveLevel({ ...base, hasAdministrator: true }, roles, [])).toBe(PermissionLevel.ADMIN);
  });

  it('server owner and BOT_OWNER_IDS are owners', () => {
    expect(resolveLevel({ ...base, isGuildOwner: true }, roles, [])).toBe(PermissionLevel.OWNER);
    expect(resolveLevel(base, roles, ['u'])).toBe(PermissionLevel.OWNER);
  });

  it('uses role IDs, never names', () => {
    expect(resolveLevel({ ...base, roleIds: ['Referee'] }, roles, [])).toBe(PermissionLevel.MEMBER);
  });
});
