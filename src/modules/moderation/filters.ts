/** Pure helpers for /purge and /role everyone — no discord.js types, so they are easy to test. */

export interface PurgeFilter {
  userId?: string | null;
  botsOnly?: boolean;
  attachmentsOnly?: boolean;
  contains?: string | null;
}

export interface PurgeCandidate {
  authorId: string;
  authorIsBot: boolean;
  hasAttachments: boolean;
  content: string;
  pinned: boolean;
  createdAt: Date;
}

/** Discord only bulk-deletes messages younger than 14 days (we keep a small safety margin). */
export const BULK_DELETE_MAX_AGE_MS = 14 * 86400_000 - 60_000;

export type PurgeVerdict = 'delete' | 'skip' | 'too-old';

export function purgeVerdict(m: PurgeCandidate, f: PurgeFilter, now = Date.now()): PurgeVerdict {
  if (m.pinned) return 'skip';
  if (f.userId && m.authorId !== f.userId) return 'skip';
  if (f.botsOnly && !m.authorIsBot) return 'skip';
  if (f.attachmentsOnly && !m.hasAttachments) return 'skip';
  if (f.contains && !m.content.toLowerCase().includes(f.contains.toLowerCase())) return 'skip';
  if (now - m.createdAt.getTime() > BULK_DELETE_MAX_AGE_MS) return 'too-old';
  return 'delete';
}

export function describePurgeFilter(f: PurgeFilter): string {
  const parts: string[] = [];
  if (f.userId) parts.push(`from <@${f.userId}>`);
  if (f.botsOnly) parts.push('from bots');
  if (f.attachmentsOnly) parts.push('with attachments');
  if (f.contains) parts.push(`containing “${f.contains.slice(0, 50)}”`);
  return parts.length > 0 ? parts.join(', ') : 'any message';
}

export interface MassRoleMember {
  id: string;
  isBot: boolean;
  hasRole: boolean;
}

export interface MassRolePlan {
  todo: string[];
  already: number;
  skippedBots: number;
}

/** Who a "role for everyone" run will touch. `give` = add the role, otherwise remove it. */
export function planMassRole(
  members: readonly MassRoleMember[],
  opts: { give: boolean; includeBots: boolean },
): MassRolePlan {
  const plan: MassRolePlan = { todo: [], already: 0, skippedBots: 0 };
  for (const m of members) {
    if (m.hasRole === opts.give) {
      plan.already++;
      continue;
    }
    if (m.isBot && !opts.includeBots) {
      plan.skippedBots++;
      continue;
    }
    plan.todo.push(m.id);
  }
  return plan;
}
