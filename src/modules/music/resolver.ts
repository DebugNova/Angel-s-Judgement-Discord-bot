/** Everything that talks to yt-dlp: search, playlists, and turning a page link into a stream. */
import { DomainError } from '../../core/errors.js';
import { log } from '../../core/logger.js';
import { pickBest } from './sources.js';
import type { Candidate } from './sources.js';
import { run, ytdlp } from './tools.js';

const BASE_ARGS = [
  '--ignore-config',
  '--no-warnings',
  '--no-progress',
  '--js-runtimes',
  `node:${process.execPath}`,
];

export interface SearchResult extends Candidate {
  url: string;
  thumbnail: string | null;
}

export interface StreamInfo {
  /** Direct audio URL (expires after a few hours). */
  streamUrl: string;
  headers: Record<string, string>;
  title: string;
  author: string;
  durationSec: number;
  thumbnail: string | null;
  pageUrl: string;
  isLive: boolean;
  resolvedAt: number;
}

/** Stream URLs from YouTube stay valid ~6 hours; re-resolve well before that. */
export const STREAM_TTL_MS = 4 * 3600_000;

function friendly(stderr: string, what: string): DomainError {
  const s = stderr.toLowerCase();
  if (s.includes('sign in to confirm') || s.includes('not a bot') || s.includes('http error 429')) {
    return new DomainError(
      'YOUTUBE_BLOCKED',
      'YouTube is refusing the bot right now (it sometimes blocks servers). Try again in a few minutes, or try a SoundCloud link.',
      'YouTube refused',
    );
  }
  if (
    s.includes('private video') ||
    s.includes('video unavailable') ||
    s.includes('removed') ||
    s.includes('does not exist')
  ) {
    return new DomainError(
      'UNAVAILABLE',
      `${what} is unavailable (private, removed or blocked in this region).`,
      'Not playable',
    );
  }
  if (s.includes('age') && s.includes('restrict')) {
    return new DomainError(
      'AGE_RESTRICTED',
      `${what} is age-restricted, so the bot can't play it.`,
      'Not playable',
    );
  }
  if (s.includes('unsupported url')) {
    return new DomainError(
      'UNSUPPORTED',
      'That link is not supported. Use a YouTube, Spotify or SoundCloud link, or a song name.',
      'Unsupported link',
    );
  }
  return new DomainError(
    'UNPLAYABLE',
    `${what} could not be loaded. Try another link or search.`,
    'Not playable',
  );
}

type Json = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function thumb(d: Json): string | null {
  if (typeof d.thumbnail === 'string') return d.thumbnail;
  const list = Array.isArray(d.thumbnails) ? (d.thumbnails as Json[]) : [];
  const last = list[list.length - 1];
  return last && typeof last.url === 'string' ? last.url : null;
}

async function ytdlpJson(args: string[], what: string, timeoutMs: number): Promise<string> {
  const bin = await ytdlp();
  const r = await run(bin, [...BASE_ARGS, ...args], timeoutMs).catch((err: unknown) => {
    log.error('YTDLP_SPAWN_FAILED', undefined, err);
    throw new DomainError(
      'UNPLAYABLE',
      'The music reader could not start. Try again in a minute.',
      'Music unavailable',
    );
  });
  if (r.code !== 0 || !r.stdout.trim()) {
    log.warn('YTDLP_FAILED', { what, code: r.code ?? 'killed', error: r.stderr.slice(-400) });
    throw friendly(r.stderr, what);
  }
  return r.stdout;
}

export async function searchYouTube(query: string, limit = 5): Promise<SearchResult[]> {
  const out = await ytdlpJson(['--flat-playlist', '-j', `ytsearch${limit}:${query}`], 'That search', 30_000);
  return out
    .split('\n')
    .filter((l) => l.trim().startsWith('{'))
    .map((l) => JSON.parse(l) as Json)
    .filter((d) => str(d.id))
    .map((d) => ({
      id: str(d.id),
      title: str(d.title) || 'Unknown title',
      channel: str(d.channel) || str(d.uploader),
      durationSec: num(d.duration),
      url: str(d.url) || `https://www.youtube.com/watch?v=${str(d.id)}`,
      thumbnail: thumb(d),
    }));
}

/** Resolves a page URL (YouTube, SoundCloud…) into a playable audio stream + details. */
export async function resolveStream(pageUrl: string): Promise<StreamInfo> {
  const out = await ytdlpJson(
    ['-j', '--no-playlist', '-f', 'bestaudio[acodec=opus]/bestaudio/best', pageUrl],
    'That song',
    45_000,
  );
  const d = JSON.parse(out) as Json;
  const streamUrl = str(d.url);
  if (!streamUrl) throw friendly('', 'That song');
  const headers: Record<string, string> = {};
  if (d.http_headers && typeof d.http_headers === 'object') {
    for (const [k, v] of Object.entries(d.http_headers as Json)) if (typeof v === 'string') headers[k] = v;
  }
  return {
    streamUrl,
    headers,
    title: str(d.title) || 'Unknown title',
    author: str(d.channel) || str(d.uploader) || str(d.artist),
    durationSec: num(d.duration),
    thumbnail: thumb(d),
    pageUrl: str(d.webpage_url) || pageUrl,
    isLive: d.is_live === true,
    resolvedAt: Date.now(),
  };
}

export interface PlaylistEntry {
  title: string;
  author: string;
  durationSec: number;
  url: string;
  thumbnail: string | null;
}

export async function listPlaylist(
  url: string,
  max: number,
): Promise<{ title: string; entries: PlaylistEntry[] }> {
  const out = await ytdlpJson(
    ['--flat-playlist', '-J', '--playlist-end', String(max), url],
    'That playlist',
    60_000,
  );
  const d = JSON.parse(out) as Json;
  const entries = (Array.isArray(d.entries) ? (d.entries as Json[]) : [])
    .filter((e) => str(e.url) || str(e.id))
    .map((e) => ({
      title: str(e.title) || 'Unknown title',
      author: str(e.channel) || str(e.uploader),
      durationSec: num(e.duration),
      url: str(e.url).startsWith('http') ? str(e.url) : `https://www.youtube.com/watch?v=${str(e.id)}`,
      thumbnail: thumb(e),
    }));
  return { title: str(d.title) || 'Playlist', entries };
}

/** Finds the YouTube upload that best matches a Spotify song. */
export async function matchSong(want: {
  title: string;
  artist: string;
  durationSec: number;
}): Promise<SearchResult> {
  const results = await searchYouTube(`${want.artist} - ${want.title}`.trim(), 6);
  const best = pickBest(results, want) ?? results[0];
  if (!best) {
    throw new DomainError('NO_MATCH', `No playable version of **${want.title}** was found.`, 'Not found');
  }
  return best as SearchResult;
}
