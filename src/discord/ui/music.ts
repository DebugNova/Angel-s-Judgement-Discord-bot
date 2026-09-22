/** Music screens: plain and professional (text buttons, no emojis), in the bot's gold frame. */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
import type { EmbedBuilder } from 'discord.js';
import type { LoopMode, Track } from '../../modules/music/queue.js';
import type { SearchResult } from '../../modules/music/resolver.js';
import { formatTime } from '../../modules/music/sources.js';
import { Ids } from '../ids.js';
import { MusicLore } from './lore.js';
import { Colors, baseEmbed, lore, ts, user } from './theme.js';
import type { Theme } from './theme.js';

export type PanelStatus = 'playing' | 'paused' | 'loading' | 'ended' | 'stopped';

export interface PanelState {
  status: PanelStatus;
  track: Track | null;
  positionSec: number;
  volume: number;
  loop: LoopMode;
  upcoming: Track[];
  upcomingSec: number;
  stay247: boolean;
  voiceChannelId: string | null;
  /** A short line under the title, e.g. "Paused: everyone left the channel". */
  note?: string | null;
}

const LOOP_LABEL: Record<LoopMode, string> = { off: 'Off', track: 'Song', queue: 'Queue' };

function link(t: Track): string {
  const title = t.title.replace(/[[\]]/g, '').slice(0, 90);
  const url = t.displayUrl ?? t.url;
  return url ? `[${title}](${url})` : title;
}

export function progressBar(positionSec: number, durationSec: number, width = 18): string {
  if (durationSec <= 0) return `\`LIVE\`  ${formatTime(positionSec)}`;
  const ratio = Math.min(1, Math.max(0, positionSec / durationSec));
  const at = Math.min(width - 1, Math.round(ratio * (width - 1)));
  const bar = '━'.repeat(at) + '●' + '─'.repeat(width - 1 - at);
  return `\`${formatTime(positionSec)}\` ${bar} \`${formatTime(durationSec)}\``;
}

export function nowPlayingEmbed(theme: Theme, s: PanelState): EmbedBuilder {
  const titles: Record<PanelStatus, string> = {
    playing: 'Now Playing',
    paused: 'Paused',
    loading: 'Loading',
    ended: 'Queue Finished',
    stopped: 'Music Stopped',
  };
  const color =
    s.status === 'playing'
      ? Colors.brand
      : s.status === 'paused' || s.status === 'loading'
        ? Colors.pending
        : Colors.cancelled;
  const embed = baseEmbed(theme, color).setTitle(titles[s.status]);
  const t = s.track;
  if (!t || s.status === 'ended' || s.status === 'stopped') {
    return embed.setDescription(
      [s.note ?? '', lore(s.status === 'stopped' ? MusicLore.stopped : MusicLore.queueEnd)]
        .filter(Boolean)
        .join('\n\n'),
    );
  }
  const lines = [`**${link(t)}**`];
  if (t.author) lines.push(`by ${t.author.slice(0, 80)}`);
  lines.push('', progressBar(s.positionSec, t.durationSec));
  if (s.status === 'playing' && t.durationSec > 0) {
    const ends = new Date(Date.now() + Math.max(0, t.durationSec - s.positionSec) * 1000);
    lines.push(`Ends ${ts(ends, 'R')}`);
  }
  if (s.note) lines.push('', s.note);
  embed.setDescription(lines.join('\n'));
  const next = s.upcoming[0];
  embed.addFields(
    { name: 'Requested by', value: user(t.requesterId), inline: true },
    { name: 'Volume', value: `${s.volume}%`, inline: true },
    { name: 'Loop', value: LOOP_LABEL[s.loop], inline: true },
    {
      name: 'Up next',
      value: next
        ? `${link(next)}${s.upcoming.length > 1 ? `\n+${s.upcoming.length - 1} more · ${formatTime(s.upcomingSec)} total` : ''}`
        : 'Nothing queued',
    },
  );
  if (s.voiceChannelId)
    embed.addFields({
      name: 'Channel',
      value: `<#${s.voiceChannelId}>${s.stay247 ? ' · 24/7' : ''}`,
      inline: true,
    });
  if (t.source === 'spotify')
    embed.addFields({ name: 'Source', value: 'Spotify (played from YouTube)', inline: true });
  if (t.thumbnail) embed.setThumbnail(t.thumbnail);
  return embed.setFooter({
    text: MusicLore.nowPlaying,
    ...(theme.iconURL ? { iconURL: theme.iconURL } : {}),
  });
}

function btn(action: string, label: string, style = ButtonStyle.Secondary, disabled = false): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(Ids.music.control(action))
    .setLabel(label)
    .setStyle(style)
    .setDisabled(disabled);
}

export function playerButtons(s: PanelState) {
  const idle = s.status === 'ended' || s.status === 'stopped';
  if (s.status === 'stopped') return [];
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      btn('back', 'Back', ButtonStyle.Secondary, idle),
      btn('toggle', s.status === 'paused' ? 'Resume' : 'Pause', ButtonStyle.Primary, idle),
      btn('skip', 'Skip', ButtonStyle.Secondary, idle),
      btn('stop', 'Stop', ButtonStyle.Danger),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      btn('shuffle', 'Shuffle', ButtonStyle.Secondary, idle || s.upcoming.length < 2),
      btn('loop', `Loop: ${LOOP_LABEL[s.loop]}`),
      btn('vdown', 'Vol −', ButtonStyle.Secondary, s.volume <= 0),
      btn('vup', 'Vol +', ButtonStyle.Secondary, s.volume >= 150),
      btn('queue', 'Queue'),
    ),
  ];
}

export const QUEUE_PAGE = 10;

export function queueEmbed(
  theme: Theme,
  q: { current: Track | null; upcoming: Track[]; upcomingSec: number; loop: LoopMode },
  page: number,
): EmbedBuilder {
  const pages = Math.max(1, Math.ceil(q.upcoming.length / QUEUE_PAGE));
  const p = Math.min(Math.max(0, page), pages - 1);
  const rows = q.upcoming
    .slice(p * QUEUE_PAGE, p * QUEUE_PAGE + QUEUE_PAGE)
    .map(
      (t, k) =>
        `\`${p * QUEUE_PAGE + k + 1}.\` ${link(t)} · ${t.durationSec > 0 ? formatTime(t.durationSec) : '?'} · ${user(t.requesterId)}`,
    );
  return baseEmbed(theme, Colors.brand)
    .setTitle(
      `Queue · ${q.upcoming.length} song${q.upcoming.length === 1 ? '' : 's'} · ${formatTime(q.upcomingSec)}`,
    )
    .setDescription(
      [
        q.current ? `**Now:** ${link(q.current)}` : '**Now:** nothing',
        '',
        rows.length > 0 ? rows.join('\n') : '*Nothing queued. Add songs with /play.*',
      ]
        .join('\n')
        .slice(0, 4000),
    )
    .setFooter({ text: `Page ${p + 1} / ${pages} · Loop: ${LOOP_LABEL[q.loop]}` });
}

export function queueComponents(upcoming: Track[], page: number, owner: string) {
  const pages = Math.max(1, Math.ceil(upcoming.length / QUEUE_PAGE));
  const p = Math.min(Math.max(0, page), pages - 1);
  const rows: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];
  const slice = upcoming.slice(p * QUEUE_PAGE, p * QUEUE_PAGE + QUEUE_PAGE);
  if (slice.length > 0) {
    rows.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(Ids.music.queueJump(owner))
          .setPlaceholder('Play one of these now…')
          .addOptions(
            slice.map((t, k) => ({
              label: `${p * QUEUE_PAGE + k + 1}. ${t.title}`.slice(0, 100),
              description: (t.author || 'Unknown').slice(0, 100),
              value: t.id,
            })),
          ),
      ),
    );
  }
  if (pages > 1) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(Ids.music.queuePage(p - 1, owner))
          .setLabel('Previous')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(p <= 0),
        new ButtonBuilder()
          .setCustomId(`noop:${Ids.music.queuePage(p, owner)}`)
          .setLabel(`Page ${p + 1} / ${pages}`)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId(Ids.music.queuePage(p + 1, owner))
          .setLabel('Next')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(p >= pages - 1),
      ),
    );
  }
  return rows;
}

export function addedEmbed(
  theme: Theme,
  opts: { tracks: Track[]; listName?: string | null; position: number; startsNow: boolean; cut?: number },
): EmbedBuilder {
  const first = opts.tracks[0]!;
  const embed = baseEmbed(theme, Colors.brand);
  if (opts.tracks.length === 1 && !opts.listName) {
    const lines = [`**${link(first)}**`];
    if (first.author) lines.push(`by ${first.author.slice(0, 80)}`);
    lines.push(
      '',
      `Length **${first.durationSec > 0 ? formatTime(first.durationSec) : 'live'}**${opts.startsNow ? '' : ` · Position **${opts.position}** in the queue`}`,
    );
    embed.setTitle(opts.startsNow ? 'Now Playing' : 'Added to Queue').setDescription(lines.join('\n'));
    if (first.thumbnail) embed.setThumbnail(first.thumbnail);
  } else {
    const total = opts.tracks.reduce((s, t) => s + t.durationSec, 0);
    embed
      .setTitle(`Added ${opts.tracks.length} Songs`)
      .setDescription(
        [
          opts.listName ? `From **${opts.listName.slice(0, 100)}**` : '',
          `Total length **${formatTime(total)}**`,
          opts.cut ? `${opts.cut} more didn't fit (the queue holds 500 songs).` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      );
  }
  return embed.addFields({ name: 'Requested by', value: user(first.requesterId), inline: true });
}

export function searchEmbed(theme: Theme, query: string, results: SearchResult[]): EmbedBuilder {
  return baseEmbed(theme, Colors.brand)
    .setTitle('Search Results')
    .setDescription(
      [
        `For **${query.slice(0, 100)}**`,
        '',
        ...results.map(
          (r, k) =>
            `\`${k + 1}.\` ${r.title.slice(0, 80)} · ${r.channel.slice(0, 40)} · ${r.durationSec > 0 ? formatTime(r.durationSec) : 'live'}`,
        ),
        '',
        'Pick one below to add it to the queue.',
      ].join('\n'),
    );
}

export function searchSelect(token: string, results: SearchResult[]) {
  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(Ids.music.pick(token))
        .setPlaceholder('Choose a song…')
        .addOptions(
          results.map((r, k) => ({
            label: `${k + 1}. ${r.title}`.slice(0, 100),
            description: `${r.channel} · ${r.durationSec > 0 ? formatTime(r.durationSec) : 'live'}`.slice(
              0,
              100,
            ),
            value: String(k),
          })),
        ),
    ),
  ];
}

export function musicInfoEmbed(theme: Theme, title: string, message: string): EmbedBuilder {
  return baseEmbed(theme, Colors.brand).setTitle(title).setDescription(message);
}
