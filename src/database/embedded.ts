import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { log } from '../core/logger.js';

const USER = 'satan';
const PASSWORD = 'satan-local';
const DATABASE = 'satan';
const CONNECT_TIMEOUT_MS = 5_000;

export interface EmbeddedDatabase {
  url: string;
  stop: () => Promise<void>;
  /** True when an already-running server was reused (e.g. the bot is running). */
  reused: boolean;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

type Probe = 'ok' | 'refused' | 'unresponsive';

/**
 * "refused" = nothing is listening; "unresponsive" = a server accepts connections but never answers
 * (an orphaned PostgreSQL whose parent process was killed on Windows). Any other failure (e.g. a
 * different PostgreSQL with other credentials on this port) is raised, never "fixed" by force.
 */
async function probe(pg: EmbeddedPostgres, port: number): Promise<Probe> {
  const client = pg.getPgClient('postgres', '127.0.0.1');
  try {
    await withTimeout(
      client.connect().then(() => client.query('SELECT 1')),
      CONNECT_TIMEOUT_MS,
    );
    return 'ok';
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code === 'ECONNREFUSED') return 'refused';
    if (e.message?.startsWith('timed out')) return 'unresponsive';
    throw new Error(
      `Another service is using port ${port} (${e.message ?? 'unknown error'}). Stop it or set EMBEDDED_DB_PORT to a free port.`,
    );
  } finally {
    void withTimeout(client.end(), 2_000).catch(() => undefined);
  }
}

async function ensureDatabase(pg: EmbeddedPostgres): Promise<void> {
  const client = pg.getPgClient('postgres', '127.0.0.1');
  await withTimeout(client.connect(), CONNECT_TIMEOUT_MS);
  try {
    const res = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [DATABASE]);
    if (res.rowCount === 0) await client.query(`CREATE DATABASE "${DATABASE}"`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

function postmasterPid(dir: string): number | null {
  const file = join(dir, 'postmaster.pid');
  if (!existsSync(file)) return null;
  const pid = Number.parseInt(readFileSync(file, 'utf8').split(/\r?\n/)[0] ?? '', 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function run(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: 'ignore', windowsHide: true });
    child.on('error', () => resolve(-1));
    child.on('close', (code) => resolve(code ?? -1));
  });
}

function output(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    let out = '';
    const child = spawn(cmd, args, { windowsHide: true });
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.on('error', () => resolve(''));
    child.on('close', () => resolve(out));
  });
}

/** Guards against PID reuse: only ever terminate a process that really is PostgreSQL. */
async function isPostgresProcess(pid: number): Promise<boolean> {
  if (process.platform === 'win32') {
    const out = await output('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']);
    return /"postgres\.exe"/i.test(out);
  }
  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('postgres');
  } catch {
    return false;
  }
}

/**
 * The PostgreSQL processes to terminate for a dead/hung server: the postmaster itself if still alive,
 * plus (Windows only) any postgres.exe children that outlived it and still hold the listening socket.
 */
async function orphanedPids(postmaster: number): Promise<number[]> {
  const pids: number[] = [];
  if (await isPostgresProcess(postmaster)) pids.push(postmaster);
  if (process.platform === 'win32') {
    const out = await output('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Get-CimInstance Win32_Process -Filter "ParentProcessId=${postmaster} AND Name='postgres.exe'" | ForEach-Object { $_.ProcessId }`,
    ]);
    for (const line of out.split(/\r?\n/)) {
      const n = Number.parseInt(line.trim(), 10);
      if (Number.isInteger(n) && n > 0 && !pids.includes(n)) pids.push(n);
    }
  }
  return pids;
}

async function killProcessTree(pid: number): Promise<void> {
  if (process.platform === 'win32') {
    await run('taskkill', ['/pid', String(pid), '/f', '/t']);
  } else {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
  await new Promise((r) => setTimeout(r, 1_500));
}

/** Resolves the pg_ctl binary shipped with embedded-postgres for this platform, if available. */
async function pgCtlPath(): Promise<string | null> {
  const os = process.platform === 'win32' ? 'windows' : process.platform;
  try {
    const mod = (await import(`@embedded-postgres/${os}-${process.arch}`)) as { pg_ctl?: string };
    return mod.pg_ctl && existsSync(mod.pg_ctl) ? mod.pg_ctl : null;
  } catch {
    return null;
  }
}

/** Clean shutdown (checkpoint + exit) via `pg_ctl stop -m fast`, falling back to a forced stop. */
async function gracefulStop(forceStop: () => Promise<void>, dir: string): Promise<void> {
  const ctl = await pgCtlPath();
  if (ctl) {
    const code = await run(ctl, ['stop', '-D', dir, '-m', 'fast', '-w', '-t', '20']);
    if (code === 0) {
      log.info('EMBEDDED_DB_STOPPED');
      return;
    }
  }
  await forceStop().catch(() => undefined);
  log.info('EMBEDDED_DB_STOPPED', { method: 'forced' });
}

/**
 * Starts a real PostgreSQL server bundled through `embedded-postgres` — zero install, zero cost.
 * Data persists in `dir` across restarts. A healthy server already listening on the port is reused;
 * a hung, orphaned one (left behind by a hard kill) is terminated and replaced safely — PostgreSQL's
 * write-ahead log recovers any in-flight work on the next start.
 */
export async function startEmbeddedDatabase(dir: string, port: number): Promise<EmbeddedDatabase> {
  mkdirSync(dir, { recursive: true });
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    port,
    user: USER,
    password: PASSWORD,
    persistent: true,
    onLog: (m) => log.debug('POSTGRES', { message: String(m).trim() }),
    onError: (m) => log.debug('POSTGRES_STDERR', { message: String(m).trim() }),
  });
  const url = `postgresql://${USER}:${encodeURIComponent(PASSWORD)}@127.0.0.1:${port}/${DATABASE}`;

  // embedded-postgres also stops every instance from its own exit hook (a hard kill on Windows).
  // Route that hook — and our own shutdown — through one graceful, run-once stop, and make it a
  // no-op unless this process actually started the server (a reused server belongs to someone else).
  const forceStop = pg.stop.bind(pg);
  let stopping: Promise<void> | null = null;
  const stop = (): Promise<void> => (stopping ??= gracefulStop(forceStop, dir));
  pg.stop = async () => undefined;

  const state = await probe(pg, port);
  if (state === 'ok') {
    log.info('EMBEDDED_DB_REUSED', { port });
    await ensureDatabase(pg);
    return { url, stop: async () => undefined, reused: true };
  }
  if (state === 'unresponsive') {
    const pid = postmasterPid(dir);
    log.warn('EMBEDDED_DB_ORPHAN', { port, pid: pid ?? undefined });
    const targets = pid ? await orphanedPids(pid) : [];
    if (targets.length === 0) {
      throw new Error(
        `Port ${port} is held by an unresponsive process that is not this bot's database. Free the port or change EMBEDDED_DB_PORT.`,
      );
    }
    for (const target of targets) await killProcessTree(target);
    if ((await probe(pg, port)) !== 'refused') {
      throw new Error(
        `Could not free port ${port} from the previous database process. Restart the computer or change EMBEDDED_DB_PORT.`,
      );
    }
  }

  if (!existsSync(join(dir, 'PG_VERSION'))) {
    log.info('EMBEDDED_DB_INITIALISING', { dir });
    await pg.initialise();
  }

  const pidFile = join(dir, 'postmaster.pid');
  if (existsSync(pidFile)) {
    // Nothing healthy is serving this directory (checked above), so the lock file is stale.
    log.warn('EMBEDDED_DB_STALE_LOCK', { file: pidFile });
    rmSync(pidFile, { force: true });
  }

  await withTimeout(pg.start(), 60_000);
  // The library's exit hook fires on Ctrl+C at the same time as the app's own shutdown; give the app
  // a moment to close its connections first (both paths share the same run-once stop).
  pg.stop = () => new Promise<void>((r) => setTimeout(r, 2_000)).then(stop);
  await ensureDatabase(pg);
  log.info('EMBEDDED_DB_STARTED', { port, dir });
  return { url, stop, reused: false };
}
