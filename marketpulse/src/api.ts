import type { ChartRange, ChartResponse, ConfigResponse, EarningsResponse, FundamentalsResponse, NewsResponse, QuotesResponse } from '../shared/types';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number | null,
  ) {
    super(message);
  }
}

async function get<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch {
    throw new ApiError('Cannot reach the MarketPulse server (disconnected?)', null);
  }
  if (!res.ok) {
    let msg = `Server error (HTTP ${res.status})`;
    try {
      const b = await res.json();
      if (b?.error) msg = b.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(msg, res.status);
  }
  return res.json() as Promise<T>;
}

export const api = {
  config: () => get<ConfigResponse>('/api/config'),
  quotes: (ids: string[], force: boolean) => get<QuotesResponse>(`/api/quotes?ids=${encodeURIComponent(ids.join(','))}${force ? '&force=1' : ''}`),
  chart: (listingId: string, range: ChartRange) => get<ChartResponse>(`/api/chart?listing=${encodeURIComponent(listingId)}&range=${range}`),
  news: (force: boolean) => get<NewsResponse>(`/api/news${force ? '?force=1' : ''}`),
  earnings: () => get<EarningsResponse>('/api/earnings'),
  fundamentals: () => get<FundamentalsResponse>('/api/fundamentals'),
};
