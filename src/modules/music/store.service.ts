/** Saved playlists and the "what was playing" snapshot used to resume after a restart. */
import type { Prisma } from '@prisma/client';
import { DomainError } from '../../core/errors.js';
import { db } from '../../database/client.js';
import type { LoopMode, Track } from './queue.js';

export const MAX_PLAYLISTS_PER_MEMBER = 25;
export const MAX_PLAYLIST_TRACKS = 200;

// ───── Sessions ─────

export interface SessionSnapshot {
  guildId: string;
  voiceChannelId: string;
  textChannelId: string | null;
  tracks: Track[];
  index: number;
  loop: LoopMode;
  positionSec: number;
  paused: boolean;
  volume: number;
  updatedAt?: Date;
}

export async function saveSession(s: SessionSnapshot): Promise<void> {
  const queue = { tracks: s.tracks, index: s.index, loop: s.loop } as unknown as Prisma.InputJsonValue;
  const data = {
    voiceChannelId: s.voiceChannelId,
    textChannelId: s.textChannelId,
    queue,
    positionSec: Math.max(0, Math.floor(s.positionSec)),
    paused: s.paused,
    volume: s.volume,
  };
  await db().musicSession.upsert({
    where: { guildId: s.guildId },
    update: data,
    create: { guildId: s.guildId, ...data },
  });
}

export async function deleteSession(guildId: string): Promise<void> {
  await db().musicSession.deleteMany({ where: { guildId } });
}

export async function loadSessions(): Promise<SessionSnapshot[]> {
  const rows = await db().musicSession.findMany();
  return rows.map((r) => {
    const q = (r.queue ?? {}) as { tracks?: Track[]; index?: number; loop?: LoopMode };
    return {
      guildId: r.guildId,
      voiceChannelId: r.voiceChannelId,
      textChannelId: r.textChannelId,
      tracks: Array.isArray(q.tracks) ? q.tracks : [],
      index: typeof q.index === 'number' ? q.index : 0,
      loop: q.loop === 'track' || q.loop === 'queue' ? q.loop : 'off',
      positionSec: r.positionSec,
      paused: r.paused,
      volume: r.volume,
      updatedAt: r.updatedAt,
    };
  });
}

// ───── Playlists ─────

/** What a saved playlist keeps of each track (no requester, no cached stream). */
export type SavedTrack = Pick<
  Track,
  'title' | 'author' | 'durationSec' | 'url' | 'search' | 'thumbnail' | 'source' | 'displayUrl'
>;

function cleanName(name: string): string {
  const n = name.trim().replace(/\s+/g, ' ').slice(0, 50);
  if (!n) throw new DomainError('BAD_NAME', 'Give the playlist a name.', 'Name required');
  return n;
}

export async function savePlaylist(guildId: string, ownerId: string, name: string, tracks: SavedTrack[]) {
  const n = cleanName(name);
  if (tracks.length === 0)
    throw new DomainError('EMPTY', 'There is nothing in the queue to save.', 'Nothing to save');
  const existing = await db().musicPlaylist.findUnique({
    where: { guildId_ownerId_name: { guildId, ownerId, name: n } },
  });
  if (!existing) {
    const count = await db().musicPlaylist.count({ where: { guildId, ownerId } });
    if (count >= MAX_PLAYLISTS_PER_MEMBER) {
      throw new DomainError(
        'TOO_MANY',
        `You can keep up to ${MAX_PLAYLISTS_PER_MEMBER} playlists. Delete one first.`,
        'Playlist limit',
      );
    }
  }
  const data = { tracks: tracks.slice(0, MAX_PLAYLIST_TRACKS) as unknown as Prisma.InputJsonValue };
  const row = await db().musicPlaylist.upsert({
    where: { guildId_ownerId_name: { guildId, ownerId, name: n } },
    update: data,
    create: { guildId, ownerId, name: n, ...data },
  });
  return { name: row.name, count: Math.min(tracks.length, MAX_PLAYLIST_TRACKS), replaced: existing !== null };
}

export async function getPlaylist(
  guildId: string,
  ownerId: string,
  name: string,
): Promise<{ name: string; tracks: SavedTrack[] }> {
  const row = await db().musicPlaylist.findUnique({
    where: { guildId_ownerId_name: { guildId, ownerId, name: cleanName(name) } },
  });
  if (!row)
    throw new DomainError(
      'NOT_FOUND',
      `You have no playlist called **${cleanName(name)}**.`,
      'Playlist not found',
    );
  return { name: row.name, tracks: (row.tracks ?? []) as unknown as SavedTrack[] };
}

export async function listPlaylists(guildId: string, ownerId: string) {
  const rows = await db().musicPlaylist.findMany({ where: { guildId, ownerId }, orderBy: { name: 'asc' } });
  return rows.map((r) => ({
    name: r.name,
    count: Array.isArray(r.tracks) ? r.tracks.length : 0,
    updatedAt: r.updatedAt,
  }));
}

export async function deletePlaylist(guildId: string, ownerId: string, name: string): Promise<void> {
  const res = await db().musicPlaylist.deleteMany({ where: { guildId, ownerId, name: cleanName(name) } });
  if (res.count === 0)
    throw new DomainError(
      'NOT_FOUND',
      `You have no playlist called **${cleanName(name)}**.`,
      'Playlist not found',
    );
}
