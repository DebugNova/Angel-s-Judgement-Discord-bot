import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import type { GuildConfig } from '@prisma/client';
import type { PermissionLevel } from '../../modules/permissions/permissions.js';
import type { Ctx } from '../context.js';

export interface SlashCommand {
  data: RESTPostAPIChatInputApplicationCommandsJSONBody;
  /** Minimum level to run the command at all. Subcommands may enforce stricter levels. */
  level: PermissionLevel;
  /** Per-user cooldown in seconds applied after a successful run. */
  cooldown?: (config: GuildConfig) => number;
  execute: (interaction: ChatInputCommandInteraction<'cached'>, ctx: Ctx) => Promise<void>;
  autocomplete?: (interaction: AutocompleteInteraction<'cached'>, ctx: Ctx) => Promise<void>;
}
