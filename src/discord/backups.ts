import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { AttachmentBuilder, ChannelType, PermissionFlagsBits } from 'discord.js';
import type { Client, TextChannel } from 'discord.js';
import { log } from '../core/logger.js';
import { describeBackup, exportAll, pruneBackups, writeBackupFile } from '../database/backup.js';
import { runtimeEnv } from './context.js';

export const AUTO_BACKUP_DIR = 'backups/auto';
const FIRST_RUN_DELAY_MS = 2 * 60_000;
/** Discord's upload limit for bots is 10 MB; stay safely under it. */
const MAX_UPLOAD_BYTES = 9_500_000;

let timer: NodeJS.Timeout | null = null;
let running = false;
let lastHash: string | null = null;

/**
 * Saves a backup to `backups/auto/` (and posts it to BACKUP_CHANNEL_ID, if set) whenever the data
 * changed since the last one. Returns the file written, or null when nothing changed.
 */
export async function runAutoBackup(client: Client, force = false): Promise<string | null> {
  if (running) return null;
  running = true;
  try {
    const env = runtimeEnv();
    const data = await exportAll();
    const hash = createHash('sha256').update(JSON.stringify(data.tables)).digest('hex');
    if (!force && hash === lastHash) return null;

    const file = writeBackupFile(AUTO_BACKUP_DIR, data);
    lastHash = hash;
    pruneBackups(AUTO_BACKUP_DIR, env.BACKUP_KEEP);
    log.info('BACKUP_SAVED', { file: basename(file), rows: describeBackup(data) });

    if (env.BACKUP_CHANNEL_ID) await uploadBackup(client, env.BACKUP_CHANNEL_ID, file, data.createdAt);
    return file;
  } finally {
    running = false;
  }
}

async function uploadBackup(
  client: Client,
  channelId: string,
  file: string,
  createdAt: string,
): Promise<void> {
  // force: always read the channel's current permissions from Discord, never a stale cached copy.
  const channel = await client.channels.fetch(channelId, { force: true }).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) {
    log.warn('BACKUP_CHANNEL_UNAVAILABLE', { channel: channelId });
    return;
  }
  // Backups hold private server links and evidence (Rule 8): never post them where members can read.
  if (!backupChannelIsPrivate(channel)) {
    log.error('BACKUP_CHANNEL_NOT_PRIVATE', {
      channel: `#${channel.name}`,
      fix: 'Make the channel private (deny View Channel for @everyone); backups are still saved on disk',
    });
    return;
  }
  const data = readFileSync(file);
  if (data.length > MAX_UPLOAD_BYTES) {
    log.warn('BACKUP_TOO_LARGE_TO_UPLOAD', { bytes: data.length, file: basename(file) });
    return;
  }
  await channel.send({
    content: `Backup <t:${Math.floor(Date.parse(createdAt) / 1000)}:f> · restore with \`npm run db:restore -- <file> --yes\``,
    files: [new AttachmentBuilder(data, { name: basename(file) })],
    allowedMentions: { parse: [] },
  });
}

/** True when @everyone cannot see the channel. */
export function backupChannelIsPrivate(channel: TextChannel): boolean {
  return !channel.permissionsFor(channel.guild.roles.everyone).has(PermissionFlagsBits.ViewChannel);
}

export function startAutoBackups(client: Client): void {
  const minutes = runtimeEnv().BACKUP_INTERVAL_MINUTES;
  if (timer || minutes === 0) return;
  const tick = () =>
    void runAutoBackup(client).catch((err: unknown) => log.error('BACKUP_FAILED', undefined, err));
  timer = setTimeout(() => {
    tick();
    timer = setInterval(tick, minutes * 60_000);
  }, FIRST_RUN_DELAY_MS);
}

export function stopAutoBackups(): void {
  if (timer) clearTimeout(timer); // also clears the interval once it has replaced the first timeout
  timer = null;
}
