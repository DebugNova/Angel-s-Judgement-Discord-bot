import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/config/env.js';
import { db } from '../src/database/client.js';
import { exportAll, importAll } from '../src/database/backup.js';
import { handleComponent } from '../src/discord/components.js';
import type { Ctx } from '../src/discord/context.js';
import { setRuntimeEnv } from '../src/discord/context.js';
import { Ids } from '../src/discord/ids.js';
import { addPending } from '../src/discord/moderation/common.js';
import { successEmbed } from '../src/discord/ui/embeds.js';
import { updateConfig } from '../src/modules/configuration/config.service.js';
import { memberRecord, recordCase, removeWarning } from '../src/modules/moderation/cases.service.js';
import { formatDuration, parseDuration, parseTimeoutDuration } from '../src/modules/moderation/duration.js';
import { planMassRole, purgeVerdict } from '../src/modules/moderation/filters.js';
import type { PurgeCandidate } from '../src/modules/moderation/filters.js';
import { assertCanActOn, assertCanManageRole } from '../src/modules/moderation/safety.js';
import type { MemberFacts, RoleFacts } from '../src/modules/moderation/safety.js';
import { PermissionLevel, hasModerationAccess } from '../src/modules/permissions/permissions.js';
import { GUILD, config, resetDb } from './helpers.js';

const Z = '1544431253204504776';
const MOD = '300000000000000001';
const MOD2 = '300000000000000002';
const TARGET = '300000000000000009';

beforeAll(() => {
  setRuntimeEnv({ ownerIds: [], NODE_ENV: 'test' } as unknown as Env);
});
beforeEach(resetDb);

describe('durations', () => {
  it('reads common formats', () => {
    expect(parseDuration('10m')).toBe(600);
    expect(parseDuration('1h30m')).toBe(5400);
    expect(parseDuration(' 2d ')).toBe(172800);
    expect(parseDuration('1w')).toBe(604800);
    expect(parseDuration('45')).toBe(2700); // a bare number means minutes
    expect(parseDuration('1H 5M')).toBe(3900);
  });

  it('rejects anything else with a friendly error', () => {
    for (const bad of ['abc', '10x', '5m abc', '', 'm5']) {
      expect(() => parseDuration(bad)).toThrow(expect.objectContaining({ code: 'BAD_DURATION' }));
    }
  });

  it("keeps timeouts inside Discord's 1 minute – 28 days", () => {
    expect(() => parseTimeoutDuration('30s')).toThrow(expect.objectContaining({ code: 'BAD_DURATION' }));
    expect(() => parseTimeoutDuration('29d')).toThrow(expect.objectContaining({ code: 'BAD_DURATION' }));
    expect(parseTimeoutDuration('28d')).toBe(28 * 86400);
    expect(parseTimeoutDuration('1m')).toBe(60);
  });

  it('formats durations for people', () => {
    expect(formatDuration(5400)).toBe('1h 30m');
    expect(formatDuration(90)).toBe('1m 30s');
    expect(formatDuration(1209600)).toBe('2w');
    expect(formatDuration(0)).toBe('0s');
  });
});

describe('who may moderate', () => {
  it('only the configured moderation roles count', () => {
    const cfg = { moderationRoleIds: [Z] };
    expect(hasModerationAccess(['111', Z], cfg)).toBe(true);
    expect(hasModerationAccess(['111', '222'], cfg)).toBe(false);
    expect(hasModerationAccess([Z], { moderationRoleIds: [] })).toBe(false);
  });

  it('new servers start with no moderation role (moderation off until the owner picks one)', async () => {
    expect((await config()).moderationRoleIds).toEqual([]);
    expect((await config()).modDmMembers).toBe(true);
  });
});

describe('safety rules', () => {
  const m = (id: string, pos: number, extra: Partial<MemberFacts> = {}): MemberFacts => ({
    id,
    topRolePosition: pos,
    isGuildOwner: false,
    isAdministrator: false,
    ...extra,
  });
  const actor = m(MOD, 10);
  const bot = m('999', 20);
  const base = { actor, bot, guildOwnerId: 'OWNER' };

  it('never on yourself, the bot or the server owner', () => {
    const refuse = (targetId: string) =>
      expect(() => assertCanActOn({ ...base, action: 'ban', target: m(targetId, 1), targetId })).toThrow(
        expect.objectContaining({ code: 'MOD_REFUSED' }),
      );
    refuse(MOD);
    refuse('999');
    refuse('OWNER');
  });

  it('never on someone ranked equal or higher than you or than the bot', () => {
    expect(() =>
      assertCanActOn({ ...base, action: 'kick', target: m(TARGET, 10), targetId: TARGET }),
    ).toThrow(/equal to or above yours/);
    expect(() =>
      assertCanActOn({ ...base, actor: m(MOD, 30), action: 'kick', target: m(TARGET, 20), targetId: TARGET }),
    ).toThrow(/equal to or above mine/);
    expect(() =>
      assertCanActOn({ ...base, action: 'warn', target: m(TARGET, 9), targetId: TARGET }),
    ).not.toThrow();
  });

  it('the server owner is above everyone; people not in the server can still be banned by ID', () => {
    const owner = m('OWNER', 1, { isGuildOwner: true });
    expect(() =>
      assertCanActOn({ ...base, actor: owner, action: 'kick', target: m(TARGET, 5), targetId: TARGET }),
    ).not.toThrow();
    expect(() => assertCanActOn({ ...base, action: 'ban', target: null, targetId: TARGET })).not.toThrow();
  });

  it('Discord does not allow timing out administrators', () => {
    expect(() =>
      assertCanActOn({
        ...base,
        action: 'timeout',
        target: m(TARGET, 1, { isAdministrator: true }),
        targetId: TARGET,
      }),
    ).toThrow(/Administrator/);
  });

  const role = (extra: Partial<RoleFacts> = {}): RoleFacts => ({
    id: '500',
    name: 'Initiate',
    position: 5,
    managed: false,
    isEveryone: false,
    dangerous: false,
    ...extra,
  });

  it('roles: not @everyone, not app-managed, not at/above you or the bot', () => {
    const ok = { actor, bot, mass: false };
    expect(() => assertCanManageRole({ ...ok, role: role() })).not.toThrow();
    expect(() => assertCanManageRole({ ...ok, role: role({ isEveryone: true }) })).toThrow();
    expect(() => assertCanManageRole({ ...ok, role: role({ managed: true }) })).toThrow(/managed/);
    expect(() => assertCanManageRole({ ...ok, role: role({ position: 10 }) })).toThrow(/your highest role/);
    expect(() => assertCanManageRole({ ...ok, actor: m(MOD, 30), role: role({ position: 20 }) })).toThrow(
      /my highest role/,
    );
  });

  it('a role with staff powers can be given to one member, never to everyone', () => {
    const r = role({ dangerous: true });
    expect(() => assertCanManageRole({ actor, bot, mass: false, role: r })).not.toThrow();
    expect(() => assertCanManageRole({ actor, bot, mass: true, role: r })).toThrow(/staff powers/);
  });
});

describe('purge filter and mass-role plan', () => {
  const msg = (extra: Partial<PurgeCandidate> = {}): PurgeCandidate => ({
    authorId: TARGET,
    authorIsBot: false,
    hasAttachments: false,
    content: 'Hello Angels',
    pinned: false,
    createdAt: new Date(),
    ...extra,
  });

  it('keeps pinned messages, applies every filter, and flags messages older than 14 days', () => {
    expect(purgeVerdict(msg(), {})).toBe('delete');
    expect(purgeVerdict(msg({ pinned: true }), {})).toBe('skip');
    expect(purgeVerdict(msg(), { userId: MOD })).toBe('skip');
    expect(purgeVerdict(msg(), { botsOnly: true })).toBe('skip');
    expect(purgeVerdict(msg({ authorIsBot: true }), { botsOnly: true })).toBe('delete');
    expect(purgeVerdict(msg(), { attachmentsOnly: true })).toBe('skip');
    expect(purgeVerdict(msg(), { contains: 'angels' })).toBe('delete');
    expect(purgeVerdict(msg(), { contains: 'demons' })).toBe('skip');
    expect(purgeVerdict(msg({ createdAt: new Date(Date.now() - 15 * 86400_000) }), {})).toBe('too-old');
  });

  it('plans who a role-for-everyone run touches', () => {
    const members = [
      { id: '1', isBot: false, hasRole: false },
      { id: '2', isBot: false, hasRole: true },
      { id: '3', isBot: true, hasRole: false },
    ];
    expect(planMassRole(members, { give: true, includeBots: false })).toEqual({
      todo: ['1'],
      already: 1,
      skippedBots: 1,
    });
    expect(planMassRole(members, { give: true, includeBots: true }).todo).toEqual(['1', '3']);
    expect(planMassRole(members, { give: false, includeBots: false }).todo).toEqual(['2']);
  });
});

describe('cases', () => {
  it('numbers cases 1, 2, 3… and writes an audit row for each', async () => {
    const a = await recordCase({
      guildId: GUILD,
      action: 'WARN',
      moderatorId: MOD,
      targetId: TARGET,
      reason: ' spam ',
    });
    const b = await recordCase({
      guildId: GUILD,
      action: 'TIMEOUT',
      moderatorId: MOD,
      targetId: TARGET,
      durationSec: 600,
    });
    expect([a.caseNumber, b.caseNumber]).toEqual([1, 2]);
    expect(a.reason).toBe('spam');
    expect(await db().auditLog.count({ where: { action: 'MOD_CASE' } })).toBe(2);
    expect((await config()).modCaseCounter).toBe(2);
  });

  it('two moderators acting at the same moment never get the same number', async () => {
    const made = await Promise.all(
      Array.from({ length: 10 }, (_, k) =>
        recordCase({ guildId: GUILD, action: 'WARN', moderatorId: k % 2 ? MOD : MOD2, targetId: TARGET }),
      ),
    );
    expect(made.map((c) => c.caseNumber).sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("a member's record counts actions and active warnings", async () => {
    await recordCase({ guildId: GUILD, action: 'WARN', moderatorId: MOD, targetId: TARGET });
    await recordCase({ guildId: GUILD, action: 'WARN', moderatorId: MOD, targetId: TARGET });
    await recordCase({ guildId: GUILD, action: 'KICK', moderatorId: MOD, targetId: TARGET });
    await recordCase({ guildId: GUILD, action: 'WARN', moderatorId: MOD, targetId: MOD2 });
    const rec = await memberRecord(GUILD, TARGET, 0, 2);
    expect(rec.total).toBe(3);
    expect(rec.cases).toHaveLength(2);
    expect(rec.cases[0]!.caseNumber).toBe(3); // newest first
    expect(rec.activeWarnings).toBe(2);
    expect(rec.counts).toMatchObject({ WARN: 2, KICK: 1 });
  });

  it('removing a warning keeps it in the record, once, and only for warnings', async () => {
    const w = await recordCase({ guildId: GUILD, action: 'WARN', moderatorId: MOD, targetId: TARGET });
    const k = await recordCase({ guildId: GUILD, action: 'KICK', moderatorId: MOD, targetId: TARGET });
    const removed = await removeWarning({
      guildId: GUILD,
      caseNumber: w.caseNumber,
      actorId: MOD2,
      reason: 'appeal',
    });
    expect(removed.active).toBe(false);
    expect(removed.removedById).toBe(MOD2);
    expect((await memberRecord(GUILD, TARGET, 0)).activeWarnings).toBe(0);
    await expect(
      removeWarning({ guildId: GUILD, caseNumber: w.caseNumber, actorId: MOD }),
    ).rejects.toMatchObject({
      code: 'ALREADY_REMOVED',
    });
    await expect(
      removeWarning({ guildId: GUILD, caseNumber: k.caseNumber, actorId: MOD }),
    ).rejects.toMatchObject({
      code: 'NOT_A_WARNING',
    });
    await expect(removeWarning({ guildId: GUILD, caseNumber: 99, actorId: MOD })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await db().auditLog.count({ where: { action: 'MOD_WARNING_REMOVED' } })).toBe(1);
  });

  it('cases survive a backup and restore; older backups without cases still restore', async () => {
    await recordCase({
      guildId: GUILD,
      action: 'BAN',
      moderatorId: MOD,
      targetId: TARGET,
      details: { deleteMessages: '1 hour' },
    });
    const snapshot = JSON.parse(JSON.stringify(await exportAll())) as Awaited<ReturnType<typeof exportAll>>;
    await resetDb();
    await importAll(snapshot);
    const c = await db().modCase.findFirstOrThrow();
    expect(c.action).toBe('BAN');
    expect(c.details).toEqual({ deleteMessages: '1 hour' });

    const { modCase: _dropped, ...oldTables } = snapshot.tables;
    await importAll({ ...snapshot, tables: oldTables });
    expect(await db().modCase.count()).toBe(0);
    expect(await db().guildConfig.count()).toBe(1);
  });
});

describe('moderation buttons', () => {
  function fakeButton(customId: string, userId: string) {
    const calls: { method: string; payload: unknown }[] = [];
    const i = {
      customId,
      user: { id: userId },
      guildId: GUILD,
      deferred: false,
      replied: false,
      isButton: () => true,
      isStringSelectMenu: () => false,
      isRoleSelectMenu: () => false,
      isModalSubmit: () => false,
      update: async (p: unknown) => {
        calls.push({ method: 'update', payload: p });
        i.replied = true;
      },
      editReply: async (p: unknown) => void calls.push({ method: 'editReply', payload: p }),
      reply: async (p: unknown) => void calls.push({ method: 'reply', payload: p }),
      followUp: async (p: unknown) => void calls.push({ method: 'followUp', payload: p }),
    };
    return { i, calls };
  }

  async function modCtx(userId: string, roles: string[]): Promise<Ctx> {
    await updateConfig(GUILD, { moderationRoleIds: [Z] });
    return {
      guild: { id: GUILD, ownerId: '1', client: { users: { fetch: async () => null } } } as never,
      member: { id: userId, roles: { cache: new Map(roles.map((r) => [r, {}])) } } as never,
      config: await config(),
      // Even the top bot level does not grant moderation: only the role does.
      level: PermissionLevel.OWNER,
      theme: { emojis: true, iconURL: null },
    };
  }

  async function press(customId: string, userId: string, roles: string[]) {
    const f = fakeButton(customId, userId);
    await handleComponent(f.i as never, await modCtx(userId, roles));
    return f.calls;
  }

  it('without the moderation role nothing works, even at Owner level', async () => {
    let ran = 0;
    const token = addPending({
      guildId: GUILD,
      userId: MOD,
      run: async (c) => (ran++, successEmbed(c.theme, 'x', 'y')),
    });
    await expect(press(Ids.mod.confirm(token), MOD, ['111'])).rejects.toMatchObject({
      code: 'NOT_MODERATOR',
    });
    expect(ran).toBe(0);
  });

  it('only the moderator who asked can confirm, and a double click runs it once', async () => {
    let ran = 0;
    const token = addPending({
      guildId: GUILD,
      userId: MOD,
      run: async (c) => (ran++, successEmbed(c.theme, 'Done', 'ok')),
    });
    await expect(press(Ids.mod.confirm(token), MOD2, [Z])).rejects.toMatchObject({ code: 'NOT_YOURS' });
    const calls = await press(Ids.mod.confirm(token), MOD, [Z]);
    expect(calls.map((c) => c.method)).toEqual(['update', 'editReply']);
    expect(JSON.stringify(calls[1]!.payload)).toContain('Done');
    await expect(press(Ids.mod.confirm(token), MOD, [Z])).rejects.toMatchObject({ code: 'STALE' });
    expect(ran).toBe(1);
  });

  it('a rule violation during the action becomes a friendly message, not a crash', async () => {
    const token = addPending({
      guildId: GUILD,
      userId: MOD,
      run: async () => {
        const { DomainError } = await import('../src/core/errors.js');
        throw new DomainError('MOD_REFUSED', 'Their role is above mine.', 'Action refused');
      },
    });
    const calls = await press(Ids.mod.confirm(token), MOD, [Z]);
    expect(JSON.stringify(calls[1]!.payload)).toContain('Their role is above mine.');
  });

  it('cancel removes the request; unknown or foreign requests are refused', async () => {
    const token = addPending({
      guildId: GUILD,
      userId: MOD,
      run: async (c) => successEmbed(c.theme, 'x', 'y'),
    });
    await expect(press(Ids.mod.cancel(token), MOD2, [Z])).rejects.toMatchObject({ code: 'NOT_YOURS' });
    const calls = await press(Ids.mod.cancel(token), MOD, [Z]);
    expect(JSON.stringify(calls[0]!.payload)).toContain('Nothing was done');
    await expect(press(Ids.mod.confirm(token), MOD, [Z])).rejects.toMatchObject({ code: 'STALE' });
    await expect(press(Ids.mod.confirm('nope'), MOD, [Z])).rejects.toMatchObject({ code: 'STALE' });
  });

  it('record pages belong to whoever opened them', async () => {
    await expect(press(Ids.mod.record(TARGET, 1, MOD), MOD2, [Z])).rejects.toMatchObject({
      code: 'NOT_OWNER',
    });
    const calls = await press(Ids.mod.record(TARGET, 0, MOD), MOD, [Z]);
    expect(calls[0]!.method).toBe('update');
    expect(JSON.stringify(calls[0]!.payload)).toContain('A clean record');
  });
});
