import { describe, expect, it } from 'vitest';
import { commands } from '../src/discord/commands/index.js';
import { HELP_CATEGORIES } from '../src/discord/ui/embeds.js';
import { Bio, StatusLines } from '../src/discord/ui/lore.js';
import type { StatusStats } from '../src/discord/ui/lore.js';

const helpText = Object.values(HELP_CATEGORIES)
  .flatMap((c) => c.lines)
  .join('\n');

describe('/help', () => {
  it('mentions every slash command', () => {
    const missing = commands.map((c) => c.data.name).filter((name) => !helpText.includes(`/${name}`));
    expect(missing).toEqual([]);
  });

  it('mentions every subcommand of the grouped commands', () => {
    const missing: string[] = [];
    for (const c of commands) {
      for (const o of c.data.options ?? []) {
        if (o.type !== 1 && o.type !== 2) continue; // 1 = subcommand, 2 = subcommand group
        if (!helpText.includes(o.name)) missing.push(`/${c.data.name} ${o.name}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('fits Discord limits (25 menu options, 4096 characters per page)', () => {
    const cats = Object.values(HELP_CATEGORIES);
    expect(cats.length).toBeLessThanOrEqual(25);
    for (const c of cats) {
      expect(c.lines.join('\n').length).toBeLessThan(4096);
      expect(c.summary.length).toBeLessThanOrEqual(100);
    }
  });
});

describe('bot status and profile', () => {
  const busy: StatusStats = {
    liveMatches: 2,
    completedMatches: 57,
    players: 31,
    champion: { name: 'Seraph', elo: 1450 },
    hotStreak: { name: 'Uriel', streak: 5 },
    completedToday: 6,
    nowPlaying: { title: 'Blinding Lights', author: 'The Weeknd' },
  };
  const quiet: StatusStats = {
    liveMatches: 0,
    completedMatches: 0,
    players: 0,
    champion: null,
    hotStreak: null,
    completedToday: 0,
    nowPlaying: null,
  };

  it('every status line is valid when busy, and lines without data are skipped when quiet', () => {
    const shown = StatusLines.map((l) => l(busy)).filter(Boolean);
    expect(shown.length).toBeGreaterThanOrEqual(12);
    for (const s of shown) expect(s!.text.length).toBeLessThanOrEqual(128);
    expect(shown.map((s) => s!.text)).toContain('Blinding Lights · The Weeknd');
    const quietShown = StatusLines.map((l) => l(quiet)).filter(Boolean);
    expect(quietShown.length).toBeGreaterThanOrEqual(6);
    expect(quietShown.some((s) => s!.text.includes('Champion'))).toBe(false);
  });

  it('the profile bio fits Discord (400 characters)', () => {
    expect(Bio.length).toBeLessThanOrEqual(400);
  });
});
