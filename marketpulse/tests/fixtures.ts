/**
 * Mock upstream responses shaped after the providers' documented formats.
 * These are TEST FIXTURES ONLY — not real market data.
 */
import type { FetchLike } from '../server/http';

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

/** epoch seconds */
export const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);

export function tdQuote(symbol: string, mic: string, currency: string, close: string, prev: string, iso: string, extra: Record<string, unknown> = {}) {
  return {
    symbol, name: `${symbol} test`, exchange: mic === 'XTSE' ? 'TSX' : mic === 'XNYS' ? 'NYSE' : 'NASDAQ', mic_code: mic, currency,
    datetime: iso.slice(0, 10), timestamp: sec(iso.slice(0, 10) + 'T13:30:00Z'), last_quote_at: sec(iso),
    open: prev, high: close, low: prev, close, volume: '1234567', previous_close: prev,
    change: String(Number(close) - Number(prev)), percent_change: '0', is_market_open: true, ...extra,
  };
}

export interface Call { url: URL; headers: Record<string, string> }

/** Route-based fake fetch that records calls. */
export function fakeFetch(route: (u: URL, call: Call) => Response | Promise<Response>): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const f: FetchLike = async (input, init) => {
    const url = new URL(input);
    const call = { url, headers: (init?.headers ?? {}) as Record<string, string> };
    calls.push(call);
    return route(url, call);
  };
  return { fetch: f, calls };
}
