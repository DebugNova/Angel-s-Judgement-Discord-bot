/** Music start-up (resume what was playing), voice events, daily yt-dlp update, and shutdown. */
import { Events } from 'discord.js';
import type { Client } from 'discord.js';
import { log } from '../../core/logger.js';
import { getConfig } from '../../modules/configuration/config.service.js';
import { deleteSession, loadSessions } from '../../modules/music/store.service.js';
import { updateYtdlpIfOld, ytdlp } from '../../modules/music/tools.js';
import { GuildPlayer, allPlayers, getPlayer, restoreQueue } from './player.js';

/** Sessions older than this are not resumed (the bot was off for a long time). */
const RESUME_WITHIN_MS = 2 * 3600_000;
let updater: NodeJS.Timeout | null = null;

export function registerMusicEvents(client: Client): void {
  client.on(Events.VoiceStateUpdate, (old, now) => {
    try {
      getPlayer(now.guild.id)?.onVoiceStateUpdate(old, now);
    } catch (err) {
      log.warn('MUSIC_VOICE_STATE_FAILED', { guild: now.guild.id }, err);
    }
  });
}

/** Called once the bot is ready: get yt-dlp, keep it fresh, and resume interrupted music. */
export async function startMusic(client: Client<true>): Promise<void> {
  void ytdlp()
    .then(() => updateYtdlpIfOld())
    .catch(() => undefined);
  updater ??= setInterval(() => void updateYtdlpIfOld().catch(() => undefined), 6 * 3600_000);
  await resumeSessions(client).catch((err: unknown) => log.error('MUSIC_RESUME_FAILED', undefined, err));
}

async function resumeSessions(client: Client<true>): Promise<void> {
  for (const s of await loadSessions()) {
    const guild = client.guilds.cache.get(s.guildId);
    const fresh = s.updatedAt && Date.now() - s.updatedAt.getTime() < RESUME_WITHIN_MS;
    const channel = guild?.channels.cache.get(s.voiceChannelId);
    if (!guild || !fresh || !channel?.isVoiceBased() || s.tracks.length === 0) {
      await deleteSession(s.guildId);
      continue;
    }
    const cfg = await getConfig(guild.id);
    const listeners = channel.members.filter((m) => !m.user.bot).size;
    if (listeners === 0 && !cfg.music247) {
      await deleteSession(s.guildId);
      continue;
    }
    try {
      const p = await GuildPlayer.connect(guild, channel, s.textChannelId);
      restoreQueue(p, s);
      p.volume = s.volume;
      await p.playCurrent(s.positionSec, true);
      if (s.paused && !p.isPaused) p.pause();
      log.info('MUSIC_RESUMED', { guild: guild.id, track: p.playing?.title ?? '', at: s.positionSec });
    } catch (err) {
      log.warn('MUSIC_RESUME_GUILD_FAILED', { guild: s.guildId }, err);
      await deleteSession(s.guildId).catch(() => undefined);
    }
  }
}

/** Bot shutting down (update/restart): remember every queue and position, then leave cleanly. */
export async function shutdownMusic(): Promise<void> {
  if (updater) clearInterval(updater);
  updater = null;
  await Promise.all(allPlayers().map((p) => p.shutdown().catch(() => undefined)));
}
