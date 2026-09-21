import type { AutocompleteInteraction, ChatInputCommandInteraction } from 'discord.js';
import { DomainError, Errors } from '../../core/errors.js';
import {
  findMatchByChannel,
  findMatchByDisplayId,
  suggestMatches,
} from '../../modules/matches/match.service.js';
import type { MatchView } from '../../modules/matches/match.types.js';
import { PermissionLevel, hasLevel } from '../../modules/permissions/permissions.js';
import type { Ctx } from '../context.js';

export function requireLevel(ctx: Ctx, level: PermissionLevel): void {
  if (!hasLevel(ctx.level, level)) throw Errors.forbidden();
}

/**
 * Resolves the `match_id` option; when omitted, falls back to the match that owns the current
 * channel (so staff can run commands straight from a match room).
 */
export async function resolveMatchOption(
  interaction: ChatInputCommandInteraction<'cached'>,
  ctx: Ctx,
  required = false,
): Promise<MatchView> {
  const raw = interaction.options.getString('match_id', required);
  if (raw) {
    const match = await findMatchByDisplayId(ctx.guild.id, raw);
    if (!match)
      throw new DomainError('NOT_FOUND', `No match found for \`${raw.slice(0, 30)}\`.`, 'Match not found');
    return match;
  }
  const inChannel = await findMatchByChannel(interaction.channelId);
  if (!inChannel || inChannel.guildId !== ctx.guild.id) {
    throw new DomainError(
      'NO_MATCH_ID',
      'Provide a `match_id`, or run this command inside a match channel.',
      'Match required',
    );
  }
  return inChannel;
}

/** Autocomplete for match IDs: staff see all matches, members only their own. */
export async function autocompleteMatchId(
  interaction: AutocompleteInteraction<'cached'>,
  ctx: Ctx,
): Promise<void> {
  const focused = interaction.options.getFocused();
  const staff = hasLevel(ctx.level, PermissionLevel.REFEREE);
  const rows = await suggestMatches(ctx.guild.id, String(focused), staff ? undefined : interaction.user.id);
  await interaction.respond(
    rows.map((m) => ({
      name: `${m.matchId} — ${m.challenger.displayName} vs ${m.opponent.displayName} (${m.status.toLowerCase().replace('_', ' ')})`.slice(
        0,
        100,
      ),
      value: m.matchId,
    })),
  );
}

export function parseDate(input: string | null, endOfDay = false): Date | undefined {
  if (!input) return undefined;
  const m = input.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m)
    throw new DomainError(
      'BAD_DATE',
      `\`${input.slice(0, 20)}\` is not a valid date. Use YYYY-MM-DD.`,
      'Invalid date',
    );
  const d = new Date(
    Date.UTC(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      endOfDay ? 23 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 59 : 0,
    ),
  );
  if (Number.isNaN(d.getTime()))
    throw new DomainError('BAD_DATE', `\`${input}\` is not a valid date.`, 'Invalid date');
  return d;
}
