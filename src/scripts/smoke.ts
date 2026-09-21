/**
 * LIVE smoke test against your real Discord server — verifies the Discord side of the bot end to end
 * (channel creation + permissions, every panel state, disputes, referee decisions, history, leaderboard,
 * cleanup, crash recovery, and that Discord accepts every embed/button/menu the bot can send).
 *
 *   npm run smoke            → run everything, then delete all test channels and restore the database
 *   npm run smoke -- --keep  → keep the test channels so you can look at them (delete the category yourself)
 *
 * Safe by design: stop the bot first (the script refuses to run while it is running). A full database
 * backup is taken first and restored at the end, so no test matches or stats are left behind.
 * Two bots already in your server stand in as "players", so no real member is pinged.
 */
import 'dotenv/config';
import { ChannelType, Client, GatewayIntentBits, OverwriteType, PermissionFlagsBits } from 'discord.js';
import type { CategoryChannel, Guild, GuildMember, TextChannel } from 'discord.js';
import { loadEnv } from '../config/env.js';
import { enableFileLogging, log, setLogLevel } from '../core/logger.js';
import { exportAll, importAll } from '../database/backup.js';
import { db, disconnectDb } from '../database/client.js';
import { runMigrations } from '../database/migrate.js';
import {
  acceptChallenge,
  attachChallengeMessage,
  createChallenge,
  expireChallenge,
} from '../modules/challenges/challenge.service.js';
import { calculateElo } from '../modules/elo/elo.js';
import { getConfig, invalidateConfig, updateConfig } from '../modules/configuration/config.service.js';
import { getLeaderboardPage } from '../modules/leaderboard/leaderboard.service.js';
import { headToHead, playerHistory, recentForm } from '../modules/history/history.service.js';
import {
  addEvidence,
  claimChannelDeletion,
  getMatch,
  listDueCleanups,
  listEvidence,
  markEvidenceRequested,
  reopenMatch,
  requestCancel,
  searchMatches,
  setServerLink,
  staffCancel,
} from '../modules/matches/match.service.js';
import { findPlayer, getRank } from '../modules/players/player.service.js';
import { decideMatch, openReview } from '../modules/referee/referee.service.js';
import { confirmResult, disputeResult, reportResult } from '../modules/results/result.service.js';
import type { Identity } from '../modules/players/player.service.js';
import { setRuntimeEnv, themeFor } from '../discord/context.js';
import { afterCancel, afterFinalize, editChallengeMessage, openMatchRoom } from '../discord/flows.js';
import { recoverGuild } from '../discord/jobs.js';
import { deleteMatchChannel, fetchTextChannel } from '../discord/managers/channels.js';
import { notifyDispute, refreshLeaderboardPanel, startLogMirror } from '../discord/managers/notify.js';
import { refreshPanel } from '../discord/managers/panel.js';
import * as E from '../discord/ui/embeds.js';
import * as C from '../discord/ui/components.js';
import { commands } from '../discord/commands/index.js';
import { Ids } from '../discord/ids.js';
import { connectForScript } from './db-connect.js';

const keep = process.argv.includes('--keep');
const env = loadEnv();
setLogLevel('warn');
enableFileLogging('logs');
setRuntimeEnv(env);

const results: { name: string; ok: boolean; detail?: string }[] = [];
async function step(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✅ ${name}`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    results.push({ name, ok: false, detail });
    console.log(`  ❌ ${name}\n     → ${detail}`);
    log.error('SMOKE_STEP_FAILED', { step: name }, err);
  }
}
function check(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const embedded = await connectForScript();
if (embedded?.reused) {
  console.error(
    '✋ The bot (or another copy of its database) is running. Stop the bot first, then run the smoke test.',
  );
  process.exit(1);
}
await runMigrations(process.env.DATABASE_URL ?? '');
console.log('📦 Backing up the database (restored at the end)…');
const backup = await exportAll();

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
await client.login(env.DISCORD_TOKEN);
await new Promise<void>((r) => (client.isReady() ? r() : client.once('clientReady', () => r())));
startLogMirror(client);

const guild: Guild | undefined = env.DISCORD_GUILD_ID
  ? client.guilds.cache.get(env.DISCORD_GUILD_ID)
  : client.guilds.cache.first();
if (!guild) {
  console.error('The bot is not in any server.');
  process.exit(1);
}
console.log(`🧪 Smoke test in "${guild.name}" as ${client.user?.tag}\n`);

const created: string[] = [];
let category: CategoryChannel | null = null;
let gallery: TextChannel | null = null;

try {
  // ───── Setup ─────
  const botRoles = guild.roles.cache.filter((r) => r.tags?.botId && r.tags.botId !== client.user!.id);
  const stand: GuildMember[] = [];
  for (const r of botRoles.values()) {
    const m = await guild.members.fetch(r.tags!.botId!).catch(() => null);
    if (m) stand.push(m);
    if (stand.length === 2) break;
  }
  check(stand.length === 2, 'Need two other bots in the server to act as test players.');
  const [m1, m2] = stand as [GuildMember, GuildMember];
  const P1: Identity = { discordId: m1.id, username: m1.user.username, displayName: m1.displayName };
  const P2: Identity = { discordId: m2.id, username: m2.user.username, displayName: m2.displayName };
  const REF = env.ownerIds[0] ?? guild.ownerId;
  console.log(`Players: ${P1.displayName} vs ${P2.displayName} · referee: ${REF}\n`);

  await step('Create private test category and channels', async () => {
    category = await guild.channels.create({
      name: '🧪 aj-smoke-test',
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: client.user!.id, allow: [PermissionFlagsBits.ViewChannel] },
      ],
    });
    created.push(category.id);
    const mk = async (name: string) => {
      const ch = await guild.channels.create({ name, type: ChannelType.GuildText, parent: category!.id });
      created.push(ch.id);
      return ch;
    };
    const [history, lb, staff, logs] = [
      await mk('history'),
      await mk('leaderboard'),
      await mk('staff'),
      await mk('logs'),
    ];
    gallery = await mk('embed-gallery');
    await getConfig(guild.id);
    await updateConfig(guild.id, {
      matchCategoryId: category.id,
      historyChannelId: history.id,
      leaderboardChannelId: lb.id,
      leaderboardMessageId: null,
      staffChannelId: staff.id,
      logChannelId: logs.id,
      minLeaderboardMatches: 1,
      maintenanceMode: false,
    });
  });
  check(category && gallery, 'Setup failed — cannot continue.');
  const cfg = () => {
    invalidateConfig(guild.id);
    return getConfig(guild.id);
  };
  const theme = themeFor(await cfg(), client);
  const g = gallery as TextChannel;

  // ───── Challenge message states ─────
  await step('Challenge embed + buttons render; every final state edits correctly', async () => {
    const ch = await createChallenge({ guildId: guild.id, config: await cfg(), challenger: P1, target: P2 });
    const msg = await g.send({
      embeds: [E.challengeEmbed(theme, ch, 'PENDING')],
      components: C.challengeButtons(theme, ch.id),
    });
    await attachChallengeMessage(ch.id, g.id, msg.id);
    for (const state of ['DECLINED', 'CANCELLED', 'SUPERSEDED'] as const) {
      await editChallengeMessage(client, { ...ch, channelId: g.id, messageId: msg.id }, state);
    }
    await db().challenge.update({ where: { id: ch.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const exp = await expireChallenge(ch.id);
    check(exp?.status === 'EXPIRED', 'challenge did not expire');
    await editChallengeMessage(client, exp, 'EXPIRED');
    const after = await g.messages.fetch({ message: msg.id, force: true });
    check(after.embeds[0]?.title?.includes('EXPIRED'), 'challenge message not edited to EXPIRED');
    check(after.components.length === 0, 'buttons not removed');
  });

  // ───── Match 1: dispute → referee ─────
  let match1 = '';
  await step('Accept → private match channel with correct permissions + panel', async () => {
    const ch = await createChallenge({ guildId: guild.id, config: await cfg(), challenger: P1, target: P2 });
    const acc = await acceptChallenge({
      challengeId: ch.id,
      actorDiscordId: P2.discordId,
      guildId: guild.id,
      config: await cfg(),
    });
    const m = await openMatchRoom(client, guild, await cfg(), acc.matchId);
    match1 = m.id;
    check(m.status === 'ACTIVE' && m.channelId, 'match not active');
    const channel = await fetchTextChannel(client, guild.id, m.channelId);
    check(channel, 'match channel missing');
    created.push(channel.id);
    check(channel.parentId === category!.id, 'channel not in the match category');
    const everyone = channel.permissionOverwrites.cache.get(guild.roles.everyone.id);
    check(everyone?.deny.has(PermissionFlagsBits.ViewChannel), '@everyone is not denied');
    for (const p of [P1, P2]) {
      const o = channel.permissionOverwrites.cache.get(p.discordId);
      check(
        o?.type === OverwriteType.Member && o.allow.has(PermissionFlagsBits.SendMessages),
        `player ${p.displayName} lacks access`,
      );
    }
    const fresh = await getMatch(m.id);
    check(fresh?.panelMessageId, 'panel message id not stored');
    const panel = await channel.messages.fetch(fresh.panelMessageId);
    check(panel.components.length > 0, 'panel has no buttons');
  });

  await step('Server link → panel updated', async () => {
    await setServerLink({
      matchId: match1,
      guildId: guild.id,
      actorDiscordId: P1.discordId,
      link: 'https://www.roblox.com/share?code=smoketest',
    });
    await refreshPanel(client, match1, { bump: true, content: '🔗 link submitted' });
    const m = await getMatch(match1);
    const ch = await fetchTextChannel(client, guild.id, m!.channelId!);
    const panel = await ch!.messages.fetch(m!.panelMessageId!);
    check(JSON.stringify(panel.embeds[0]?.fields).includes('smoketest'), 'link not on panel');
  });

  await step('Report → RESULT PENDING panel with Confirm/Dispute', async () => {
    const p1 = await findPlayer(guild.id, P1.discordId);
    await reportResult({
      matchId: match1,
      guildId: guild.id,
      actorDiscordId: P1.discordId,
      winnerPlayerId: p1!.id,
    });
    await refreshPanel(client, match1, { bump: true, content: 'result reported' });
    const m = await getMatch(match1);
    const ch = await fetchTextChannel(client, guild.id, m!.channelId!);
    const panel = await ch!.messages.fetch(m!.panelMessageId!);
    check(panel.embeds[0]?.title?.includes('RESULT PENDING'), 'panel not in RESULT PENDING');
    const ids = panel.components.flatMap((r) =>
      ('components' in r ? r.components : []).map((c) => ('customId' in c ? c.customId : '')),
    );
    check(
      ids.includes(Ids.match.confirm(match1)) && ids.includes(Ids.match.dispute(match1)),
      'confirm/dispute buttons missing',
    );
  });

  await step('Dispute → staff alert posted + DISPUTED panel', async () => {
    const d = await disputeResult({ matchId: match1, guildId: guild.id, actorDiscordId: P2.discordId });
    await refreshPanel(client, match1, { bump: true, content: 'disputed' });
    const posted = await notifyDispute(client, d);
    check(posted, 'staff channel not used');
    const staff = await fetchTextChannel(client, guild.id, (await cfg()).staffChannelId!);
    const last = (await staff!.messages.fetch({ limit: 1 })).first();
    check(last?.embeds[0]?.title?.includes('DISPUTED'), 'no dispute alert in staff channel');
  });

  await step('Review → UNDER REVIEW; review/decision/cancel panels render', async () => {
    const m = await openReview({ matchId: match1, guildId: guild.id, staffDiscordId: REF });
    check(m.status === 'UNDER_REVIEW', 'not under review');
    await refreshPanel(client, match1);
    await g.send({ embeds: [E.reviewPanelEmbed(theme, m)], components: C.reviewPanelButtons(theme, m) });
    await g.send({
      embeds: [E.decisionConfirmEmbed(theme, m, m.challenger, 'd')],
      components: C.confirmDecisionButtons(theme, m.id, m.challenger.id, 'd'),
    });
    await g.send({
      embeds: [E.cancelConfirmEmbed(theme, m)],
      components: C.confirmCancelButtons(theme, m.id),
    });
  });

  await step('Evidence request + evidence recording + evidence list', async () => {
    const m = (await getMatch(match1))!;
    await markEvidenceRequested(m, REF);
    const ch = await fetchTextChannel(client, guild.id, m.channelId!);
    await ch!.send({ embeds: [E.evidenceRequestEmbed(theme, m, REF)] });
    await addEvidence(m, [
      {
        submittedByDiscordId: P1.discordId,
        channelId: m.channelId!,
        messageId: '1',
        attachmentUrl: 'https://cdn.discordapp.com/x.png',
        fileName: 'x.png',
        contentType: 'image/png',
      },
    ]);
    const list = await listEvidence(m.id);
    check(list.length === 1, 'evidence not stored');
    await g.send({ embeds: [E.evidenceListEmbed(theme, (await getMatch(m.id))!, list)] });
  });

  await step('Referee decision → stats/ELO, channel locked, COMPLETED panel, history record', async () => {
    const p1 = await findPlayer(guild.id, P1.discordId);
    const out = await decideMatch({
      matchId: match1,
      guildId: guild.id,
      staffDiscordId: REF,
      winnerPlayerId: p1!.id,
      reason: 'Smoke test decision',
      mode: 'decide',
      config: await cfg(),
    });
    const even = calculateElo((await cfg()).startingElo, (await cfg()).startingElo, await cfg());
    check(
      out.elo.winnerChange === even.winnerChange && out.elo.loserChange === even.loserChange,
      `unexpected ELO ${out.elo.winnerChange}, expected ${even.winnerChange}`,
    );
    await afterFinalize(client, out);
    const ch = await fetchTextChannel(client, guild.id, out.match.channelId!);
    const o = ch!.permissionOverwrites.cache.get(P1.discordId);
    check(o?.deny.has(PermissionFlagsBits.SendMessages), 'channel not locked after completion');
    const m = await getMatch(match1);
    const panel = await ch!.messages.fetch(m!.panelMessageId!);
    check(panel.embeds[0]?.title?.includes('COMPLETED'), 'panel not COMPLETED');
    const hist = await fetchTextChannel(client, guild.id, (await cfg()).historyChannelId!);
    const rec = (await hist!.messages.fetch({ limit: 1 })).first();
    check(rec?.embeds[0]?.title?.includes('RESOLVED'), 'history record missing');
    check(!JSON.stringify(rec!.embeds).includes('smoketest'), 'server link leaked into history!');
  });

  // ───── Match 2: confirm path ─────
  await step('Second match: report → confirm → ELO from updated ratings', async () => {
    const ch = await createChallenge({ guildId: guild.id, config: await cfg(), challenger: P2, target: P1 });
    const acc = await acceptChallenge({
      challengeId: ch.id,
      actorDiscordId: P1.discordId,
      guildId: guild.id,
      config: await cfg(),
    });
    const m = await openMatchRoom(client, guild, await cfg(), acc.matchId);
    created.push(m.channelId!);
    const p2 = await findPlayer(guild.id, P2.discordId);
    await reportResult({
      matchId: m.id,
      guildId: guild.id,
      actorDiscordId: P2.discordId,
      winnerPlayerId: p2!.id,
    });
    const out = await confirmResult({
      matchId: m.id,
      guildId: guild.id,
      actorDiscordId: P1.discordId,
      config: await cfg(),
    });
    const c = await cfg();
    const loserAfterMatch1 = calculateElo(c.startingElo, c.startingElo, c).loserNew;
    const expected = calculateElo(loserAfterMatch1, 2 * c.startingElo - loserAfterMatch1, c);
    check(
      out.elo.winnerOld === expected.winnerOld && out.elo.winnerChange === expected.winnerChange,
      `unexpected ELO ${out.elo.winnerOld}+${out.elo.winnerChange}, expected ${expected.winnerOld}+${expected.winnerChange}`,
    );
    await afterFinalize(client, out);
  });

  // ───── Match 3: mutual cancel, reopen, staff cancel ─────
  await step('Third match: mutual cancel → reopen → staff cancel', async () => {
    const ch = await createChallenge({ guildId: guild.id, config: await cfg(), challenger: P1, target: P2 });
    const acc = await acceptChallenge({
      challengeId: ch.id,
      actorDiscordId: P2.discordId,
      guildId: guild.id,
      config: await cfg(),
    });
    const m = await openMatchRoom(client, guild, await cfg(), acc.matchId);
    created.push(m.channelId!);
    const r1 = await requestCancel({
      matchId: m.id,
      guildId: guild.id,
      actorDiscordId: P1.discordId,
      config: await cfg(),
    });
    check(r1.outcome === 'REQUESTED', 'first cancel not a request');
    await refreshPanel(client, m.id, { bump: true });
    const r2 = await requestCancel({
      matchId: m.id,
      guildId: guild.id,
      actorDiscordId: P2.discordId,
      config: await cfg(),
    });
    check(r2.outcome === 'CANCELLED', 'mutual cancel failed');
    await afterCancel(client, r2.match);
    const re = await reopenMatch({ matchId: m.id, guildId: guild.id, staffDiscordId: REF });
    check(re.match.status === 'ACTIVE', 'reopen failed');
    await refreshPanel(client, m.id, { bump: true });
    const sc = await staffCancel({
      matchId: m.id,
      guildId: guild.id,
      staffDiscordId: REF,
      reason: 'smoke',
      config: await cfg(),
    });
    await afterCancel(client, sc);
  });

  // ───── Leaderboard panel ─────
  await step('Live leaderboard panel is created once, then edited in place', async () => {
    await refreshLeaderboardPanel(client, guild.id);
    const id1 = (await cfg()).leaderboardMessageId;
    await refreshLeaderboardPanel(client, guild.id);
    const id2 = (await cfg()).leaderboardMessageId;
    check(id1 && id1 === id2, 'leaderboard panel was re-posted instead of edited');
  });

  // ───── Every other screen ─────
  await step('All remaining embeds, menus and modals are accepted by Discord', async () => {
    const c = await cfg();
    const p1 = (await findPlayer(guild.id, P1.discordId))!;
    const p2 = (await findPlayer(guild.id, P2.discordId))!;
    await g.send({
      embeds: [
        E.profileEmbed(theme, p1, {
          rank: await getRank(p1, 1),
          minMatches: 1,
          form: await recentForm(p1),
          avatarURL: m1.displayAvatarURL(),
          accountCreated: m1.user.createdAt,
        }),
        E.leaderboardEmbed(theme, 'elo', await getLeaderboardPage(guild.id, 'elo', 10, 0, 1), 1),
        E.historyEmbed(theme, p1, await playerHistory(p1, 10, 0)),
        E.headToHeadEmbed(theme, p1, p2, await headToHead(p1, p2)),
      ],
      components: C.pagerRow(theme, (p) => `smoke:${p}`, 0, 3),
    });
    for (const cat of [null, 'duel', 'stats', 'matches', 'staff', 'admin'] as const) {
      await g.send({ embeds: [E.helpEmbed(theme, cat)], components: C.helpSelect(theme, cat) });
    }
    const search = await searchMatches({ guildId: guild.id }, 0, 10);
    const any = (await getMatch(match1))!;
    await g.send({
      embeds: [
        E.aboutEmbed(theme, null),
        E.configEmbed(theme, c, null),
        E.searchEmbed(theme, search.rows, 0, 1, search.total),
        E.matchSummaryEmbed(theme, any, { staff: true, notes: [] }),
      ],
    });
    await g.send({
      embeds: [
        E.statusEmbed(theme, {
          latency: 42,
          dbOk: true,
          dbLatency: 3,
          live: 0,
          players: 2,
          completed: 2,
          uptimeSec: 3600,
          maintenance: false,
          admin: { memoryMb: 90, node: process.version, guilds: 1, env: 'production' },
        }),
      ],
    });
    await g.send({ embeds: [E.inspectEmbed(theme, p1, { current: null, audit: [], rank: 1 })] });
    await g.send({
      embeds: [E.resetDangerEmbed(theme, 'all', null, true)],
      components: C.resetButtons(theme, 'all', '-', true),
    });
    await g.send({ content: 'report select', components: C.reportSelect(any, P1.discordId) });
    await g.send({ content: 'role select', components: C.roleSelect('referee', []) });
    await g.send({
      embeds: [
        E.errorEmbed(theme, 'Error', 'x'),
        E.successEmbed(theme, 'Ok', 'x'),
        E.noPermissionEmbed(theme),
      ],
    });
    // Modals cannot be sent to a channel; validate them locally with discord.js builders.
    C.serverLinkModal(any.id).toJSON();
    C.reasonModal(Ids.referee.reasonModal(any.id, p1.id, 'd'), 'Decision reason').toJSON();
    C.resetModal(Ids.reset.modal('all', '-', true)).toJSON();
    check(commands.length === 16, 'unexpected command count');
  });

  // ───── Cleanup job + crash recovery ─────
  await step('Scheduled cleanup deletes finished match channels exactly once', async () => {
    await db().match.updateMany({
      where: { guildId: guild.id, status: { in: ['COMPLETED', 'CANCELLED'] } },
      data: { cleanupAt: new Date(Date.now() - 1000) },
    });
    const due = await listDueCleanups();
    check(due.length >= 3, `expected 3 due cleanups, got ${due.length}`);
    for (const m of due) {
      const gone = await deleteMatchChannel(client, m.guildId, m.channelId!, 'smoke cleanup');
      check(gone && (await claimChannelDeletion(m.id)), 'cleanup failed');
      check(!(await claimChannelDeletion(m.id)), 'cleanup claimed twice');
    }
  });

  await step('Crash recovery recreates a deleted live match channel; reports orphans', async () => {
    const ch = await createChallenge({ guildId: guild.id, config: await cfg(), challenger: P1, target: P2 });
    const acc = await acceptChallenge({
      challengeId: ch.id,
      actorDiscordId: P2.discordId,
      guildId: guild.id,
      config: await cfg(),
    });
    const m = await openMatchRoom(client, guild, await cfg(), acc.matchId);
    await guild.channels.delete(m.channelId!);
    const known = await db().auditLog.count({ where: { action: 'ORPHAN_DETECTED' } });
    const stray = await guild.channels.create({
      name: 'stray-channel',
      type: ChannelType.GuildText,
      parent: category!.id,
    });
    created.push(stray.id);
    await recoverGuild(client, guild);
    const after = await getMatch(m.id);
    check(after?.channelId && after.channelId !== m.channelId, 'channel not recreated');
    created.push(after.channelId);
    check(await fetchTextChannel(client, guild.id, after.channelId), 'recreated channel missing');
    const orphans = await db().auditLog.count({ where: { action: 'ORPHAN_DETECTED' } });
    check(orphans - known === 2, `expected 2 orphan reports (stray + gallery), got ${orphans - known}`);
  });

  await sleep(3000); // let the log-channel mirror catch up
  await step('Log channel received audit events', async () => {
    const logs = await fetchTextChannel(client, guild.id, (await cfg()).logChannelId!);
    const msgs = await logs!.messages.fetch({ limit: 20 });
    check(msgs.size > 5, `only ${msgs.size} log messages`);
  });
} finally {
  console.log('\n🧹 Cleaning up…');
  if (!keep) {
    for (const id of created.reverse()) await guild.channels.delete(id).catch(() => undefined);
  } else {
    console.log('   --keep: test channels left in "🧪 aj-smoke-test" — delete that category when done.');
  }
  await importAll(backup);
  console.log('   Database restored to its state before the test.');
  await sleep(500);
  await client.destroy();
  await disconnectDb();
  await embedded?.stop();
}

const failed = results.filter((r) => !r.ok);
console.log(
  `\n${failed.length === 0 ? '🎉 ALL' : '⚠️'} ${results.length - failed.length}/${results.length} smoke steps passed.`,
);
if (failed.length > 0) {
  for (const f of failed) console.log(`   ❌ ${f.name}: ${f.detail}`);
  process.exit(1);
}
process.exit(0);
