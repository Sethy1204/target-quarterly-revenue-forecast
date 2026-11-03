import { ProviderError } from './http.js';

export interface RateGateOptions {
  name: string;
  /** Max credits per rolling minute (null = unlimited). */
  perMinute: number | null;
  /** Max credits per UTC day (null = unlimited). */
  perDay: number | null;
  now?: () => number;
}

/**
 * Client-side enforcement of a provider's documented limits: a token bucket for the
 * per-minute limit, a UTC-day counter for daily caps, and an exponential cooldown
 * after the provider itself reports HTTP 429.
 */
export class RateGate {
  readonly name: string;
  readonly perMinute: number | null;
  readonly perDay: number | null;
  private tokens: number;
  private lastRefill: number;
  private dayKey: string;
  private usedToday = 0;
  private cooldownUntil = 0;
  private consecutive429 = 0;
  private now: () => number;

  constructor(o: RateGateOptions) {
    this.name = o.name;
    this.perMinute = o.perMinute;
    this.perDay = o.perDay;
    this.now = o.now ?? Date.now;
    this.tokens = o.perMinute ?? Infinity;
    this.lastRefill = this.now();
    this.dayKey = this.utcDay();
  }

  private utcDay(): string {
    return new Date(this.now()).toISOString().slice(0, 10);
  }

  private refill(): void {
    const t = this.now();
    if (this.perMinute !== null) {
      const elapsed = t - this.lastRefill;
      this.tokens = Math.min(this.perMinute, this.tokens + (elapsed / 60_000) * this.perMinute);
    }
    this.lastRefill = t;
    const day = this.utcDay();
    if (day !== this.dayKey) {
      this.dayKey = day;
      this.usedToday = 0;
    }
  }

  /** ms until `cost` credits could be spent (0 = now). Infinity if cost exceeds limits. */
  msUntil(cost: number): number {
    this.refill();
    const t = this.now();
    let wait = Math.max(0, this.cooldownUntil - t);
    if (this.perDay !== null && this.usedToday + cost > this.perDay) {
      const nextDay = Date.parse(`${this.dayKey}T00:00:00Z`) + 86_400_000;
      wait = Math.max(wait, nextDay - t);
    }
    if (this.perMinute !== null) {
      if (cost > this.perMinute) return Infinity;
      if (this.tokens < cost) wait = Math.max(wait, Math.ceil(((cost - this.tokens) / this.perMinute) * 60_000));
    }
    return wait;
  }

  /** Whole credits that can be spent right now (0 during a cooldown). */
  available(): number {
    this.refill();
    if (this.cooldownUntil > this.now()) return 0;
    let n = this.perMinute === null ? Number.MAX_SAFE_INTEGER : Math.floor(this.tokens + 1e-9);
    if (this.perDay !== null) n = Math.min(n, this.perDay - this.usedToday);
    return Math.max(0, n);
  }

  /** Spend credits or throw a rate-limit ProviderError (no request is sent). */
  take(cost: number): void {
    const wait = this.msUntil(cost);
    if (wait > 0) {
      const reason = this.cooldownUntil > this.now() ? 'cooling down after provider rate-limit response' : 'local rate budget exhausted';
      throw new ProviderError(`${this.name}: ${reason}; retry in ${Math.ceil(wait / 1000)} s`, 'rate-limit', wait);
    }
    if (this.perMinute !== null) this.tokens -= cost;
    this.usedToday += cost;
  }

  async run<T>(cost: number, fn: () => Promise<T>): Promise<T> {
    this.take(cost);
    try {
      const out = await fn();
      this.consecutive429 = 0;
      return out;
    } catch (e) {
      if (e instanceof ProviderError && e.kind === 'rate-limit') this.onRateLimited(e.retryAfterMs);
      throw e;
    }
  }

  /** Exponential cooldown: 60 s, 120 s, 240 s … capped at 15 min (or provider Retry-After). */
  onRateLimited(retryAfterMs?: number): void {
    this.consecutive429++;
    const backoff = Math.min(60_000 * 2 ** (this.consecutive429 - 1), 15 * 60_000);
    this.cooldownUntil = this.now() + Math.max(backoff, retryAfterMs ?? 0);
  }

  snapshot() {
    this.refill();
    return {
      perMinute: this.perMinute,
      perDay: this.perDay,
      usedToday: this.usedToday,
      cooldownUntil: this.cooldownUntil > this.now() ? new Date(this.cooldownUntil).toISOString() : null,
    };
  }
}
