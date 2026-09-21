/**
 * Every piece of branding and story text in one place.
 * To change the bot's name or lore, edit this file only, then rebuild (`npm run build`).
 */
export const Brand = {
  name: "Angel's Judgement",
  author: "ANGEL'S JUDGEMENT • SEVEN ANGELS",
  footer: "Seven Angels • Angel's Judgement",
  tagline: 'Seven Angels. One Judgement.',
  presence: 'over the Seven Angels',
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
