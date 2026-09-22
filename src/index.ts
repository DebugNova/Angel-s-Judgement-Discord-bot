import 'dotenv/config';
import { Client, GatewayIntentBits, Options, Partials } from 'discord.js';
import { loadEnv } from './config/env.js';
import { enableFileLogging, log, setLogLevel } from './core/logger.js';
import { disconnectDb, db } from './database/client.js';
import { startEmbeddedDatabase } from './database/embedded.js';
import type { EmbeddedDatabase } from './database/embedded.js';
import { runMigrations } from './database/migrate.js';
import { setRuntimeEnv } from './discord/context.js';
import { registerEvents } from './discord/events.js';
import { stopScheduler } from './discord/jobs.js';
import { stopPresence } from './discord/presence.js';
import { stopAutoBackups } from './discord/backups.js';
import { shutdownMusic } from './discord/music/lifecycle.js';

// Registered before anything else so no failure during startup can go unlogged.
process.on('unhandledRejection', (reason) => log.error('UNHANDLED_REJECTION', undefined, reason));
process.on('uncaughtException', (err) => log.error('UNCAUGHT_EXCEPTION', undefined, err));

async function main(): Promise<void> {
  const env = loadEnv();
  setLogLevel(env.LOG_LEVEL);
  enableFileLogging('logs');
  setRuntimeEnv(env);
  log.info('STARTING', { env: env.NODE_ENV, embeddedDb: env.EMBEDDED_DB });

  let embedded: EmbeddedDatabase | null = null;
  if (env.EMBEDDED_DB) {
    embedded = await startEmbeddedDatabase(env.embeddedDbDir, env.EMBEDDED_DB_PORT);
    process.env.DATABASE_URL = embedded.url;
  }
  const databaseUrl = process.env.DATABASE_URL ?? env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');

  await runMigrations(databaseUrl);
  await db().$connect();
  log.info('DATABASE_CONNECTED');

  const client = new Client({
    // GuildVoiceStates (music: who is in which voice channel) is not a privileged intent.
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildVoiceStates,
    ],
    partials: [Partials.Channel],
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      MessageManager: 50,
      ReactionManager: 0,
    }),
    allowedMentions: { parse: [] },
  });
  registerEvents(client);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('SHUTTING_DOWN', { signal });
    stopScheduler();
    stopPresence();
    stopAutoBackups();
    // Remember what was playing (queue + position) so music resumes after the restart.
    await shutdownMusic().catch(() => undefined);
    await client.destroy().catch(() => undefined);
    await disconnectDb().catch(() => undefined);
    await embedded?.stop().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  // Windows: closing the console window (SIGHUP) or Ctrl+Break (SIGBREAK).
  process.on('SIGHUP', () => void shutdown('SIGHUP'));
  if (process.platform === 'win32') process.on('SIGBREAK', () => void shutdown('SIGBREAK'));

  await client.login(env.DISCORD_TOKEN);
}

main().catch((err: unknown) => {
  log.error('FATAL', undefined, err);
  process.exit(1);
});
