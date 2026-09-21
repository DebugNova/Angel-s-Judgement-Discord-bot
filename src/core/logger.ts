import { appendFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

type Level = 'debug' | 'info' | 'warn' | 'error';
type Fields = Record<string, string | number | boolean | null | undefined>;

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
let threshold: Level = 'info';
let logDir: string | null = null;
let logDay = '';
const KEEP_LOG_DAYS = 30;

export function setLogLevel(level: Level): void {
  threshold = level;
}

/** Also append every line to `<dir>/bot-YYYY-MM-DD.log` (one file per UTC day, last 30 days kept). */
export function enableFileLogging(dir: string): void {
  mkdirSync(dir, { recursive: true });
  logDir = dir;
}

/** Deletes daily log files older than `keepDays` (the file names sort by date). */
export function pruneLogs(dir: string, keepDays: number, today = new Date()): void {
  const cutoff = `bot-${new Date(today.getTime() - keepDays * 86_400_000).toISOString().slice(0, 10)}.log`;
  for (const name of readdirSync(dir)) {
    if (/^bot-\d{4}-\d{2}-\d{2}\.log$/.test(name) && name < cutoff) rmSync(join(dir, name), { force: true });
  }
}

function toFile(text: string): void {
  if (!logDir) return;
  try {
    const day = new Date().toISOString().slice(0, 10);
    if (day !== logDay) {
      logDay = day;
      pruneLogs(logDir, KEEP_LOG_DAYS);
    }
    appendFileSync(join(logDir, `bot-${day}.log`), `${text}\n`);
  } catch {
    // Never let logging break the bot.
  }
}

function format(value: Fields[string]): string {
  const s = String(value);
  return /\s/.test(s) ? JSON.stringify(s) : s;
}

function write(level: Level, event: string, fields?: Fields, err?: unknown): void {
  if (ORDER[level] < ORDER[threshold]) return;
  const parts = [new Date().toISOString(), level.toUpperCase().padEnd(5), event];
  if (fields) {
    for (const [k, v] of Object.entries(fields)) {
      if (v !== undefined) parts.push(`${k}=${format(v)}`);
    }
  }
  const line = parts.join(' ');
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
  toFile(line);
  if (err) {
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.error(detail);
    toFile(detail);
  }
}

/** Structured, single-line logs: `INFO MATCH_CREATED matchId=SA-000124 challenger=123` */
export const log = {
  debug: (event: string, fields?: Fields) => write('debug', event, fields),
  info: (event: string, fields?: Fields) => write('info', event, fields),
  warn: (event: string, fields?: Fields, err?: unknown) => write('warn', event, fields, err),
  error: (event: string, fields?: Fields, err?: unknown) => write('error', event, fields, err),
};
