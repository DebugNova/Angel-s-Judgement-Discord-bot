import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/database/client.js';
import { exportAll, importAll } from '../src/database/backup.js';
import { Queue } from '../src/modules/music/queue.js';
import type { Track } from '../src/modules/music/queue.js';
import {
  formatTime,
  parseInput,
  parseTimestamp,
  pickBest,
  scoreCandidate,
} from '../src/modules/music/sources.js';
import { parseSpotifyEmbed } from '../src/modules/music/spotify.js';
import {
  deletePlaylist,
  deleteSession,
  getPlaylist,
  listPlaylists,
  loadSessions,
  savePlaylist,
  saveSession,
} from '../src/modules/music/store.service.js';
import { GUILD, config, resetDb } from './helpers.js';

const ME = '400000000000000001';

function t(n: number, extra: Partial<Track> = {}): Track {
  return {
    id: `t${n}`,
    title: `Song ${n}`,
    author: 'Artist',
    durationSec: 180,
    url: `https://www.youtube.com/watch?v=${n}`,
    search: null,
    thumbnail: null,
    source: 'youtube',
    requesterId: ME,
    displayUrl: null,
    ...extra,
  };
}

function queueOf(n: number): Queue {
  const q = new Queue();
  q.add(Array.from({ length: n }, (_, k) => t(k + 1)));
  q.advance(true);
  return q;
}

describe('queue', () => {
  it('plays in order, then finishes', () => {
    const q = queueOf(3);
    expect(q.current?.id).toBe('t1');
    expect(q.advance()?.id).toBe('t2');
    expect(q.advance()?.id).toBe('t3');
    expect(q.advance()).toBeNull();
    expect(q.current).toBeNull();
    expect(q.history.map((x) => x.id)).toEqual(['t1', 't2', 't3']);
  });

  it('loop song repeats until skipped; loop queue wraps around', () => {
    const q = queueOf(2);
    q.loop = 'track';
    expect(q.advance()?.id).toBe('t1');
    expect(q.advance(true)?.id).toBe('t2');
    q.loop = 'queue';
    expect(q.advance()?.id).toBe('t1');
    expect(q.cycleLoop()).toBe('off');
  });

  it('back, jump, remove and move use 1-based positions of upcoming songs', () => {
    const q = queueOf(5);
    expect(q.back()).toBeNull();
    expect(q.jump(2)?.id).toBe('t3');
    expect(q.back()?.id).toBe('t2');
    expect(q.remove(1)?.id).toBe('t3');
    expect(q.upcoming.map((x) => x.id)).toEqual(['t4', 't5']);
    expect(q.move(2, 1)?.id).toBe('t5');
    expect(q.upcoming.map((x) => x.id)).toEqual(['t5', 't4']);
    expect(q.remove(9)).toBeNull();
    expect(q.move(0, 1)).toBeNull();
  });

  it('shuffle keeps the current song and every upcoming song', () => {
    const q = queueOf(10);
    let seed = 1;
    q.shuffle(() => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646);
    expect(q.current?.id).toBe('t1');
    expect(q.upcoming.map((x) => x.id).sort()).toEqual([
      't10',
      't2',
      't3',
      't4',
      't5',
      't6',
      't7',
      't8',
      't9',
    ]);
  });

  it('add "next" goes to the front; the queue caps at 500 songs', () => {
    const q = queueOf(2);
    q.add([t(99)], { next: true });
    expect(q.upcoming[0]?.id).toBe('t99');
    const added = q.add(Array.from({ length: 600 }, (_, k) => t(1000 + k)));
    expect(added).toBe(498);
    expect(q.upcoming).toHaveLength(500);
    expect(q.clear()).toBe(500);
  });
});

describe('what members type', () => {
  it('recognises Spotify tracks, albums and playlists (links and URIs)', () => {
    expect(parseInput('https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b?si=abc')).toMatchObject({
      kind: 'spotify',
      type: 'track',
      id: '0VjIjW4GlUZAMYd2vXMi3b',
    });
    expect(parseInput('https://open.spotify.com/intl-de/album/4yP0hdKOZPNshxUOjY0cZj')).toMatchObject({
      type: 'album',
    });
    expect(parseInput('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M')).toMatchObject({ type: 'playlist' });
  });

  it('recognises YouTube videos and playlists; a video inside a playlist plays just that video', () => {
    expect(parseInput('https://www.youtube.com/playlist?list=PL123')).toEqual({
      kind: 'youtube-playlist',
      url: 'https://www.youtube.com/playlist?list=PL123',
    });
    expect(parseInput('https://music.youtube.com/watch?v=abc&list=PL1')).toEqual({
      kind: 'url',
      url: 'https://www.youtube.com/watch?v=abc',
    });
    expect(parseInput('https://youtu.be/abc')).toEqual({ kind: 'url', url: 'https://youtu.be/abc' });
  });

  it('anything else is a search', () => {
    expect(parseInput('  blinding lights  ')).toEqual({ kind: 'search', query: 'blinding lights' });
  });

  it('reads times like 1:30 and 1:02:07', () => {
    expect(parseTimestamp('1:30')).toBe(90);
    expect(parseTimestamp('1:02:07')).toBe(3727);
    expect(parseTimestamp('95')).toBe(95);
    expect(parseTimestamp('abc')).toBeNull();
    expect(formatTime(3727)).toBe('1:02:07');
    expect(formatTime(65)).toBe('1:05');
  });
});

describe('matching Spotify songs to YouTube', () => {
  const want = { title: 'Blinding Lights', artist: 'The Weeknd', durationSec: 200 };

  it('prefers the official upload of the right length over remixes and wrong lengths', () => {
    const best = pickBest(
      [
        { id: 'a', title: 'Blinding Lights (Sped Up)', channel: 'Fan', durationSec: 160 },
        { id: 'b', title: 'The Weeknd - Blinding Lights (Live)', channel: 'Concerts', durationSec: 204 },
        { id: 'c', title: 'Blinding Lights', channel: 'The Weeknd - Topic', durationSec: 201 },
        { id: 'd', title: 'Blinding Lights 1 hour', channel: 'Loops', durationSec: 3600 },
      ],
      want,
    );
    expect(best?.id).toBe('c');
  });

  it('rejects results that are far too long or short', () => {
    expect(
      scoreCandidate({ id: 'x', title: 'Blinding Lights', channel: 'The Weeknd', durationSec: 400 }, want),
    ).toBeNull();
  });

  it('keeps a remix when the Spotify song itself is a remix', () => {
    const w = { title: 'Blinding Lights - Remix', artist: 'The Weeknd', durationSec: 200 };
    const s = scoreCandidate(
      { id: 'r', title: 'The Weeknd - Blinding Lights (Remix)', channel: 'The Weeknd', durationSec: 201 },
      w,
    );
    expect(s).toBeGreaterThan(30);
  });
});

describe('Spotify embed pages', () => {
  const page = (entity: unknown) =>
    `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: { pageProps: { state: { data: { entity } } } },
    })}</script></html>`;

  it('reads a playlist, skipping unplayable songs, keeping each song link', () => {
    const list = parseSpotifyEmbed(
      page({
        type: 'playlist',
        name: 'Today’s Top Hits',
        subtitle: 'Spotify',
        trackList: [
          { uri: 'spotify:track:AAA111AAA111', title: 'One', subtitle: 'Artist A', duration: 201000 },
          {
            uri: 'spotify:track:BBB222BBB222',
            title: 'Two',
            subtitle: 'B',
            duration: 1000,
            isPlayable: false,
          },
        ],
      }),
      'playlist',
    );
    expect(list.name).toBe('Today’s Top Hits');
    expect(list.songs).toEqual([
      {
        title: 'One',
        artist: 'Artist A',
        durationSec: 201,
        url: 'https://open.spotify.com/track/AAA111AAA111',
      },
    ]);
  });

  it('reads a single track with its artists', () => {
    const list = parseSpotifyEmbed(
      page({
        type: 'track',
        id: 'T1T1T1T1T1',
        name: 'Song',
        artists: [{ name: 'X' }, { name: 'Y' }],
        duration: 90500,
      }),
      'track',
    );
    expect(list.songs[0]).toEqual({
      title: 'Song',
      artist: 'X, Y',
      durationSec: 91,
      url: 'https://open.spotify.com/track/T1T1T1T1T1',
    });
  });

  it('gives a friendly error for pages it cannot read or empty lists', () => {
    expect(() => parseSpotifyEmbed('<html>nothing</html>', 'album')).toThrow(
      expect.objectContaining({ code: 'SPOTIFY_UNREADABLE' }),
    );
    expect(() => parseSpotifyEmbed(page({ type: 'album', trackList: [] }), 'album')).toThrow(
      expect.objectContaining({ code: 'SPOTIFY_EMPTY' }),
    );
  });
});

describe('saved playlists and sessions', () => {
  beforeEach(resetDb);

  it('saves, lists, loads, replaces and deletes a member’s playlist', async () => {
    const tracks = [t(1), t(2, { source: 'spotify', url: null, search: 'Artist - Song 2' })];
    expect(await savePlaylist(GUILD, ME, '  Gym  Mix ', tracks)).toMatchObject({
      name: 'Gym Mix',
      count: 2,
      replaced: false,
    });
    expect(await savePlaylist(GUILD, ME, 'Gym Mix', [t(3)])).toMatchObject({ replaced: true, count: 1 });
    expect(await listPlaylists(GUILD, ME)).toEqual([expect.objectContaining({ name: 'Gym Mix', count: 1 })]);
    expect((await getPlaylist(GUILD, ME, 'gym mix'.replace('gym mix', 'Gym Mix'))).tracks[0]?.title).toBe(
      'Song 3',
    );
    await expect(getPlaylist(GUILD, '999', 'Gym Mix')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await deletePlaylist(GUILD, ME, 'Gym Mix');
    await expect(deletePlaylist(GUILD, ME, 'Gym Mix')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(savePlaylist(GUILD, ME, 'x', [])).rejects.toMatchObject({ code: 'EMPTY' });
    await expect(savePlaylist(GUILD, ME, '   ', [t(1)])).rejects.toMatchObject({ code: 'BAD_NAME' });
  });

  it('remembers the queue and position for resuming after a restart', async () => {
    await saveSession({
      guildId: GUILD,
      voiceChannelId: '500',
      textChannelId: '501',
      tracks: [t(1), t(2)],
      index: 1,
      loop: 'queue',
      positionSec: 42.7,
      paused: false,
      volume: 60,
    });
    const [s] = await loadSessions();
    expect(s).toMatchObject({ guildId: GUILD, index: 1, loop: 'queue', positionSec: 42, volume: 60 });
    expect(s?.tracks.map((x) => x.id)).toEqual(['t1', 't2']);
    await deleteSession(GUILD);
    expect(await loadSessions()).toEqual([]);
  });

  it('playlists survive a backup and restore; music defaults are sensible', async () => {
    await savePlaylist(GUILD, ME, 'Keep', [t(1)]);
    const snapshot = JSON.parse(JSON.stringify(await exportAll())) as Awaited<ReturnType<typeof exportAll>>;
    await resetDb();
    await importAll(snapshot);
    expect(await db().musicPlaylist.count()).toBe(1);
    const cfg = await config();
    expect(cfg.musicVolume).toBe(100);
    expect(cfg.music247).toBe(false);
    expect(cfg.musicDjRoleIds).toEqual([]);
  });
});
