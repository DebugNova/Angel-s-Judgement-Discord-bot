import 'dotenv/config';
import { loadEnv } from '../config/env.js';
import { startEmbeddedDatabase } from '../database/embedded.js';
import type { EmbeddedDatabase } from '../database/embedded.js';

/** Points DATABASE_URL at the configured database, starting the embedded one if needed. */
export async function connectForScript(): Promise<EmbeddedDatabase | null> {
  const env = loadEnv();
  if (!env.EMBEDDED_DB) return null;
  const embedded = await startEmbeddedDatabase(env.embeddedDbDir, env.EMBEDDED_DB_PORT);
  process.env.DATABASE_URL = embedded.url;
  return embedded;
}
