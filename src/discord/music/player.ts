/**
 * One music player per server: voice connection + audio player + queue + the Now Playing panel.
 *
 * Audio path: yt-dlp (a separate program) downloads the song → a memory buffer → Discord, untouched
 * (YouTube's Opus is Discord's own format). Only a volume change or a seek adds ffmpeg (another
 * separate program) to re-encode. Either helper crashing only ends that song (it is retried once);
 * it can never take the bot (or the 1v1 system) down with it.
 */
import { spawn } from 'node:child_process';
import type { ChildProcessByStdio } from 'node:child_process';
import { PassThrough } from 'node:stream';
import type { Readable, Writable } from 'node:stream';
import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
} from '@discordjs/voice';
import type { AudioPlayer, AudioResource, VoiceConnection } from '@discordjs/voice';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import type { Guild, GuildTextBasedChannel, Message, VoiceBasedChannel, VoiceState } from 'discord.js';
import { DomainError } from '../../core/errors.js';
import { log } from '../../core/logger.js';
import { getConfig } from '../../modules/configuration/config.service.js';
import { Queue } from '../../modules/music/queue.js';
import type { Track } from '../../modules/music/queue.js';
import { STREAM_TTL_MS, downloadAudio, matchSong, resolveStream } from '../../modules/music/resolver.js';
import type { AudioDownload, StreamInfo } from '../../modules/music/resolver.js';
import { deleteSession, saveSession } from '../../modules/music/store.service.js';
import { findFfmpeg } from '../../modules/music/tools.js';
import { themeFor } from '../context.js';
import { nowPlayingEmbed, playerButtons } from '../ui/music.js';
import type { PanelState, PanelStatus } from '../ui/music.js';

const players = new Map<string, GuildPlayer>();

export function getPlayer(guildId: string): GuildPlayer | null {
  return players.get(guildId) ?? null;
}

export function allPlayers(): GuildPlayer[] {
  return [...players.values()];
}

const EMPTY_LEAVE_MS = 2 * 60_000;
const QUEUE_END_LEAVE_MS = 3 * 60_000;
const PANEL_REFRESH_MS = 15_000;
const SAVE_EVERY_MS = 30_000;
const MAX_FAILURES_IN_A_ROW = 3;

export class GuildPlayer {
  readonly queue = new Queue();
  readonly votes = new Set<string>();
  volume: number;
  stay247: boolean;
  voiceChannelId: string;
  textChannelId: string | null;

  private connection: VoiceConnection;
  private readonly audio: AudioPlayer;
  private ffmpeg: ChildProcessByStdio<Writable, Readable, Readable> | null = null;
  private download: AudioDownload | null = null;
  private streamFailed = false;
  private resource: AudioResource<Track> | null = null;
  private offsetSec = 0;
  private readonly streams = new Map<string, StreamInfo>();
  private readonly retried = new Set<string>();
  private failures = 0;
  private playToken = 0;
  private autoPaused = false;
  private destroyed = false;
  private status: PanelStatus = 'loading';
  private note: string | null = null;
  private panel: Message | null = null;
  private panelTimer: NodeJS.Timeout | null = null;
  private saveTimer: NodeJS.Timeout | null = null;
  private saveDebounce: NodeJS.Timeout | null = null;
  private leaveTimer: NodeJS.Timeout | null = null;
  private volumeTimer: NodeJS.Timeout | null = null;

  private constructor(
    readonly guild: Guild,
    channel: VoiceBasedChannel,
    textChannelId: string | null,
    opts: { volume: number; stay247: boolean },
  ) {
    this.voiceChannelId = channel.id;
    this.textChannelId = textChannelId;
    this.volume = opts.volume;
    this.stay247 = opts.stay247;
    this.connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
    });
    this.audio = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
    this.connection.subscribe(this.audio);
    this.wireConnection();
    this.audio.on('stateChange', (old, now) => {
      if (now.status === AudioPlayerStatus.Idle && old.status !== AudioPlayerStatus.Idle) {
        // Only a resource we still consider "current" ending means the song finished.
        if ('resource' in old && old.resource === this.resource) void this.onTrackEnd();
      }
    });
    this.audio.on('error', (err) => {
      if (err.resource === this.resource) this.streamFailed = true;
      log.warn(
        'MUSIC_AUDIO_ERROR',
        {
          guild: guild.id,
          track: err.resource.metadata ? String((err.resource.metadata as Track).title) : '',
        },
        err,
      );
    });
    this.saveTimer = setInterval(() => void this.save(), SAVE_EVERY_MS);
    this.panelTimer = setInterval(() => {
      if (this.status === 'playing') void this.refreshPanel();
    }, PANEL_REFRESH_MS);
  }

  /** The member's voice channel gets a player (joining it), or the existing one is returned. */
  static async connect(
    guild: Guild,
    channel: VoiceBasedChannel,
    textChannelId: string | null,
  ): Promise<GuildPlayer> {
    const existing = players.get(guild.id);
    if (existing) {
      if (existing.voiceChannelId !== channel.id) {
        if (existing.listeners() > 0) {
          throw new DomainError(
            'OTHER_CHANNEL',
            `I'm already playing in <#${existing.voiceChannelId}>. Join that channel to add songs.`,
            'Busy in another channel',
          );
        }
        existing.moveTo(channel);
      }
      if (textChannelId) existing.textChannelId = textChannelId;
      return existing;
    }
    const me = guild.members.me ?? (await guild.members.fetchMe());
    const perms = channel.permissionsFor(me);
    const missing = (['ViewChannel', 'Connect', 'Speak'] as const).filter(
      (p) => !perms.has(PermissionFlagsBits[p]),
    );
    if (missing.length > 0) {
      throw new DomainError(
        'VOICE_PERMISSIONS',
        `I can't ${missing.includes('Speak') && missing.length === 1 ? 'speak' : 'join'} in ${channel}. Give my role **${missing.join(', ')}** there (channel settings → Permissions).`,
        'I need a permission',
      );
    }
    if (!channel.joinable) {
      throw new DomainError('VOICE_FULL', `${channel} is full.`, "Can't join");
    }
    // ffmpeg is only needed for volume changes and seeking, so it is not required to join.
    const cfg = await getConfig(guild.id);
    const player = new GuildPlayer(guild, channel, textChannelId, {
      volume: cfg.musicVolume,
      stay247: cfg.music247,
    });
    players.set(guild.id, player);
    try {
      await entersState(player.connection, VoiceConnectionStatus.Ready, 20_000);
    } catch {
      player.destroy('join failed', false);
      throw new DomainError(
        'VOICE_JOIN_FAILED',
        `I couldn't connect to ${channel}. Try again in a moment.`,
        "Can't join",
      );
    }
    if (channel.type === ChannelType.GuildStageVoice) {
      await me.voice.setSuppressed(false).catch(() => undefined);
    }
    log.info('MUSIC_JOINED', { guild: guild.id, channel: channel.id });
    return player;
  }

  // ───── Voice connection ─────

  private wireConnection(): void {
    this.connection.on('stateChange', (_old, now) => {
      if (now.status === VoiceConnectionStatus.Disconnected) {
        // Being moved or a network blip: give Discord 5 s to reconnect before giving up.
        Promise.race([
          entersState(this.connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(this.connection, VoiceConnectionStatus.Connecting, 5_000),
        ]).catch(() => this.destroy('disconnected'));
      } else if (now.status === VoiceConnectionStatus.Destroyed && !this.destroyed) {
        this.destroy('connection destroyed', false);
      }
    });
    this.connection.on('error', (err) => log.warn('MUSIC_VOICE_ERROR', { guild: this.guild.id }, err));
  }

  private moveTo(channel: VoiceBasedChannel): void {
    this.voiceChannelId = channel.id;
    this.connection.rejoin({ channelId: channel.id, selfDeaf: true, selfMute: false });
  }

  /** People (not bots) in the bot's voice channel. */
  listeners(): number {
    const ch = this.guild.channels.cache.get(this.voiceChannelId);
    if (!ch || !ch.isVoiceBased()) return 0;
    return ch.members.filter((m) => !m.user.bot).size;
  }

  listenerIds(): string[] {
    const ch = this.guild.channels.cache.get(this.voiceChannelId);
    if (!ch || !ch.isVoiceBased()) return [];
    return [...ch.members.filter((m) => !m.user.bot).keys()];
  }

  onVoiceStateUpdate(old: VoiceState, now: VoiceState): void {
    const botId = this.guild.client.user?.id;
    if (now.id === botId) {
      if (!now.channelId) this.destroy('disconnected by someone');
      else if (now.channelId !== this.voiceChannelId) {
        this.voiceChannelId = now.channelId; // dragged into another channel: keep playing there
        this.scheduleSave();
      }
      this.checkEmpty();
      return;
    }
    if (old.channelId === this.voiceChannelId || now.channelId === this.voiceChannelId) this.checkEmpty();
  }

  private checkEmpty(): void {
    if (this.destroyed) return;
    if (this.listeners() === 0) {
      if (this.status === 'playing') {
        this.audio.pause();
        this.autoPaused = true;
        this.setStatus('paused', 'Paused: everyone left the voice channel.');
      }
      if (!this.stay247) this.armLeave(EMPTY_LEAVE_MS, 'channel empty');
    } else {
      if (this.leaveTimer && this.status !== 'ended') this.clearLeave();
      if (this.autoPaused) {
        this.autoPaused = false;
        this.audio.unpause();
        this.setStatus('playing', null);
      }
    }
  }

  private armLeave(ms: number, why: string): void {
    this.clearLeave();
    this.leaveTimer = setTimeout(() => this.destroy(why), ms);
  }

  private clearLeave(): void {
    if (this.leaveTimer) clearTimeout(this.leaveTimer);
    this.leaveTimer = null;
  }

  // ───── Playback ─────

  get playing(): Track | null {
    return this.status === 'ended' ? null : this.queue.current;
  }

  get isPaused(): boolean {
    return this.status === 'paused';
  }

  positionSec(): number {
    return this.offsetSec + (this.resource ? this.resource.playbackDuration / 1000 : 0);
  }

  /** Adds tracks; starts playing if nothing was. Returns how many fit and whether they start now. */
  async add(
    tracks: Track[],
    opts: { next?: boolean } = {},
  ): Promise<{ added: number; startsNow: boolean; position: number }> {
    const idle = this.queue.current === null || this.status === 'ended';
    if (idle) {
      // A finished queue starts over with the new songs.
      this.queue.tracks.splice(0, this.queue.tracks.length);
      this.queue.index = -1;
    }
    const position = opts.next ? 1 : this.queue.upcoming.length + 1;
    const added = this.queue.add(tracks, opts);
    this.clearLeave();
    if (idle && added > 0) {
      this.queue.advance(true);
      void this.playCurrent(0, true);
      return { added, startsNow: true, position: 0 };
    }
    this.scheduleSave();
    void this.refreshPanel();
    this.prefetchNext();
    return { added, startsNow: false, position };
  }

  /** Stops what is streaming now without triggering "song finished". */
  private stopStream(): void {
    this.resource = null;
    if (this.download) {
      this.download.proc.kill('SIGKILL');
      this.download.cleanup();
      this.download = null;
    }
    if (this.ffmpeg) {
      this.ffmpeg.kill('SIGKILL');
      this.ffmpeg = null;
    }
  }

  /** Remembers a stream that was already resolved while reading the member's link. */
  prime(trackId: string, info: StreamInfo): void {
    this.streams.set(trackId, info);
  }

  private async streamFor(track: Track): Promise<StreamInfo> {
    const cached = this.streams.get(track.id);
    if (cached && Date.now() - cached.resolvedAt < STREAM_TTL_MS) return cached;
    if (!track.url) {
      const match = await matchSong({
        title: track.title,
        artist: track.author,
        durationSec: track.durationSec,
      });
      track.url = match.url;
      track.thumbnail ??= match.thumbnail;
    }
    const info = await resolveStream(track.url);
    if (track.source !== 'spotify') {
      track.title = info.title;
      track.author = info.author;
      track.durationSec = info.durationSec;
      track.displayUrl ??= info.pageUrl;
    }
    track.thumbnail ??= info.thumbnail;
    this.streams.set(track.id, info);
    if (this.streams.size > 6) this.streams.delete(this.streams.keys().next().value!);
    return info;
  }

  /**
   * yt-dlp downloads the song → a 32 MB memory buffer (so the download finishes in seconds and
   * yt-dlp exits, freeing its memory) → Discord.
   *
   * Best quality: YouTube's audio is already Discord's format (Opus 48 kHz), so at normal volume
   * and from the start it is sent UNTOUCHED (no re-encoding, near-zero CPU). Only a volume change,
   * a seek, or another format goes through ffmpeg, which re-encodes at 160 kbps.
   */
  private async spawnPipeline(info: StreamInfo, seekSec: number) {
    const dl = await downloadAudio(info);
    const buffer = new PassThrough({ highWaterMark: 32 << 20 });
    dl.proc.stdout.on('error', () => undefined);
    buffer.on('error', () => undefined);
    if (info.passthrough && this.volume === 100 && seekSec === 0) {
      dl.proc.stdout.pipe(buffer);
      return { dl, ff: null, output: buffer as Readable, type: StreamType.WebmOpus };
    }
    const ffmpegBin = await findFfmpeg();
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      ...(seekSec > 0 ? ['-ss', String(Math.floor(seekSec))] : []),
      '-i',
      'pipe:0',
      '-vn',
      '-af',
      `volume=${(this.volume / 100).toFixed(2)}`,
      '-c:a',
      'libopus',
      '-b:a',
      '160k',
      '-ar',
      '48000',
      '-ac',
      '2',
      '-application',
      'audio',
      '-frame_duration',
      '20',
      '-f',
      'ogg',
      'pipe:1',
    ];
    const ff = spawn(ffmpegBin, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    // Killing one side on skip/stop must not crash the other with a "broken pipe".
    ff.stdin.on('error', () => undefined);
    dl.proc.stdout.pipe(buffer).pipe(ff.stdin);
    return { dl, ff, output: ff.stdout as Readable, type: StreamType.OggOpus };
  }

  /** Watches the helper programs; any real failure marks the current song as broken. */
  private watch(dl: AudioDownload, ff: ChildProcessByStdio<Writable, Readable, Readable> | null): void {
    let dlErr = '';
    dl.proc.stderr.on('data', (d: Buffer) => {
      if (dlErr.length < 2000) dlErr += d.toString('utf8');
    });
    dl.proc.on('error', (err) => log.warn('MUSIC_DOWNLOAD_ERROR', { guild: this.guild.id }, err));
    dl.proc.on('close', (code, signal) => {
      if (this.download !== dl || signal === 'SIGKILL' || code === 0) return;
      this.streamFailed = true;
      log.warn('MUSIC_DOWNLOAD_FAILED', {
        guild: this.guild.id,
        code: code ?? 'none',
        error: dlErr.slice(-300),
      });
    });
    if (!ff) return;
    let ffErr = '';
    ff.stderr.on('data', (d: Buffer) => {
      if (ffErr.length < 2000) ffErr += d.toString('utf8');
    });
    ff.on('error', (err) => log.warn('MUSIC_FFMPEG_ERROR', { guild: this.guild.id }, err));
    ff.on('close', (code, signal) => {
      if (this.ffmpeg !== ff || signal === 'SIGKILL' || code === 0) return;
      this.streamFailed = true;
      log.warn('MUSIC_FFMPEG_EXIT', { guild: this.guild.id, code: code ?? 'none', error: ffErr.slice(-300) });
    });
  }

  /** Plays the queue's current track from `seekSec`. Failed songs are skipped with a notice. */
  async playCurrent(seekSec = 0, newTrack = false): Promise<void> {
    if (this.destroyed) return;
    const token = ++this.playToken;
    const track = this.queue.current;
    if (!track) return this.onQueueEnd();
    this.stopStream();
    if (newTrack) {
      this.votes.clear();
      this.setStatus('loading', null);
    }
    try {
      const info = await this.streamFor(track);
      if (token !== this.playToken || this.destroyed) return;
      const { dl, ff, output, type } = await this.spawnPipeline(info, seekSec);
      if (token !== this.playToken || this.destroyed) {
        dl.proc.kill('SIGKILL');
        ff?.kill('SIGKILL');
        return;
      }
      this.download = dl;
      this.ffmpeg = ff;
      this.streamFailed = false;
      this.watch(dl, ff);
      const resource = createAudioResource(output, { inputType: type, metadata: track });
      this.resource = resource;
      this.offsetSec = seekSec;
      this.audio.play(resource);
      if (this.autoPaused || this.listeners() === 0) {
        this.audio.pause();
        this.autoPaused = true;
        this.setStatus('paused', 'Paused: everyone left the voice channel.', false);
      } else {
        this.setStatus('playing', null, false);
      }
      if (newTrack) await this.postPanel();
      else void this.refreshPanel();
      this.prefetchNext();
      this.scheduleSave();
    } catch (err) {
      if (token !== this.playToken || this.destroyed) return;
      this.failures++;
      const why = err instanceof DomainError ? err.message : 'It could not be loaded.';
      if (!(err instanceof DomainError))
        log.error('MUSIC_PLAY_FAILED', { guild: this.guild.id, track: track.title }, err);
      await this.say(`Skipped **${track.title.slice(0, 80)}**: ${why}`);
      if (this.failures >= MAX_FAILURES_IN_A_ROW) {
        this.failures = 0;
        await this.say(
          `Stopped: ${MAX_FAILURES_IN_A_ROW} songs in a row could not be played. YouTube may be refusing the bot right now.`,
        );
        this.queue.clear();
        this.queue.advance(true);
        return this.onQueueEnd();
      }
      this.queue.advance(true);
      return this.playCurrent(0, true);
    }
  }

  private async onTrackEnd(): Promise<void> {
    const track = this.queue.current;
    const played = this.resource ? this.resource.playbackDuration : 0;
    const crashed = this.streamFailed;
    this.resource = null;
    // The stream broke (expired details, network, YouTube hiccup): retry the same song once,
    // from where it stopped, with fresh details.
    if (track && crashed && !this.retried.has(track.id)) {
      this.retried.add(track.id);
      this.streams.delete(track.id);
      log.warn('MUSIC_STREAM_RETRY', { guild: this.guild.id, track: track.title });
      return this.playCurrent(this.positionAfter(played), false);
    }
    if (track && crashed) {
      this.failures++;
      await this.say(`Skipped **${track.title.slice(0, 80)}**: it could not be streamed.`);
    } else this.failures = 0;
    if (this.failures >= MAX_FAILURES_IN_A_ROW) {
      this.failures = 0;
      await this.say('Stopped: several songs in a row failed to play.');
      this.queue.clear();
      this.queue.advance(true);
      return this.onQueueEnd();
    }
    const next = this.queue.advance();
    if (next) return this.playCurrent(0, true);
    return this.onQueueEnd();
  }

  private positionAfter(playedMs: number): number {
    return this.offsetSec + playedMs / 1000;
  }

  private async onQueueEnd(): Promise<void> {
    this.stopStream();
    this.audio.stop(true);
    this.setStatus('ended', null, false);
    await this.postPanel();
    if (this.stay247) this.scheduleSave();
    else {
      await deleteSession(this.guild.id).catch(() => undefined);
      this.armLeave(QUEUE_END_LEAVE_MS, 'queue finished');
    }
  }

  private prefetchNext(): void {
    const next =
      this.queue.loop === 'track'
        ? null
        : (this.queue.upcoming[0] ?? (this.queue.loop === 'queue' ? this.queue.tracks[0] : null));
    if (!next) return;
    setTimeout(() => {
      if (this.destroyed) return;
      void this.streamFor(next).catch(() => undefined);
    }, 5_000);
  }

  // ───── Controls (callers check permissions first) ─────

  pause(): void {
    if (this.status !== 'playing')
      throw new DomainError('NOT_PLAYING', 'Nothing is playing.', 'Nothing to pause');
    this.audio.pause();
    this.autoPaused = false;
    this.setStatus('paused', null);
  }

  resume(): void {
    if (this.status !== 'paused')
      throw new DomainError('NOT_PAUSED', 'The music is not paused.', 'Nothing to resume');
    this.audio.unpause();
    this.autoPaused = false;
    this.setStatus('playing', null);
  }

  togglePause(): void {
    if (this.status === 'paused') this.resume();
    else this.pause();
  }

  async skip(): Promise<Track | null> {
    const skipped = this.queue.current;
    if (!skipped || this.status === 'ended')
      throw new DomainError('NOT_PLAYING', 'Nothing is playing.', 'Nothing to skip');
    this.stopStream();
    this.audio.stop(true);
    const next = this.queue.advance(true);
    if (next) await this.playCurrent(0, true);
    else await this.onQueueEnd();
    return skipped;
  }

  async back(): Promise<Track> {
    const prev = this.queue.back();
    if (!prev)
      throw new DomainError(
        'NO_PREVIOUS',
        'There is no earlier song in this queue.',
        'Nothing to go back to',
      );
    await this.playCurrent(0, true);
    return prev;
  }

  async jumpTo(trackId: string): Promise<Track> {
    const pos = this.queue.upcoming.findIndex((t) => t.id === trackId);
    if (pos < 0) throw new DomainError('STALE', 'That song is no longer in the queue.', 'Not in the queue');
    const t = this.queue.jump(pos + 1)!;
    await this.playCurrent(0, true);
    return t;
  }

  async jump(position: number): Promise<Track> {
    const t = this.queue.jump(position);
    if (!t)
      throw new DomainError('BAD_POSITION', `There is no song at position ${position}.`, 'Not in the queue');
    await this.playCurrent(0, true);
    return t;
  }

  async seek(sec: number): Promise<void> {
    const t = this.playing;
    if (!t) throw new DomainError('NOT_PLAYING', 'Nothing is playing.', 'Nothing to seek');
    if (t.durationSec <= 0) throw new DomainError('LIVE', "You can't seek in a live stream.", 'Not possible');
    if (sec < 0 || sec >= t.durationSec) {
      throw new DomainError(
        'BAD_TIME',
        `This song is only ${Math.floor(t.durationSec / 60)}:${String(t.durationSec % 60).padStart(2, '0')} long.`,
        'Out of range',
      );
    }
    await this.playCurrent(sec, false);
  }

  /** Changes volume; the stream restarts once, shortly after the last change (debounced). */
  setVolume(v: number): number {
    this.volume = Math.max(0, Math.min(150, Math.round(v)));
    if (this.volumeTimer) clearTimeout(this.volumeTimer);
    this.volumeTimer = setTimeout(() => {
      this.volumeTimer = null;
      if (this.resource && (this.status === 'playing' || this.status === 'paused')) {
        const wasPaused = this.status === 'paused';
        void this.playCurrent(this.positionSec(), false).then(() => {
          if (wasPaused && this.status === 'playing') this.pause();
        });
      }
    }, 900);
    void this.refreshPanel();
    this.scheduleSave();
    return this.volume;
  }

  shuffle(): void {
    if (this.queue.upcoming.length < 2)
      throw new DomainError('TOO_FEW', 'Add at least two songs to shuffle.', 'Nothing to shuffle');
    this.queue.shuffle();
    void this.refreshPanel();
    this.prefetchNext();
    this.scheduleSave();
  }

  cycleLoop(): string {
    const mode = this.queue.cycleLoop();
    void this.refreshPanel();
    this.scheduleSave();
    return mode;
  }

  setLoop(mode: 'off' | 'track' | 'queue'): void {
    this.queue.loop = mode;
    void this.refreshPanel();
    this.scheduleSave();
  }

  changed(): void {
    void this.refreshPanel();
    this.prefetchNext();
    this.scheduleSave();
  }

  set247(on: boolean): void {
    this.stay247 = on;
    if (on) this.clearLeave();
    else if (this.listeners() === 0) this.armLeave(EMPTY_LEAVE_MS, 'channel empty');
    else if (this.status === 'ended') this.armLeave(QUEUE_END_LEAVE_MS, 'queue finished');
    void this.refreshPanel();
  }

  // ───── Panel ─────

  private setStatus(status: PanelStatus, note: string | null, refresh = true): void {
    this.status = status;
    this.note = note;
    if (refresh) void this.refreshPanel();
    this.scheduleSave();
  }

  panelState(): PanelState {
    return {
      status: this.status,
      track: this.queue.current,
      positionSec: this.positionSec(),
      volume: this.volume,
      loop: this.queue.loop,
      upcoming: this.queue.upcoming,
      upcomingSec: this.queue.upcomingSeconds(),
      stay247: this.stay247,
      voiceChannelId: this.voiceChannelId,
      note: this.note,
    };
  }

  async panelPayload() {
    const theme = themeFor(await getConfig(this.guild.id), this.guild.client);
    const s = this.panelState();
    return {
      embeds: [nowPlayingEmbed(theme, s)],
      components: playerButtons(s),
      allowedMentions: { parse: [] },
    };
  }

  private textChannel(): GuildTextBasedChannel | null {
    if (!this.textChannelId) return null;
    const ch = this.guild.channels.cache.get(this.textChannelId);
    return ch && ch.isTextBased() ? (ch as GuildTextBasedChannel) : null;
  }

  /**
   * Shows the panel at the bottom of the chat: edited in place if it is still the latest message,
   * otherwise re-posted (and the old one deleted) so the buttons are always easy to reach.
   */
  async postPanel(force = false): Promise<void> {
    const ch = this.textChannel();
    if (!ch || this.destroyed) return;
    if (!force && this.panel && ch.lastMessageId === this.panel.id) {
      await this.refreshPanel();
      if (this.panel) return;
    }
    const old = this.panel;
    this.panel = null;
    try {
      this.panel = await ch.send(await this.panelPayload());
    } catch (err) {
      log.warn('MUSIC_PANEL_FAILED', { guild: this.guild.id }, err);
    }
    if (old) await old.delete().catch(() => undefined);
  }

  async refreshPanel(): Promise<void> {
    if (!this.panel) return;
    await this.panel.edit(await this.panelPayload()).catch(() => {
      this.panel = null;
    });
  }

  /** Called when a panel button was pressed on this exact message. */
  isPanel(messageId: string): boolean {
    return this.panel?.id === messageId;
  }

  async say(text: string): Promise<void> {
    const ch = this.textChannel();
    if (!ch) return;
    await ch.send({ content: text, allowedMentions: { parse: [] } }).catch(() => undefined);
  }

  // ───── Saving & leaving ─────

  scheduleSave(): void {
    if (this.saveDebounce) clearTimeout(this.saveDebounce);
    this.saveDebounce = setTimeout(() => void this.save(), 3_000);
  }

  async save(): Promise<void> {
    if (this.destroyed || (this.status === 'ended' && !this.stay247)) return;
    await saveSession({
      guildId: this.guild.id,
      voiceChannelId: this.voiceChannelId,
      textChannelId: this.textChannelId,
      tracks: this.queue.tracks.slice(Math.max(0, this.queue.index - 20)),
      index: Math.min(this.queue.index, 20),
      loop: this.queue.loop,
      positionSec: this.positionSec(),
      paused: this.status === 'paused' && !this.autoPaused,
      volume: this.volume,
    }).catch((err: unknown) => log.warn('MUSIC_SAVE_FAILED', { guild: this.guild.id }, err));
  }

  /**
   * Leaves the channel and forgets the player. `forget` = also delete the saved session (true for
   * stop/leave; false when the bot is shutting down so it can resume on the next start).
   */
  destroy(why: string, forget = true): void {
    if (this.destroyed) return;
    this.destroyed = true;
    players.delete(this.guild.id);
    for (const t of [this.panelTimer, this.saveTimer, this.leaveTimer, this.volumeTimer, this.saveDebounce]) {
      if (t) clearTimeout(t);
    }
    this.stopStream();
    this.audio.stop(true);
    if (this.connection.state.status !== VoiceConnectionStatus.Destroyed) this.connection.destroy();
    log.info('MUSIC_LEFT', { guild: this.guild.id, reason: why });
    if (forget) {
      void deleteSession(this.guild.id).catch(() => undefined);
      const panel = this.panel;
      if (panel) {
        void themeForPanel(this).then((payload) => panel.edit(payload).catch(() => undefined));
      }
    }
  }

  /** Shutdown: save where every server was, without deleting it, then leave. */
  async shutdown(): Promise<void> {
    await this.save();
    this.destroy('bot shutting down', false);
  }
}

async function themeForPanel(p: GuildPlayer) {
  const theme = themeFor(await getConfig(p.guild.id), p.guild.client);
  const s = { ...p.panelState(), status: 'stopped' as const, upcoming: [] };
  return { embeds: [nowPlayingEmbed(theme, s)], components: [], allowedMentions: { parse: [] } };
}

/** Restores a saved queue into a freshly connected player (used after a restart). */
export function restoreQueue(
  p: GuildPlayer,
  snap: { tracks: Track[]; index: number; loop: 'off' | 'track' | 'queue' },
): void {
  p.queue.tracks.splice(0, p.queue.tracks.length, ...snap.tracks);
  p.queue.index = Math.min(Math.max(0, snap.index), Math.max(0, snap.tracks.length - 1));
  p.queue.loop = snap.loop;
}
