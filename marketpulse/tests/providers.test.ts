import { describe, expect, it } from 'vitest';
import { COMPANIES, getListing } from '../shared/companies';
import { loadConfig } from '../server/config';
import { classifyKind, FinnhubProvider, newsId, parseFinnhubNews, parseFinnhubQuote } from '../server/providers/finnhub';
import { parseTwelveDataQuote, parseTwelveDataSeries, TwelveDataProvider } from '../server/providers/twelvedata';
import { dedupeNews } from '../server/services/news';
import { fakeFetch, jsonResponse, sec, tdQuote } from './fixtures';

const cfg = loadConfig({ TWELVEDATA_API_KEY: 'td-secret', FINNHUB_API_KEY: 'fh-secret', TWELVEDATA_CREDITS_PER_MINUTE: '0', TWELVEDATA_CREDITS_PER_DAY: '0', FINNHUB_CALLS_PER_MINUTE: '0' });
const L = (id: string) => getListing(id)!;

describe('Twelve Data adapter', () => {
  it('parses a quote and recomputes change from close/previous_close', () => {
    const q = parseTwelveDataQuote(tdQuote('MSFT', 'XNAS', 'USD', '420.50', '400.00', '2026-11-03T15:00:00Z', { percent_change: '999' }), L('MSFT:XNAS'), new Date());
    expect(q.price).toBe(420.5);
    expect(q.change).toBe(20.5);
    expect(q.changePercent).toBe(5.125);
    expect(q.volume).toBe(1234567);
    expect(q.quoteTime).toBe('2026-11-03T15:00:00.000Z');
    expect(q.currency).toBe('USD');
  });
  it('keeps missing fields null instead of 0', () => {
    const q = parseTwelveDataQuote({ close: '10', previous_close: '', volume: null, open: undefined }, L('MSFT:XNAS'), new Date());
    expect(q.previousClose).toBeNull();
    expect(q.change).toBeNull();
    expect(q.changePercent).toBeNull();
    expect(q.volume).toBeNull();
    expect(q.open).toBeNull();
    expect(q.quoteTime).toBeNull();
  });
  it('separates extended-hours change (vs regular close) from the daily change', () => {
    const q = parseTwelveDataQuote(
      tdQuote('TSLA', 'XNAS', 'USD', '200', '190', '2026-11-03T21:00:00Z', { extended_price: '204', extended_timestamp: sec('2026-11-03T22:30:00Z') }),
      L('TSLA:XNAS'), new Date(),
    );
    expect(q.changePercent).toBeCloseTo(5.263158, 5);
    expect(q.extended).toEqual({ price: 204, change: 4, changePercent: 2, time: '2026-11-03T22:30:00.000Z' });
  });

  it('batches per exchange and always sends TELUS "T" with mic_code=XTSE', async () => {
    const { fetch, calls } = fakeFetch((u) => {
      const mic = u.searchParams.get('mic_code');
      const ex = u.searchParams.get('exchange');
      const syms = u.searchParams.get('symbol')!.split(',');
      if (mic === 'XTSE') return jsonResponse(tdQuote('T', 'XTSE', 'CAD', '20.10', '20.00', '2026-11-03T20:59:00Z'));
      // Nasdaq stocks may come back with a tier MIC such as XNGS — that must be accepted.
      const m = ex === 'NYSE' ? 'XNYS' : 'XNGS';
      return jsonResponse(syms.length === 1 ? tdQuote(syms[0], m, 'USD', '100', '99', '2026-11-03T15:00:00Z') : Object.fromEntries(syms.map((s) => [s, tdQuote(s, m, 'USD', '100', '99', '2026-11-03T15:00:00Z')])));
    });
    const td = new TwelveDataProvider(cfg.twelvedata, fetch);
    const r = await td.fetchQuotes([L('T:XTSE'), L('MSFT:XNAS'), L('TSLA:XNAS'), L('JNJ:XNYS')]);
    expect(r.errors).toEqual([]);
    expect(r.quotes.map((q) => `${q.symbol}:${q.currency}`).sort()).toEqual(['JNJ:USD', 'MSFT:USD', 'T:CAD', 'TSLA:USD']);
    const tCalls = calls.filter((c) => c.url.searchParams.get('symbol')!.split(',').includes('T'));
    expect(tCalls).toHaveLength(1);
    expect(tCalls[0].url.searchParams.get('mic_code')).toBe('XTSE');
    expect(tCalls[0].url.searchParams.get('symbol')).toBe('T');
    const nas = calls.find((c) => c.url.searchParams.get('exchange') === 'NASDAQ')!;
    expect(nas.url.searchParams.get('symbol')).toBe('MSFT,TSLA');
    expect(nas.url.searchParams.get('mic_code')).toBeNull();
  });

  it('requests only what the per-minute budget allows and defers the rest (no errors)', async () => {
    let t = Date.parse('2026-11-03T15:00:00Z');
    const { RateGate } = await import('../server/rateGate');
    const gate = new RateGate({ name: 'TD', perMinute: 3, perDay: null, now: () => t });
    const { fetch, calls } = fakeFetch((u) => {
      const syms = u.searchParams.get('symbol')!.split(',');
      const one = (s: string) => tdQuote(s, 'XNGS', 'USD', '10', '9', '2026-11-03T15:00:00Z');
      return jsonResponse(syms.length === 1 ? one(syms[0]) : Object.fromEntries(syms.map((s) => [s, one(s)])));
    });
    const td = new TwelveDataProvider(cfg.twelvedata, fetch, gate);
    const ls = ['SPCX:XNAS', 'TTWO:XNAS', 'CRWV:XNAS', 'TSLA:XNAS', 'MSFT:XNAS'].map(L);
    const r = await td.fetchQuotes(ls);
    expect(r.quotes.map((q) => q.symbol)).toEqual(['SPCX', 'TTWO', 'CRWV']);
    expect(r.errors).toEqual([]);
    expect(r.deferred).toEqual(['TSLA:XNAS', 'MSFT:XNAS']);
    expect(r.retryAfterMs).toBe(20_000);
    expect(calls).toHaveLength(1);
    t += 40_000;
    const r2 = await td.fetchQuotes(ls.slice(3));
    expect(r2.quotes.map((q) => q.symbol)).toEqual(['TSLA', 'MSFT']);
  });

  it('rejects quotes whose currency or exchange do not match (e.g. AT&T returned for "T")', async () => {
    const { fetch } = fakeFetch(() => jsonResponse(tdQuote('T', 'XNYS', 'USD', '25', '24', '2026-11-03T15:00:00Z')));
    const r = await new TwelveDataProvider(cfg.twelvedata, fetch).fetchQuotes([L('T:XTSE')]);
    expect(r.quotes).toEqual([]);
    expect(r.errors[0].message).toMatch(/mismatch/i);
  });

  it('reports per-symbol errors inside a batch', async () => {
    const { fetch } = fakeFetch(() =>
      jsonResponse({ MSFT: tdQuote('MSFT', 'XNAS', 'USD', '1', '1', '2026-11-03T15:00:00Z'), SPCX: { status: 'error', code: 404, message: 'symbol not found' } }),
    );
    const r = await new TwelveDataProvider(cfg.twelvedata, fetch).fetchQuotes([L('MSFT:XNAS'), L('SPCX:XNAS')]);
    expect(r.quotes).toHaveLength(1);
    expect(r.errors).toEqual([{ listingId: 'SPCX:XNAS', message: expect.stringContaining('symbol not found') }]);
  });

  it('maps Twelve Data JSON 429 bodies to a cooldown and defers (not fails) the listings', async () => {
    const { fetch } = fakeFetch(() => jsonResponse({ status: 'error', code: 429, message: 'You have run out of API credits' }));
    const td = new TwelveDataProvider(cfg.twelvedata, fetch);
    const r = await td.fetchQuotes([L('MSFT:XNAS')]);
    expect(r.deferred).toEqual(['MSFT:XNAS']);
    expect(r.errors).toEqual([]);
    expect(td.gate.available()).toBe(0); // cooldown active
  });

  it("surfaces the provider's own message on HTTP 4xx", async () => {
    const { fetch } = fakeFetch(() => jsonResponse({ code: 404, message: 'symbol or figi parameter is missing or invalid', status: 'error' }, 404));
    const r = await new TwelveDataProvider(cfg.twelvedata, fetch).fetchQuotes([L('SPCX:XNAS')]);
    expect(r.errors[0].message).toBe('Not found at provider (HTTP 404): symbol or figi parameter is missing or invalid');
  });

  it('parses time series into ascending UTC points, skipping missing closes', () => {
    const pts = parseTwelveDataSeries(
      {
        meta: { exchange_timezone: 'America/New_York', currency: 'USD' },
        values: [
          { datetime: '2026-11-03 09:40:00', close: '101' },
          { datetime: '2026-11-03 09:35:00', close: '' },
          { datetime: '2026-11-03 09:30:00', close: '100' },
          { datetime: '2026-11-02 15:55:00', close: '99' },
        ],
      },
      L('MSFT:XNAS'),
      '1D',
    );
    expect(pts).toEqual([
      { t: Date.parse('2026-11-03T14:30:00Z'), close: 100 },
      { t: Date.parse('2026-11-03T14:40:00Z'), close: 101 },
    ]);
  });

  it('requests charts with the documented parameters and a YTD start date', async () => {
    const { fetch, calls } = fakeFetch(() => jsonResponse({ meta: { currency: 'CAD', exchange_timezone: 'America/Toronto' }, values: [{ datetime: '2026-01-02', close: '20' }], status: 'ok' }));
    const r = await new TwelveDataProvider(cfg.twelvedata, fetch).fetchChart(L('T:XTSE'), 'YTD', new Date('2026-11-03T15:00:00Z'));
    const p = calls[0].url.searchParams;
    expect(calls[0].url.pathname).toBe('/time_series');
    expect([p.get('symbol'), p.get('mic_code'), p.get('interval'), p.get('start_date')]).toEqual(['T', 'XTSE', '1day', '2026-01-01']);
    expect(r.points).toHaveLength(1);
  });
});

describe('Finnhub adapter', () => {
  it('treats all-zero quote responses as no data (not a price of 0)', () => {
    expect(parseFinnhubQuote({ c: 0, d: null, dp: null, h: 0, l: 0, o: 0, pc: 0, t: 0 }, L('T:XTSE'), new Date())).toBeNull();
    const q = parseFinnhubQuote({ c: 105, d: 5, dp: 5, h: 106, l: 99, o: 100, pc: 100, t: sec('2026-11-03T15:00:00Z') }, L('MSFT:XNAS'), new Date())!;
    expect(q.changePercent).toBe(5);
    expect(q.volume).toBeNull();
  });

  it('sends the key in a header, not the URL', async () => {
    const { fetch, calls } = fakeFetch(() => jsonResponse([]));
    await new FinnhubProvider(cfg.finnhub, fetch).fetchCompanyNews(COMPANIES[1], '2026-10-27', '2026-11-04');
    expect(calls[0].url.toString()).not.toContain('fh-secret');
    expect(calls[0].headers['X-Finnhub-Token']).toBe('fh-secret');
    expect(calls[0].url.searchParams.get('symbol')).toBe('TU');
  });

  it('parses news, drops items missing required fields, and never fabricates summaries', () => {
    const telus = COMPANIES.find((c) => c.id === 'telus')!;
    const items = parseFinnhubNews(
      [
        { headline: 'TELUS reports Q3 results', source: 'GlobeNewswire', url: 'https://x.test/a?utm_source=y', datetime: sec('2026-11-03T11:00:00Z'), summary: '', category: 'company' },
        { headline: '', source: 'X', url: 'https://x.test/b', datetime: 1 },
        { headline: 'No date', source: 'X', url: 'https://x.test/c' },
        { headline: 'Analysis piece', source: 'Reuters', url: 'https://x.test/d', datetime: sec('2026-11-02T11:00:00Z'), summary: 'Feed text.' },
      ],
      telus,
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: 'company-announcement', summary: '', companyIds: ['telus'], publishedAt: '2026-11-03T11:00:00.000Z' });
    expect(items[1]).toMatchObject({ kind: 'not-specified', summary: 'Feed text.' });
    expect(classifyKind('Business Wire').kind).toBe('company-announcement');
  });

  it('labels earnings dates as unconfirmed provider estimates', async () => {
    const { fetch } = fakeFetch(() => jsonResponse({ earningsCalendar: [{ date: '2026-11-05', hour: 'amc', quarter: 3, year: 2026, symbol: 'TU', epsEstimate: null }] }));
    const ev = await new FinnhubProvider(cfg.finnhub, fetch).fetchEarnings(COMPANIES[1], '2026-11-03', '2027-03-01');
    expect(ev[0]).toMatchObject({ date: '2026-11-05', confirmation: 'unconfirmed-provider-estimate', epsEstimate: null });
  });
});

describe('news deduplication', () => {
  const base = { publisher: 'Reuters', summary: '', kind: 'not-specified' as const, topics: [], provider: 'Finnhub', demo: false };
  it('merges the same story across companies and tracking-param variants', () => {
    const a = { ...base, id: newsId('https://www.x.test/story?utm_source=a', 'H'), headline: 'Microsoft and Alphabet sign deal', url: 'https://www.x.test/story?utm_source=a', publishedAt: '2026-11-03T10:00:00Z', companyIds: ['microsoft'] };
    const b = { ...base, id: newsId('https://x.test/story/', 'H'), headline: 'Microsoft and Alphabet sign deal', url: 'https://x.test/story/', publishedAt: '2026-11-03T10:00:00Z', companyIds: ['alphabet'] };
    const c = { ...base, id: 'other', headline: 'Microsoft and Alphabet sign deal!', url: 'https://mirror.test/1', publishedAt: '2026-11-03T10:00:00Z', companyIds: ['alphabet'] };
    const d = { ...base, id: 'newer', headline: 'Different', url: 'https://x.test/2', publishedAt: '2026-11-03T12:00:00Z', companyIds: ['tesla'] };
    const out = dedupeNews([a, b, c, d]);
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe('newer');
    expect(out[1].companyIds.sort()).toEqual(['alphabet', 'microsoft']);
  });
});
