import { Events, MessageFlags } from 'discord.js';
import type { Client, Interaction, Message } from 'discord.js';
import { isDomainError } from '../core/errors.js';
import { log } from '../core/logger.js';
import { getConfig } from '../modules/configuration/config.service.js';
import { addEvidence, findMatchByChannel } from '../modules/matches/match.service.js';
import { isParticipant } from '../modules/matches/match.types.js';
import { PermissionLevel, hasLevel } from '../modules/permissions/permissions.js';
import { buildCtx, levelOf, replyEphemeral, runtimeEnv } from './context.js';
import type { Ctx } from './context.js';
import { commandMap, registerCommands } from './commands/index.js';
import { handleComponent } from './components.js';
import { commandLimiter, rearmChallengeTimers, recoverGuild, startScheduler } from './jobs.js';
import { matchChannelIds } from './managers/channels.js';
import { startLogMirror } from './managers/notify.js';
import { startModLog } from './moderation/modlog.js';
import { registerMusicEvents, startMusic } from './music/lifecycle.js';
import { noteChannelActivity } from './managers/panel.js';
import { startPresence } from './presence.js';
import { startAutoBackups } from './backups.js';
import { errorEmbed, noPermissionEmbed } from './ui/embeds.js';
import type { Theme } from './ui/theme.js';
import { Brand } from './ui/lore.js';

const GLOBAL_THROTTLE_MS = 1_500;

async function reportError(i: Interaction, err: unknown, theme: Theme | null): Promise<void> {
  if (!i.isRepliable()) return;
  const t: Theme = theme ?? { emojis: true, iconURL: null };
  let embed;
  if (isDomainError(err)) {
    embed = err.code === 'FORBIDDEN' ? noPermissionEmbed(t) : errorEmbed(t, err.title, err.message);
  } else {
    log.error(
      'INTERACTION_FAILED',
      {
        type: i.type,
        user: i.user.id,
        id: 'customId' in i ? i.customId : i.isChatInputCommand() ? i.commandName : undefined,
      },
      err,
    );
    embed = errorEmbed(
      t,
      'Something went wrong',
      'The action could not be completed. The error has been logged for the staff.',
    );
  }
  await replyEphemeral(i, { embeds: [embed] }).catch((e: unknown) =>
    log.debug('ERROR_REPLY_FAILED', { error: String(e) }),
  );
}

async function onInteraction(i: Interaction): Promise<void> {
  if (!i.inCachedGuild()) {
    if (i.isRepliable())
      await i
        .reply({ content: `${Brand.name} only answers inside a server.`, flags: MessageFlags.Ephemeral })
        .catch(() => undefined);
    return;
  }
  let ctx: Ctx | null = null;
  try {
    ctx = await buildCtx(i);

    if (i.isAutocomplete()) {
      const cmd = commandMap.get(i.commandName);
      await (cmd?.autocomplete?.(i, ctx) ?? i.respond([]));
      return;
    }

    if (i.isChatInputCommand()) {
      const cmd = commandMap.get(i.commandName);
      if (!cmd) return;
      if (!hasLevel(ctx.level, cmd.level)) {
        await replyEphemeral(i, { embeds: [noPermissionEmbed(ctx.theme)] });
        return;
      }
      const throttleKey = `${i.guildId}:${i.user.id}`;
      const commandKey = `${throttleKey}:${cmd.data.name === 'challenge' ? '1v1' : cmd.data.name}`;
      const wait = Math.max(commandLimiter.remaining(throttleKey), commandLimiter.remaining(commandKey));
      if (wait > 0 && !hasLevel(ctx.level, PermissionLevel.MODERATOR)) {
        await replyEphemeral(i, {
          embeds: [
            errorEmbed(
              ctx.theme,
              'Slow down',
              `You can use this again <t:${Math.ceil((Date.now() + wait) / 1000)}:R>.`,
            ),
          ],
        });
        return;
      }
      commandLimiter.hit(throttleKey, GLOBAL_THROTTLE_MS);
      await cmd.execute(i, ctx);
      if (cmd.cooldown) commandLimiter.hit(commandKey, cmd.cooldown(ctx.config) * 1000);
      return;
    }

    if (i.isButton() || i.isStringSelectMenu() || i.isRoleSelectMenu() || i.isModalSubmit()) {
      if (i.customId.startsWith('noop:')) return;
      await handleComponent(i, ctx);
    }
  } catch (err) {
    await reportError(i, err, ctx?.theme ?? null);
  }
}

/** Evidence capture + sticky panel activity for messages sent inside match channels. */
async function onMessage(message: Message): Promise<void> {
  if (message.author.bot || !message.inGuild()) return;
  const config = await getConfig(message.guildId);
  const inCategory = config.matchCategoryId !== null && message.channel.parentId === config.matchCategoryId;
  if (!inCategory && !matchChannelIds.has(message.channelId)) return;
  const match = await findMatchByChannel(message.channelId);
  if (!match || match.guildId !== message.guildId) return;
  matchChannelIds.add(message.channelId);

  if (message.attachments.size > 0) {
    const member = message.member;
    const staff = member ? hasLevel(levelOf(member, config), PermissionLevel.REFEREE) : false;
    if (isParticipant(match, message.author.id) || staff) {
      const saved = await addEvidence(
        match,
        [...message.attachments.values()].map((a) => ({
          submittedByDiscordId: message.author.id,
          channelId: message.channelId,
          messageId: message.id,
          attachmentUrl: a.url,
          fileName: a.name,
          contentType: a.contentType ?? null,
        })),
      );
      if (saved > 0) await message.react('📎').catch(() => undefined);
    }
  }
  noteChannelActivity(message.client, match.id, match.status, config.stickyPanel);
}

async function onReady(client: Client<true>): Promise<void> {
  log.info('BOT_READY', { user: client.user.tag, guilds: client.guilds.cache.size });
  startPresence(client);
  await registerCommands(client, runtimeEnv().DISCORD_GUILD_ID);
  for (const guild of client.guilds.cache.values()) {
    await getConfig(guild.id);
    await recoverGuild(client, guild).catch((err: unknown) =>
      log.error('RECOVERY_FAILED', { guild: guild.id }, err),
    );
  }
  await rearmChallengeTimers(client);
  startScheduler(client);
  startAutoBackups(client);
  await startMusic(client);
  if (client.guilds.cache.size === 0) {
    log.warn('NO_GUILDS', {
      invite: `https://discord.com/oauth2/authorize?client_id=${client.user.id}&permissions=1099783334998&scope=bot%20applications.commands`,
    });
  }
}

export function registerEvents(client: Client): void {
  startLogMirror(client);
  startModLog(client);
  registerMusicEvents(client);
  client.once(
    Events.ClientReady,
    (c) => void onReady(c).catch((err: unknown) => log.error('READY_FAILED', undefined, err)),
  );
  client.on(Events.InteractionCreate, (i) => void onInteraction(i));
  client.on(
    Events.MessageCreate,
    (m) =>
      void onMessage(m).catch((err: unknown) =>
        log.warn('MESSAGE_HANDLER_FAILED', { channel: m.channelId }, err),
      ),
  );
  client.on(Events.GuildCreate, (guild) => {
    log.info('GUILD_JOINED', { guild: guild.id, name: guild.name });
    const only = runtimeEnv().DISCORD_GUILD_ID;
    if (only && only !== guild.id) return;
    void getConfig(guild.id)
      .then(() => guild.commands.set([...commandMap.values()].map((c) => c.data)))
      .then(() => log.info('COMMANDS_REGISTERED', { guild: guild.id }))
      .catch((err: unknown) => log.error('COMMAND_REGISTER_FAILED', { guild: guild.id }, err));
  });
  client.on(Events.Error, (err) => log.error('DISCORD_CLIENT_ERROR', undefined, err));
  client.on(Events.Warn, (msg) => log.warn('DISCORD_CLIENT_WARN', { message: msg }));
}
