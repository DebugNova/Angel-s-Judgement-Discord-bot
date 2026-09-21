/**
 * Registers slash commands without starting the bot.
 *   npm run commands:deploy                 → every server the bot is in
 *   npm run commands:deploy -- --validate   → dry-run against Discord's API (registers globally, then removes)
 * The bot also registers commands automatically on startup and when it joins a server.
 */
import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import type { RESTGetAPICurrentUserGuildsResult } from 'discord.js';
import { loadEnv } from '../config/env.js';
import { commands } from '../discord/commands/index.js';

const env = loadEnv();
const rest = new REST().setToken(env.DISCORD_TOKEN);
const body = commands.map((c) => c.data);

if (process.argv.includes('--validate')) {
  await rest.put(Routes.applicationCommands(env.clientId), { body });
  await rest.put(Routes.applicationCommands(env.clientId), { body: [] });
  console.log(`✓ Discord accepted all ${body.length} commands.`);
} else {
  const guilds = env.DISCORD_GUILD_ID
    ? [{ id: env.DISCORD_GUILD_ID }]
    : ((await rest.get(Routes.userGuilds())) as RESTGetAPICurrentUserGuildsResult);
  if (guilds.length === 0) console.log('The bot is not in any server yet — invite it first.');
  for (const g of guilds) {
    await rest.put(Routes.applicationGuildCommands(env.clientId, g.id), { body });
    console.log(`✓ Registered ${body.length} commands in ${g.id}`);
  }
}
