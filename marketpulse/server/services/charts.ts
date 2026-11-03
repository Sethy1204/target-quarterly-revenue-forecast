import type { ListingDef } from '../../shared/companies.js';
import type { ChartRange, ChartResponse } from '../../shared/types.js';
import { ProviderError } from '../http.js';
import type { ChartProvider } from '../providers/types.js';

const TTL_SEC: Record<ChartRange, number> = { '1D': 120, '5D': 900, '1M': 3600, '6M': 3600, YTD: 3600, '1Y': 3600 };

export class ChartService {
  private cache = new Map<string, { res: ChartResponse; at: number }>();
  private inflight = new Map<string, Promise<ChartResponse>>();

  constructor(
    private provider: ChartProvider | null,
    private demo: boolean,
    private now: () => number = Date.now,
  ) {}

  async get(listing: ListingDef, range: ChartRange, minTtlSec = 0): Promise<ChartResponse> {
    const key = `${listing.id}:${range}`;
    const hit = this.cache.get(key);
    const ttl = Math.max(TTL_SEC[range], minTtlSec) * 1000;
    if (hit && this.now() - hit.at < ttl) return hit.res;
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const p = this.load(listing, range, hit?.res).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private base(listing: ListingDef, range: ChartRange): Omit<ChartResponse, 'points' | 'interval' | 'fetchedAt'> {
    return {
      listingId: listing.id,
      range,
      currency: listing.currency,
      provider: this.provider?.name ?? 'none',
      timing: this.provider?.timingFor(listing.exchange).timing ?? 'end-of-day',
      demo: this.demo,
    };
  }

  private async load(listing: ListingDef, range: ChartRange, stale?: ChartResponse): Promise<ChartResponse> {
    if (!this.provider) {
      return { ...this.base(listing, range), interval: '', points: [], fetchedAt: new Date(this.now()).toISOString(), unavailableReason: 'No chart provider configured (requires TWELVEDATA_API_KEY).' };
    }
    try {
      const r = await this.provider.fetchChart(listing, range, new Date(this.now()));
      const res: ChartResponse = {
        ...this.base(listing, range),
        interval: r.interval,
        points: r.points,
        fetchedAt: new Date(this.now()).toISOString(),
        unavailableReason: r.points.length === 0 ? 'Provider returned no data points for this range.' : undefined,
      };
      if (r.points.length > 0) this.cache.set(`${listing.id}:${range}`, { res, at: this.now() });
      return res;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (stale) return { ...stale, unavailableReason: `Showing cached series from ${stale.fetchedAt}; refresh failed: ${msg}` };
      const hint = e instanceof ProviderError && (e.kind === 'plan' || e.kind === 'not-found') ? ' This range/exchange may not be included in your provider plan.' : '';
      return { ...this.base(listing, range), interval: '', points: [], fetchedAt: new Date(this.now()).toISOString(), unavailableReason: `${msg}${hint}` };
    }
  }
}
