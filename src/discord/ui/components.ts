import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { Player } from '@prisma/client';
import type { MatchView } from '../../modules/matches/match.types.js';
import { Ids } from '../ids.js';
import { HELP_CATEGORIES } from './embeds.js';
import type { HelpCategory } from './embeds.js';
import type { Theme } from './theme.js';

type Row = ActionRowBuilder<ButtonBuilder>;

function btn(id: string, label: string, style: ButtonStyle, theme: Theme, emoji?: string): ButtonBuilder {
  const b = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
  if (emoji && theme.emojis) b.setEmoji(emoji);
  return b;
}

export function challengeButtons(theme: Theme, challengeId: string): Row[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      btn(Ids.challenge.accept(challengeId), 'Accept', ButtonStyle.Success, theme, '⚔️'),
      btn(Ids.challenge.decline(challengeId), 'Decline', ButtonStyle.Danger, theme),
      btn(Ids.challenge.cancel(challengeId), 'Cancel Challenge', ButtonStyle.Secondary, theme),
    ),
  ];
}

/** Controls shown on the match status panel. They change with the match state. */
export function panelButtons(theme: Theme, match: MatchView): Row[] {
  switch (match.status) {
    case 'ACTIVE': {
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        btn(Ids.match.report(match.id), 'Report Result', ButtonStyle.Success, theme, '🏆'),
        btn(Ids.match.link(match.id), 'Submit Server Link', ButtonStyle.Primary, theme, '🔗'),
      );
      if (match.cancelRequestedById) {
        return [
          row,
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            btn(Ids.match.cancelAgree(match.id), 'Agree to Cancel', ButtonStyle.Danger, theme),
            btn(Ids.match.cancelRefuse(match.id), 'Keep Playing', ButtonStyle.Secondary, theme),
          ),
        ];
      }
      row.addComponents(
        btn(Ids.match.cancelRequest(match.id), 'Request Cancel', ButtonStyle.Secondary, theme),
      );
      return [row];
    }
    case 'RESULT_PENDING':
      return [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          btn(Ids.match.confirm(match.id), 'Confirm Result', ButtonStyle.Success, theme, '✅'),
          btn(Ids.match.dispute(match.id), 'Dispute Result', ButtonStyle.Danger, theme, '🚨'),
        ),
      ];
    case 'DISPUTED':
    case 'UNDER_REVIEW':
      return [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          btn(Ids.referee.review(match.id), 'Review Match (Staff)', ButtonStyle.Secondary, theme, '⚖️'),
        ),
      ];
    default:
      return [];
  }
}

export function reviewNotificationButtons(theme: Theme, matchId: string): Row[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      btn(Ids.referee.review(matchId), 'Review Match', ButtonStyle.Primary, theme, '⚖️'),
    ),
  ];
}

export function reviewPanelButtons(theme: Theme, match: MatchView): Row[] {
  const mode = match.status === 'ACTIVE' ? 'f' : 'd';
  const short = (p: Player) => (p.displayName.length > 24 ? `${p.displayName.slice(0, 23)}…` : p.displayName);
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      btn(
        Ids.referee.award(match.id, match.challenger.id, mode),
        `Award Win → ${short(match.challenger)}`,
        ButtonStyle.Success,
        theme,
      ),
      btn(
        Ids.referee.award(match.id, match.opponent.id, mode),
        `Award Win → ${short(match.opponent)}`,
        ButtonStyle.Success,
        theme,
      ),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      btn(Ids.referee.evidence(match.id), 'Request Evidence', ButtonStyle.Primary, theme, '📎'),
      btn(Ids.referee.cancel(match.id), 'Cancel Match', ButtonStyle.Danger, theme),
    ),
  ];
}

export function confirmDecisionButtons(
  theme: Theme,
  matchId: string,
  playerId: string,
  mode: 'd' | 'f',
): Row[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      btn(Ids.referee.confirmAward(matchId, playerId, mode), 'Confirm Decision', ButtonStyle.Danger, theme),
      btn(Ids.dismiss, 'Cancel', ButtonStyle.Secondary, theme),
    ),
  ];
}

export function confirmCancelButtons(theme: Theme, matchId: string): Row[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      btn(Ids.referee.confirmCancel(matchId), 'Confirm Cancellation', ButtonStyle.Danger, theme),
      btn(Ids.dismiss, 'Back', ButtonStyle.Secondary, theme),
    ),
  ];
}

export function resetButtons(theme: Theme, scope: string, playerId: string, del: boolean): Row[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      btn(Ids.reset.proceed(scope, playerId, del), 'Proceed', ButtonStyle.Danger, theme),
      btn(Ids.dismiss, 'Cancel', ButtonStyle.Secondary, theme),
    ),
  ];
}

/** ◀ Page x / y ▶ — the middle button is an inert page indicator. */
export function pagerRow(theme: Theme, makeId: (page: number) => string, page: number, pages: number): Row[] {
  if (pages <= 1) return [];
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(makeId(page - 1))
        .setLabel(theme.emojis ? '◀ Previous' : 'Previous')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 0),
      new ButtonBuilder()
        .setCustomId(`noop:${makeId(page)}`)
        .setLabel(`Page ${page + 1} / ${pages}`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(makeId(page + 1))
        .setLabel(theme.emojis ? 'Next ▶' : 'Next')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= pages - 1),
    ),
  ];
}

export function reportSelect(
  match: MatchView,
  reporterDiscordId: string,
): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const me = match.challenger.discordId === reporterDiscordId ? match.challenger : match.opponent;
  const opp = me.id === match.challenger.id ? match.opponent : match.challenger;
  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(Ids.match.reportSelect(match.id))
        .setPlaceholder('Who won?')
        .addOptions(
          { label: `Me — ${me.displayName}`.slice(0, 100), value: me.id, description: 'I won this match' },
          {
            label: `Opponent — ${opp.displayName}`.slice(0, 100),
            value: opp.id,
            description: 'My opponent won this match',
          },
        ),
    ),
  ];
}

export function helpSelect(
  theme: Theme,
  selected: HelpCategory | null,
): ActionRowBuilder<StringSelectMenuBuilder>[] {
  void theme;
  const menu = new StringSelectMenuBuilder().setCustomId(Ids.help).setPlaceholder('Choose a category');
  for (const [key, c] of Object.entries(HELP_CATEGORIES)) {
    menu.addOptions({ label: c.label, description: c.summary, value: key, default: key === selected });
  }
  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)];
}

export function roleSelect(kind: string, current: string[]): ActionRowBuilder<RoleSelectMenuBuilder>[] {
  const menu = new RoleSelectMenuBuilder()
    .setCustomId(Ids.config.roles(kind))
    .setPlaceholder(`Select the ${kind} roles (leave empty to clear)`)
    .setMinValues(0)
    .setMaxValues(10);
  if (current.length > 0) menu.setDefaultRoles(current.slice(0, 10));
  return [new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(menu)];
}

export function serverLinkModal(matchId: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(Ids.match.linkModal(matchId))
    .setTitle('Submit Private Server Link')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('link')
          .setLabel('Private Server Link')
          .setPlaceholder('https://www.roblox.com/share?code=…')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(500),
      ),
    );
}

export function reasonModal(customId: string, title: string, required = false): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title.slice(0, 45))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('reason')
          .setLabel(required ? 'Reason' : 'Reason (optional, but encouraged)')
          .setPlaceholder('e.g. Evidence reviewed — screenshot shows the final score')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(required)
          .setMaxLength(500),
      ),
    );
}

export function resetModal(customId: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle('Confirm Reset')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('phrase')
          .setLabel('Type: RESET SEVEN ANGELS')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(40),
      ),
    );
}
