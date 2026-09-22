/**
 * The music queue as plain data + rules (no Discord, no processes), so every button's effect on the
 * queue is easy to test. The player in src/discord/music/ owns one Queue per server.
 */

export type LoopMode = 'off' | 'track' | 'queue';

export interface Track {
  /** Stable id inside this queue (for buttons/menus). */
  id: string;
  title: string;
  /** Artist / channel name. */
  author: string;
  /** Seconds; 0 when unknown (live streams). */
  durationSec: number;
  /** A playable page URL (YouTube/SoundCloud…). Null until a Spotify track has been matched. */
  url: string | null;
  /** What to search for when `url` is null (Spotify tracks: "artist - title"). */
  search: string | null;
  thumbnail: string | null;
  source: 'youtube' | 'spotify' | 'soundcloud' | 'search' | 'other';
  requesterId: string;
  /** Link shown to people (the Spotify link for Spotify tracks). */
  displayUrl: string | null;
}

export const MAX_QUEUE = 500;
const HISTORY_SIZE = 20;

export class Queue {
  tracks: Track[] = [];
  /** Index of the current track in `tracks`, or -1 before anything plays. */
  index = -1;
  loop: LoopMode = 'off';
  /** Finished tracks, newest last (for "back" and /music history). */
  history: Track[] = [];

  get current(): Track | null {
    return this.tracks[this.index] ?? null;
  }

  /** Tracks after the current one. */
  get upcoming(): Track[] {
    return this.tracks.slice(this.index + 1);
  }

  get size(): number {
    return this.upcoming.length;
  }

  /** Adds tracks at the end (or right after the current one with `next`). Returns how many fit. */
  add(tracks: Track[], opts: { next?: boolean } = {}): number {
    const room = Math.max(0, MAX_QUEUE - this.upcoming.length);
    const fit = tracks.slice(0, room);
    if (opts.next) this.tracks.splice(this.index + 1, 0, ...fit);
    else this.tracks.push(...fit);
    return fit.length;
  }

  /**
   * Moves on after a track ends (`skip` = the user asked, so a looped track still moves on).
   * Returns the new current track, or null when the queue is finished.
   */
  advance(skip = false): Track | null {
    const finished = this.current;
    if (finished && !(this.loop === 'track' && !skip)) this.remember(finished);
    if (this.loop === 'track' && !skip && finished) return finished;
    if (this.index + 1 < this.tracks.length) {
      this.index++;
      return this.current;
    }
    if (this.loop === 'queue' && this.tracks.length > 0) {
      this.index = 0;
      return this.current;
    }
    // Finished: keep the list so "back" still works, but nothing is current.
    this.index = this.tracks.length;
    return null;
  }

  /** Goes back to the previous track. Returns it, or null if there is none. */
  back(): Track | null {
    if (this.index <= 0) return null;
    this.index = Math.min(this.index, this.tracks.length) - 1;
    return this.current;
  }

  /** Jumps to the n-th upcoming track (1 = next). */
  jump(position: number): Track | null {
    const target = this.index + position;
    if (position < 1 || target >= this.tracks.length) return null;
    const finished = this.current;
    if (finished) this.remember(finished);
    this.index = target;
    return this.current;
  }

  /** Removes the n-th upcoming track (1 = next). */
  remove(position: number): Track | null {
    const at = this.index + position;
    if (position < 1 || at >= this.tracks.length) return null;
    const [removed] = this.tracks.splice(at, 1);
    return removed ?? null;
  }

  /** Moves an upcoming track from one position to another (both 1-based, upcoming only). */
  move(from: number, to: number): Track | null {
    const n = this.upcoming.length;
    if (from < 1 || from > n || to < 1 || to > n) return null;
    const a = this.index + from;
    const [t] = this.tracks.splice(a, 1);
    if (!t) return null;
    this.tracks.splice(this.index + to, 0, t);
    return t;
  }

  /** Shuffles the upcoming tracks only; the current one keeps playing. */
  shuffle(random: () => number = Math.random): void {
    const start = this.index + 1;
    for (let k = this.tracks.length - 1; k > start; k--) {
      const j = start + Math.floor(random() * (k - start + 1));
      [this.tracks[k], this.tracks[j]] = [this.tracks[j]!, this.tracks[k]!];
    }
  }

  /** Removes every upcoming track. Returns how many were removed. */
  clear(): number {
    const n = this.upcoming.length;
    this.tracks.splice(this.index + 1);
    return n;
  }

  cycleLoop(): LoopMode {
    this.loop = this.loop === 'off' ? 'track' : this.loop === 'track' ? 'queue' : 'off';
    return this.loop;
  }

  /** Seconds left in the upcoming tracks (unknown durations count as 0). */
  upcomingSeconds(): number {
    return this.upcoming.reduce((s, t) => s + t.durationSec, 0);
  }

  private remember(t: Track): void {
    this.history.push(t);
    if (this.history.length > HISTORY_SIZE) this.history.shift();
  }
}
