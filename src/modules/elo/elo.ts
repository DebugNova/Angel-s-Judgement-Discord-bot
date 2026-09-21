export interface EloSettings {
  kFactor: number;
  minElo: number;
  maxElo: number;
}

export interface EloOutcome {
  winnerOld: number;
  winnerNew: number;
  winnerChange: number;
  loserOld: number;
  loserNew: number;
  loserChange: number;
}

/** Expected score of a player against an opponent: 1 / (1 + 10^((opp - player) / 400)). */
export function expectedScore(playerRating: number, opponentRating: number): number {
  return 1 / (1 + 10 ** ((opponentRating - playerRating) / 400));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Standard ELO for a decisive result. The rating swing is rounded once and applied as +delta / -delta,
 * so the exchange is always symmetric (rounding each side separately can create or destroy points).
 * Ratings are then clamped to the configured bounds.
 */
export function calculateElo(winnerRating: number, loserRating: number, settings: EloSettings): EloOutcome {
  const delta = Math.round(settings.kFactor * (1 - expectedScore(winnerRating, loserRating)));
  const winnerNew = clamp(winnerRating + delta, settings.minElo, settings.maxElo);
  const loserNew = clamp(loserRating - delta, settings.minElo, settings.maxElo);
  return {
    winnerOld: winnerRating,
    winnerNew,
    winnerChange: winnerNew - winnerRating,
    loserOld: loserRating,
    loserNew,
    loserChange: loserNew - loserRating,
  };
}

/** Win rate as a percentage with two decimals (e.g. 69.05). */
export function winRate(wins: number, matchesPlayed: number): number {
  if (matchesPlayed <= 0) return 0;
  return Math.round((wins / matchesPlayed) * 10000) / 100;
}
