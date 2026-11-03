import { EXCHANGE_TZ, type ExchangeCode, type ListingDef } from '../../shared/companies.js';
import { computeChange, localParts, shiftLocalDate, toNum, zonedLocalToEpoch } from '../../shared/market.js';
import type { ChartPoint, ChartRange, Quote } from '../../shared/types.js';
import { regionOf, type AppConfig, type TimingDecl } from '../config.js';
import { fetchJson, ProviderError, type FetchLike } from '../http.js';
import { RateGate } from '../rateGate.js';
import type { ChartProvider, ChartResult, QuoteBatchResult, QuoteProvider } from './types.js';

/**
 * Twelve Data adapter (https://twelvedata.com/docs).
 * Endpoints used: GET /quote (batch via comma-separated symbols), GET /time_series.
 * Credits: 1 per symbol per request (verify for your plan in Twelve Data's credit docs).
 * Twelve Data may answer HTTP 200 with {"status":"error","code":429,...}; that is mapped
 * to the same errors as real HTTP status codes.
 */

type Raw = Record<string, unknown>;

function asError(body: Raw): ProviderError | null {
  if (body && body.status === 'error') {
    const code = Number(body.code);
    const msg = String(body.message ?? 'Twelve Data error');
    if (code === 429) return new ProviderError('Twelve Data: API credits exhausted for the current period (429)', 'rate-limit');
    if (code === 401) return new ProviderError('Twelve Data: invalid API key (401)', 'auth');
    if (code === 403) return new ProviderError(`Twelve Data: not available on current plan (403) — ${msg}`, 'plan');
    if (code === 404 || code === 400) return new ProviderError(`Twelve Data: ${msg}`, 'not-found');
    return new ProviderError(`Twelve Data: ${msg}`, 'bad-response');
  }
  return null;
}

function epochToIso(v: unknown): string | null {
  const n = toNum(v);
  if (n === null || n <= 0) return null;
  return new Date(n * 1000).toISOString();
}

export function parseTwelveDataQuote(raw: Raw, listing: ListingDef, fetchedAt: Date): Quote {
  const price = toNum(raw.close);
  const previousClose = toNum(raw.previous_close);
  const ours = computeChange(price, previousClose);
  const extPrice = toNum(raw.extended_price);
  const ext = extPrice !== null ? computeChange(extPrice, price) : null;
  const providerCurrency = typeof raw.currency === 'string' ? raw.currency : null;
  return {
    listingId: listing.id,
    symbol: listing.symbol,
    exchange: listing.exchange,
    currency: listing.currency,
    providerCurrency,
    price,
    change: ours.change ?? toNum(raw.change),
    changePercent: ours.changePercent ?? toNum(raw.percent_change),
    previousClose,
    open: toNum(raw.open),
    high: toNum(raw.high),
    low: toNum(raw.low),
    volume: toNum(raw.volume),
    // last_quote_at = time of last quote; timestamp = start of the bar (daily bar by default).
    quoteTime: epochToIso(raw.last_quote_at) ?? epochToIso(raw.timestamp),
    extended:
      extPrice !== null && ext
        ? { price: extPrice, change: ext.change, changePercent: ext.changePercent, time: epochToIso(raw.extended_timestamp) }
        : null,
    providerMarketOpen: typeof raw.is_market_open === 'boolean' ? raw.is_market_open : null,
    provider: 'Twelve Data',
    fetchedAt: fetchedAt.toISOString(),
  };
}

export const RANGE_SPEC: Record<ChartRange, { interval: string; outputsize: number; start?: (now: Date, tz: string) => string; sessions?: number }> = {
  '1D': { interval: '5min', outputsize: 200, sessions: 1 },
  '5D': { interval: '30min', outputsize: 120, sessions: 5 },
  '1M': { interval: '1day', outputsize: 40, start: (n, tz) => shiftLocalDate(n, tz, { months: -1 }) },
  '6M': { interval: '1day', outputsize: 200, start: (n, tz) => shiftLocalDate(n, tz, { months: -6 }) },
  YTD: { interval: '1day', outputsize: 300, start: (n, tz) => `${localParts(n, tz).year}-01-01` },
  '1Y': { interval: '1day', outputsize: 300, start: (n, tz) => shiftLocalDate(n, tz, { years: -1 }) },
};

export function parseTwelveDataSeries(body: Raw, listing: ListingDef, range: ChartRange): ChartPoint[] {
  const meta = (body.meta ?? {}) as Raw;
  const tz = typeof meta.exchange_timezone === 'string' ? meta.exchange_timezone : EXCHANGE_TZ[listing.exchange];
  const values = Array.isArray(body.values) ? (body.values as Raw[]) : [];
  let pts: (ChartPoint & { day: string })[] = [];
  for (const v of values) {
    const close = toNum(v.close);
    const dt = typeof v.datetime === 'string' ? v.datetime : null;
    if (close === null || !dt) continue; // skip, never zero-fill
    const t = zonedLocalToEpoch(dt, tz);
    if (t === null) continue;
    pts.push({ t, close, day: dt.slice(0, 10) });
  }
  pts.sort((a, b) => a.t - b.t);
  const sessions = RANGE_SPEC[range].sessions;
  if (sessions) {
    const days = [...new Set(pts.map((p) => p.day))].slice(-sessions);
    pts = pts.filter((p) => days.includes(p.day));
  }
  return pts.map(({ t, close }) => ({ t, close }));
}

export class TwelveDataProvider implements QuoteProvider, ChartProvider {
  readonly name = 'Twelve Data';
  readonly docsUrl = 'https://twelvedata.com/docs';
  readonly gate: RateGate;

  constructor(
    private cfg: AppConfig['twelvedata'],
    private fetchImpl: FetchLike = fetch,
    gate?: RateGate,
  ) {
    if (!cfg.apiKey) throw new ProviderError('TWELVEDATA_API_KEY is not set', 'not-configured');
    this.gate = gate ?? new RateGate({ name: 'Twelve Data', perMinute: cfg.perMinute, perDay: cfg.perDay });
  }

  timingFor(exchange: ExchangeCode): TimingDecl {
    return this.cfg.timing[regionOf(exchange)];
  }

  costFor(listings: ListingDef[]): number {
    return listings.length;
  }

  private url(path: string, params: Record<string, string>): string {
    const u = new URL(path.replace(/^\//, ''), this.cfg.baseUrl.endsWith('/') ? this.cfg.baseUrl : `${this.cfg.baseUrl}/`);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    u.searchParams.set('apikey', this.cfg.apiKey!);
    return u.toString();
  }

  private get(path: string, params: Record<string, string>): Promise<Raw> {
    return fetchJson<Raw>(this.url(path, params), { fetchImpl: this.fetchImpl, redact: [this.cfg.apiKey!] });
  }

  async fetchQuotes(listings: ListingDef[]): Promise<QuoteBatchResult> {
    const out: QuoteBatchResult = { quotes: [], errors: [] };
    // Group by MIC: one batch request per exchange keeps symbols unambiguous
    // (TSX "T" = TELUS is always sent with mic_code=XTSE, never bare).
    const groups = new Map<string, ListingDef[]>();
    for (const l of listings) {
      const k = l.providerSymbols.twelvedata.mic_code;
      groups.set(k, [...(groups.get(k) ?? []), l]);
    }
    const extra: Record<string, string> = this.cfg.prepost ? { prepost: 'true' } : {};
    for (const [mic, group] of groups) {
      try {
        const body = await this.gate.run(this.costFor(group), () =>
          this.get('/quote', { symbol: group.map((l) => l.providerSymbols.twelvedata.symbol).join(','), mic_code: mic, ...extra }),
        );
        const fetchedAt = new Date();
        const top = asError(body);
        if (top) throw top;
        for (const l of group) {
          // Single-symbol responses are the quote object itself; batch responses are keyed by symbol.
          const raw = (group.length === 1 ? body : (body[l.providerSymbols.twelvedata.symbol] as Raw | undefined)) ?? null;
          if (!raw) {
            out.errors.push({ listingId: l.id, message: 'Twelve Data returned no data for this symbol' });
            continue;
          }
          const e = asError(raw);
          if (e) {
            out.errors.push({ listingId: l.id, message: e.message });
            continue;
          }
          if (typeof raw.mic_code === 'string' && raw.mic_code !== l.mic) {
            out.errors.push({ listingId: l.id, message: `Exchange mismatch: provider returned ${raw.mic_code}, expected ${l.mic}. Quote discarded.` });
            continue;
          }
          const q = parseTwelveDataQuote(raw, l, fetchedAt);
          if (q.providerCurrency && q.providerCurrency !== l.currency) {
            out.errors.push({ listingId: l.id, message: `Currency mismatch: provider reported ${q.providerCurrency}, expected ${l.currency}. Quote discarded.` });
            continue;
          }
          out.quotes.push(q);
        }
      } catch (e) {
        if (e instanceof ProviderError && (e.kind === 'rate-limit' || e.kind === 'auth')) throw e;
        const msg = e instanceof Error ? e.message : String(e);
        for (const l of group) out.errors.push({ listingId: l.id, message: msg });
      }
    }
    return out;
  }

  async fetchChart(listing: ListingDef, range: ChartRange, now: Date): Promise<ChartResult> {
    const spec = RANGE_SPEC[range];
    const tz = EXCHANGE_TZ[listing.exchange];
    const params: Record<string, string> = {
      symbol: listing.providerSymbols.twelvedata.symbol,
      mic_code: listing.providerSymbols.twelvedata.mic_code,
      interval: spec.interval,
      outputsize: String(spec.outputsize),
    };
    if (spec.start) params.start_date = spec.start(now, tz);
    const body = await this.gate.run(1, () => this.get('/time_series', params));
    const e = asError(body);
    if (e) throw e;
    if (body.meta && typeof (body.meta as Raw).currency === 'string' && (body.meta as Raw).currency !== listing.currency) {
      throw new ProviderError(`Currency mismatch in series: ${(body.meta as Raw).currency} vs ${listing.currency}`, 'bad-response');
    }
    return { points: parseTwelveDataSeries(body, listing, range), interval: spec.interval };
  }
}
