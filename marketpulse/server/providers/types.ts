import type { CompanyDef, ExchangeCode, ListingDef } from '../../shared/companies.js';
import type { ChartPoint, ChartRange, EarningsEvent, Fundamentals, NewsItem, Quote } from '../../shared/types.js';
import type { TimingDecl } from '../config.js';
import type { RateGate } from '../rateGate.js';

/**
 * Provider adapter contracts. The UI and services only depend on these interfaces,
 * so a provider can be replaced by adding one adapter file and wiring it in registry.ts.
 */

export interface QuoteBatchResult {
  quotes: Quote[];
  errors: { listingId: string; message: string }[];
}

export interface QuoteProvider {
  readonly name: string;
  readonly docsUrl: string;
  readonly gate: RateGate | null;
  timingFor(exchange: ExchangeCode): TimingDecl;
  /** Credits a fetch of these listings will consume. */
  costFor(listings: ListingDef[]): number;
  fetchQuotes(listings: ListingDef[]): Promise<QuoteBatchResult>;
}

export interface ChartResult {
  points: ChartPoint[];
  interval: string;
}

export interface ChartProvider {
  readonly name: string;
  readonly docsUrl: string;
  timingFor(exchange: ExchangeCode): TimingDecl;
  fetchChart(listing: ListingDef, range: ChartRange, now: Date): Promise<ChartResult>;
}

export interface NewsProvider {
  readonly name: string;
  readonly docsUrl: string;
  fetchCompanyNews(company: CompanyDef, fromDate: string, toDate: string): Promise<NewsItem[]>;
}

export interface EarningsProvider {
  readonly name: string;
  fetchEarnings(company: CompanyDef, fromDate: string, toDate: string): Promise<EarningsEvent[]>;
}

export interface FundamentalsProvider {
  readonly name: string;
  fetchFundamentals(company: CompanyDef): Promise<Fundamentals>;
}

export interface ProviderSet {
  demo: boolean;
  quotes: QuoteProvider | null;
  charts: ChartProvider | null;
  news: NewsProvider | null;
  earnings: EarningsProvider | null;
  fundamentals: FundamentalsProvider | null;
}
