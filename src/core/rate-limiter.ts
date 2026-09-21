/**
 * In-memory, per-key rate limiter for command spam protection. Losing it on restart is harmless:
 * it only throttles; every business rule that matters (cooldowns, locks) lives in the database.
 */
export class RateLimiter {
  private readonly until = new Map<string, number>();

  /** Returns the remaining wait in ms, or 0 when the key is free. */
  remaining(key: string): number {
    const t = this.until.get(key);
    if (!t) return 0;
    const left = t - Date.now();
    if (left <= 0) {
      this.until.delete(key);
      return 0;
    }
    return left;
  }

  hit(key: string, ms: number): void {
    if (ms > 0) this.until.set(key, Date.now() + ms);
  }

  sweep(): void {
    const now = Date.now();
    for (const [k, t] of this.until) if (t <= now) this.until.delete(k);
  }
}
