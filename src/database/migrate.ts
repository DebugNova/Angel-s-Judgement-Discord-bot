import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { log } from '../core/logger.js';

/** Applies pending Prisma migrations (`prisma migrate deploy`). Safe to run on every start. */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const require = createRequire(import.meta.url);
  const cli = join(dirname(require.resolve('prisma/package.json')), 'build', 'index.js');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (d: Buffer) => (output += d.toString()));
    child.stderr.on('data', (d: Buffer) => (output += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        log.info('MIGRATIONS_APPLIED');
        resolve();
      } else {
        reject(new Error(`prisma migrate deploy failed (exit ${code}):\n${output}`));
      }
    });
  });
}
