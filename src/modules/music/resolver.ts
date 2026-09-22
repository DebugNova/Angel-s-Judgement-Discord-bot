/** Everything that talks to yt-dlp: search, playlists, song details, and the audio download. */
import { spawn } from 'node:child_process';
import type { ChildProcessByStdio } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
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
/**
 * YouTube often answers "Sign in to confirm you're not a bot" to its normal web client, even on
 * home internet. These alternative clients are not challenged and still give the Opus audio.
 */
const CLIENT_ARGS = ['--extractor-args', 'youtube:player_client=web_embedded,web_safari,mweb'];
const AUDIO_FORMAT = 'bestaudio[acodec=opus]/bestaudio/best';

export interface SearchResult extends Candidate {
  url: string;
  thumbnail: string | null;
}

export interface StreamInfo {
  title: string;
  author: string;
  durationSec: number;
  thumbnail: string | null;
  pageUrl: string;
  isLive: boolean;
  resolvedAt: number;
  /** yt-dlp's full details, so the download can start without asking YouTube again. */
  infoJson: string;
}

/** Song details from YouTube stay usable ~6 hours; re-resolve well before that. */
export const STREAM_TTL_MS = 4 * 3600_000;

function isBotCheck(stderr: string): boolean {
  const s = stderr.toLowerCase();
  return s.includes('sign in to confirm') || s.includes('not a bot') || s.includes('http error 429');
}

function friendly(stderr: string, what: string): DomainError {
  const s = stderr.toLowerCase();
  if (isBotCheck(stderr)) {
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

/** Reads a song page (YouTube, SoundCloud…): its details plus what the download needs. */
export async function resolveStream(pageUrl: string): Promise<StreamInfo> {
  const args = ['-j', '--no-playlist', '-f', AUDIO_FORMAT, pageUrl];
  let out: string;
  try {
    out = await ytdlpJson([...CLIENT_ARGS, ...args], 'That song', 60_000);
  } catch (err) {
    // The alternative clients can miss some songs; YouTube's normal client is the fallback.
    if (!(err instanceof DomainError) || err.code === 'AGE_RESTRICTED' || err.code === 'UNSUPPORTED')
      throw err;
    out = await ytdlpJson(args, 'That song', 60_000);
  }
  const line = out.trim().split('\n').pop() ?? '';
  const d = JSON.parse(line) as Json;
  return {
    title: str(d.title) || 'Unknown title',
    author: str(d.channel) || str(d.uploader) || str(d.artist),
    durationSec: num(d.duration),
    thumbnail: thumb(d),
    pageUrl: str(d.webpage_url) || pageUrl,
    isLive: d.is_live === true,
    resolvedAt: Date.now(),
    infoJson: line,
  };
}

export interface AudioDownload {
  proc: ChildProcessByStdio<null, Readable, Readable>;
  /** Removes the temporary details file. */
  cleanup: () => void;
}

const TMP = join(tmpdir(), 'angels-judgement-music');

/**
 * Starts yt-dlp downloading the song's audio to stdout (YouTube only accepts downloads done the way
 * yt-dlp does them). Uses the saved details when present, so it starts in about a second.
 */
export async function downloadAudio(info: StreamInfo): Promise<AudioDownload> {
  const bin = await ytdlp();
  let file: string | null = null;
  const source: string[] = [];
  if (info.infoJson) {
    mkdirSync(TMP, { recursive: true });
    file = join(TMP, `${randomBytes(6).toString('hex')}.json`);
    writeFileSync(file, info.infoJson);
    source.push('--load-info-json', file);
  } else {
    source.push(...CLIENT_ARGS, info.pageUrl);
  }
  const proc = spawn(bin, [...BASE_ARGS, '--quiet', '-f', AUDIO_FORMAT, '-o', '-', ...source], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const cleanup = () => {
    if (file) rmSync(file, { force: true });
    file = null;
  };
  proc.on('close', cleanup);
  return { proc, cleanup };
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
