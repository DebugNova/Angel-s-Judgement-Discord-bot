import { DomainError } from '../../core/errors.js';

const UNIT_SECONDS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
  w: 604800,
};

/** Discord caps timeouts at 28 days. */
export const MAX_TIMEOUT_SEC = 28 * 86400;

/**
 * "10m", "1h30m", "2d", "1w", "90s" or a bare number of minutes → seconds.
 * Throws a friendly DomainError for anything else.
 */
export function parseDuration(input: string): number {
  const text = input.trim().toLowerCase().replace(/\s+/g, '');
  if (/^\d+$/.test(text)) return Number(text) * 60;
  const parts = [...text.matchAll(/(\d+)([smhdw])/g)];
  const consumed = parts.map((p) => p[0]).join('');
  if (parts.length === 0 || consumed !== text) {
    throw new DomainError(
      'BAD_DURATION',
      `\`${input.slice(0, 20)}\` is not a duration. Use for example \`10m\`, \`1h\`, \`2d\` or \`1w\`.`,
      'Invalid duration',
    );
  }
  return parts.reduce((sum, p) => sum + Number(p[1]) * UNIT_SECONDS[p[2]!]!, 0);
}

export function parseTimeoutDuration(input: string): number {
  const sec = parseDuration(input);
  if (sec < 60 || sec > MAX_TIMEOUT_SEC) {
    throw new DomainError(
      'BAD_DURATION',
      'A timeout must last between **1 minute** and **28 days** (Discord’s limit).',
      'Invalid duration',
    );
  }
  return sec;
}

/** 5400 → "1h 30m", 90 → "1m 30s", 1209600 → "2w". */
export function formatDuration(totalSec: number): string {
  let rest = Math.max(0, Math.round(totalSec));
  const out: string[] = [];
  for (const [unit, size] of [
    ['w', 604800],
    ['d', 86400],
    ['h', 3600],
    ['m', 60],
    ['s', 1],
  ] as const) {
    const n = Math.floor(rest / size);
    if (n > 0) out.push(`${n}${unit}`);
    rest -= n * size;
  }
  return out.length > 0 ? out.slice(0, 2).join(' ') : '0s';
}
