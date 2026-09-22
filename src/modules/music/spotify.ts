/**
 * Spotify links → a list of songs (title, artist, length). Spotify audio itself can't be played by
 * bots (it is DRM-protected), so each song is later matched to YouTube.
 *
 * We read Spotify's public embed page (the same data the "embed this playlist" widget shows), so no
 * Spotify account or keys are needed. Big playlists are cut to what that page lists (usually 100).
 */
import { DomainError } from '../../core/errors.js';

export interface SpotifySong {
  title: string;
  artist: string;
  durationSec: number;
  /** The song's own Spotify link, when known. */
  url: string | null;
}

export interface SpotifyList {
  type: 'track' | 'album' | 'playlist';
  name: string;
  owner: string | null;
  image: string | null;
  songs: SpotifySong[];
}

interface EmbedEntity {
  type?: string;
  name?: string;
  title?: string;
  subtitle?: string;
  duration?: number;
  artists?: { name?: string }[];
  id?: string;
  trackList?: { uri?: string; title?: string; subtitle?: string; duration?: number; isPlayable?: boolean }[];
  visualIdentity?: { image?: { url?: string; maxWidth?: number }[] };
  coverArt?: { sources?: { url?: string }[] };
}

/** Parses the embed page HTML. Exported for tests. */
export function parseSpotifyEmbed(html: string, type: SpotifyList['type']): SpotifyList {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) throw notReadable();
  let entity: EmbedEntity | undefined;
  try {
    const data = JSON.parse(m[1]!) as {
      props?: { pageProps?: { state?: { data?: { entity?: EmbedEntity } } } };
    };
    entity = data.props?.pageProps?.state?.data?.entity;
  } catch {
    throw notReadable();
  }
  if (!entity) throw notReadable();
  const clean = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
  const images = entity.visualIdentity?.image ?? [];
  const image = [...images].sort((a, b) => (b.maxWidth ?? 0) - (a.maxWidth ?? 0))[0]?.url ?? null;
  if (type === 'track') {
    const artist = (entity.artists ?? [])
      .map((a) => clean(a.name))
      .filter(Boolean)
      .join(', ');
    const title = clean(entity.name ?? entity.title);
    if (!title) throw notReadable();
    return {
      type,
      name: title,
      owner: artist || null,
      image,
      songs: [
        {
          title,
          artist,
          durationSec: Math.round((entity.duration ?? 0) / 1000),
          url: entity.id ? `https://open.spotify.com/track/${entity.id}` : null,
        },
      ],
    };
  }
  const songs = (entity.trackList ?? [])
    .filter((t) => t.isPlayable !== false && clean(t.title))
    .map((t) => {
      const id = t.uri?.match(/^spotify:track:([A-Za-z0-9]+)$/)?.[1];
      return {
        title: clean(t.title),
        artist: clean(t.subtitle),
        durationSec: Math.round((t.duration ?? 0) / 1000),
        url: id ? `https://open.spotify.com/track/${id}` : null,
      };
    });
  if (songs.length === 0) {
    throw new DomainError(
      'SPOTIFY_EMPTY',
      'That Spotify list has no playable songs (it may be private or empty).',
      'Nothing to play',
    );
  }
  return {
    type,
    name: clean(entity.name ?? entity.title) || 'Spotify',
    owner: clean(entity.subtitle) || null,
    image,
    songs,
  };
}

function notReadable(): DomainError {
  return new DomainError(
    'SPOTIFY_UNREADABLE',
    "I couldn't read that Spotify link. Check that it is public, or try the song's name instead.",
    'Spotify link not readable',
  );
}

export async function fetchSpotify(type: SpotifyList['type'], id: string): Promise<SpotifyList> {
  const res = await fetch(`https://open.spotify.com/embed/${type}/${id}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Accept-Language': 'en' },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!res) throw notReadable();
  if (res.status === 404) {
    throw new DomainError(
      'SPOTIFY_NOT_FOUND',
      'That Spotify link does not exist (or is private).',
      'Not found',
    );
  }
  if (!res.ok) throw notReadable();
  return parseSpotifyEmbed(await res.text(), type);
}
