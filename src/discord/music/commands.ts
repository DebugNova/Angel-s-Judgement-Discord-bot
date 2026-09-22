import { randomBytes } from 'node:crypto';
import { InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction, EmbedBuilder, InteractionEditReplyOptions } from 'discord.js';
import { DomainError, isDomainError } from '../../core/errors.js';
import { log } from '../../core/logger.js';
import { updateConfig } from '../../modules/configuration/config.service.js';
import { PermissionLevel } from '../../modules/permissions/permissions.js';
import { MAX_QUEUE } from '../../modules/music/queue.js';
import type { Track } from '../../modules/music/queue.js';
import { listPlaylist, resolveStream, searchYouTube } from '../../modules/music/resolver.js';
import type { SearchResult, StreamInfo } from '../../modules/music/resolver.js';
import { formatTime, parseInput, parseTimestamp } from '../../modules/music/sources.js';
import { fetchSpotify } from '../../modules/music/spotify.js';
import {
  deletePlaylist,
  getPlaylist,
  listPlaylists,
  savePlaylist,
} from '../../modules/music/store.service.js';
import type { SavedTrack } from '../../modules/music/store.service.js';
import type { SlashCommand } from '../commands/types.js';
import type { Ctx } from '../context.js';
import {
  addedEmbed,
  musicInfoEmbed,
  queueComponents,
  queueEmbed,
  searchEmbed,
  searchSelect,
} from '../ui/music.js';
import { user } from '../ui/theme.js';
import { isDj, isMusicStaff, requireControl, requireInVoice, requireListener } from './access.js';
import { GuildPlayer, getPlayer } from './player.js';

const guildOnly = [InteractionContextType.Guild];

// ───── Helpers ─────

interface Reply {
  embeds: EmbedBuilder[];
  components?: InteractionEditReplyOptions['components'];
  /** Only the member sees it. Results are public by default. */
  private?: boolean;
  /** Nothing to post (the Now Playing panel says it all). */
  silent?: boolean;
}

function errorCard(ctx: Ctx, err: unknown, what: string): EmbedBuilder {
  if (isDomainError(err)) return musicInfoEmbed(ctx.theme, err.title, err.message).setColor(0xc0392b);
  log.error('MUSIC_COMMAND_FAILED', { command: what, guild: ctx.guild.id }, err);
  return musicInfoEmbed(
    ctx.theme,
    'Something went wrong',
    'The music command failed. The error has been logged.',
  ).setColor(0xc0392b);
}

/** "Thinking…" privately; then the result publicly (or privately), errors always privately. */
async function respond(
  i: ChatInputCommandInteraction<'cached'>,
  ctx: Ctx,
  fn: () => Promise<Reply>,
): Promise<void> {
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  let out: Reply;
  try {
    out = await fn();
  } catch (err) {
    await i
      .editReply({ embeds: [errorCard(ctx, err, i.commandName)], components: [] })
      .catch(() => undefined);
    return;
  }
  if (out.private) {
    await i.editReply({
      embeds: out.embeds,
      components: out.components ?? [],
      allowedMentions: { parse: [] },
    });
    return;
  }
  await i.deleteReply().catch(() => undefined);
  if (!out.silent)
    await i.followUp({
      embeds: out.embeds,
      components: out.components ?? [],
      allowedMentions: { parse: [] },
    });
}

export function requirePlayer(ctx: Ctx): GuildPlayer {
  const p = getPlayer(ctx.guild.id);
  if (!p) throw new DomainError('NO_PLAYER', 'Nothing is playing. Start with `/play`.', 'No music');
  return p;
}

function newId(): string {
  return randomBytes(5).toString('hex');
}

function trackFrom(r: SearchResult, requesterId: string): Track {
  return {
    id: newId(),
    title: r.title,
    author: r.channel,
    durationSec: r.durationSec,
    url: r.url,
    search: null,
    thumbnail: r.thumbnail,
    source: 'youtube',
    requesterId,
    displayUrl: r.url,
  };
}

interface Resolved {
  tracks: Track[];
  listName: string | null;
  primed: Map<string, StreamInfo>;
}

/** Turns whatever the member typed into tracks. Spotify songs are matched to YouTube when played. */
async function resolveInput(query: string, requesterId: string): Promise<Resolved> {
  const input = parseInput(query);
  const primed = new Map<string, StreamInfo>();
  switch (input.kind) {
    case 'search': {
      const [best] = await searchYouTube(input.query, 1);
      if (!best)
        throw new DomainError(
          'NO_RESULTS',
          `Nothing found for **${input.query.slice(0, 100)}**.`,
          'No results',
        );
      return { tracks: [trackFrom(best, requesterId)], listName: null, primed };
    }
    case 'url': {
      const info = await resolveStream(input.url);
      const id = newId();
      primed.set(id, info);
      const host = new URL(info.pageUrl).hostname;
      return {
        tracks: [
          {
            id,
            title: info.title,
            author: info.author,
            durationSec: info.durationSec,
            url: info.pageUrl,
            search: null,
            thumbnail: info.thumbnail,
            source: host.includes('youtu') ? 'youtube' : host.includes('soundcloud') ? 'soundcloud' : 'other',
            requesterId,
            displayUrl: info.pageUrl,
          },
        ],
        listName: null,
        primed,
      };
    }
    case 'youtube-playlist': {
      const list = await listPlaylist(input.url, MAX_QUEUE);
      if (list.entries.length === 0)
        throw new DomainError('EMPTY', 'That playlist is empty or private.', 'Nothing to play');
      return {
        tracks: list.entries.map((e) => ({
          id: newId(),
          title: e.title,
          author: e.author,
          durationSec: e.durationSec,
          url: e.url,
          search: null,
          thumbnail: e.thumbnail,
          source: 'youtube' as const,
          requesterId,
          displayUrl: e.url,
        })),
        listName: list.title,
        primed,
      };
    }
    case 'spotify': {
      const list = await fetchSpotify(input.type, input.id);
      return {
        tracks: list.songs.map((s) => ({
          id: newId(),
          title: s.title,
          author: s.artist,
          durationSec: s.durationSec,
          url: null,
          search: `${s.artist} - ${s.title}`,
          thumbnail: list.type === 'album' ? list.image : null,
          source: 'spotify' as const,
          requesterId,
          displayUrl: s.url,
        })),
        listName: input.type === 'track' ? null : list.name,
        primed,
      };
    }
  }
}

async function enqueue(ctx: Ctx, textChannelId: string, resolved: Resolved, next: boolean): Promise<Reply> {
  const vc = requireInVoice(ctx);
  if (next && !isDj(ctx)) {
    throw new DomainError('DJ_ONLY', 'Only DJs can put songs at the front of the queue.', 'DJs only');
  }
  const player = await GuildPlayer.connect(ctx.guild, vc, textChannelId);
  for (const [id, info] of resolved.primed) player.prime(id, info);
  const res = await player.add(resolved.tracks, { next });
  if (res.added === 0) {
    throw new DomainError(
      'QUEUE_FULL',
      `The queue is full (${MAX_QUEUE} songs). Skip or clear some first.`,
      'Queue full',
    );
  }
  const added = resolved.tracks.slice(0, res.added);
  // A single song that starts right away: the Now Playing panel already shows it.
  if (res.startsNow && added.length === 1 && !resolved.listName) return { embeds: [], silent: true };
  return {
    embeds: [
      addedEmbed(ctx.theme, {
        tracks: added,
        listName: resolved.listName,
        position: res.position,
        startsNow: res.startsNow,
        cut: resolved.tracks.length - res.added,
      }),
    ],
  };
}

/** Skips at once for DJs, the song's requester, or someone alone; otherwise counts a vote. */
export async function skipOrVote(ctx: Ctx, p: GuildPlayer): Promise<string> {
  requireListener(ctx, p);
  const current = p.playing;
  if (!current) throw new DomainError('NOT_PLAYING', 'Nothing is playing.', 'Nothing to skip');
  const listeners = p.listenerIds();
  if (isDj(ctx) || current.requesterId === ctx.member.id || listeners.length <= 1) {
    await p.skip();
    return `${user(ctx.member.id)} skipped **${current.title.slice(0, 80)}**.`;
  }
  p.votes.add(ctx.member.id);
  const votes = [...p.votes].filter((id) => listeners.includes(id)).length;
  const needed = Math.ceil(listeners.length / 2);
  if (votes >= needed) {
    await p.skip();
    return `Vote passed (${votes}/${needed}). Skipped **${current.title.slice(0, 80)}**.`;
  }
  return `${user(ctx.member.id)} voted to skip **${current.title.slice(0, 80)}** · ${votes}/${needed} votes.`;
}

export function renderQueue(ctx: Ctx, p: GuildPlayer, page: number, owner: string): Reply {
  return {
    embeds: [
      queueEmbed(
        ctx.theme,
        {
          current: p.playing,
          upcoming: p.queue.upcoming,
          upcomingSec: p.queue.upcomingSeconds(),
          loop: p.queue.loop,
        },
        page,
      ),
    ],
    components: queueComponents(p.queue.upcoming, page, owner),
  };
}

// ───── Search picker (in memory; a restart just expires it) ─────

interface PendingSearch {
  guildId: string;
  userId: string;
  channelId: string;
  results: SearchResult[];
  expiresAt: number;
}
const searches = new Map<string, PendingSearch>();

export function takeSearch(token: string): PendingSearch | null {
  const s = searches.get(token);
  if (!s || s.expiresAt < Date.now()) {
    searches.delete(token);
    return null;
  }
  return s;
}

export async function pickSearchResult(ctx: Ctx, s: PendingSearch, index: number): Promise<EmbedBuilder> {
  const r = s.results[index];
  if (!r) throw new DomainError('STALE', 'That choice is no longer available.', 'Expired');
  const out = await enqueue(
    ctx,
    s.channelId,
    { tracks: [trackFrom(r, ctx.member.id)], listName: null, primed: new Map() },
    false,
  );
  return out.embeds[0] ?? musicInfoEmbed(ctx.theme, 'Now Playing', `**${r.title}**`);
}

// ───── Commands ─────

const play: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription(
      'Play a song: a name, or a YouTube / Spotify / SoundCloud link (also albums and playlists)',
    )
    .setContexts(guildOnly)
    .addStringOption((o) =>
      o.setName('song').setDescription('Song name or link').setRequired(true).setMaxLength(300),
    )
    .addBooleanOption((o) => o.setName('next').setDescription('Play it right after the current song (DJs)'))
    .toJSON(),
  level: PermissionLevel.MEMBER,
  async execute(i, ctx) {
    requireInVoice(ctx);
    const query = i.options.getString('song', true);
    const next = i.options.getBoolean('next') ?? false;
    await respond(i, ctx, async () => enqueue(ctx, i.channelId, await resolveInput(query, i.user.id), next));
  },
};

const search: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('search')
    .setDescription('Search YouTube and pick the right song from a list')
    .setContexts(guildOnly)
    .addStringOption((o) =>
      o.setName('song').setDescription('What to search for').setRequired(true).setMaxLength(200),
    )
    .toJSON(),
  level: PermissionLevel.MEMBER,
  async execute(i, ctx) {
    requireInVoice(ctx);
    const query = i.options.getString('song', true);
    await respond(i, ctx, async () => {
      const results = await searchYouTube(query, 5);
      if (results.length === 0)
        throw new DomainError('NO_RESULTS', `Nothing found for **${query.slice(0, 100)}**.`, 'No results');
      const token = randomBytes(6).toString('base64url');
      for (const [k, v] of searches) if (v.expiresAt < Date.now()) searches.delete(k);
      searches.set(token, {
        guildId: ctx.guild.id,
        userId: i.user.id,
        channelId: i.channelId,
        results,
        expiresAt: Date.now() + 120_000,
      });
      return {
        embeds: [searchEmbed(ctx.theme, query, results)],
        components: searchSelect(token, results),
        private: true,
      };
    });
  },
};

const skip: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Skip the current song (or vote to skip)')
    .setContexts(guildOnly)
    .toJSON(),
  level: PermissionLevel.MEMBER,
  async execute(i, ctx) {
    await respond(i, ctx, async () => ({
      embeds: [musicInfoEmbed(ctx.theme, 'Skip', await skipOrVote(ctx, requirePlayer(ctx)))],
    }));
  },
};

const stop: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop the music, clear the queue and leave')
    .setContexts(guildOnly)
    .toJSON(),
  level: PermissionLevel.MEMBER,
  async execute(i, ctx) {
    await respond(i, ctx, async () => {
      const p = requirePlayer(ctx);
      requireControl(ctx, p, 'stop the music');
      p.destroy(`stopped by ${i.user.id}`);
      return {
        embeds: [
          musicInfoEmbed(
            ctx.theme,
            'Music Stopped',
            `${user(i.user.id)} stopped the music and cleared the queue.`,
          ),
        ],
      };
    });
  },
};

const queue: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Show the queue')
    .setContexts(guildOnly)
    .addIntegerOption((o) => o.setName('page').setDescription('Page number').setMinValue(1))
    .toJSON(),
  level: PermissionLevel.MEMBER,
  async execute(i, ctx) {
    await respond(i, ctx, async () =>
      renderQueue(ctx, requirePlayer(ctx), (i.options.getInteger('page') ?? 1) - 1, i.user.id),
    );
  },
};

const nowPlaying: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('nowplaying')
    .setDescription('Bring the music player to the bottom of this channel')
    .setContexts(guildOnly)
    .toJSON(),
  level: PermissionLevel.MEMBER,
  async execute(i, ctx) {
    await respond(i, ctx, async () => {
      const p = requirePlayer(ctx);
      p.textChannelId = i.channelId;
      await p.postPanel(true);
      return { embeds: [], silent: true };
    });
  },
};

const music: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('music')
    .setDescription('Music controls')
    .setContexts(guildOnly)
    .addSubcommand((s) => s.setName('pause').setDescription('Pause the music'))
    .addSubcommand((s) => s.setName('resume').setDescription('Resume the music'))
    .addSubcommand((s) => s.setName('back').setDescription('Play the previous song again'))
    .addSubcommand((s) =>
      s
        .setName('loop')
        .setDescription('Repeat the song or the whole queue')
        .addStringOption((o) =>
          o
            .setName('mode')
            .setDescription('What to repeat')
            .setRequired(true)
            .addChoices(
              { name: 'Off', value: 'off' },
              { name: 'This song', value: 'track' },
              { name: 'The whole queue', value: 'queue' },
            ),
        ),
    )
    .addSubcommand((s) => s.setName('shuffle').setDescription('Shuffle the upcoming songs'))
    .addSubcommand((s) =>
      s
        .setName('volume')
        .setDescription('Set the volume (default 80)')
        .addIntegerOption((o) =>
          o.setName('level').setDescription('0–150').setRequired(true).setMinValue(0).setMaxValue(150),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('seek')
        .setDescription('Jump to a moment in the song')
        .addStringOption((o) =>
          o.setName('to').setDescription('For example 1:30').setRequired(true).setMaxLength(10),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Remove a song from the queue')
        .addIntegerOption((o) =>
          o.setName('position').setDescription('Its number in /queue').setRequired(true).setMinValue(1),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('move')
        .setDescription('Move a song in the queue')
        .addIntegerOption((o) =>
          o.setName('from').setDescription('Its number in /queue').setRequired(true).setMinValue(1),
        )
        .addIntegerOption((o) =>
          o.setName('to').setDescription('New number').setRequired(true).setMinValue(1),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('jump')
        .setDescription('Play a song from the queue now')
        .addIntegerOption((o) =>
          o.setName('position').setDescription('Its number in /queue').setRequired(true).setMinValue(1),
        ),
    )
    .addSubcommand((s) => s.setName('clear').setDescription('Remove every upcoming song'))
    .addSubcommand((s) => s.setName('history').setDescription('Recently played songs'))
    .addSubcommand((s) =>
      s
        .setName('stay')
        .setDescription('24/7: stay in the voice channel even when idle (DJs/staff)')
        .addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(true)),
    )
    .toJSON(),
  level: PermissionLevel.MEMBER,
  async execute(i, ctx) {
    const sub = i.options.getSubcommand();
    await respond(i, ctx, async () => {
      const p = requirePlayer(ctx);
      const done = (title: string, text: string): Reply => ({
        embeds: [musicInfoEmbed(ctx.theme, title, text)],
      });
      const who = user(i.user.id);
      switch (sub) {
        case 'pause':
          requireControl(ctx, p, 'pause the music');
          p.pause();
          return done('Paused', `${who} paused the music.`);
        case 'resume':
          requireControl(ctx, p, 'resume the music');
          p.resume();
          return done('Resumed', `${who} resumed the music.`);
        case 'back': {
          requireControl(ctx, p, 'go back');
          const t = await p.back();
          return done('Back', `${who} went back to **${t.title.slice(0, 80)}**.`);
        }
        case 'loop': {
          requireControl(ctx, p, 'change the loop');
          const mode = i.options.getString('mode', true) as 'off' | 'track' | 'queue';
          p.setLoop(mode);
          return done(
            'Loop',
            mode === 'off'
              ? 'Loop is off.'
              : mode === 'track'
                ? 'Repeating this song.'
                : 'Repeating the whole queue.',
          );
        }
        case 'shuffle':
          requireControl(ctx, p, 'shuffle');
          p.shuffle();
          return done('Shuffled', `${who} shuffled ${p.queue.upcoming.length} songs.`);
        case 'volume': {
          requireControl(ctx, p, 'change the volume');
          const v = p.setVolume(i.options.getInteger('level', true));
          return done('Volume', `Volume set to **${v}%**.`);
        }
        case 'seek': {
          requireControl(ctx, p, 'seek');
          const raw = i.options.getString('to', true);
          const sec = parseTimestamp(raw);
          if (sec === null)
            throw new DomainError(
              'BAD_TIME',
              `\`${raw.slice(0, 10)}\` is not a time. Use for example \`1:30\`.`,
              'Invalid time',
            );
          await p.seek(sec);
          return done('Seek', `Jumped to **${formatTime(sec)}**.`);
        }
        case 'remove': {
          requireListener(ctx, p);
          const pos = i.options.getInteger('position', true);
          const t = p.queue.upcoming[pos - 1];
          if (!t)
            throw new DomainError('BAD_POSITION', `There is no song at position ${pos}.`, 'Not in the queue');
          if (t.requesterId !== i.user.id) requireControl(ctx, p, "remove other people's songs");
          p.queue.remove(pos);
          p.changed();
          return done('Removed', `Removed **${t.title.slice(0, 80)}** from the queue.`);
        }
        case 'move': {
          requireControl(ctx, p, 'move songs');
          const t = p.queue.move(i.options.getInteger('from', true), i.options.getInteger('to', true));
          if (!t)
            throw new DomainError(
              'BAD_POSITION',
              'One of those positions is not in the queue.',
              'Not in the queue',
            );
          p.changed();
          return done(
            'Moved',
            `Moved **${t.title.slice(0, 80)}** to position ${i.options.getInteger('to', true)}.`,
          );
        }
        case 'jump': {
          requireControl(ctx, p, 'jump in the queue');
          const t = await p.jump(i.options.getInteger('position', true));
          return done('Jumped', `Now playing **${t.title.slice(0, 80)}**.`);
        }
        case 'clear': {
          requireControl(ctx, p, 'clear the queue');
          const n = p.queue.clear();
          p.changed();
          return done('Queue Cleared', `${who} removed ${n} upcoming song${n === 1 ? '' : 's'}.`);
        }
        case 'history': {
          const h = [...p.queue.history].reverse().slice(0, 15);
          return {
            embeds: [
              musicInfoEmbed(
                ctx.theme,
                'Recently Played',
                h.length > 0
                  ? h
                      .map((t, k) => `\`${k + 1}.\` ${t.title.slice(0, 80)} · ${user(t.requesterId)}`)
                      .join('\n')
                  : 'Nothing has finished playing yet.',
              ),
            ],
            private: true,
          };
        }
        case 'stay': {
          if (!isMusicStaff(ctx)) {
            throw new DomainError(
              'DJ_ONLY',
              'Only DJs, moderators or admins can turn 24/7 mode on or off.',
              'Staff only',
            );
          }
          const on = i.options.getBoolean('enabled', true);
          await updateConfig(ctx.guild.id, { music247: on });
          p.set247(on);
          return done(
            '24/7 Mode',
            on
              ? 'I will stay in the voice channel even when idle.'
              : 'I will leave when the queue ends or everyone leaves.',
          );
        }
      }
      throw new DomainError('STALE', 'Unknown option.', 'Not available');
    });
  },
};

// ───── Saved playlists ─────

function toSaved(t: Track): SavedTrack {
  return {
    title: t.title,
    author: t.author,
    durationSec: t.durationSec,
    url: t.url,
    search: t.search,
    thumbnail: t.thumbnail,
    source: t.source,
    displayUrl: t.displayUrl,
  };
}

const playlist: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('playlist')
    .setDescription('Your saved playlists')
    .setContexts(guildOnly)
    .addSubcommand((s) =>
      s
        .setName('save')
        .setDescription('Save the current queue as a playlist')
        .addStringOption((o) =>
          o.setName('name').setDescription('Playlist name').setRequired(true).setMaxLength(50),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('load')
        .setDescription('Add one of your playlists to the queue')
        .addStringOption((o) =>
          o
            .setName('name')
            .setDescription('Playlist name')
            .setRequired(true)
            .setMaxLength(50)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((s) => s.setName('list').setDescription('Your playlists'))
    .addSubcommand((s) =>
      s
        .setName('delete')
        .setDescription('Delete one of your playlists')
        .addStringOption((o) =>
          o
            .setName('name')
            .setDescription('Playlist name')
            .setRequired(true)
            .setMaxLength(50)
            .setAutocomplete(true),
        ),
    )
    .toJSON(),
  level: PermissionLevel.MEMBER,
  async execute(i, ctx) {
    const sub = i.options.getSubcommand();
    await respond(i, ctx, async () => {
      if (sub === 'list') {
        const rows = await listPlaylists(ctx.guild.id, i.user.id);
        return {
          embeds: [
            musicInfoEmbed(
              ctx.theme,
              'Your Playlists',
              rows.length > 0
                ? rows.map((r) => `**${r.name}** · ${r.count} song${r.count === 1 ? '' : 's'}`).join('\n')
                : 'You have no saved playlists. Queue some songs, then `/playlist save`.',
            ),
          ],
          private: true,
        };
      }
      const name = i.options.getString('name', true);
      if (sub === 'save') {
        const p = requirePlayer(ctx);
        const tracks = [...(p.playing ? [p.playing] : []), ...p.queue.upcoming].map(toSaved);
        const r = await savePlaylist(ctx.guild.id, i.user.id, name, tracks);
        return {
          embeds: [
            musicInfoEmbed(
              ctx.theme,
              'Playlist Saved',
              `${r.replaced ? 'Updated' : 'Saved'} **${r.name}** with ${r.count} song${r.count === 1 ? '' : 's'}. Load it any time with \`/playlist load\`.`,
            ),
          ],
          private: true,
        };
      }
      if (sub === 'delete') {
        await deletePlaylist(ctx.guild.id, i.user.id, name);
        return {
          embeds: [musicInfoEmbed(ctx.theme, 'Playlist Deleted', `**${name.slice(0, 50)}** was deleted.`)],
          private: true,
        };
      }
      const pl = await getPlaylist(ctx.guild.id, i.user.id, name);
      const tracks: Track[] = pl.tracks.map((t) => ({ ...t, id: newId(), requesterId: i.user.id }));
      return enqueue(ctx, i.channelId, { tracks, listName: pl.name, primed: new Map() }, false);
    });
  },
  async autocomplete(i, ctx) {
    const typed = String(i.options.getFocused()).toLowerCase();
    const rows = await listPlaylists(ctx.guild.id, i.user.id);
    await i.respond(
      rows
        .filter((r) => r.name.toLowerCase().includes(typed))
        .slice(0, 25)
        .map((r) => ({ name: `${r.name} (${r.count})`.slice(0, 100), value: r.name })),
    );
  },
};

export const musicCommands: SlashCommand[] = [play, search, skip, stop, queue, nowPlaying, music, playlist];
