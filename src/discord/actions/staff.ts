import { MessageFlags } from 'discord.js';
import type { ButtonInteraction, ChatInputCommandInteraction, ModalSubmitInteraction } from 'discord.js';
import { DomainError, Errors } from '../../core/errors.js';
import {
  getMatch,
  markEvidenceRequested,
  requireMatch,
  staffCancel,
} from '../../modules/matches/match.service.js';
import type { MatchView } from '../../modules/matches/match.types.js';
import { PermissionLevel, hasLevel } from '../../modules/permissions/permissions.js';
import {
  assertDecidable,
  assertImpartial,
  decideMatch,
  openReview,
} from '../../modules/referee/referee.service.js';
import type { Ctx } from '../context.js';
import { afterCancel, afterFinalize } from '../flows.js';
import { fetchTextChannel } from '../managers/channels.js';
import { refreshPanel } from '../managers/panel.js';
import {
  cancelConfirmEmbed,
  decisionConfirmEmbed,
  evidenceRequestEmbed,
  reviewPanelEmbed,
  successEmbed,
} from '../ui/embeds.js';
import { confirmCancelButtons, confirmDecisionButtons, reviewPanelButtons } from '../ui/components.js';
import { signed, user } from '../ui/theme.js';

type Replyable =
  ButtonInteraction<'cached'> | ChatInputCommandInteraction<'cached'> | ModalSubmitInteraction<'cached'>;

export function levelForMode(mode: 'd' | 'f'): PermissionLevel {
  return mode === 'f' ? PermissionLevel.MODERATOR : PermissionLevel.REFEREE;
}

function ensure(ctx: Ctx, level: PermissionLevel): void {
  if (!hasLevel(ctx.level, level)) throw Errors.forbidden();
}

/** Replaces the ephemeral message a button lives on, or sends a new ephemeral reply for commands. */
async function show(
  i: Replyable,
  payload: Parameters<ButtonInteraction['update']>[0] & object,
): Promise<void> {
  if (i.isButton() || (i.isModalSubmit() && i.isFromMessage())) {
    if (i.message.flags.has(MessageFlags.Ephemeral)) {
      await i.update(payload);
      return;
    }
  }
  const body = {
    ...(payload as object),
    flags: MessageFlags.Ephemeral as const,
    allowedMentions: { parse: [] as never[] },
  };
  if (i.deferred || i.replied) await i.followUp(body);
  else await i.reply(body);
}

export async function showReviewPanel(i: Replyable, ctx: Ctx, matchId: string): Promise<void> {
  ensure(ctx, PermissionLevel.REFEREE);
  const before = await requireMatch(matchId, ctx.guild.id);
  const match = await openReview({ matchId, guildId: ctx.guild.id, staffDiscordId: i.user.id });
  if (before.status !== match.status) void refreshPanel(i.client, match.id);
  await show(i, {
    embeds: [reviewPanelEmbed(ctx.theme, match)],
    components: reviewPanelButtons(ctx.theme, match),
  });
}

export async function showDecisionConfirm(
  i: Replyable,
  ctx: Ctx,
  match: MatchView,
  winnerPlayerId: string,
  mode: 'd' | 'f',
): Promise<void> {
  ensure(ctx, levelForMode(mode));
  assertImpartial(match, i.user.id);
  assertDecidable(match, mode === 'f' ? 'force' : 'decide');
  const winner =
    winnerPlayerId === match.challenger.id
      ? match.challenger
      : winnerPlayerId === match.opponent.id
        ? match.opponent
        : null;
  if (!winner)
    throw new DomainError(
      'INVALID_WINNER',
      'The selected winner is not a player in this match.',
      'Invalid winner',
    );
  await show(i, {
    embeds: [decisionConfirmEmbed(ctx.theme, match, winner, mode)],
    components: confirmDecisionButtons(ctx.theme, match.id, winner.id, mode),
  });
}

export async function applyDecision(
  i: ModalSubmitInteraction<'cached'>,
  ctx: Ctx,
  matchId: string,
  winnerPlayerId: string,
  mode: 'd' | 'f',
): Promise<void> {
  ensure(ctx, levelForMode(mode));
  const reason = i.fields.getTextInputValue('reason').trim() || null;
  const outcome = await decideMatch({
    matchId,
    guildId: ctx.guild.id,
    staffDiscordId: i.user.id,
    winnerPlayerId,
    reason,
    mode: mode === 'f' ? 'force' : 'decide',
    config: ctx.config,
  });
  await show(i, {
    embeds: [
      successEmbed(
        ctx.theme,
        'Decision applied',
        `\`${outcome.match.matchId}\` — win awarded to ${user(outcome.winner.discordId)}.\nELO: ${signed(outcome.elo.winnerChange)} / ${signed(outcome.elo.loserChange)}`,
      ),
    ],
    components: [],
  });
  await afterFinalize(i.client, outcome);
}

export async function showCancelConfirm(i: Replyable, ctx: Ctx, match: MatchView): Promise<void> {
  ensure(ctx, PermissionLevel.REFEREE);
  assertImpartial(match, i.user.id);
  if (match.status === 'COMPLETED') {
    throw new DomainError(
      'COMPLETED',
      `${match.matchId} is already completed and cannot be cancelled.`,
      'Cancellation unavailable',
    );
  }
  await show(i, {
    embeds: [cancelConfirmEmbed(ctx.theme, match)],
    components: confirmCancelButtons(ctx.theme, match.id),
  });
}

export async function applyCancel(
  i: ModalSubmitInteraction<'cached'>,
  ctx: Ctx,
  matchId: string,
): Promise<void> {
  ensure(ctx, PermissionLevel.REFEREE);
  const match = await requireMatch(matchId, ctx.guild.id);
  assertImpartial(match, i.user.id);
  const reason = i.fields.getTextInputValue('reason').trim() || null;
  const cancelled = await staffCancel({
    matchId,
    guildId: ctx.guild.id,
    staffDiscordId: i.user.id,
    reason,
    config: ctx.config,
  });
  await show(i, {
    embeds: [
      successEmbed(
        ctx.theme,
        'Match cancelled',
        `\`${cancelled.matchId}\` was cancelled. No stats or ELO changed.`,
      ),
    ],
    components: [],
  });
  await afterCancel(i.client, cancelled);
}

export async function requestEvidence(i: Replyable, ctx: Ctx, match: MatchView): Promise<void> {
  ensure(ctx, PermissionLevel.REFEREE);
  assertImpartial(match, i.user.id);
  if (
    !['ACTIVE', 'RESULT_PENDING', 'DISPUTED', 'UNDER_REVIEW'].includes(match.status) ||
    !match.channelId ||
    match.channelDeletedAt
  ) {
    throw new DomainError(
      'NOT_LIVE',
      `${match.matchId} is not in progress, so evidence cannot be requested in its channel.`,
      'Unavailable',
    );
  }
  const channel = await fetchTextChannel(i.client, match.guildId, match.channelId);
  if (!channel)
    throw new DomainError('CHANNEL_MISSING', 'The match channel could not be found.', 'Unavailable');
  await markEvidenceRequested(match, i.user.id);
  await channel.send({
    content: `${user(match.challenger.discordId)} ${user(match.opponent.discordId)}`,
    embeds: [evidenceRequestEmbed(ctx.theme, match, i.user.id)],
    allowedMentions: { users: [match.challenger.discordId, match.opponent.discordId] },
  });
  const fresh = (await getMatch(match.id)) ?? match;
  await show(i, {
    embeds: [
      successEmbed(
        ctx.theme,
        'Evidence requested',
        `The players of \`${fresh.matchId}\` were asked to upload evidence in <#${match.channelId}>.`,
      ),
    ],
    components: [],
  });
}
