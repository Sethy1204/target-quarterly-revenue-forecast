import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { loadConfig } from '../server/config';
import type { ConfigResponse, QuotesResponse, NewsResponse, ChartResponse, EarningsResponse, FundamentalsResponse } from '../shared/types';
import { fakeFetch, jsonResponse, sec, tdQuote } from './fixtures';

const NOW = Date.parse('2026-11-03T15:00:00Z'); // Tue 10:00 ET

function upstream() {
  return fakeFetch((u) => {
    if (u.hostname === 'td.test') {
      if (u.pathname === '/quote') {
        const mic = u.searchParams.get('mic_code') ?? (u.searchParams.get('exchange') === 'NYSE' ? 'XNYS' : 'XNGS');
        const syms = u.searchParams.get('symbol')!.split(',');
        const ccy = mic === 'XTSE' ? 'CAD' : 'USD';
        const one = (s: string) => tdQuote(s, mic, ccy, '50.00', '49.00', '2026-11-03T14:59:00Z');
        return jsonResponse(syms.length === 1 ? one(syms[0]) : Object.fromEntries(syms.map((s) => [s, one(s)])));
      }
      if (u.pathname === '/time_series') {
        return jsonResponse({ meta: { currency: u.searchParams.get('mic_code') === 'XTSE' ? 'CAD' : 'USD', exchange_timezone: 'America/New_York' }, values: [{ datetime: '2026-11-02', close: '49' }, { datetime: '2026-11-03', close: '50' }], status: 'ok' });
      }
    }
    if (u.hostname === 'fh.test') {
      const sym = u.searchParams.get('symbol');
      if (u.pathname.endsWith('/company-news')) return jsonResponse([{ headline: `Story about ${sym}`, source: 'Example Wire', url: `https://news.test/${sym}`, datetime: sec('2026-11-03T12:00:00Z'), summary: '', category: 'company' }]);
      if (u.pathname.endsWith('/calendar/earnings')) return jsonResponse({ earningsCalendar: sym === 'MSFT' ? [{ date: '2027-01-27', hour: 'amc', symbol: 'MSFT', quarter: 2, year: 2027 }] : [] });
      if (u.pathname.endsWith('/stock/profile2')) return jsonResponse(sym === 'SPCX' ? {} : { marketCapitalization: 1000, currency: 'USD' });
    }
    return jsonResponse({ error: 'unexpected' }, 404);
  });
}

async function start(env: Record<string, string>) {
  const up = upstream();
  const app = createApp({ cfg: loadConfig(env), fetchImpl: up.fetch, now: () => NOW });
  const server: Server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = async <T,>(p: string) => { const res = await fetch(base + p); return { status: res.status, body: (await res.json()) as T }; };
  return { server, get, up };
}

describe('API (live mode, mocked upstream)', () => {
  let ctx: Awaited<ReturnType<typeof start>>;
  beforeAll(async () => {
    ctx = await start({ TWELVEDATA_API_KEY: 'k1', FINNHUB_API_KEY: 'k2', TWELVEDATA_BASE_URL: 'https://td.test', FINNHUB_BASE_URL: 'https://fh.test/api/v1', TWELVEDATA_CREDITS_PER_MINUTE: '0', TWELVEDATA_CREDITS_PER_DAY: '0' });
  });
  afterAll(() => ctx.server.close());

  it('reports configuration without exposing keys', async () => {
    const { body } = await ctx.get<ConfigResponse>('/api/config');
    expect(body.mode).toBe('live');
    expect(body.missing).toEqual([]);
    expect(body.backgroundAlerts).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/k1|k2/);
    expect(body.timing.find((t) => t.exchange === 'TSX')!.timing).toBe('end-of-day');
  });

  it('returns labelled quotes with currency, exchange, freshness and session', async () => {
    const { body } = await ctx.get<QuotesResponse>('/api/quotes?ids=T:XTSE,TU:XNYS,MSFT:XNAS');
    expect(body.errors).toEqual([]);
    const t = body.quotes.find((q) => q.listingId === 'T:XTSE')!;
    expect([t.symbol, t.exchange, t.currency, t.freshness.level, t.session.state]).toEqual(['T', 'TSX', 'CAD', 'end-of-day', 'regular']);
    const m = body.quotes.find((q) => q.listingId === 'MSFT:XNAS')!;
    expect([m.currency, m.freshness.level, m.changePercent]).toEqual(['USD', 'delayed', expect.closeTo(2.0408, 3)]);
    expect(body.status.lastSuccessAt).toBe(new Date(NOW).toISOString());
    expect(body.status.nextRefreshAt).toBeTruthy();
  });

  it('validates input', async () => {
    expect((await ctx.get('/api/quotes?ids=T')).status).toBe(400); // bare "T" is not a valid id
    expect((await ctx.get('/api/chart?listing=MSFT:XNAS&range=10Y')).status).toBe(400);
  });

  it('serves charts for each range', async () => {
    for (const r of ['1D', '5D', '1M', '6M', 'YTD', '1Y']) {
      const { body } = await ctx.get<ChartResponse>(`/api/chart?listing=T:XTSE&range=${r}`);
      expect(body.currency).toBe('CAD');
      expect(body.points.length).toBeGreaterThan(0);
    }
  });

  it('serves deduplicated news, earnings and market cap (missing → null)', async () => {
    const news = (await ctx.get<NewsResponse>('/api/news')).body;
    expect(news.items).toHaveLength(8);
    expect(news.items[0].url).toMatch(/^https:\/\/news.test\//);
    const earn = (await ctx.get<EarningsResponse>('/api/earnings')).body;
    expect(earn.events).toEqual([expect.objectContaining({ companyId: 'microsoft', date: '2027-01-27', confirmation: 'unconfirmed-provider-estimate' })]);
    const fund = (await ctx.get<FundamentalsResponse>('/api/fundamentals')).body;
    expect(fund.items.find((f) => f.companyId === 'microsoft')!.marketCap).toBe(1e9);
    expect(fund.items.find((f) => f.companyId === 'spacex')!.marketCap).toBeNull();
  });
});

describe('API (unconfigured)', () => {
  it('reports missing keys and returns no prices', async () => {
    const ctx = await start({});
    const cfg = (await ctx.get<ConfigResponse>('/api/config')).body;
    expect(cfg.mode).toBe('unconfigured');
    expect(cfg.missing).toHaveLength(2);
    const q = (await ctx.get<QuotesResponse>('/api/quotes')).body;
    expect(q.quotes).toEqual([]);
    expect(q.errors).toHaveLength(10);
    expect(ctx.up.calls).toHaveLength(0);
    ctx.server.close();
  });
});

describe('API (demo mode)', () => {
  it('flags everything as demo and makes no network calls', async () => {
    const ctx = await start({ MARKETPULSE_MODE: 'demo' });
    const q = (await ctx.get<QuotesResponse>('/api/quotes')).body;
    expect(q.demo).toBe(true);
    expect(q.quotes.every((x) => x.freshness.level === 'demo' && x.provider.includes('DEMO'))).toBe(true);
    const a = (await ctx.get<QuotesResponse>('/api/quotes?force=1')).body;
    expect(a.quotes.map((x) => x.price)).toEqual(q.quotes.map((x) => x.price)); // no random walk
    const n = (await ctx.get<NewsResponse>('/api/news')).body;
    expect(n.items.every((i) => i.demo && i.headline.startsWith('[DEMO]'))).toBe(true);
    expect(ctx.up.calls).toHaveLength(0);
    ctx.server.close();
  });
});
