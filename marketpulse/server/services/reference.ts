import { COMPANIES } from '../../shared/companies.js';
import { localParts, shiftLocalDate } from '../../shared/market.js';
import type { EarningsEvent, EarningsResponse, FeedStatus, Fundamentals, FundamentalsResponse } from '../../shared/types.js';
import { ProviderError } from '../http.js';
import type { EarningsProvider, FundamentalsProvider } from '../providers/types.js';

/** Generic slow-changing per-company data with a long TTL (earnings calendar, market cap). */
class PerCompanyCache<T> {
  data = new Map<string, { value: T; at: number }>();
  errors = new Map<string, string>();
  lastAttemptAt: number | null = null;
  lastSuccessAt: number | null = null;
  rateLimitedUntil = 0;
  private inflight: Promise<void> | null = null;

  constructor(
    private ttlSec: number,
    private load: (companyId: string) => Promise<T>,
    private now: () => number,
  ) {}

  async refresh(): Promise<void> {
    const now = this.now();
    if (now < this.rateLimitedUntil) return;
    const due = COMPANIES.filter((c) => {
      const e = this.data.get(c.id);
      return !e || now - e.at >= this.ttlSec * 1000;
    });
    if (!due.length) return;
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      this.lastAttemptAt = this.now();
      for (const c of due) {
        try {
          this.data.set(c.id, { value: await this.load(c.id), at: this.now() });
          this.errors.delete(c.id);
          this.lastSuccessAt = this.now();
        } catch (e) {
          this.errors.set(c.id, e instanceof Error ? e.message : String(e));
          if (e instanceof ProviderError && e.kind === 'rate-limit') {
            this.rateLimitedUntil = this.now() + (e.retryAfterMs ?? 60_000);
            break;
          }
          if (e instanceof ProviderError && e.kind === 'auth') break;
        }
      }
    })().finally(() => (this.inflight = null));
    return this.inflight;
  }

  status(provider: string): FeedStatus {
    const now = this.now();
    const oldest = Math.min(...[...this.data.values()].map((e) => e.at), now);
    return {
      provider,
      lastAttemptAt: this.lastAttemptAt ? new Date(this.lastAttemptAt).toISOString() : null,
      lastSuccessAt: this.lastSuccessAt ? new Date(this.lastSuccessAt).toISOString() : null,
      lastError: this.errors.size ? [...this.errors.values()][0] : null,
      nextRefreshAt: new Date(Math.max(oldest + this.ttlSec * 1000, this.rateLimitedUntil, now + 5000)).toISOString(),
      refreshIntervalSec: this.ttlSec,
      rateLimited: this.rateLimitedUntil > now,
      rateLimitResetAt: this.rateLimitedUntil > now ? new Date(this.rateLimitedUntil).toISOString() : null,
    };
  }
}

export class EarningsService {
  private cache: PerCompanyCache<EarningsEvent[]>;
  constructor(
    private provider: EarningsProvider | null,
    private lookaheadDays: number,
    private demo: boolean,
    private now: () => number = Date.now,
  ) {
    this.cache = new PerCompanyCache(6 * 3600, async (id) => {
      const c = COMPANIES.find((x) => x.id === id)!;
      const n = new Date(this.now());
      return this.provider!.fetchEarnings(c, shiftLocalDate(n, 'America/Toronto', { days: 0 }), shiftLocalDate(n, 'America/Toronto', { days: this.lookaheadDays }));
    }, now);
  }
  async get(): Promise<EarningsResponse> {
    if (this.provider) await this.cache.refresh();
    const today = localParts(new Date(this.now()), 'America/Toronto').date;
    const events = [...this.cache.data.values()]
      .flatMap((e) => e.value)
      .filter((e) => e.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date));
    const status = this.cache.status(this.provider?.name ?? 'none');
    if (!this.provider) status.lastError = 'No earnings provider configured (requires FINNHUB_API_KEY).';
    return { events, status, demo: this.demo };
  }
}

export class FundamentalsService {
  private cache: PerCompanyCache<Fundamentals>;
  constructor(
    private provider: FundamentalsProvider | null,
    private demo: boolean,
    now: () => number = Date.now,
  ) {
    this.cache = new PerCompanyCache(12 * 3600, (id) => this.provider!.fetchFundamentals(COMPANIES.find((x) => x.id === id)!), now);
  }
  async get(): Promise<FundamentalsResponse> {
    if (this.provider) await this.cache.refresh();
    const status = this.cache.status(this.provider?.name ?? 'none');
    if (!this.provider) status.lastError = 'No fundamentals provider configured (requires FINNHUB_API_KEY).';
    return { items: [...this.cache.data.values()].map((e) => e.value), status, demo: this.demo };
  }
}
