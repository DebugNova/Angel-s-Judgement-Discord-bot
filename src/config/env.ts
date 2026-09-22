import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => (v ?? '').trim().toLowerCase())
  .pipe(z.enum(['', 'true', 'false', '1', '0', 'yes', 'no']))
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined));

/** Whole number from the environment; blank or missing = `fallback`. */
const int = (fallback: number, min: number, max: number) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.coerce.number().int().min(min).max(max).default(fallback),
  );

const schema = z
  .object({
    DISCORD_TOKEN: z.string().trim().min(50, 'DISCORD_TOKEN is missing or invalid'),
    DISCORD_CLIENT_ID: optionalString,
    DISCORD_GUILD_ID: optionalString,
    BOT_OWNER_IDS: optionalString,
    EMBEDDED_DB: bool,
    EMBEDDED_DB_DIR: optionalString,
    EMBEDDED_DB_PORT: int(54321, 1024, 65535),
    DATABASE_URL: optionalString,
    NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    BACKUP_CHANNEL_ID: optionalString.pipe(
      z
        .string()
        .regex(/^\d{17,20}$/, 'must be a channel ID (numbers only)')
        .optional(),
    ),
    BACKUP_INTERVAL_MINUTES: int(60, 0, 10_080),
    BACKUP_KEEP: int(48, 1, 1000),
    // Music helpers (optional overrides; read by src/modules/music/tools.ts)
    FFMPEG_PATH: optionalString,
    YTDLP_PATH: optionalString,
    TOOLS_DIR: optionalString,
  })
  .superRefine((env, ctx) => {
    if (!env.EMBEDDED_DB && !env.DATABASE_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message: 'DATABASE_URL is required when EMBEDDED_DB is false',
      });
    }
  });

export type Env = z.infer<typeof schema> & {
  clientId: string;
  ownerIds: string[];
  embeddedDbDir: string;
};

/** The application ID is the base64-encoded first segment of a bot token. */
function clientIdFromToken(token: string): string {
  const first = token.split('.')[0] ?? '';
  return Buffer.from(first, 'base64').toString('utf8');
}

function defaultDbDir(): string {
  // Keep database files out of synced folders (e.g. OneDrive) — sync clients corrupt live databases.
  const base = process.env.LOCALAPPDATA ?? join(homedir(), '.local', 'share');
  return join(base, 'SatanBot', 'postgres');
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;
  const clientId = env.DISCORD_CLIENT_ID ?? clientIdFromToken(env.DISCORD_TOKEN);
  if (!/^\d{17,20}$/.test(clientId)) {
    throw new Error('Could not determine DISCORD_CLIENT_ID. Set it in your .env file.');
  }
  const ownerIds = (env.BOT_OWNER_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d{17,20}$/.test(s));
  return { ...env, clientId, ownerIds, embeddedDbDir: env.EMBEDDED_DB_DIR ?? defaultDbDir() };
}
