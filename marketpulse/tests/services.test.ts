import { describe, expect, it } from 'vitest';
import { getListing, type ListingDef } from '../shared/companies';
import { ProviderError } from '../server/http';
import { RateGate } from '../server/rateGate';
import type { QuoteBatchResult, QuoteProvider } from '../server/providers/types';
import { QuoteService } from '../server/services/quotes';
import { NewsService } from '../server/services/news';
import { ChartService } from '../server/services/charts';
import type { Quote } from '../shared/types';

// Tuesday 2026-11-03 10:00 ET — US and TSX regular sessions open.
const T0 = Date.parse('2026-11-03T15:00:00Z');

function mkQuote(l: ListingDef, price: number, at: number): Quote {
  return {
    listingId: l.id, symbol: l.symbol, exchange: l.exchange, currency: l.currency, providerCurrency: l.currency, price, change: null, changePercent: null,
    previousClose: null, open: null, high: null, low: null, volume: null, quoteTime: new Date(at - 1000).toISOString(), extended: null,
    providerMarketOpen: true, provider: 'Mock', fetchedAt: new Date(at).toISOString(),
  };
}

class MockProvider implements QuoteProvider {
  name = 'Mock';
  docsUrl = '';
  calls: string[][] = [];
  mode: 'ok' | 'fail' | '429' = 'ok';
  constructor(public gate: RateGate | null, private clock: () => number) {}
  timingFor() { return { timing: 'real-time' as const, delayMinutes: 0, source: 'test' }; }
  costFor(l: ListingDef[]) { return l.length; }
  async fetchQuotes(ls: ListingDef[]): Promise<QuoteBatchResult> {
    this.calls.push(ls.map((l) => l.id));
    if (this.mode === '429') throw new ProviderError('rate', 'rate-limit', 120_000);
    if (this.mode === 'fail') throw new ProviderError('Network error: down', 'network');
    return { quotes: ls.map((l) => mkQuote(l, 100 + this.calls.length, this.clock())), errors: [] };
  }
}

const cfg = { minQuoteRefreshSec: 60, closedMarketRefreshSec: 900 };
const ids = ['MSFT:XNAS', 'T:XTSE'];

describe('QuoteService', () => {
  it('derives the refresh interval from the credit budget', () => {
    let t = T0;
    const p = new MockProvider(new RateGate({ name: 'g', perMinute: 8, perDay: null, now: () => t }), () => t);
    const s = new QuoteService(p, cfg, false, () => t);
    const ten = ['SPCX:XNAS', 'T:XTSE', 'TU:XNYS', 'TTWO:XNAS', 'JNJ:XNYS', 'CRWV:XNAS', 'TSLA:XNAS', 'MSFT:XNAS', 'GOOGL:XNAS', 'GOOG:XNAS'].map((i) => getListing(i)!);
    expect(s.refreshIntervalSec(ten)).toBe(94); // 10 credits / 8 per min * 60 s * 1.25
    const daily = new QuoteService(new MockProvider(new RateGate({ name: 'g', perMinute: 8, perDay: 800, now: () => t }), () => t), cfg, false, () => t);
    expect(daily.refreshIntervalSec(ten)).toBe(720); // 800/day spread over 16 h
    t = Date.parse('2026-11-07T15:00:00Z'); // Saturday
    expect(s.refreshIntervalSec(ten)).toBe(900);
  });

  it('serves from cache within the interval and refetches when due', async () => {
    let t = T0;
    const p = new MockProvider(null, () => t);
    const s = new QuoteService(p, cfg, false, () => t);
    const r1 = await s.get(ids);
    expect(r1.quotes).toHaveLength(2);
    expect(r1.status.lastSuccessAt).toBe(new Date(T0).toISOString());
    expect(Date.parse(r1.status.nextRefreshAt!)).toBe(T0 + 60_000);
    t += 30_000;
    await s.get(ids);
    expect(p.calls).toHaveLength(1);
    t += 31_000;
    const r3 = await s.get(ids);
    expect(p.calls).toHaveLength(2);
    expect(r3.quotes[0].price).toBe(102);
  });

  it('throttles manual force-refresh', async () => {
    let t = T0;
    const p = new MockProvider(null, () => t);
    const s = new QuoteService(p, cfg, false, () => t);
    await s.get(ids);
    t += 3_000;
    await s.get(ids, true);
    expect(p.calls).toHaveLength(1); // forced refresh ignored within 10 s of the last fetch
    t += 10_000;
    await s.get(ids, true);
    expect(p.calls).toHaveLength(2);
  });

  it('keeps last good data, reports the error, marks stale, and backs off on failure', async () => {
    let t = T0;
    const p = new MockProvider(null, () => t);
    const s = new QuoteService(p, cfg, false, () => t);
    await s.get(ids);
    p.mode = 'fail';
    t += 61_000;
    const r = await s.get(ids);
    expect(r.quotes).toHaveLength(2); // last good data retained
    expect(r.quotes[0].price).toBe(101);
    expect(r.errors.map((e) => e.message)).toEqual(['Network error: down', 'Network error: down']);
    expect(r.status.lastError).toMatch(/down/);
    expect(r.status.lastSuccessAt).toBe(new Date(T0).toISOString());
    expect(r.quotes[0].freshness.warning).toMatch(/failed/);
    // next attempt after backoff (30 s), not immediately
    t += 10_000;
    await s.get(ids);
    expect(p.calls).toHaveLength(2);
    t += 25_000;
    const r2 = await s.get(ids);
    expect(p.calls).toHaveLength(3);
    expect(r2.quotes[0].freshness.level).toBe('real-time'); // still within tolerance, but warning shown
    t += 90_000; // second failure → 60 s backoff elapsed; > 2 intervals since last good fetch
    const r2b = await s.get(ids);
    expect(p.calls).toHaveLength(4);
    expect(r2b.quotes[0].freshness.level).toBe('stale');
    p.mode = 'ok';
    t += 120_000;
    const r3 = await s.get(ids);
    expect(r3.errors).toEqual([]);
    expect(r3.quotes[0].freshness.level).toBe('real-time');
  });

  it('enters a cooldown on provider 429 instead of retrying', async () => {
    let t = T0;
    const p = new MockProvider(null, () => t);
    p.mode = '429';
    const s = new QuoteService(p, cfg, false, () => t);
    const r = await s.get(ids);
    expect(r.status.rateLimited).toBe(true);
    expect(Date.parse(r.status.rateLimitResetAt!)).toBe(T0 + 120_000);
    t += 60_000;
    await s.get(ids, true);
    expect(p.calls).toHaveLength(1);
    p.mode = 'ok';
    t += 61_000;
    expect((await s.get(ids)).quotes).toHaveLength(2);
  });

  it('only fetches listings that are due (e.g. a newly shown listing)', async () => {
    let t = T0;
    const p = new MockProvider(null, () => t);
    const s = new QuoteService(p, cfg, false, () => t);
    await s.get(['MSFT:XNAS']);
    t += 5_000;
    await s.get(['MSFT:XNAS', 'GOOG:XNAS']);
    expect(p.calls).toEqual([['MSFT:XNAS'], ['GOOG:XNAS']]);
  });

  it('queues listings deferred by the rate budget without reporting them as failures', async () => {
    let t = T0;
    const p = new MockProvider(null, () => t);
    const orig = p.fetchQuotes.bind(p);
    let first = true;
    p.fetchQuotes = async (ls) => {
      if (first) {
        first = false;
        const r = await orig(ls.slice(0, 1));
        return { ...r, deferred: ls.slice(1).map((l) => l.id), retryAfterMs: 20_000 };
      }
      return orig(ls);
    };
    const s = new QuoteService(p, cfg, false, () => t);
    const r = await s.get(ids);
    expect(r.quotes.map((q) => q.listingId)).toEqual(['MSFT:XNAS']);
    expect(r.errors).toEqual([]);
    expect(r.pending).toEqual(['T:XTSE']);
    expect(Date.parse(r.status.nextRefreshAt!)).toBe(T0 + 20_000);
    t += 5_000;
    await s.get(ids);
    expect(p.calls).toHaveLength(1); // waits for the budget
    t += 16_000;
    const r2 = await s.get(ids);
    expect(r2.pending).toEqual([]);
    expect(r2.quotes).toHaveLength(2);
  });

  it('returns explicit errors (not empty prices) when no provider is configured', async () => {
    const r = await new QuoteService(null, cfg, false, () => T0).get(ids);
    expect(r.quotes).toEqual([]);
    expect(r.errors).toHaveLength(2);
  });

  it('coalesces concurrent requests into one provider call', async () => {
    const t = T0;
    const p = new MockProvider(null, () => t);
    const s = new QuoteService(p, cfg, false, () => t);
    await Promise.all([s.get(ids), s.get(ids), s.get(ids)]);
    expect(p.calls).toHaveLength(1);
  });
});

describe('NewsService', () => {
  it('caches per company, stops on rate limit, and reports status', async () => {
    let t = T0;
    let n = 0;
    const provider = {
      name: 'MockNews', docsUrl: '',
      async fetchCompanyNews(c: { id: string }) {
        n++;
        if (n === 3) throw new ProviderError('rate', 'rate-limit', 60_000);
        return [{ id: `x-${c.id}`, headline: `H ${c.id}`, publisher: 'P', publishedAt: new Date(t - 3600_000).toISOString(), url: `https://x.test/${c.id}`, companyIds: [c.id], summary: '', kind: 'not-specified' as const, topics: [], provider: 'MockNews', demo: false }];
      },
    };
    const s = new NewsService(provider, { newsRefreshSec: 600, newsLookbackDays: 7 }, false, () => t);
    const r = await s.get();
    expect(n).toBe(3);
    expect(r.items).toHaveLength(2);
    expect(r.status.rateLimited).toBe(true);
    t += 61_000;
    const r2 = await s.get();
    expect(r2.items).toHaveLength(8);
    t += 60_000;
    await s.get();
    expect(n).toBe(9); // cached, no refetch within 10 min
  });
});

describe('ChartService', () => {
  it('caches results and explains unavailable ranges without inventing data', async () => {
    let calls = 0;
    const provider = {
      name: 'MockChart', docsUrl: '',
      timingFor: () => ({ timing: 'end-of-day' as const, delayMinutes: 0, source: '' }),
      async fetchChart() {
        calls++;
        if (calls === 1) throw new ProviderError('Twelve Data: not available on current plan (403)', 'plan');
        return { points: [{ t: 1, close: 2 }], interval: '1day' };
      },
    };
    const s = new ChartService(provider, false, () => T0);
    const r1 = await s.get(getListing('T:XTSE')!, '1D');
    expect(r1.points).toEqual([]);
    expect(r1.unavailableReason).toMatch(/plan/);
    const r2 = await s.get(getListing('T:XTSE')!, '1D');
    expect(r2.points).toHaveLength(1);
    expect(r2.currency).toBe('CAD');
    await s.get(getListing('T:XTSE')!, '1D');
    expect(calls).toBe(2);
  });
});
