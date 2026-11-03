import { COMPANIES, type CompanyDef } from '../../shared/companies.js';
import { shiftLocalDate } from '../../shared/market.js';
import type { FeedStatus, NewsItem, NewsResponse } from '../../shared/types.js';
import type { AppConfig } from '../config.js';
import { ProviderError } from '../http.js';
import type { NewsProvider } from '../providers/types.js';

const headlineKey = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Merges duplicate stories (same normalised URL id, or same publisher + headline) and unions related companies. */
export function dedupeNews(items: NewsItem[]): NewsItem[] {
  const byId = new Map<string, NewsItem>();
  const byHeadline = new Map<string, string>();
  for (const it of items) {
    const hk = `${it.publisher.toLowerCase()}|${headlineKey(it.headline)}`;
    const existingId = byId.has(it.id) ? it.id : byHeadline.get(hk);
    if (existingId) {
      const ex = byId.get(existingId)!;
      ex.companyIds = [...new Set([...ex.companyIds, ...it.companyIds])];
      if (!ex.summary && it.summary) ex.summary = it.summary;
      continue;
    }
    const copy = { ...it, companyIds: [...it.companyIds] };
    byId.set(it.id, copy);
    byHeadline.set(hk, it.id);
  }
  return [...byId.values()].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

export class NewsService {
  private perCompany = new Map<string, { items: NewsItem[]; at: number }>();
  private errors = new Map<string, string>();
  private lastAttemptAt: number | null = null;
  private lastSuccessAt: number | null = null;
  private lastError: string | null = null;
  private rateLimitedUntil = 0;
  private lastForcedAt = 0;
  private inflight: Promise<void> | null = null;

  constructor(
    private provider: NewsProvider | null,
    private cfg: Pick<AppConfig, 'newsRefreshSec' | 'newsLookbackDays'>,
    private demo: boolean,
    private now: () => number = Date.now,
  ) {}

  async get(force = false): Promise<NewsResponse> {
    const now = this.now();
    if (this.provider && now >= this.rateLimitedUntil) {
      const forced = force && now - this.lastForcedAt >= 30_000;
      if (forced) this.lastForcedAt = now;
      const due = COMPANIES.filter((c) => {
        const e = this.perCompany.get(c.id);
        return forced || !e || now - e.at >= this.cfg.newsRefreshSec * 1000;
      });
      if (due.length) {
        if (this.inflight) await this.inflight;
        else {
          this.inflight = this.fetch(due).finally(() => (this.inflight = null));
          await this.inflight;
        }
      }
    }
    return this.view();
  }

  private async fetch(due: CompanyDef[]): Promise<void> {
    const p = this.provider!;
    const nowD = new Date(this.now());
    const from = shiftLocalDate(nowD, 'America/Toronto', { days: -this.cfg.newsLookbackDays });
    const to = shiftLocalDate(nowD, 'America/Toronto', { days: 1 });
    this.lastAttemptAt = this.now();
    let anyOk = false;
    for (const c of due) {
      try {
        const items = await p.fetchCompanyNews(c, from, to);
        this.perCompany.set(c.id, { items, at: this.now() });
        this.errors.delete(c.id);
        anyOk = true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.errors.set(c.id, msg);
        this.lastError = msg;
        if (e instanceof ProviderError && e.kind === 'rate-limit') {
          this.rateLimitedUntil = this.now() + (e.retryAfterMs ?? 60_000);
          break;
        }
        if (e instanceof ProviderError && e.kind === 'auth') break;
      }
    }
    if (anyOk) this.lastSuccessAt = this.now();
    if (anyOk && this.errors.size === 0) this.lastError = null;
  }

  private view(): NewsResponse {
    const now = this.now();
    const cutoff = now - (this.cfg.newsLookbackDays + 1) * 86_400_000;
    const all = [...this.perCompany.values()].flatMap((e) => e.items);
    const items = dedupeNews(all)
      .filter((i) => this.demo || Date.parse(i.publishedAt) >= cutoff)
      .slice(0, 400);
    const oldest = Math.min(...[...this.perCompany.values()].map((e) => e.at), now);
    const next = Math.max(this.perCompany.size < COMPANIES.length ? now + 5_000 : oldest + this.cfg.newsRefreshSec * 1000, this.rateLimitedUntil, now + 5_000);
    const status: FeedStatus = {
      provider: this.provider?.name ?? 'none',
      lastAttemptAt: this.lastAttemptAt ? new Date(this.lastAttemptAt).toISOString() : null,
      lastSuccessAt: this.lastSuccessAt ? new Date(this.lastSuccessAt).toISOString() : null,
      lastError: this.provider ? this.lastError : 'No news provider configured (requires FINNHUB_API_KEY).',
      nextRefreshAt: new Date(next).toISOString(),
      refreshIntervalSec: this.cfg.newsRefreshSec,
      rateLimited: this.rateLimitedUntil > now,
      rateLimitResetAt: this.rateLimitedUntil > now ? new Date(this.rateLimitedUntil).toISOString() : null,
    };
    return { items, status, errors: [...this.errors.entries()].map(([companyId, message]) => ({ companyId, message })), demo: this.demo };
  }
}
