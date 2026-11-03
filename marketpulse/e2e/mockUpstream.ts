/**
 * TEST-ONLY mock of the Twelve Data and Finnhub endpoints MarketPulse uses, shaped after
 * their documented responses. Used by the end-to-end smoke test to exercise the full path
 * (provider → server → UI → refresh → alert) without network access.
 * Values are fixed test numbers, never presented as market data.
 */
import { createServer, type Server } from 'node:http';

export interface MockState {
  prices: Record<string, number>;
  news: { symbol: string; headline: string; url: string; source: string; datetime: number }[];
  calls: string[];
}

export function startMockUpstream(port: number): Promise<{ server: Server; state: MockState }> {
  const state: MockState = {
    prices: { SPCX: 150, T: 20, TU: 14.5, TTWO: 230, JNJ: 160, CRWV: 110, TSLA: 300, MSFT: 100, GOOGL: 180, GOOG: 181 },
    news: [],
    calls: [],
  };
  const nowSec = () => Math.floor(Date.now() / 1000);
  const quote = (s: string, mic: string) => {
    const close = state.prices[s];
    if (close === undefined) return { status: 'error', code: 404, message: `symbol ${s} not found` };
    const prev = Math.round(close * 0.98 * 100) / 100;
    return {
      symbol: s, name: `${s} (mock)`, exchange: mic === 'XTSE' ? 'TSX' : mic === 'XNYS' ? 'NYSE' : 'NASDAQ', mic_code: mic,
      currency: mic === 'XTSE' ? 'CAD' : 'USD', datetime: new Date().toISOString().slice(0, 10), timestamp: nowSec() - 3600,
      last_quote_at: nowSec() - 30, open: String(prev), high: String(close + 1), low: String(prev - 1), close: String(close),
      volume: s === 'GOOG' ? '' : '1000000', previous_close: String(prev), change: String(close - prev), percent_change: '0', is_market_open: true,
    };
  };
  const server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    state.calls.push(u.pathname + u.search);
    const send = (body: unknown, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (u.pathname === '/td/quote') {
      const mic = u.searchParams.get('mic_code') ?? 'XNAS';
      const syms = (u.searchParams.get('symbol') ?? '').split(',');
      return send(syms.length === 1 ? quote(syms[0], mic) : Object.fromEntries(syms.map((s) => [s, quote(s, mic)])));
    }
    if (u.pathname === '/td/time_series') {
      const s = u.searchParams.get('symbol')!;
      const interval = u.searchParams.get('interval')!;
      const n = interval === '1day' ? 60 : 78;
      const values = Array.from({ length: n }, (_, i) => {
        const d = new Date(Date.now() - i * (interval === '1day' ? 86_400_000 : interval === '30min' ? 1_800_000 : 300_000));
        const local = d.toISOString().replace('T', ' ').slice(0, 19);
        return { datetime: interval === '1day' ? local.slice(0, 10) : local, close: String((state.prices[s] ?? 50) * (1 - i * 0.001)) };
      });
      return send({ meta: { symbol: s, currency: u.searchParams.get('mic_code') === 'XTSE' ? 'CAD' : 'USD', exchange_timezone: 'UTC' }, values, status: 'ok' });
    }
    if (u.pathname === '/fh/company-news') {
      const sym = u.searchParams.get('symbol');
      return send(state.news.filter((n) => n.symbol === sym).map((n) => ({ ...n, category: 'company', summary: '', related: sym })));
    }
    if (u.pathname === '/fh/calendar/earnings') return send({ earningsCalendar: [] });
    if (u.pathname === '/fh/stock/profile2') return send({ marketCapitalization: 2000, currency: 'USD' });
    send({ error: 'not mocked' }, 404);
  });
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r({ server, state })));
}
