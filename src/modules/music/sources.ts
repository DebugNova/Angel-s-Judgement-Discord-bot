/** Understanding what a member typed into /play, and picking the right YouTube match. Pure logic. */

export type ParsedInput =
  | { kind: 'spotify'; type: 'track' | 'album' | 'playlist'; id: string; url: string }
  | { kind: 'youtube-playlist'; url: string }
  | { kind: 'url'; url: string }
  | { kind: 'search'; query: string };

const SPOTIFY =
  /^https?:\/\/(?:open|play)\.spotify\.com\/(?:intl-[a-z-]+\/)?(track|album|playlist)\/([A-Za-z0-9]{10,40})/i;
const SPOTIFY_URI = /^spotify:(track|album|playlist):([A-Za-z0-9]{10,40})$/i;

export function parseInput(raw: string): ParsedInput {
  const text = raw.trim();
  const sp = text.match(SPOTIFY) ?? text.match(SPOTIFY_URI);
  if (sp) {
    const type = sp[1]!.toLowerCase() as 'track' | 'album' | 'playlist';
    return { kind: 'spotify', type, id: sp[2]!, url: `https://open.spotify.com/${type}/${sp[2]}` };
  }
  if (/^https?:\/\//i.test(text)) {
    let u: URL;
    try {
      u = new URL(text);
    } catch {
      return { kind: 'search', query: text };
    }
    const host = u.hostname.replace(/^(www|m|music)\./, '');
    if (host === 'youtube.com' && u.pathname === '/playlist' && u.searchParams.get('list')) {
      return {
        kind: 'youtube-playlist',
        url: `https://www.youtube.com/playlist?list=${u.searchParams.get('list')}`,
      };
    }
    if (host === 'youtube.com' && u.searchParams.get('v')) {
      // A video opened from inside a playlist plays just that video.
      return { kind: 'url', url: `https://www.youtube.com/watch?v=${u.searchParams.get('v')}` };
    }
    return { kind: 'url', url: text };
  }
  return { kind: 'search', query: text.slice(0, 200) };
}

export interface Candidate {
  id: string;
  title: string;
  channel: string;
  durationSec: number;
}

const UNWANTED = [
  'live',
  'remix',
  'sped up',
  'speed up',
  'slowed',
  'reverb',
  'nightcore',
  '8d',
  'karaoke',
  'instrumental',
  'cover',
  'acoustic',
  'reaction',
  '1 hour',
  'extended',
  'bass boosted',
];

/**
 * Scores a YouTube result for a Spotify track. Higher is better; null = unusable.
 * Rewards the right length and official uploads; punishes versions the listener didn't ask for.
 */
export function scoreCandidate(
  c: Candidate,
  want: { title: string; artist: string; durationSec: number },
): number | null {
  const title = c.title.toLowerCase();
  const channel = c.channel.toLowerCase();
  const wantTitle = want.title.toLowerCase();
  const wantArtist = want.artist
    .toLowerCase()
    .split(/,|&| x | feat\.? /)[0]!
    .trim();
  let score = 0;
  if (want.durationSec > 0 && c.durationSec > 0) {
    const diff = Math.abs(c.durationSec - want.durationSec);
    if (diff > 30) return null;
    score += diff <= 3 ? 30 : diff <= 8 ? 18 : diff <= 15 ? 6 : 0;
  }
  const core = wantTitle
    .replace(/\s*[([].*?[)\]]\s*/g, ' ')
    .replace(/\s+-\s+.*$/, '')
    .trim();
  if (core && title.includes(core)) score += 25;
  if (wantArtist && (title.includes(wantArtist) || channel.includes(wantArtist))) score += 20;
  if (channel.endsWith(' - topic')) score += 15;
  if (/official (audio|music video|video|lyric)/.test(title)) score += 8;
  if (channel.includes('vevo')) score += 6;
  for (const bad of UNWANTED) {
    if (title.includes(bad) && !wantTitle.includes(bad)) score -= 25;
  }
  return score;
}

export function pickBest(
  candidates: readonly Candidate[],
  want: { title: string; artist: string; durationSec: number },
): Candidate | null {
  let best: { c: Candidate; s: number } | null = null;
  for (const c of candidates) {
    const s = scoreCandidate(c, want);
    if (s === null) continue;
    if (!best || s > best.s) best = { c, s };
  }
  return best?.c ?? null;
}

/** "3:05", "1:02:07" → seconds; "abc" → null. Also accepts plain seconds ("95"). */
export function parseTimestamp(input: string): number | null {
  const t = input.trim();
  if (/^\d+$/.test(t)) return Number(t);
  const m = t.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

export function formatTime(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
