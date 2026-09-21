import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';
import { startEmbeddedDatabase } from '../../src/database/embedded.js';
import { runMigrations } from '../../src/database/migrate.js';

/** Spins up a throw-away PostgreSQL for the test run and applies the real migrations. */
export default async function setup(project: TestProject) {
  const dir = mkdtempSync(join(tmpdir(), 'satan-test-db-'));
  const db = await startEmbeddedDatabase(dir, 54339);
  await runMigrations(db.url);
  project.provide('databaseUrl', db.url);
  return async () => {
    await db.stop();
    rmSync(dir, { recursive: true, force: true });
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}
