import type { Currency, ExchangeCode } from './companies.js';
import type { SessionInfo } from './market.js';

/** How the configured provider/plan delivers data for an exchange (declared in config, never inferred from refresh rate). */
export type FeedTiming = 'real-time' | 'delayed' | 'end-of-day';

export type FreshnessLevel = 'real-time' | 'delayed' | 'end-of-day' | 'stale' | 'demo' | 'unknown';

export interface Freshness {
  level: FreshnessLevel;
  label: string;
  detail: string;
  ageSeconds: number | null;
  warning?: string;
}

export interface ExtendedHoursQuote {
  price: number;
  /** Change vs. the latest regular-session close (NOT vs. previous close). */
  change: number | null;
  changePercent: number | null;
  time: string | null;
}

/** Normalised quote returned by every provider adapter. Missing values are null, never 0. */
export interface Quote {
  listingId: string;
  symbol: string;
  exchange: ExchangeCode;
  currency: Currency;
  /** Currency reported by the provider, if any (mismatch is flagged). */
  providerCurrency: string | null;
  price: number | null;
  /** Daily change: price vs previous regular-session close. */
  change: number | null;
  changePercent: number | null;
  previousClose: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  /** Time of the last trade/quote as reported by the provider (ISO). */
  quoteTime: string | null;
  extended: ExtendedHoursQuote | null;
  providerMarketOpen: boolean | null;
  provider: string;
  fetchedAt: string;
}

export interface QuoteView extends Quote {
  session: SessionInfo;
  freshness: Freshness;
  timing: FeedTiming;
  delayMinutes: number;
}

export interface FeedStatus {
  provider: string;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  nextRefreshAt: string | null;
  refreshIntervalSec: number;
  rateLimited: boolean;
  rateLimitResetAt: string | null;
  budget?: { perMinute: number | null; perDay: number | null; usedToday: number | null };
}

export interface QuotesResponse {
  quotes: QuoteView[];
  errors: { listingId: string; message: string }[];
  status: FeedStatus;
  demo: boolean;
}

export type ChartRange = '1D' | '5D' | '1M' | '6M' | 'YTD' | '1Y';
export const CHART_RANGES: ChartRange[] = ['1D', '5D', '1M', '6M', 'YTD', '1Y'];

export interface ChartPoint {
  /** epoch ms */
  t: number;
  close: number;
}

export interface ChartResponse {
  listingId: string;
  range: ChartRange;
  interval: string;
  currency: Currency;
  points: ChartPoint[];
  provider: string;
  fetchedAt: string;
  timing: FeedTiming;
  demo: boolean;
  /** Set when the series could not be fetched (e.g. plan does not include intraday TSX data). */
  unavailableReason?: string;
}

export type NewsKind = 'company-announcement' | 'not-specified';

export interface NewsItem {
  id: string;
  headline: string;
  publisher: string;
  publishedAt: string;
  url: string;
  companyIds: string[];
  /** Summary text exactly as supplied by the feed (may be empty). Never generated. */
  summary: string;
  kind: NewsKind;
  kindReason?: string;
  /** Provider category label if supplied. */
  category?: string;
  /** Keyword-derived topic tags (headline keywords only). */
  topics: string[];
  provider: string;
  demo: boolean;
}

export interface NewsResponse {
  items: NewsItem[];
  status: FeedStatus;
  errors: { companyId: string; message: string }[];
  demo: boolean;
}

export interface EarningsEvent {
  companyId: string;
  symbol: string;
  date: string;
  /** bmo = before market open, amc = after market close, dmh = during market hours (Finnhub codes). */
  hour: string | null;
  quarter: number | null;
  year: number | null;
  epsEstimate: number | null;
  revenueEstimate: number | null;
  /** Finnhub does not state whether a date is company-confirmed. */
  confirmation: 'confirmed' | 'unconfirmed-provider-estimate';
  provider: string;
}

export interface EarningsResponse {
  events: EarningsEvent[];
  status: FeedStatus;
  demo: boolean;
}

export interface Fundamentals {
  companyId: string;
  marketCap: number | null;
  marketCapCurrency: string | null;
  sourceSymbol: string;
  provider: string;
  fetchedAt: string;
}

export interface FundamentalsResponse {
  items: Fundamentals[];
  status: FeedStatus;
  demo: boolean;
}

export interface ProviderInfo {
  role: 'quotes' | 'charts' | 'news' | 'earnings' | 'fundamentals';
  provider: string;
  configured: boolean;
  docsUrl: string;
  notes: string[];
}

export interface ConfigResponse {
  mode: 'live' | 'demo' | 'unconfigured';
  providers: ProviderInfo[];
  timing: { exchange: ExchangeCode; timing: FeedTiming; delayMinutes: number; source: string }[];
  missing: string[];
  companies: import('./companies.js').CompanyDef[];
  serverTime: string;
  backgroundAlerts: false;
}
