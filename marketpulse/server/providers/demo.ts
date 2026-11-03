import { ALL_LISTINGS, type CompanyDef, type ExchangeCode, type ListingDef } from '../../shared/companies.js';
import { computeChange } from '../../shared/market.js';
import type { ChartRange, EarningsEvent, Fundamentals, NewsItem, Quote } from '../../shared/types.js';
import type { TimingDecl } from '../config.js';
import type { ChartProvider, ChartResult, EarningsProvider, FundamentalsProvider, NewsProvider, QuoteBatchResult, QuoteProvider } from './types.js';

/**
 * DEMO provider — static, deterministic fixtures for exploring the UI without API keys.
 * Values are illustrative round numbers, NOT market data. They never change between
 * refreshes (no random walk), and every response is flagged demo=true so the UI labels it.
 */

const FIXTURE_TIME = '2026-01-02T21:00:00.000Z';
const NAME = 'DEMO fixture (not market data)';

function demoQuote(l: ListingDef, i: number): Quote {
  const price = 100 + i * 10;
  const previousClose = price - (i % 2 === 0 ? 2 : -1.5);
  const ch = computeChange(price, previousClose);
  return {
    listingId: l.id,
    symbol: l.symbol,
    exchange: l.exchange,
    currency: l.currency,
    providerCurrency: l.currency,
    price,
    change: ch.change,
    changePercent: ch.changePercent,
    previousClose,
    open: previousClose,
    high: Math.max(price, previousClose) + 1,
    low: Math.min(price, previousClose) - 1,
    // One listing deliberately has no volume to demonstrate the "unavailable" state.
    volume: l.symbol === 'GOOG' ? null : 1_000_000 * (i + 1),
    quoteTime: FIXTURE_TIME,
    extended: l.exchange === 'TSX' ? null : { price: price + 0.5, change: 0.5, changePercent: (0.5 / price) * 100, time: FIXTURE_TIME },
    providerMarketOpen: null,
    provider: NAME,
    fetchedAt: new Date().toISOString(),
  };
}

export class DemoProvider implements QuoteProvider, ChartProvider, NewsProvider, EarningsProvider, FundamentalsProvider {
  readonly name = NAME;
  readonly docsUrl = '';
  readonly gate = null;

  timingFor(_e: ExchangeCode): TimingDecl {
    return { timing: 'end-of-day', delayMinutes: 0, source: 'Demo fixture' };
  }
  costFor(): number {
    return 0;
  }
  async fetchQuotes(listings: ListingDef[]): Promise<QuoteBatchResult> {
    return { quotes: listings.map((l) => demoQuote(l, ALL_LISTINGS.findIndex((x) => x.id === l.id))), errors: [] };
  }
  async fetchChart(listing: ListingDef, range: ChartRange): Promise<ChartResult> {
    const idx = ALL_LISTINGS.findIndex((x) => x.id === listing.id);
    const n = { '1D': 78, '5D': 65, '1M': 21, '6M': 126, YTD: 200, '1Y': 252 }[range];
    const step = range === '1D' ? 5 * 60_000 : range === '5D' ? 30 * 60_000 : 86_400_000;
    const end = Date.parse(FIXTURE_TIME);
    const base = 100 + idx * 10;
    // Deterministic illustrative shape (same output every call) — clearly labelled DEMO in the UI.
    const points = Array.from({ length: n }, (_, k) => ({
      t: end - (n - 1 - k) * step,
      close: Math.round((base * (1 + 0.04 * Math.sin((k + idx * 3) / 9) + 0.0006 * k * (idx % 3 === 0 ? 1 : -1))) * 100) / 100,
    }));
    return { points, interval: range === '1D' ? '5min' : range === '5D' ? '30min' : '1day' };
  }
  async fetchCompanyNews(company: CompanyDef): Promise<NewsItem[]> {
    return [
      {
        id: `demo-${company.id}`,
        headline: `[DEMO] Placeholder item for ${company.name} — not a real news story`,
        publisher: 'Demo fixture',
        publishedAt: FIXTURE_TIME,
        url: `https://example.com/marketpulse-demo/${company.id}`,
        companyIds: [company.id],
        summary: 'Demo mode shows this static placeholder so the news layout can be explored without an API key.',
        kind: 'not-specified',
        topics: [],
        provider: NAME,
        demo: true,
      },
    ];
  }
  async fetchEarnings(): Promise<EarningsEvent[]> {
    return [];
  }
  async fetchFundamentals(company: CompanyDef): Promise<Fundamentals> {
    return { companyId: company.id, marketCap: null, marketCapCurrency: null, sourceSymbol: company.finnhubCompanySymbol, provider: NAME, fetchedAt: new Date().toISOString() };
  }
}
