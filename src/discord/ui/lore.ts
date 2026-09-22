/**
 * Every piece of branding and story text in one place.
 * To change the bot's name or lore, edit this file only, then rebuild (`npm run build`).
 */
export const Brand = {
  name: "Angel's Judgement",
  author: "ANGEL'S JUDGEMENT • SEVEN ANGELS",
  footer: "Seven Angels • Angel's Judgement",
  tagline: 'Seven Angels. One Judgement.',
  channelTopic: "Angel's Judgement",
} as const;

export const Lore = {
  about:
    'Before the throne of Judgement, the Seven Angels are weighed against one another. Every duel is a trial — the victor ascends, the defeated falls. Only the worthy are remembered.',
  help: 'Every duel is a trial. Every trial ends in judgement.',
  challenge: (a: string, b: string) => `${a} calls ${b} before the Judgement.`,
  accepted: 'The trial begins.',
  declined: 'The call goes unanswered by choice.',
  matchActive: 'Two angels stand in judgement. Only one will ascend.',
  resultPending: 'The verdict awaits the word of the defeated.',
  disputed: 'The verdict is contested. A judge must decide.',
  completed: (winner: string, loser: string) => `${winner} ascends. ${loser} falls.`,
  cancelled: 'The trial is void. No judgement was passed.',
  leaderboard: 'The angels who stand highest in Judgement.',
  leaderboardPanel: 'Every victory raises you. Every defeat casts you down.',
  choir: (choir: string) => `Choir of the ${choir}`,
} as const;

/**
 * The bot's "About Me" on its Discord profile (max 400 characters). Set automatically on start.
 * Set to '' to leave whatever is typed in the Developer Portal untouched.
 */
export const Bio = [
  '⚔️ The ranked 1v1 arbiter of the Seven Angels.',
  '',
  '• Challenge anyone with /1v1',
  '• Private match rooms, fair referees',
  '• Live ELO, stats & leaderboards',
  '',
  'Every duel is a trial. Every trial ends in judgement.',
  '',
  '📜 /help to begin',
].join('\n');

export interface StatusStats {
  liveMatches: number;
  completedMatches: number;
  players: number;
  champion: { name: string; elo: number } | null;
}

export type StatusKind = 'watching' | 'competing' | 'playing' | 'listening' | 'custom';

/**
 * The rotating status lines (one every 10 seconds). A line returning null is skipped, e.g. the
 * champion line before anyone has qualified. "watching X" shows as "Watching X" on Discord.
 */
export const StatusLines: ((s: StatusStats) => { kind: StatusKind; text: string } | null)[] = [
  () => ({ kind: 'watching', text: 'over the Seven Angels' }),
  (s) =>
    s.liveMatches > 0
      ? { kind: 'watching', text: `${s.liveMatches} live trial${s.liveMatches === 1 ? '' : 's'}` }
      : { kind: 'custom', text: '⚔️ The arena is quiet. /1v1 to start a trial' },
  (s) =>
    s.champion ? { kind: 'custom', text: `👑 Champion: ${s.champion.name} • ${s.champion.elo} ELO` } : null,
  () => ({ kind: 'competing', text: 'ranked 1v1s' }),
  (s) =>
    s.completedMatches > 0
      ? {
          kind: 'custom',
          text: `⚖️ ${s.completedMatches} judgement${s.completedMatches === 1 ? '' : 's'} passed`,
        }
      : null,
  (s) => (s.players > 0 ? { kind: 'watching', text: `${s.players} angels rise and fall` } : null),
  () => ({ kind: 'listening', text: '/help' }),
  () => ({ kind: 'custom', text: '✨ Seven Angels. One Judgement.' }),
];

/** Moderation wording: the closing line on each case card, DM and confirmation. */
export const ModLore = {
  WARN: 'A mark of warning is set upon them.',
  TIMEOUT: 'Their voice is stilled for a time.',
  UNTIMEOUT: 'Their voice is restored.',
  KICK: 'Sent beyond the gates.',
  BAN: 'Cast out from the Seven Angels.',
  UNBAN: 'The gates open to them once more.',
  PURGE: 'The hall is cleansed.',
  ROLE_ADD: 'A mantle is bestowed.',
  ROLE_REMOVE: 'A mantle is taken away.',
  ROLE_ALL_ADD: 'A mantle is bestowed upon the whole host.',
  ROLE_ALL_REMOVE: 'A mantle is lifted from the whole host.',
  SLOWMODE: 'Time slows within this hall.',
  LOCK: 'The gates of this hall are sealed.',
  UNLOCK: 'The gates of this hall are open once more.',
  WARNING_REMOVED: 'The mark is lifted.',
  confirm: 'Judgement is final. Be certain.',
  dmFooter: 'If you believe this was a mistake, reach out to the server staff.',
} as const;
