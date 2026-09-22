import type { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';
import { MessageFlags } from 'discord.js';
import { DomainError } from '../../core/errors.js';
import type { Ctx } from '../context.js';
import { musicInfoEmbed } from '../ui/music.js';
import { user } from '../ui/theme.js';
import { requireControl, requireListener } from './access.js';
import { pickSearchResult, renderQueue, requirePlayer, skipOrVote, takeSearch } from './commands.js';
import type { GuildPlayer } from './player.js';

/** After a panel button: redraw that same message (or just acknowledge an old panel). */
async function redraw(i: ButtonInteraction<'cached'>, p: GuildPlayer): Promise<void> {
  if (p.isPanel(i.message.id)) await i.update(await p.panelPayload());
  else {
    await i.deferUpdate();
    await p.refreshPanel();
  }
}

/** Buttons and menus in the `mu:` namespace. Every press re-checks who may do what. */
export async function handleMusicComponent(
  i: ButtonInteraction<'cached'> | StringSelectMenuInteraction<'cached'>,
  ctx: Ctx,
  action: string,
  args: string[],
): Promise<void> {
  if (i.isStringSelectMenu()) {
    if (action === 'pick') {
      const s = takeSearch(args[0] ?? '');
      if (!s || s.guildId !== ctx.guild.id) {
        throw new DomainError('STALE', 'These search results have expired. Run `/search` again.', 'Expired');
      }
      if (s.userId !== i.user.id)
        throw new DomainError('NOT_YOURS', 'Run `/search` yourself to pick a song.', 'Not your search');
      await i.update({ embeds: [musicInfoEmbed(ctx.theme, 'Adding…', 'One moment.')], components: [] });
      try {
        const embed = await pickSearchResult(ctx, s, Number(i.values[0] ?? -1));
        await i.deleteReply().catch(() => undefined);
        await i.followUp({ embeds: [embed], allowedMentions: { parse: [] } });
      } catch (err) {
        const e =
          err instanceof DomainError
            ? err
            : new DomainError('FAILED', 'That song could not be added.', 'Not added');
        await i.editReply({ embeds: [musicInfoEmbed(ctx.theme, e.title, e.message).setColor(0xc0392b)] });
      }
      return;
    }
    if (action === 'qj') {
      if (args[0] !== i.user.id)
        throw new DomainError('NOT_OWNER', 'Open the queue yourself to use this menu.', 'Not your menu');
      const p = requirePlayer(ctx);
      requireControl(ctx, p, 'jump in the queue');
      const t = await p.jumpTo(i.values[0] ?? '');
      await i.update(renderQueue(ctx, p, 0, i.user.id));
      await p.say(`${user(i.user.id)} jumped to **${t.title.slice(0, 80)}**.`);
      return;
    }
    throw new DomainError('STALE', 'This menu is no longer available.', 'Expired');
  }

  if (action === 'qp') {
    const [page = '0', owner = ''] = args;
    if (owner !== i.user.id)
      throw new DomainError('NOT_OWNER', 'Open the queue yourself to browse it.', 'Not your menu');
    await i.update(renderQueue(ctx, requirePlayer(ctx), Number(page) || 0, owner));
    return;
  }

  const p = requirePlayer(ctx);
  switch (action) {
    case 'toggle':
      requireControl(ctx, p, 'pause or resume');
      p.togglePause();
      return redraw(i, p);
    case 'back':
      requireControl(ctx, p, 'go back');
      await i.deferUpdate();
      await p.back();
      return;
    case 'skip': {
      await i.deferUpdate();
      const text = await skipOrVote(ctx, p);
      await p.say(text);
      return;
    }
    case 'stop':
      requireControl(ctx, p, 'stop the music');
      await i.deferUpdate();
      p.destroy(`stopped by ${i.user.id}`);
      await p.say(`${user(i.user.id)} stopped the music.`);
      return;
    case 'shuffle':
      requireControl(ctx, p, 'shuffle');
      p.shuffle();
      return redraw(i, p);
    case 'loop':
      requireControl(ctx, p, 'change the loop');
      p.cycleLoop();
      return redraw(i, p);
    case 'queue':
      requireListener(ctx, p);
      await i.reply({
        ...renderQueue(ctx, p, 0, i.user.id),
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
      return;
  }
  throw new DomainError('STALE', 'This button is no longer available.', 'Expired');
}
