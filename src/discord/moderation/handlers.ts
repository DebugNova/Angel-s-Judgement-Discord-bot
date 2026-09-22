import type { ButtonInteraction } from 'discord.js';
import { DomainError } from '../../core/errors.js';
import type { Ctx } from '../context.js';
import { replyEphemeral } from '../context.js';
import { infoEmbed, successEmbed } from '../ui/embeds.js';
import { e } from '../ui/theme.js';
import { friendlyError, peekPending, requireModeration, takePending } from './common.js';
import { renderRecord } from './commands.js';
import { stopJob } from './massrole.js';

function expired(): DomainError {
  return new DomainError(
    'STALE',
    'This confirmation has expired (they last 2 minutes, and a bot restart clears them). Run the command again.',
    'Request expired',
  );
}

/** Buttons in the `mod:` namespace. Every press re-checks the moderation role. */
export async function handleModerationButton(
  i: ButtonInteraction<'cached'>,
  ctx: Ctx,
  action: string,
  args: string[],
): Promise<void> {
  requireModeration(ctx);
  switch (action) {
    case 'ok': {
      const p = peekPending(args[0] ?? '');
      if (!p || p.guildId !== ctx.guild.id) throw expired();
      if (p.userId !== i.user.id) {
        throw new DomainError(
          'NOT_YOURS',
          'Only the moderator who asked can confirm this.',
          'Not your request',
        );
      }
      if (!takePending(args[0] ?? '')) throw expired();
      await i.update({
        embeds: [infoEmbed(ctx.theme, e(ctx.theme, '⏳', 'Working…'), 'One moment.')],
        components: [],
      });
      try {
        const embed = await p.run(ctx);
        await i.editReply({ embeds: [embed], components: [], allowedMentions: { parse: [] } });
      } catch (err) {
        await i.editReply({ embeds: [friendlyError(ctx, err, 'confirm')], components: [] });
      }
      return;
    }
    case 'no': {
      const p = peekPending(args[0] ?? '');
      if (p && p.userId !== i.user.id) {
        throw new DomainError(
          'NOT_YOURS',
          'Only the moderator who asked can cancel this.',
          'Not your request',
        );
      }
      takePending(args[0] ?? '');
      await i.update({ embeds: [infoEmbed(ctx.theme, 'Cancelled', 'Nothing was done.')], components: [] });
      return;
    }
    case 'stop': {
      if (args[0] !== ctx.guild.id || !stopJob(ctx.guild.id)) {
        await i.update({ components: [] });
        return;
      }
      await replyEphemeral(i, {
        embeds: [
          successEmbed(
            ctx.theme,
            'Stopping',
            'The run stops after the member it is working on. The progress message shows the final numbers.',
          ),
        ],
      });
      return;
    }
    case 'rec': {
      const [targetId = '', page = '0', owner = ''] = args;
      if (owner !== i.user.id) {
        throw new DomainError(
          'NOT_OWNER',
          'Run `/warnings` yourself to browse this record.',
          'Not your menu',
        );
      }
      await i.update(await renderRecord(ctx, targetId, Math.max(0, Number(page) || 0), owner));
      return;
    }
  }
  throw new DomainError('STALE', 'This button is no longer available.', 'Action expired');
}
