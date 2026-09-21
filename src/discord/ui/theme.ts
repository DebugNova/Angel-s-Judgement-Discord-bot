import { EmbedBuilder } from 'discord.js';
import type { MatchStatus } from '@prisma/client';
import { Brand } from './lore.js';

export const BOT_VERSION = '1.0.0';
export const BRAND = Brand.author;
export const FOOTER = Brand.footer;
export const DIVIDER = '━━━━━━━━━━━━━━━━━━━━';

/** Heavenly gold for glory, celestial blue for battle, hellfire crimson for conflict. */
export const Colors = {
  brand: 0xd4af37,
  ivory: 0xe8dcc0,
  pending: 0xf1c40f,
  active: 0x5dade2,
  completed: 0xd4af37,
  disputed: 0xc0392b,
  review: 0x8e44ad,
  cancelled: 0x4f545c,
  danger: 0xc0392b,
  success: 0x57a773,
} as const;

export interface Theme {
  emojis: boolean;
  iconURL: string | null;
}

/** Prefix text with an emoji only when the server has emojis enabled. */
export function e(theme: Theme, emoji: string, text: string): string {
  return theme.emojis ? `${emoji} ${text}` : text;
}

const STATUS: Record<MatchStatus, { emoji: string; label: string; color: number }> = {
  PENDING: { emoji: '🟡', label: 'Pending', color: Colors.pending },
  ACCEPTED: { emoji: '🔵', label: 'Starting', color: Colors.active },
  ACTIVE: { emoji: '🔵', label: 'Active', color: Colors.active },
  RESULT_PENDING: { emoji: '🟡', label: 'Result Pending', color: Colors.pending },
  DISPUTED: { emoji: '🔴', label: 'Disputed', color: Colors.disputed },
  UNDER_REVIEW: { emoji: '🟣', label: 'Under Review', color: Colors.review },
  COMPLETED: { emoji: '🟢', label: 'Completed', color: Colors.completed },
  CANCELLED: { emoji: '⚫', label: 'Cancelled', color: Colors.cancelled },
  EXPIRED: { emoji: '⚫', label: 'Expired', color: Colors.cancelled },
};

export function statusLabel(theme: Theme, status: MatchStatus): string {
  const s = STATUS[status];
  return e(theme, s.emoji, s.label);
}

export function statusColor(status: MatchStatus): number {
  return STATUS[status].color;
}

/** Every embed shares the same frame: brand author line, footer and timestamp. */
export function baseEmbed(theme: Theme, color: number = Colors.brand): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: BRAND, ...(theme.iconURL ? { iconURL: theme.iconURL } : {}) })
    .setFooter({ text: FOOTER, ...(theme.iconURL ? { iconURL: theme.iconURL } : {}) })
    .setTimestamp(new Date());
}

export function lore(text: string): string {
  return `*${text}*`;
}

export function ts(date: Date, style: 'R' | 'F' | 'f' | 'D' | 'd' | 't' = 'f'): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}

export function user(discordId: string): string {
  return `<@${discordId}>`;
}

export function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

export function num(n: number): string {
  return n.toLocaleString('en-US');
}

/** Angelic choir by rating — flavour only, derived live from ELO. */
export function choir(elo: number): string {
  if (elo >= 1600) return 'Seraphim';
  if (elo >= 1400) return 'Cherubim';
  if (elo >= 1250) return 'Thrones';
  if (elo >= 1100) return 'Dominions';
  if (elo >= 1000) return 'Virtues';
  if (elo >= 900) return 'Powers';
  return 'The Fallen';
}

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${num(n)} ${n === 1 ? word : pluralWord}`;
}
