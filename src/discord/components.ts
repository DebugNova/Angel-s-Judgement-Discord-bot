import type {
  ButtonInteraction,
  ModalSubmitInteraction,
  RoleSelectMenuInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import { DomainError, Errors } from '../core/errors.js';
import { AuditAction, audit } from '../modules/audit/audit.service.js';
import {
  acceptChallenge,
  cancelChallenge,
  declineChallenge,
  getChallenge,
} from '../modules/challenges/challenge.service.js';
import { updateConfig } from '../modules/configuration/config.service.js';
import { LEADERBOARD_TYPES } from '../modules/leaderboard/leaderboard.service.js';
import type { LeaderboardType } from '../modules/leaderboard/leaderboard.service.js';
import {
  clearCancelRequest,
  requestCancel,
  requireMatch,
  setServerLink,
} from '../modules/matches/match.service.js';
import { isParticipant } from '../modules/matches/match.types.js';
import { PermissionLevel, hasLevel } from '../modules/permissions/permissions.js';
import { RESET_PHRASE, RESET_SCOPES, resetStats } from '../modules/reset/reset.service.js';
import type { ResetScope } from '../modules/reset/reset.service.js';
import { confirmResult, disputeResult, reportResult } from '../modules/results/result.service.js';
import type { Ctx } from './context.js';
import { replyEphemeral } from './context.js';
import { afterCancel, afterFinalize, editChallengeMessage, openMatchRoom } from './flows.js';
import { clearChallengeTimer } from './jobs.js';
import { fetchMember, resolveMatchCategory } from './managers/channels.js';
import { notifyDispute, scheduleLeaderboardRefresh } from './managers/notify.js';
import { refreshPanel } from './managers/panel.js';
import { parseId } from './ids.js';
import {
  applyCancel,
  applyDecision,
  requestEvidence,
  showCancelConfirm,
  showDecisionConfirm,
  showReviewPanel,
} from './actions/staff.js';
import { renderHistory, renderLeaderboard } from './commands/member.js';
import { renderSearch } from './commands/staff.js';
import { handleModerationButton } from './moderation/handlers.js';
import { handleMusicComponent } from './music/handlers.js';
import { challengeEmbed, errorEmbed, helpEmbed, HELP_CATEGORIES, successEmbed } from './ui/embeds.js';
import type { HelpCategory } from './ui/embeds.js';
import { helpSelect, reasonModal, reportSelect, resetModal, serverLinkModal } from './ui/components.js';
import { Ids } from './ids.js';
import { user } from './ui/theme.js';

type AnyComponent =
  | ButtonInteraction<'cached'>
  | StringSelectMenuInteraction<'cached'>
  | RoleSelectMenuInteraction<'cached'>
  | ModalSubmitInteraction<'cached'>;

function mode(raw: string | undefined): 'd' | 'f' {
  return raw === 'f' ? 'f' : 'd';
}

// ───────────────────────────── Challenges ─────────────────────────────

async function onChallenge(
  i: ButtonInteraction<'cached'>,
  ctx: Ctx,
  action: string,
  id: string,
): Promise<void> {
  const challenge = await getChallenge(id);
  if (!challenge || challenge.guildId !== ctx.guild.id) throw Errors.stale();

  if (action === 'acc' || action === 'dec') {
    if (challenge.challenged.discordId !== i.user.id) {
      throw new DomainError(
        'NOT_YOURS',
        `Only ${user(challenge.challenged.discordId)} can respond to this challenge.`,
        'Not your challenge',
      );
    }
  } else if (challenge.challenger.discordId !== i.user.id) {
    throw new DomainError(
      'NOT_YOURS',
      `Only ${user(challenge.challenger.discordId)} can cancel this challenge.`,
      'Not your challenge',
    );
  }

  if (action === 'dec') {
    const declined = await declineChallenge({
      challengeId: id,
      actorDiscordId: i.user.id,
      guildId: ctx.guild.id,
      config: ctx.config,
    });
    clearChallengeTimer(id);
    await i.update({
      content: '',
      embeds: [challengeEmbed(ctx.theme, declined, 'DECLINED')],
      components: [],
    });
    return;
  }
  if (action === 'can') {
    const cancelled = await cancelChallenge({
      challengeId: id,
      actorDiscordId: i.user.id,
      guildId: ctx.guild.id,
    });
    clearChallengeTimer(id);
    await i.update({
      content: '',
      embeds: [challengeEmbed(ctx.theme, cancelled, 'CANCELLED')],
      components: [],
    });
    return;
  }

  // Accept — validate the Discord side first so nobody is locked into a match that cannot start.
  if (challenge.status !== 'PENDING') throw Errors.stale();
  const challengerMember = await fetchMember(ctx.guild, challenge.challenger.discordId);
  if (!challengerMember) {
    throw new DomainError(
      'NOT_MEMBER',
      `${user(challenge.challenger.discordId)} is no longer a member of this server.`,
      'Unable to start the match',
    );
  }
  await resolveMatchCategory(ctx.guild, ctx.config);
  await i.deferUpdate();

  const accepted = await acceptChallenge({
    challengeId: id,
    actorDiscordId: i.user.id,
    guildId: ctx.guild.id,
    config: ctx.config,
  });
  clearChallengeTimer(id);
  for (const other of accepted.cancelled) {
    clearChallengeTimer(other.id);
    void editChallengeMessage(i.client, other, 'SUPERSEDED');
  }
  try {
    const match = await openMatchRoom(i.client, ctx.guild, ctx.config, accepted.matchId);
    await i.editReply({
      content: '',
      embeds: [
        challengeEmbed(ctx.theme, accepted.challenge, 'ACCEPTED', {
          matchDisplayId: match.matchId,
          channelId: match.channelId ?? undefined,
        }),
      ],
      components: [],
    });
  } catch (err) {
    const message = err instanceof DomainError ? err.message : 'The match could not be started.';
    await i.editReply({
      content: '',
      embeds: [errorEmbed(ctx.theme, 'Unable to start the match', message)],
      components: [],
    });
    throw err;
  }
}

// ───────────────────────────── Match panel ─────────────────────────────

async function onMatchButton(
  i: ButtonInteraction<'cached'>,
  ctx: Ctx,
  action: string,
  id: string,
): Promise<void> {
  const match = await requireMatch(id, ctx.guild.id);
  const participant = isParticipant(match, i.user.id);

  switch (action) {
    case 'link': {
      if (!participant)
        throw new DomainError(
          'NOT_PARTICIPANT',
          'Only the players in this match can submit the server link.',
          'Not your match',
        );
      if (!['ACTIVE', 'RESULT_PENDING'].includes(match.status)) throw Errors.stale();
      await i.showModal(serverLinkModal(match.id));
      return;
    }
    case 'rep': {
      if (!participant)
        throw new DomainError(
          'NOT_PARTICIPANT',
          'Only the players in this match can report the result.',
          'Not your match',
        );
      if (match.status !== 'ACTIVE') throw Errors.stale();
      await replyEphemeral(i, {
        content: '**Who won the match?**',
        components: reportSelect(match, i.user.id),
      });
      return;
    }
    case 'conf': {
      await i.deferUpdate();
      const outcome = await confirmResult({
        matchId: id,
        guildId: ctx.guild.id,
        actorDiscordId: i.user.id,
        config: ctx.config,
      });
      await afterFinalize(i.client, outcome);
      return;
    }
    case 'disp': {
      await i.deferUpdate();
      const disputed = await disputeResult({ matchId: id, guildId: ctx.guild.id, actorDiscordId: i.user.id });
      const staffRoles = [...new Set([...ctx.config.refereeRoleIds, ...ctx.config.moderatorRoleIds])];
      await refreshPanel(i.client, disputed.id, {
        bump: true,
        content: `🚨 This match has been escalated to staff review.${staffRoles.length > 0 ? ` ${staffRoles.map((r) => `<@&${r}>`).join(' ')}` : ''}\nPlayers: upload screenshots or other evidence here.`,
        mentionRoles: staffRoles,
      });
      await notifyDispute(i.client, disputed);
      return;
    }
    case 'creq':
    case 'cyes': {
      const { outcome, match: updated } = await requestCancel({
        matchId: id,
        guildId: ctx.guild.id,
        actorDiscordId: i.user.id,
        config: ctx.config,
      });
      await i.deferUpdate();
      if (outcome === 'CANCELLED') {
        await afterCancel(i.client, updated);
      } else {
        const other = updated.challenger.discordId === i.user.id ? updated.opponent : updated.challenger;
        await refreshPanel(i.client, updated.id, {
          bump: true,
          content: `${user(other.discordId)}, your opponent asked to cancel this match.`,
          mentionUsers: [other.discordId],
        });
      }
      return;
    }
    case 'cno': {
      await clearCancelRequest({ matchId: id, guildId: ctx.guild.id, actorDiscordId: i.user.id });
      await i.deferUpdate();
      await refreshPanel(i.client, id);
      return;
    }
  }
  throw Errors.stale();
}

async function onReportSelect(i: StringSelectMenuInteraction<'cached'>, ctx: Ctx, id: string): Promise<void> {
  const winnerPlayerId = i.values[0];
  if (!winnerPlayerId) throw Errors.stale();
  const match = await reportResult({
    matchId: id,
    guildId: ctx.guild.id,
    actorDiscordId: i.user.id,
    winnerPlayerId,
  });
  await i.update({ content: '✅ Result reported. Your opponent has been asked to confirm.', components: [] });
  const waiting = match.challenger.discordId === i.user.id ? match.opponent : match.challenger;
  const winner = winnerPlayerId === match.challenger.id ? match.challenger : match.opponent;
  await refreshPanel(i.client, match.id, {
    bump: true,
    content: `${user(waiting.discordId)}, ${user(i.user.id)} reported ${winner.discordId === i.user.id ? 'themselves' : 'you'} as the winner. Please confirm or dispute.`,
    mentionUsers: [waiting.discordId],
  });
}

// ───────────────────────────── Referee ─────────────────────────────

async function onReferee(
  i: ButtonInteraction<'cached'>,
  ctx: Ctx,
  action: string,
  args: string[],
): Promise<void> {
  const [id = '', playerId = '', m] = args;
  switch (action) {
    case 'rev':
      await showReviewPanel(i, ctx, id);
      return;
    case 'aw':
      await showDecisionConfirm(i, ctx, await requireMatch(id, ctx.guild.id), playerId, mode(m));
      return;
    case 'ok': {
      if (!hasLevel(ctx.level, mode(m) === 'f' ? PermissionLevel.MODERATOR : PermissionLevel.REFEREE))
        throw Errors.forbidden();
      await i.showModal(reasonModal(Ids.referee.reasonModal(id, playerId, mode(m)), 'Decision reason'));
      return;
    }
    case 'can':
      await showCancelConfirm(i, ctx, await requireMatch(id, ctx.guild.id));
      return;
    case 'canok': {
      if (!hasLevel(ctx.level, PermissionLevel.REFEREE)) throw Errors.forbidden();
      await i.showModal(reasonModal(Ids.referee.cancelModal(id), 'Cancellation reason'));
      return;
    }
    case 'ev':
      await requestEvidence(i, ctx, await requireMatch(id, ctx.guild.id));
      return;
  }
  throw Errors.stale();
}

// ───────────────────────────── Modals ─────────────────────────────

async function onModal(i: ModalSubmitInteraction<'cached'>, ctx: Ctx): Promise<void> {
  const { ns, action, args } = parseId(i.customId);
  if (ns === 'm' && action === 'linkmd') {
    const match = await setServerLink({
      matchId: args[0] ?? '',
      guildId: ctx.guild.id,
      actorDiscordId: i.user.id,
      link: i.fields.getTextInputValue('link'),
    });
    await replyEphemeral(i, {
      embeds: [successEmbed(ctx.theme, 'Server link saved', 'The link is now shown on the match panel.')],
    });
    await refreshPanel(i.client, match.id, {
      bump: true,
      content: `🔗 ${user(i.user.id)} submitted the private server link.`,
    });
    return;
  }
  if (ns === 'r' && action === 'rs') {
    await applyDecision(i, ctx, args[0] ?? '', args[1] ?? '', mode(args[2]));
    return;
  }
  if (ns === 'r' && action === 'canrs') {
    await applyCancel(i, ctx, args[0] ?? '');
    return;
  }
  if (ns === 'rs' && action === 'md') {
    if (!hasLevel(ctx.level, PermissionLevel.ADMIN)) throw Errors.forbidden();
    const [scopeRaw = '', playerId = '-', del = '0'] = args;
    if (!(RESET_SCOPES as readonly string[]).includes(scopeRaw)) throw Errors.stale();
    if (i.fields.getTextInputValue('phrase').trim() !== RESET_PHRASE) {
      throw new DomainError(
        'BAD_PHRASE',
        `The confirmation did not match. Nothing was reset.\nType exactly: \`${RESET_PHRASE}\``,
        'Reset aborted',
      );
    }
    const result = await resetStats({
      guildId: ctx.guild.id,
      scope: scopeRaw as ResetScope,
      actorDiscordId: i.user.id,
      startingElo: ctx.config.startingElo,
      playerId: playerId === '-' ? undefined : playerId,
      deleteHistory: del === '1',
    });
    const body = `Reset **${scopeRaw}** completed for ${result.playersAffected} player(s).${result.matchesDeleted > 0 ? `\n${result.matchesDeleted} finished match records were deleted.` : ''}`;
    if (i.isFromMessage())
      await i.update({ embeds: [successEmbed(ctx.theme, 'Stats reset', body)], components: [] });
    else await replyEphemeral(i, { embeds: [successEmbed(ctx.theme, 'Stats reset', body)] });
    scheduleLeaderboardRefresh(i.client, ctx.guild.id, 1_000);
    return;
  }
  throw Errors.stale();
}

// ───────────────────────────── Router ─────────────────────────────

export async function handleComponent(i: AnyComponent, ctx: Ctx): Promise<void> {
  if (i.isModalSubmit()) return onModal(i, ctx);
  const { ns, action, args } = parseId(i.customId);

  if (i.isButton()) {
    switch (ns) {
      case 'ch':
        return onChallenge(i, ctx, action, args[0] ?? '');
      case 'm':
        return onMatchButton(i, ctx, action, args[0] ?? '');
      case 'r':
        return onReferee(i, ctx, action, args);
      case 'mod':
        return handleModerationButton(i, ctx, action, args);
      case 'mu':
        return handleMusicComponent(i, ctx, action, args);
      case 'x':
        await i.update({ content: 'Dismissed.', embeds: [], components: [] });
        return;
      case 'lb': {
        const [size = '10', page = '0', owner = ''] = args;
        if (owner !== i.user.id)
          throw new DomainError(
            'NOT_OWNER',
            'Run `/leaderboard` yourself to browse the rankings.',
            'Not your menu',
          );
        const type = (LEADERBOARD_TYPES as readonly string[]).includes(action)
          ? (action as LeaderboardType)
          : 'elo';
        await i.update(await renderLeaderboard(ctx, type, Number(size), Number(page), owner));
        return;
      }
      case 'h': {
        const [limit = '10', page = '0', owner = ''] = args;
        if (owner !== i.user.id)
          throw new DomainError(
            'NOT_OWNER',
            'Run `/history` yourself to browse match history.',
            'Not your menu',
          );
        await i.update(await renderHistory(ctx, action, Number(limit), Number(page), owner));
        return;
      }
      case 'ms': {
        const [page = '0', owner = ''] = args;
        if (owner !== i.user.id)
          throw new DomainError('NOT_OWNER', 'This search belongs to someone else.', 'Not your menu');
        if (!hasLevel(ctx.level, PermissionLevel.REFEREE)) throw Errors.forbidden();
        await i.update(await renderSearch(ctx, action, Number(page), owner));
        return;
      }
      case 'rs': {
        if (!hasLevel(ctx.level, PermissionLevel.ADMIN)) throw Errors.forbidden();
        const [scope = '', playerId = '-', del = '0'] = [action === 'go' ? args[0] : '', args[1], args[2]];
        if (!(RESET_SCOPES as readonly string[]).includes(scope)) throw Errors.stale();
        await i.showModal(resetModal(Ids.reset.modal(scope, playerId, del === '1')));
        return;
      }
    }
  }

  if (i.isStringSelectMenu()) {
    if (ns === 'mu') return handleMusicComponent(i, ctx, action, args);
    if (ns === 'm' && action === 'repsel') return onReportSelect(i, ctx, args[0] ?? '');
    if (i.customId === Ids.help) {
      const value = i.values[0] ?? '';
      const category = value in HELP_CATEGORIES ? (value as HelpCategory) : null;
      await i.update({
        embeds: [helpEmbed(ctx.theme, category)],
        components: helpSelect(ctx.theme, category),
      });
      return;
    }
  }

  if (i.isRoleSelectMenu() && ns === 'cfg' && action === 'roles') {
    const kind = args[0] ?? '';
    const required =
      kind === 'admin' || kind === 'moderation' ? PermissionLevel.OWNER : PermissionLevel.ADMIN;
    if (!hasLevel(ctx.level, required)) throw Errors.forbidden();
    const field =
      kind === 'referee'
        ? 'refereeRoleIds'
        : kind === 'moderator'
          ? 'moderatorRoleIds'
          : kind === 'admin'
            ? 'adminRoleIds'
            : kind === 'moderation'
              ? 'moderationRoleIds'
              : kind === 'dj'
                ? 'musicDjRoleIds'
                : null;
    if (!field) throw Errors.stale();
    const roleIds = [...i.roles.keys()].filter((id) => id !== ctx.guild.id);
    await updateConfig(ctx.guild.id, { [field]: roleIds });
    await audit({
      guildId: ctx.guild.id,
      actorId: i.user.id,
      action: AuditAction.PERMISSION_CHANGED,
      metadata: { level: kind, roles: roleIds.join(',') || 'none' },
    });
    await i.update({
      content:
        kind === 'moderation'
          ? `✅ Moderation is now reserved for: ${roleIds.length > 0 ? roleIds.map((r) => `<@&${r}>`).join(' ') : 'nobody (moderation commands are off)'}.`
          : kind === 'dj'
            ? `✅ Music DJs: ${roleIds.length > 0 ? `${roleIds.map((r) => `<@&${r}>`).join(' ')} (others can add songs and vote to skip)` : 'none, so everyone in the voice channel controls the music'}.`
            : `✅ **${kind}** roles set to: ${roleIds.length > 0 ? roleIds.map((r) => `<@&${r}>`).join(' ') : 'none'}.\nNew match channels will grant these roles access.`,
      components: [],
      allowedMentions: { parse: [] },
    });
    return;
  }

  throw Errors.stale();
}
