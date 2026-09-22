import type { Client } from 'discord.js';
import { log } from '../../core/logger.js';
import { adminCommands } from './admin.js';
import { memberCommands } from './member.js';
import { moderationCommands } from '../moderation/commands.js';
import { musicCommands } from '../music/commands.js';
import { staffCommands } from './staff.js';
import type { SlashCommand } from './types.js';

export const commands: SlashCommand[] = [
  ...memberCommands,
  ...staffCommands,
  ...adminCommands,
  ...moderationCommands,
  ...musicCommands,
];
export const commandMap = new Map(commands.map((c) => [c.data.name, c]));

/** Guild-scoped registration: updates appear instantly and avoid global/guild duplicates. */
export async function registerCommands(client: Client, onlyGuildId?: string): Promise<void> {
  const body = commands.map((c) => c.data);
  const guilds = onlyGuildId ? [onlyGuildId] : [...client.guilds.cache.keys()];
  for (const guildId of guilds) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      log.warn('COMMAND_REGISTER_SKIPPED', { guild: guildId, reason: 'bot is not in this server' });
      continue;
    }
    try {
      await guild.commands.set(body);
      log.info('COMMANDS_REGISTERED', { guild: guildId, count: body.length });
    } catch (err) {
      log.error('COMMAND_REGISTER_FAILED', { guild: guildId }, err);
    }
  }
}
