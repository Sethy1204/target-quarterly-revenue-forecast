import { getListing, type ListingDef } from '../../shared/companies.js';
import { classifyFreshness } from '../../shared/freshness.js';
import { getSession, type SessionInfo } from '../../shared/market.js';
import type { FeedStatus, Quote, QuotesResponse, QuoteView } from '../../shared/types.js';
import type { AppConfig } from '../config.js';
import { ProviderError } from '../http.js';
import type { QuoteProvider } from '../providers/types.js';

interface Failure {
  message: string;
  at: number;
  count: number;
}

const FORCE_MIN_GAP_MS = 10_000;

/**
 * Server-side quote cache + scheduler. Clients poll this service; it only calls the
 * provider when a listing's cached quote is older than the refresh interval derived
 * from the provider's rate limits, so many tabs/clients never multiply provider usage.
 */
export class QuoteService {
  private entries = new Map<string, Quote>();
  private failures = new Map<string, Failure>();
  private lastAttemptAt: number | null = null;
  private lastSuccessAt: number | null = null;
  private lastError: string | null = null;
  private rateLimitedUntil = 0;
  private lastForcedAt = 0;
  private inflight: Promise<void> | null = null;

  constructor(
    private provider: QuoteProvider | null,
    private cfg: Pick<AppConfig, 'minQuoteRefreshSec' | 'closedMarketRefreshSec'>,
    private demo: boolean,
    private now: () => number = Date.now,
  ) {}

  /** Refresh interval honouring per-minute and per-day credit budgets. */
  refreshIntervalSec(listings: ListingDef[]): number {
    let sec = this.cfg.minQuoteRefreshSec;
    const gate = this.provider?.gate;
    const cost = this.provider ? this.provider.costFor(listings) : 0;
    if (gate && cost > 0) {
      if (gate.perMinute) sec = Math.max(sec, Math.ceil((cost / gate.perMinute) * 60 * 1.25));
      // Spread a daily cap across a 16-hour active window (US pre-market → after-hours).
      if (gate.perDay) sec = Math.max(sec, Math.ceil((16 * 3600 * cost) / gate.perDay));
    }
    const nowD = new Date(this.now());
    const anyActive = listings.some((l) => {
      const s = getSession(l.exchange, nowD).state;
      return s === 'regular' || s === 'pre-market' || s === 'after-hours';
    });
    if (!anyActive) sec = Math.max(sec, this.cfg.closedMarketRefreshSec);
    return sec;
  }

  private isDue(l: ListingDef, intervalMs: number, now: number): boolean {
    const f = this.failures.get(l.id);
    if (f) {
      // Per-listing exponential backoff after failures: 30 s, 60 s, 120 s … ≤ 15 min.
      const backoff = Math.min(30_000 * 2 ** (f.count - 1), 15 * 60_000);
      return now - f.at >= Math.min(backoff, intervalMs);
    }
    const q = this.entries.get(l.id);
    return !q || now - Date.parse(q.fetchedAt) >= intervalMs;
  }

  async get(ids: string[], force = false): Promise<QuotesResponse> {
    const listings = ids.map(getListing).filter((l): l is ListingDef => !!l);
    const intervalSec = this.refreshIntervalSec(listings);
    const now = this.now();

    if (this.provider) {
      let due = listings.filter((l) => this.isDue(l, intervalSec * 1000, now));
      // Manual refresh bypasses the cache, but never more than once per FORCE_MIN_GAP_MS after any fetch.
      if (force && now - Math.max(this.lastForcedAt, this.lastAttemptAt ?? 0) >= FORCE_MIN_GAP_MS) {
        this.lastForcedAt = now;
        due = listings;
      }
      if (due.length > 0 && now >= this.rateLimitedUntil) {
        if (this.inflight) await this.inflight;
        else {
          this.inflight = this.fetch(due).finally(() => (this.inflight = null));
          await this.inflight;
        }
      }
    }
    return this.view(listings, intervalSec);
  }

  private async fetch(due: ListingDef[]): Promise<void> {
    const p = this.provider!;
    this.lastAttemptAt = this.now();
    const fail = (l: ListingDef, message: string) => {
      const prev = this.failures.get(l.id);
      this.failures.set(l.id, { message, at: this.now(), count: (prev?.count ?? 0) + 1 });
    };
    try {
      const res = await p.fetchQuotes(due);
      for (const q of res.quotes) {
        this.entries.set(q.listingId, q);
        this.failures.delete(q.listingId);
      }
      for (const e of res.errors) {
        const l = getListing(e.listingId);
        if (l) fail(l, e.message);
      }
      if (res.quotes.length > 0) this.lastSuccessAt = this.now();
      this.lastError = res.errors.length ? `${res.errors.length} listing(s) failed: ${res.errors[0].message}` : null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.lastError = msg;
      if (e instanceof ProviderError && e.kind === 'rate-limit') {
        this.rateLimitedUntil = this.now() + (e.retryAfterMs ?? 60_000);
      }
      for (const l of due) fail(l, msg);
    }
  }

  private sessionFor(l: ListingDef, q: Quote | undefined, now: Date): SessionInfo {
    const s = getSession(l.exchange, now);
    // Prefer the provider's explicit "closed" signal (covers holidays missing from local tables).
    if (q?.providerMarketOpen === false && s.state === 'regular' && this.now() - Date.parse(q.fetchedAt) < 15 * 60_000) {
      return { ...s, state: 'closed', label: 'Closed (per provider)' };
    }
    return s;
  }

  private view(listings: ListingDef[], intervalSec: number): QuotesResponse {
    const now = this.now();
    const nowD = new Date(now);
    const quotes: QuoteView[] = [];
    const errors: QuotesResponse['errors'] = [];
    for (const l of listings) {
      const q = this.entries.get(l.id);
      const failure = this.failures.get(l.id);
      if (!this.provider) {
        errors.push({ listingId: l.id, message: 'No quote provider configured' });
        continue;
      }
      if (failure) errors.push({ listingId: l.id, message: failure.message });
      if (!q) continue;
      const decl = this.provider.timingFor(l.exchange);
      const session = this.sessionFor(l, q, nowD);
      quotes.push({
        ...q,
        session,
        timing: decl.timing,
        delayMinutes: decl.delayMinutes,
        freshness: classifyFreshness({
          timing: decl.timing,
          delayMinutes: decl.delayMinutes,
          quoteTime: q.quoteTime,
          now: nowD,
          session: session.state,
          lastFetchFailed: !!failure,
          fetchedAt: q.fetchedAt,
          refreshIntervalSec: intervalSec,
          demo: this.demo,
        }),
      });
    }

    let next = now + intervalSec * 1000;
    for (const l of listings) {
      const q = this.entries.get(l.id);
      const f = this.failures.get(l.id);
      if (f) next = Math.min(next, f.at + Math.min(30_000 * 2 ** (f.count - 1), 15 * 60_000, intervalSec * 1000));
      else if (q) next = Math.min(next, Date.parse(q.fetchedAt) + intervalSec * 1000);
      else next = now;
    }
    next = Math.max(next, this.rateLimitedUntil, now + 5_000);

    const gate = this.provider?.gate;
    const snap = gate?.snapshot();
    const status: FeedStatus = {
      provider: this.provider?.name ?? 'none',
      lastAttemptAt: this.lastAttemptAt ? new Date(this.lastAttemptAt).toISOString() : null,
      lastSuccessAt: this.lastSuccessAt ? new Date(this.lastSuccessAt).toISOString() : null,
      lastError: this.lastError,
      nextRefreshAt: new Date(next).toISOString(),
      refreshIntervalSec: intervalSec,
      rateLimited: this.rateLimitedUntil > now,
      rateLimitResetAt: this.rateLimitedUntil > now ? new Date(this.rateLimitedUntil).toISOString() : (snap?.cooldownUntil ?? null),
      budget: snap ? { perMinute: snap.perMinute, perDay: snap.perDay, usedToday: snap.usedToday } : undefined,
    };
    return { quotes, errors, status, demo: this.demo };
  }
}
