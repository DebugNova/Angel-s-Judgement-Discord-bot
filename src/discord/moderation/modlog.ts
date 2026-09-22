import type { Client } from 'discord.js';
import { log } from '../../core/logger.js';
import { AuditAction, auditEvents } from '../../modules/audit/audit.service.js';
import type { AuditEntry } from '../../modules/audit/audit.service.js';
import { getConfig } from '../../modules/configuration/config.service.js';
import { getCaseById } from '../../modules/moderation/cases.service.js';
import { themeFor } from '../context.js';
import { sendableChannel } from '../managers/notify.js';
import { caseEmbed, warningRemovedEmbed } from '../ui/moderation.js';

const queues = new Map<string, Promise<void>>();

/**
 * Posts a full case card for every moderation case to the mod-log channel (or, if none is set,
 * the normal log channel). Runs in order per server, like the audit mirror.
 */
export function startModLog(client: Client): void {
  auditEvents.on('entry', (entry: AuditEntry) => {
    if (entry.action !== AuditAction.MOD_CASE && entry.action !== AuditAction.MOD_WARNING_REMOVED) return;
    const caseId = entry.metadata?.caseId;
    if (typeof caseId !== 'string') return;
    const prev = queues.get(entry.guildId) ?? Promise.resolve();
    const next = prev
      .then(async () => {
        const [config, c] = await Promise.all([getConfig(entry.guildId), getCaseById(caseId)]);
        if (!c) return;
        const channel = await sendableChannel(
          client,
          entry.guildId,
          config.modLogChannelId ?? config.logChannelId,
        );
        if (!channel) return;
        const theme = themeFor(config, client);
        await channel.send({
          embeds: [
            entry.action === AuditAction.MOD_CASE ? caseEmbed(theme, c) : warningRemovedEmbed(theme, c),
          ],
          allowedMentions: { parse: [] },
        });
      })
      .catch((err: unknown) =>
        log.warn('MOD_LOG_FAILED', { guild: entry.guildId, case: String(entry.metadata?.case) }, err),
      );
    queues.set(entry.guildId, next);
  });
}
