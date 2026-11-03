import { createHash } from 'node:crypto';
import type { CompanyDef, ExchangeCode, ListingDef } from '../../shared/companies.js';
import { computeChange, toNum } from '../../shared/market.js';
import type { EarningsEvent, Fundamentals, NewsItem, NewsKind, Quote } from '../../shared/types.js';
import { regionOf, type AppConfig, type TimingDecl } from '../config.js';
import { fetchJson, ProviderError, type FetchLike } from '../http.js';
import { RateGate } from '../rateGate.js';
import type { EarningsProvider, FundamentalsProvider, NewsProvider, QuoteBatchResult, QuoteProvider } from './types.js';

/**
 * Finnhub adapter (https://finnhub.io/docs/api).
 * Endpoints: /quote, /company-news, /calendar/earnings, /stock/profile2.
 * Auth via the documented X-Finnhub-Token header so the key never appears in URLs/logs.
 */

type Raw = Record<string, unknown>;

/** Wire services that distribute company-issued press releases. Classification is by publisher only. */
const WIRE_SERVICES = ['business wire', 'businesswire', 'pr newswire', 'prnewswire', 'globenewswire', 'globe newswire', 'accesswire', 'newsfile', 'cnw', 'canada newswire'];

export function classifyKind(publisher: string, category?: string): { kind: NewsKind; reason?: string } {
  const p = publisher.toLowerCase();
  if (WIRE_SERVICES.some((w) => p.includes(w))) return { kind: 'company-announcement', reason: `Published via press-release wire (${publisher})` };
  if (category && category.toLowerCase() === 'press') return { kind: 'company-announcement', reason: 'Provider category: press release' };
  return { kind: 'not-specified' };
}

const TOPIC_RULES: { topic: string; re: RegExp }[] = [
  { topic: 'launch', re: /\b(launch|starship|falcon|dragon|booster|orbit|liftoff)\b/i },
  { topic: 'starlink', re: /\bstarlink\b/i },
  { topic: 'financing/valuation', re: /\b(valuation|ipo|offering|shares?|stake|funding|financing|bond|debt|lock-?up|tender)\b/i },
  { topic: 'earnings', re: /\b(earnings|quarter|q[1-4]|results|revenue|guidance)\b/i },
];

export function topicsFor(headline: string): string[] {
  return TOPIC_RULES.filter((r) => r.re.test(headline)).map((r) => r.topic);
}

export function normalizeUrl(u: string): string {
  try {
    const url = new URL(u);
    url.hash = '';
    // Strip tracking params only; keep ids that identify the article.
    for (const k of [...url.searchParams.keys()]) if (/^utm_|^(cmp|src|ref)$/i.test(k)) url.searchParams.delete(k);
    return `${url.protocol}//${url.host.toLowerCase().replace(/^www\./, '')}${url.pathname.replace(/\/$/, '')}${url.search}`;
  } catch {
    return u.trim();
  }
}

export function newsId(url: string, headline: string): string {
  return createHash('sha1').update(normalizeUrl(url) || headline.toLowerCase()).digest('hex').slice(0, 16);
}

export function parseFinnhubNews(rows: unknown, company: CompanyDef): NewsItem[] {
  if (!Array.isArray(rows)) throw new ProviderError('Finnhub: unexpected company-news response', 'bad-response');
  const out: NewsItem[] = [];
  for (const r of rows as Raw[]) {
    const headline = typeof r.headline === 'string' ? r.headline.trim() : '';
    const url = typeof r.url === 'string' ? r.url.trim() : '';
    const ts = toNum(r.datetime);
    if (!headline || !url || ts === null || ts <= 0) continue; // never invent missing fields
    const publisher = typeof r.source === 'string' && r.source.trim() ? r.source.trim() : 'Unknown publisher';
    const category = typeof r.category === 'string' ? r.category : undefined;
    let summary = typeof r.summary === 'string' ? r.summary.trim() : '';
    if (summary.toLowerCase() === headline.toLowerCase()) summary = '';
    const { kind, reason } = classifyKind(publisher, category);
    out.push({
      id: newsId(url, headline),
      headline,
      publisher,
      publishedAt: new Date(ts * 1000).toISOString(),
      url,
      companyIds: [company.id],
      summary,
      kind,
      kindReason: reason,
      category,
      topics: topicsFor(headline),
      provider: 'Finnhub',
      demo: false,
    });
  }
  return out;
}

export function parseFinnhubQuote(raw: Raw, listing: ListingDef, fetchedAt: Date): Quote | null {
  const t = toNum(raw.t);
  const c = toNum(raw.c);
  // Finnhub answers unknown/unsupported symbols with all-zero fields. That is "no data", not a price of 0.
  if (t === null || t <= 0 || c === null || c <= 0) return null;
  const pcRaw = toNum(raw.pc);
  const pc = pcRaw !== null && pcRaw > 0 ? pcRaw : null;
  const pos = (v: unknown) => {
    const n = toNum(v);
    return n !== null && n > 0 ? n : null;
  };
  const ch = computeChange(c, pc);
  return {
    listingId: listing.id,
    symbol: listing.symbol,
    exchange: listing.exchange,
    currency: listing.currency,
    providerCurrency: null,
    price: c,
    change: ch.change,
    changePercent: ch.changePercent,
    previousClose: pc,
    open: pos(raw.o),
    high: pos(raw.h),
    low: pos(raw.l),
    volume: null, // not included in Finnhub /quote
    quoteTime: new Date(t * 1000).toISOString(),
    extended: null,
    providerMarketOpen: null,
    provider: 'Finnhub',
    fetchedAt: fetchedAt.toISOString(),
  };
}

export class FinnhubProvider implements QuoteProvider, NewsProvider, EarningsProvider, FundamentalsProvider {
  readonly name = 'Finnhub';
  readonly docsUrl = 'https://finnhub.io/docs/api';
  readonly gate: RateGate;

  constructor(
    private cfg: AppConfig['finnhub'],
    private fetchImpl: FetchLike = fetch,
    gate?: RateGate,
  ) {
    if (!cfg.apiKey) throw new ProviderError('FINNHUB_API_KEY is not set', 'not-configured');
    this.gate = gate ?? new RateGate({ name: 'Finnhub', perMinute: cfg.perMinute, perDay: null });
  }

  timingFor(exchange: ExchangeCode): TimingDecl {
    return this.cfg.timing[regionOf(exchange)];
  }

  costFor(listings: ListingDef[]): number {
    return listings.length; // one call per symbol
  }

  private get(path: string, params: Record<string, string>): Promise<unknown> {
    const u = new URL(path.replace(/^\//, ''), this.cfg.baseUrl.endsWith('/') ? this.cfg.baseUrl : `${this.cfg.baseUrl}/`);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return this.gate.run(1, () =>
      fetchJson(u.toString(), { fetchImpl: this.fetchImpl, headers: { 'X-Finnhub-Token': this.cfg.apiKey! }, redact: [this.cfg.apiKey!] }),
    );
  }

  async fetchQuotes(listings: ListingDef[]): Promise<QuoteBatchResult> {
    const out: QuoteBatchResult = { quotes: [], errors: [] };
    for (const l of listings) {
      try {
        const raw = (await this.get('/quote', { symbol: l.providerSymbols.finnhub })) as Raw;
        const q = parseFinnhubQuote(raw ?? {}, l, new Date());
        if (q) out.quotes.push(q);
        else out.errors.push({ listingId: l.id, message: `Finnhub returned no data for ${l.providerSymbols.finnhub} (symbol may not be covered by your plan)` });
      } catch (e) {
        if (e instanceof ProviderError && (e.kind === 'rate-limit' || e.kind === 'auth')) throw e;
        out.errors.push({ listingId: l.id, message: e instanceof Error ? e.message : String(e) });
      }
    }
    return out;
  }

  async fetchCompanyNews(company: CompanyDef, fromDate: string, toDate: string): Promise<NewsItem[]> {
    const rows = await this.get('/company-news', { symbol: company.finnhubCompanySymbol, from: fromDate, to: toDate });
    return parseFinnhubNews(rows, company);
  }

  async fetchEarnings(company: CompanyDef, fromDate: string, toDate: string): Promise<EarningsEvent[]> {
    const body = (await this.get('/calendar/earnings', { symbol: company.finnhubCompanySymbol, from: fromDate, to: toDate })) as Raw;
    const rows = Array.isArray(body?.earningsCalendar) ? (body.earningsCalendar as Raw[]) : [];
    return rows
      .filter((r) => typeof r.date === 'string')
      .map((r) => ({
        companyId: company.id,
        symbol: String(r.symbol ?? company.finnhubCompanySymbol),
        date: String(r.date),
        hour: typeof r.hour === 'string' && r.hour ? r.hour : null,
        quarter: toNum(r.quarter),
        year: toNum(r.year),
        epsEstimate: toNum(r.epsEstimate),
        revenueEstimate: toNum(r.revenueEstimate),
        confirmation: 'unconfirmed-provider-estimate' as const,
        provider: 'Finnhub',
      }));
  }

  async fetchFundamentals(company: CompanyDef): Promise<Fundamentals> {
    const body = (await this.get('/stock/profile2', { symbol: company.finnhubCompanySymbol })) as Raw;
    const mcM = toNum(body?.marketCapitalization);
    return {
      companyId: company.id,
      // Finnhub reports market capitalisation in millions.
      marketCap: mcM !== null && mcM > 0 ? mcM * 1_000_000 : null,
      marketCapCurrency: typeof body?.currency === 'string' ? body.currency : null,
      sourceSymbol: company.finnhubCompanySymbol,
      provider: 'Finnhub (/stock/profile2)',
      fetchedAt: new Date().toISOString(),
    };
  }
}
