import express, { type Express, type Request, type Response } from 'express';
import { ALL_LISTINGS, COMPANIES, getListing, type ExchangeCode } from '../shared/companies.js';
import { CHART_RANGES, type ChartRange, type ConfigResponse, type ProviderInfo } from '../shared/types.js';
import type { AppConfig } from './config.js';
import type { FetchLike } from './http.js';
import { buildProviders } from './providers/registry.js';
import type { ProviderSet } from './providers/types.js';
import { ChartService } from './services/charts.js';
import { NewsService } from './services/news.js';
import { QuoteService } from './services/quotes.js';
import { EarningsService, FundamentalsService } from './services/reference.js';

export interface AppDeps {
  cfg: AppConfig;
  fetchImpl?: FetchLike;
  providers?: ProviderSet;
  now?: () => number;
}

export function missingSetup(cfg: AppConfig): string[] {
  if (cfg.mode === 'demo') return [];
  const m: string[] = [];
  if (!cfg.twelvedata.apiKey) m.push('TWELVEDATA_API_KEY (quotes for US + TSX listings, and price charts)');
  if (!cfg.finnhub.apiKey) m.push('FINNHUB_API_KEY (company news, earnings calendar, market capitalisation)');
  return m;
}

export function createApp({ cfg, fetchImpl = fetch, providers, now = Date.now }: AppDeps): Express {
  const p = providers ?? buildProviders(cfg, fetchImpl);
  const quotes = new QuoteService(p.quotes, cfg, p.demo, now);
  const charts = new ChartService(p.charts, p.demo, now);
  const news = new NewsService(p.news, cfg, p.demo, now);
  const earnings = new EarningsService(p.earnings, cfg.earningsLookaheadDays, p.demo, now);
  const fundamentals = new FundamentalsService(p.fundamentals, p.demo, now);

  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response) => {
    fn(req, res).catch((e) => {
      console.error('[api]', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Internal error' });
    });
  };

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, time: new Date(now()).toISOString() });
  });

  app.get('/api/config', (_req, res) => {
    const providers: ProviderInfo[] = [
      { role: 'quotes', provider: p.quotes?.name ?? 'not configured', configured: !!p.quotes, docsUrl: p.quotes?.docsUrl ?? '', notes: p.quotes?.name === 'Finnhub' ? ['Finnhub /quote has no volume field; TSX coverage depends on plan.'] : [] },
      { role: 'charts', provider: p.charts?.name ?? 'not configured', configured: !!p.charts, docsUrl: p.charts?.docsUrl ?? '', notes: [] },
      { role: 'news', provider: p.news?.name ?? 'not configured', configured: !!p.news, docsUrl: p.news?.docsUrl ?? '', notes: ['Summaries are shown only when supplied by the feed.'] },
      { role: 'earnings', provider: p.earnings?.name ?? 'not configured', configured: !!p.earnings, docsUrl: '', notes: ['Provider does not mark dates as company-confirmed.'] },
      { role: 'fundamentals', provider: p.fundamentals?.name ?? 'not configured', configured: !!p.fundamentals, docsUrl: '', notes: ['Market cap from company profile; updated a few times per day.'] },
    ];
    const exchanges: ExchangeCode[] = ['NASDAQ', 'NYSE', 'TSX'];
    const body: ConfigResponse = {
      mode: p.demo ? 'demo' : p.quotes || p.news ? 'live' : 'unconfigured',
      providers,
      timing: p.quotes ? exchanges.map((ex) => ({ exchange: ex, ...p.quotes!.timingFor(ex) })) : [],
      missing: missingSetup(cfg),
      companies: COMPANIES,
      serverTime: new Date(now()).toISOString(),
      backgroundAlerts: false,
    };
    res.json(body);
  });

  app.get(
    '/api/quotes',
    wrap(async (req, res) => {
      const idsParam = typeof req.query.ids === 'string' && req.query.ids ? req.query.ids.split(',') : ALL_LISTINGS.map((l) => l.id);
      const unknown = idsParam.filter((id) => !getListing(id));
      if (unknown.length) return res.status(400).json({ error: `Unknown listing id(s): ${unknown.join(', ')}` });
      res.json(await quotes.get(idsParam, req.query.force === '1'));
    }),
  );

  app.get(
    '/api/chart',
    wrap(async (req, res) => {
      const listing = getListing(String(req.query.listing ?? ''));
      const range = String(req.query.range ?? '') as ChartRange;
      if (!listing) return res.status(400).json({ error: 'Unknown listing' });
      if (!CHART_RANGES.includes(range)) return res.status(400).json({ error: `range must be one of ${CHART_RANGES.join(', ')}` });
      res.json(await charts.get(listing, range));
    }),
  );

  app.get('/api/news', wrap(async (req, res) => res.json(await news.get(req.query.force === '1'))));
  app.get('/api/earnings', wrap(async (_req, res) => res.json(await earnings.get())));
  app.get('/api/fundamentals', wrap(async (_req, res) => res.json(await fundamentals.get())));

  return app;
}
