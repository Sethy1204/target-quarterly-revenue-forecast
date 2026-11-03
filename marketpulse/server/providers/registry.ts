import type { AppConfig } from '../config.js';
import type { FetchLike } from '../http.js';
import { DemoProvider } from './demo.js';
import { FinnhubProvider } from './finnhub.js';
import { TwelveDataProvider } from './twelvedata.js';
import type { ProviderSet } from './types.js';

/** Wires configured adapters to roles. Swap providers here without touching services or UI. */
export function buildProviders(cfg: AppConfig, fetchImpl: FetchLike = fetch): ProviderSet {
  if (cfg.mode === 'demo') {
    const d = new DemoProvider();
    return { demo: true, quotes: d, charts: d, news: d, earnings: d, fundamentals: d };
  }
  const td = cfg.twelvedata.apiKey ? new TwelveDataProvider(cfg.twelvedata, fetchImpl) : null;
  const fh = cfg.finnhub.apiKey ? new FinnhubProvider(cfg.finnhub, fetchImpl) : null;
  const quotes = cfg.quoteProvider === 'twelvedata' ? td : cfg.quoteProvider === 'finnhub' ? fh : null;
  return {
    demo: false,
    quotes,
    // Charts: Twelve Data /time_series. (Finnhub candles are not used: not part of its free plan.)
    charts: td,
    news: fh,
    earnings: fh,
    fundamentals: fh,
  };
}
