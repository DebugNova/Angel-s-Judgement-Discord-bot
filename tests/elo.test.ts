import { describe, expect, it } from 'vitest';
import { calculateElo, expectedScore, winRate } from '../src/modules/elo/elo.js';

const settings = { kFactor: 32, minElo: 0, maxElo: 5000 };

describe('ELO', () => {
  it('equal-rated players exchange 16 points (1000 → 1016 / 984)', () => {
    const r = calculateElo(1000, 1000, settings);
    expect(r).toMatchObject({ winnerNew: 1016, loserNew: 984, winnerChange: 16, loserChange: -16 });
  });

  it('default K-factor 120: equal-rated players exchange 60 points, upsets up to 120', () => {
    const big = { kFactor: 120, minElo: 0, maxElo: 5000 };
    expect(calculateElo(1000, 1000, big)).toMatchObject({ winnerChange: 60, loserChange: -60 });
    const upset = calculateElo(1000, 1400, big);
    expect(upset.winnerChange).toBeGreaterThan(100);
    expect(upset.winnerChange).toBeLessThanOrEqual(120);
    expect(calculateElo(1400, 1000, big).winnerChange).toBeLessThan(20);
  });

  it('higher-rated winner gains less', () => {
    const r = calculateElo(1400, 1000, settings);
    expect(r.winnerChange).toBe(3);
    expect(r.loserChange).toBe(-3);
  });

  it('lower-rated winner gains more (upset)', () => {
    const r = calculateElo(1000, 1400, settings);
    expect(r.winnerChange).toBe(29);
    expect(r.loserChange).toBe(-29);
  });

  it('is always zero-sum after rounding', () => {
    for (let a = 800; a <= 1600; a += 37) {
      for (let b = 800; b <= 1600; b += 41) {
        const r = calculateElo(a, b, settings);
        expect(r.winnerChange + r.loserChange).toBe(0);
        expect(Number.isInteger(r.winnerNew)).toBe(true);
      }
    }
  });

  it('expected scores sum to 1', () => {
    expect(expectedScore(1200, 1000) + expectedScore(1000, 1200)).toBeCloseTo(1, 10);
  });

  it('respects the configured bounds', () => {
    const r = calculateElo(4995, 4995, settings);
    expect(r.winnerNew).toBe(5000);
    const low = calculateElo(10, 5, { kFactor: 32, minElo: 0, maxElo: 5000 });
    expect(low.loserNew).toBeGreaterThanOrEqual(0);
  });

  it('computes win rate with two decimals', () => {
    expect(winRate(29, 42)).toBe(69.05);
    expect(winRate(0, 0)).toBe(0);
  });
});
