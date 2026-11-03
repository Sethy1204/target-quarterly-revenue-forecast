/**
 * Verified watchlist definition.
 *
 * Identities, exchanges and tickers were checked on 2026-11-03 (see `verification`
 * on each company and VERIFICATION.md). Re-verify periodically: listings change.
 *
 * IMPORTANT: TELUS trades as "T" on the Toronto Stock Exchange (CAD). The NYSE
 * ticker "T" belongs to AT&T Inc. — an unrelated company. Every provider symbol
 * for the TELUS TSX listing is therefore always qualified with the TSX exchange
 * (MIC XTSE / Finnhub suffix ".TO"); a bare "T" is never sent to a provider.
 */

export type Currency = 'USD' | 'CAD';
export type ExchangeCode = 'NASDAQ' | 'NYSE' | 'TSX';

export interface ListingDef {
  /** Stable internal id, unique across the app (never a bare ticker). */
  id: string;
  companyId: string;
  symbol: string;
  exchange: ExchangeCode;
  /** ISO 10383 Market Identifier Code. */
  mic: 'XNAS' | 'XNYS' | 'XTSE';
  currency: Currency;
  /** Short display label, e.g. "Class A". */
  shareClass?: string;
  /** Default listing shown on the company card. */
  primary: boolean;
  providerSymbols: {
    /** Query params identifying the listing at Twelve Data (symbol + exchange or MIC). */
    twelvedata: { symbol: string; params: Record<string, string> };
    finnhub: string;
  };
}

export interface SourceRef {
  label: string;
  url: string;
  /** Publication date of the source (YYYY-MM-DD) when known. */
  date?: string;
}

export interface CompanyDef {
  id: string;
  name: string;
  legalName: string;
  listings: ListingDef[];
  /** Symbol used to request company news / earnings / profile from Finnhub (US listing). */
  finnhubCompanySymbol: string;
  notes: string[];
  verification: SourceRef[];
}

const L = (
  companyId: string,
  symbol: string,
  exchange: ExchangeCode,
  currency: Currency,
  primary: boolean,
  shareClass?: string,
): ListingDef => {
  const mic = exchange === 'NASDAQ' ? 'XNAS' : exchange === 'NYSE' ? 'XNYS' : 'XTSE';
  return {
    id: `${symbol}:${mic}`,
    companyId,
    symbol,
    exchange,
    mic,
    currency,
    shareClass,
    primary,
    providerSymbols: {
      // US listings are identified by exchange name (Nasdaq stocks can be reported under tier
      // MICs such as XNGS), TSX by its MIC. TELUS "T" is therefore never sent unqualified.
      twelvedata: { symbol, params: exchange === 'TSX' ? { mic_code: 'XTSE' } : { exchange } },
      // Finnhub uses an exchange suffix for non-US listings (".TO" = Toronto).
      finnhub: exchange === 'TSX' ? `${symbol}.TO` : symbol,
    },
  };
};

export const COMPANIES: CompanyDef[] = [
  {
    id: 'spacex',
    name: 'SpaceX',
    legalName: 'Space Exploration Technologies Corp.',
    listings: [L('spacex', 'SPCX', 'NASDAQ', 'USD', true, 'Class A')],
    finnhubCompanySymbol: 'SPCX',
    notes: [
      'Publicly traded since 12 Jun 2026 (Nasdaq: SPCX, Class A common stock). IPO priced 11 Jun 2026 at US$135.',
      'Starlink is a business within SpaceX (its Connectivity segment), not a separately listed company.',
      'xAI was merged into SpaceX in Feb 2026; SPCX represents the combined company.',
      'Funds, SPVs or other companies that hold SpaceX exposure are NOT SpaceX stock and are not shown here.',
    ],
    verification: [
      { label: 'Nasdaq newsroom — SpaceX (SPCX) IPO', url: 'https://www.nasdaq.com/newsroom/spacex-ipo-rocket-company-launches-historic-ipo' },
      { label: 'SEC EDGAR — Space Exploration Technologies S-1', url: 'https://www.sec.gov/Archives/edgar/data/1181412/000162828026036936/spaceexplorationtechnologi.htm' },
      { label: 'CNBC — SPCX debut', url: 'https://www.cnbc.com/2026/06/12/spacex-ipo-spcx-live-updates.html', date: '2026-06-12' },
    ],
  },
  {
    id: 'telus',
    name: 'TELUS',
    legalName: 'TELUS Corporation',
    listings: [L('telus', 'T', 'TSX', 'CAD', true), L('telus', 'TU', 'NYSE', 'USD', false)],
    finnhubCompanySymbol: 'TU',
    notes: [
      'Default listing: TSX "T" in CAD. NYSE "TU" in USD is the US listing of the same company.',
      'Not AT&T: AT&T trades as "T" on the NYSE and is unrelated to TELUS.',
    ],
    verification: [{ label: 'TELUS investor relations', url: 'https://www.telus.com/en/about/investor-relations' }],
  },
  {
    id: 'take-two',
    name: 'Take-Two Interactive',
    legalName: 'Take-Two Interactive Software, Inc.',
    listings: [L('take-two', 'TTWO', 'NASDAQ', 'USD', true)],
    finnhubCompanySymbol: 'TTWO',
    notes: [],
    verification: [{ label: 'Take-Two investor relations', url: 'https://ir.take2games.com/' }],
  },
  {
    id: 'jnj',
    name: 'Johnson & Johnson',
    legalName: 'Johnson & Johnson',
    listings: [L('jnj', 'JNJ', 'NYSE', 'USD', true)],
    finnhubCompanySymbol: 'JNJ',
    notes: [],
    verification: [{ label: 'J&J investor relations', url: 'https://www.investor.jnj.com/' }],
  },
  {
    id: 'coreweave',
    name: 'CoreWeave',
    legalName: 'CoreWeave, Inc.',
    listings: [L('coreweave', 'CRWV', 'NASDAQ', 'USD', true, 'Class A')],
    finnhubCompanySymbol: 'CRWV',
    notes: [],
    verification: [{ label: 'CoreWeave investor relations', url: 'https://investors.coreweave.com/' }],
  },
  {
    id: 'tesla',
    name: 'Tesla',
    legalName: 'Tesla, Inc.',
    listings: [L('tesla', 'TSLA', 'NASDAQ', 'USD', true)],
    finnhubCompanySymbol: 'TSLA',
    notes: [],
    verification: [{ label: 'Tesla investor relations', url: 'https://ir.tesla.com/' }],
  },
  {
    id: 'microsoft',
    name: 'Microsoft',
    legalName: 'Microsoft Corporation',
    listings: [L('microsoft', 'MSFT', 'NASDAQ', 'USD', true)],
    finnhubCompanySymbol: 'MSFT',
    notes: [],
    verification: [{ label: 'Microsoft investor relations', url: 'https://www.microsoft.com/en-us/investor' }],
  },
  {
    id: 'alphabet',
    name: 'Alphabet (Google)',
    legalName: 'Alphabet Inc.',
    listings: [
      L('alphabet', 'GOOGL', 'NASDAQ', 'USD', true, 'Class A'),
      L('alphabet', 'GOOG', 'NASDAQ', 'USD', false, 'Class C'),
    ],
    finnhubCompanySymbol: 'GOOGL',
    notes: ['GOOGL = Class A (voting); GOOG = Class C (non-voting). Both trade on Nasdaq in USD.'],
    verification: [{ label: 'Alphabet investor relations', url: 'https://abc.xyz/investor/' }],
  },
];

export const ALL_LISTINGS: ListingDef[] = COMPANIES.flatMap((c) => c.listings);

export function getListing(id: string): ListingDef | undefined {
  return ALL_LISTINGS.find((l) => l.id === id);
}

export function getCompany(id: string): CompanyDef | undefined {
  return COMPANIES.find((c) => c.id === id);
}

/** MICs a provider may report for each exchange (Nasdaq has per-tier MICs). */
export const ACCEPTED_MICS: Record<ExchangeCode, string[]> = {
  NASDAQ: ['XNAS', 'XNGS', 'XNMS', 'XNCM'],
  NYSE: ['XNYS'],
  TSX: ['XTSE'],
};

/** IANA timezone in which each exchange operates. */
export const EXCHANGE_TZ: Record<ExchangeCode, string> = {
  NASDAQ: 'America/New_York',
  NYSE: 'America/New_York',
  TSX: 'America/Toronto',
};
