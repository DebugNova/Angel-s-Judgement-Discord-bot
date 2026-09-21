import type { MatchStatus, Prisma } from '@prisma/client';

/** Statuses in which a match still occupies its players. */
export const LIVE_STATUSES: MatchStatus[] = [
  'PENDING',
  'ACCEPTED',
  'ACTIVE',
  'RESULT_PENDING',
  'DISPUTED',
  'UNDER_REVIEW',
];

export const FINAL_STATUSES: MatchStatus[] = ['COMPLETED', 'CANCELLED', 'EXPIRED'];

export const matchInclude = {
  challenger: true,
  opponent: true,
  winner: true,
  loser: true,
  result: true,
  eloHistory: true,
  _count: { select: { evidence: true, notes: true } },
} satisfies Prisma.MatchInclude;

export type MatchView = Prisma.MatchGetPayload<{ include: typeof matchInclude }>;

export function formatMatchId(prefix: string, matchNumber: number): string {
  return `${prefix}-${String(matchNumber).padStart(6, '0')}`;
}

export function formatChannelName(prefix: string, matchNumber: number): string {
  const clean = prefix
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `${clean || 'queue'}-${String(matchNumber).padStart(3, '0')}`;
}

/** Accepts "SA-000124", "sa-124", "#124" or "124" and returns the match number. */
export function parseMatchNumber(input: string): number | null {
  const digits = input.trim().match(/(\d+)\s*$/);
  if (!digits?.[1]) return null;
  const n = Number.parseInt(digits[1], 10);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export function isParticipant(
  match: { challenger: { discordId: string }; opponent: { discordId: string } },
  discordId: string,
): boolean {
  return match.challenger.discordId === discordId || match.opponent.discordId === discordId;
}
