/**
 * Drives the real button / select / modal router (src/discord/components.ts) with simulated
 * interactions, so permission checks, ownership checks and state transitions behind every button
 * are exercised without a Discord connection.
 */
import { MessageFlags } from 'discord.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handleComponent } from '../src/discord/components.js';
import type { Ctx } from '../src/discord/context.js';
import { setRuntimeEnv } from '../src/discord/context.js';
import { Ids } from '../src/discord/ids.js';
import { db } from '../src/database/client.js';
import { PermissionLevel } from '../src/modules/permissions/permissions.js';
import { reportResult } from '../src/modules/results/result.service.js';
import type { Env } from '../src/config/env.js';
import { A, B, C, GUILD, REF, config, player, resetDb, startMatch } from './helpers.js';

type Kind = 'button' | 'select' | 'modal' | 'role';
interface Call {
  method: string;
  payload: unknown;
}

function fake(kind: Kind, customId: string, userId: string, extra: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const record = (method: string) => async (payload?: unknown) => {
    calls.push({ method, payload });
    if (method === 'deferUpdate' || method === 'deferReply') i.deferred = true;
    else if (method !== 'showModal') i.replied = true;
  };
  const i = {
    customId,
    user: { id: userId },
    guildId: GUILD,
    deferred: false,
    replied: false,
    client: {
      guilds: { cache: new Map() },
      channels: { cache: new Map(), fetch: async () => null },
      user: null,
    },
    message: { flags: { has: (f: unknown) => f === MessageFlags.Ephemeral } },
    values: [] as string[],
    fields: {
      getTextInputValue: (name: string) => String((extra.inputs as Record<string, string>)?.[name] ?? ''),
    },
    isButton: () => kind === 'button',
    isStringSelectMenu: () => kind === 'select',
    isRoleSelectMenu: () => kind === 'role',
    isModalSubmit: () => kind === 'modal',
    isFromMessage: () => true,
    reply: record('reply'),
    update: record('update'),
    followUp: record('followUp'),
    deferUpdate: record('deferUpdate'),
    editReply: record('editReply'),
    showModal: record('showModal'),
    ...extra,
  };
  return { i, calls };
}

async function ctx(level: PermissionLevel): Promise<Ctx> {
  return {
    guild: { id: GUILD, ownerId: '1', channels: { cache: new Map() } } as never,
    member: {} as never,
    config: await config(),
    level,
    theme: { emojis: true, iconURL: null },
  };
}

async function press(
  kind: Kind,
  customId: string,
  userId: string,
  level = PermissionLevel.MEMBER,
  extra = {},
) {
  const f = fake(kind, customId, userId, extra);
  await handleComponent(f.i as never, await ctx(level));
  return f.calls;
}

beforeAll(() => {
  setRuntimeEnv({ ownerIds: [], NODE_ENV: 'test' } as unknown as Env);
});
beforeEach(resetDb);

describe('match panel buttons', () => {
  it('only players can open the report menu; it offers both players', async () => {
    const id = await startMatch(A, B);
    await expect(press('button', Ids.match.report(id), C.discordId)).rejects.toMatchObject({
      code: 'NOT_PARTICIPANT',
    });
    const calls = await press('button', Ids.match.report(id), A.discordId);
    expect(calls[0]?.method).toBe('reply');
    expect(JSON.stringify(calls[0]?.payload)).toContain(Ids.match.reportSelect(id));
  });

  it('report select → confirm by reporter fails → confirm by opponent completes the match', async () => {
    const id = await startMatch(A, B);
    const a = await player(A);
    const sel = await press('select', Ids.match.reportSelect(id), A.discordId, PermissionLevel.MEMBER, {
      values: [a.id],
    });
    expect(sel[0]?.method).toBe('update');
    expect((await db().match.findUniqueOrThrow({ where: { id } })).status).toBe('RESULT_PENDING');

    await expect(press('button', Ids.match.confirm(id), A.discordId)).rejects.toMatchObject({
      code: 'OWN_REPORT',
    });
    await expect(press('button', Ids.match.confirm(id), C.discordId)).rejects.toMatchObject({
      code: 'NOT_OPPONENT',
    });
    await press('button', Ids.match.confirm(id), B.discordId);
    expect((await db().match.findUniqueOrThrow({ where: { id } })).status).toBe('COMPLETED');
    expect((await player(A)).elo).toBe(1016);
    // A second click after completion is rejected, not re-applied.
    await expect(press('button', Ids.match.confirm(id), B.discordId)).rejects.toMatchObject({
      code: 'ALREADY_FINALIZED',
    });
    expect((await player(A)).elo).toBe(1016);
  });

  it('dispute button escalates the match', async () => {
    const id = await startMatch(A, B);
    await reportResult({
      matchId: id,
      guildId: GUILD,
      actorDiscordId: A.discordId,
      winnerPlayerId: (await player(A)).id,
    });
    await press('button', Ids.match.dispute(id), B.discordId);
    expect((await db().match.findUniqueOrThrow({ where: { id } })).status).toBe('DISPUTED');
  });

  it('cancel request → agree cancels; refuse clears the request', async () => {
    const id = await startMatch(A, B);
    await press('button', Ids.match.cancelRequest(id), A.discordId);
    await press('button', Ids.match.cancelRefuse(id), B.discordId);
    expect((await db().match.findUniqueOrThrow({ where: { id } })).cancelRequestedById).toBeNull();
    await press('button', Ids.match.cancelRequest(id), A.discordId);
    await press('button', Ids.match.cancelAgree(id), B.discordId);
    expect((await db().match.findUniqueOrThrow({ where: { id } })).status).toBe('CANCELLED');
  });

  it('server link button opens a modal; invalid links are rejected', async () => {
    const id = await startMatch(A, B);
    const calls = await press('button', Ids.match.link(id), A.discordId);
    expect(calls[0]?.method).toBe('showModal');
    await expect(
      press('modal', Ids.match.linkModal(id), A.discordId, PermissionLevel.MEMBER, {
        inputs: { link: 'not a link' },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_LINK' });
    await press('modal', Ids.match.linkModal(id), A.discordId, PermissionLevel.MEMBER, {
      inputs: { link: 'https://www.roblox.com/share?code=abc' },
    });
    expect((await db().match.findUniqueOrThrow({ where: { id } })).serverLink).toContain('roblox');
  });

  it('stale buttons on a deleted/unknown match answer "no longer available"', async () => {
    await expect(
      press('button', Ids.match.confirm('00000000-0000-0000-0000-000000000000'), A.discordId),
    ).rejects.toMatchObject({
      code: 'STALE',
    });
  });
});

describe('referee buttons', () => {
  async function disputed() {
    const id = await startMatch(A, B);
    await reportResult({
      matchId: id,
      guildId: GUILD,
      actorDiscordId: A.discordId,
      winnerPlayerId: (await player(A)).id,
    });
    await press('button', Ids.match.dispute(id), B.discordId);
    return id;
  }

  it('members cannot use staff buttons', async () => {
    const id = await disputed();
    await expect(press('button', Ids.referee.review(id), C.discordId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    const b = await player(B);
    await expect(press('button', Ids.referee.award(id, b.id, 'd'), C.discordId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('review → award → confirm (modal) → reason submit applies the decision once', async () => {
    const id = await disputed();
    const rev = await press('button', Ids.referee.review(id), REF.discordId, PermissionLevel.REFEREE);
    expect(rev[0]?.method).toBe('update');
    expect((await db().match.findUniqueOrThrow({ where: { id } })).status).toBe('UNDER_REVIEW');

    const b = await player(B);
    const aw = await press(
      'button',
      Ids.referee.award(id, b.id, 'd'),
      REF.discordId,
      PermissionLevel.REFEREE,
    );
    expect(JSON.stringify(aw[0]?.payload)).toContain(Ids.referee.confirmAward(id, b.id, 'd'));
    const ok = await press(
      'button',
      Ids.referee.confirmAward(id, b.id, 'd'),
      REF.discordId,
      PermissionLevel.REFEREE,
    );
    expect(ok[0]?.method).toBe('showModal');

    await press('modal', Ids.referee.reasonModal(id, b.id, 'd'), REF.discordId, PermissionLevel.REFEREE, {
      inputs: { reason: 'Screenshot shows B won' },
    });
    const m = await db().match.findUniqueOrThrow({ where: { id } });
    expect(m).toMatchObject({
      status: 'COMPLETED',
      winnerId: b.id,
      decisionReason: 'Screenshot shows B won',
    });
    await expect(
      press('modal', Ids.referee.reasonModal(id, b.id, 'd'), REF.discordId, PermissionLevel.REFEREE, {
        inputs: { reason: '' },
      }),
    ).rejects.toMatchObject({ code: 'ALREADY_FINALIZED' });
    expect((await player(B)).elo).toBe(1016);
  });

  it('force-complete needs moderator; referee is refused', async () => {
    const id = await startMatch(A, B);
    const a = await player(A);
    await expect(
      press('button', Ids.referee.award(id, a.id, 'f'), REF.discordId, PermissionLevel.REFEREE),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const calls = await press(
      'button',
      Ids.referee.award(id, a.id, 'f'),
      REF.discordId,
      PermissionLevel.MODERATOR,
    );
    expect(calls[0]?.method).toBe('update');
  });

  it('staff cancel through the modal cancels the match', async () => {
    const id = await disputed();
    await press('button', Ids.referee.cancel(id), REF.discordId, PermissionLevel.REFEREE);
    await press('modal', Ids.referee.cancelModal(id), REF.discordId, PermissionLevel.REFEREE, {
      inputs: { reason: 'no show' },
    });
    expect((await db().match.findUniqueOrThrow({ where: { id } })).status).toBe('CANCELLED');
  });
});

describe('admin & misc components', () => {
  it('reset requires admin and the exact phrase', async () => {
    const id = await startMatch(A, B);
    await reportResult({
      matchId: id,
      guildId: GUILD,
      actorDiscordId: A.discordId,
      winnerPlayerId: (await player(A)).id,
    });
    await press('button', Ids.match.confirm(id), B.discordId);
    await expect(press('button', Ids.reset.proceed('all', '-', false), A.discordId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      press('modal', Ids.reset.modal('all', '-', false), A.discordId, PermissionLevel.ADMIN, {
        inputs: { phrase: 'reset seven angels' },
      }),
    ).rejects.toMatchObject({ code: 'BAD_PHRASE' });
    expect((await player(A)).elo).toBe(1016);
    await press('modal', Ids.reset.modal('all', '-', false), A.discordId, PermissionLevel.ADMIN, {
      inputs: { phrase: 'RESET SEVEN ANGELS' },
    });
    expect((await player(A)).elo).toBe(1000);
  });

  it('pagination only works for the person who opened it', async () => {
    await expect(
      press('button', Ids.page.leaderboard('elo', 10, 1, A.discordId), B.discordId),
    ).rejects.toMatchObject({
      code: 'NOT_OWNER',
    });
    const calls = await press('button', Ids.page.leaderboard('elo', 10, 0, A.discordId), A.discordId);
    expect(calls[0]?.method).toBe('update');
  });

  it('dismiss closes an ephemeral panel', async () => {
    const calls = await press('button', Ids.dismiss, A.discordId);
    expect(calls[0]?.method).toBe('update');
  });

  it('only the owner can change admin roles', async () => {
    const roles = new Map([['555', {}]]);
    await expect(
      press('role', Ids.config.roles('admin'), A.discordId, PermissionLevel.ADMIN, { roles }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await press('role', Ids.config.roles('referee'), A.discordId, PermissionLevel.ADMIN, { roles });
    expect((await config()).refereeRoleIds).toEqual(['555']);
  });
});
