import type { ExchangeCode } from '../shared/companies.js';
import type { FeedTiming } from '../shared/types.js';

export interface TimingDecl {
  timing: FeedTiming;
  delayMinutes: number;
  source: string;
}

export interface AppConfig {
  port: number;
  mode: 'live' | 'demo';
  quoteProvider: 'twelvedata' | 'finnhub' | null;
  twelvedata: {
    apiKey: string | null;
    baseUrl: string;
    perMinute: number | null;
    perDay: number | null;
    prepost: boolean;
    timing: Record<'US' | 'TSX', TimingDecl>;
  };
  finnhub: {
    apiKey: string | null;
    baseUrl: string;
    perMinute: number | null;
    timing: Record<'US' | 'TSX', TimingDecl>;
  };
  minQuoteRefreshSec: number;
  closedMarketRefreshSec: number;
  newsRefreshSec: number;
  newsLookbackDays: number;
  earningsLookaheadDays: number;
}

type Env = Record<string, string | undefined>;

function str(env: Env, k: string): string | null {
  const v = env[k]?.trim();
  return v ? v : null;
}

function int(env: Env, k: string, def: number | null): number | null {
  const v = str(env, k);
  if (v === null) return def;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid ${k}: "${v}" (expected a non-negative number)`);
  return n === 0 ? null : n; // 0 = unlimited
}

function timing(env: Env, k: string, def: FeedTiming, delayKey: string, defDelay: number, defSource: string): TimingDecl {
  const v = str(env, k);
  if (v !== null && !['real-time', 'delayed', 'end-of-day'].includes(v)) {
    throw new Error(`Invalid ${k}: "${v}" (expected real-time | delayed | end-of-day)`);
  }
  const delay = int(env, delayKey, defDelay) ?? 0;
  return {
    timing: (v as FeedTiming) ?? def,
    delayMinutes: (v ?? def) === 'real-time' ? 0 : delay,
    source: v ? `Declared in ${k}` : defSource,
  };
}

export function loadConfig(env: Env = process.env): AppConfig {
  const tdKey = str(env, 'TWELVEDATA_API_KEY');
  const fhKey = str(env, 'FINNHUB_API_KEY');
  const modeRaw = (str(env, 'MARKETPULSE_MODE') ?? 'live').toLowerCase();
  if (modeRaw !== 'live' && modeRaw !== 'demo') throw new Error(`Invalid MARKETPULSE_MODE "${modeRaw}" (live | demo)`);

  const qpRaw = str(env, 'QUOTE_PROVIDER');
  if (qpRaw && qpRaw !== 'twelvedata' && qpRaw !== 'finnhub') throw new Error(`Invalid QUOTE_PROVIDER "${qpRaw}" (twelvedata | finnhub)`);
  const quoteProvider = (qpRaw as 'twelvedata' | 'finnhub' | null) ?? (tdKey ? 'twelvedata' : fhKey ? 'finnhub' : null);

  return {
    port: int(env, 'PORT', 8787) ?? 8787,
    mode: modeRaw,
    quoteProvider,
    twelvedata: {
      apiKey: tdKey,
      baseUrl: str(env, 'TWELVEDATA_BASE_URL') ?? 'https://api.twelvedata.com',
      // Defaults = Twelve Data free "Basic" plan limits (8 credits/min, 800/day). Set to your plan's values.
      perMinute: int(env, 'TWELVEDATA_CREDITS_PER_MINUTE', 8),
      perDay: int(env, 'TWELVEDATA_CREDITS_PER_DAY', 800),
      prepost: (str(env, 'TWELVEDATA_PREPOST') ?? 'false') === 'true',
      timing: {
        // Conservative default: label US data "delayed" until you declare your plan's timing.
        US: timing(env, 'TWELVEDATA_US_TIMING', 'delayed', 'TWELVEDATA_US_DELAY_MINUTES', 15, 'Default (conservative) — set TWELVEDATA_US_TIMING to match your plan'),
        // Twelve Data's XTSE exchange page lists the Toronto Stock Exchange delay as "EOD".
        TSX: timing(env, 'TWELVEDATA_TSX_TIMING', 'end-of-day', 'TWELVEDATA_TSX_DELAY_MINUTES', 0, 'Twelve Data exchange page lists XTSE as end-of-day'),
      },
    },
    finnhub: {
      apiKey: fhKey,
      baseUrl: str(env, 'FINNHUB_BASE_URL') ?? 'https://finnhub.io/api/v1',
      // Finnhub free tier is documented at 60 calls/min; keep headroom by default.
      perMinute: int(env, 'FINNHUB_CALLS_PER_MINUTE', 50),
      timing: {
        US: timing(env, 'FINNHUB_US_TIMING', 'delayed', 'FINNHUB_US_DELAY_MINUTES', 15, 'Default (conservative) — set FINNHUB_US_TIMING to match your plan'),
        TSX: timing(env, 'FINNHUB_TSX_TIMING', 'end-of-day', 'FINNHUB_TSX_DELAY_MINUTES', 0, 'Default — Finnhub documents TSX as end-of-day outside enterprise feeds'),
      },
    },
    minQuoteRefreshSec: int(env, 'MIN_QUOTE_REFRESH_SECONDS', 60) ?? 60,
    closedMarketRefreshSec: int(env, 'CLOSED_MARKET_REFRESH_SECONDS', 900) ?? 900,
    newsRefreshSec: int(env, 'NEWS_REFRESH_SECONDS', 600) ?? 600,
    newsLookbackDays: int(env, 'NEWS_LOOKBACK_DAYS', 7) ?? 7,
    earningsLookaheadDays: int(env, 'EARNINGS_LOOKAHEAD_DAYS', 120) ?? 120,
  };
}

export const regionOf = (ex: ExchangeCode): 'US' | 'TSX' => (ex === 'TSX' ? 'TSX' : 'US');
