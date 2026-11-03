import { isNum } from './market.js';
import type { NewsItem, QuoteView } from './types.js';

export type AlertType = 'price-above' | 'price-below' | 'pct-move' | 'news';

export interface AlertRule {
  id: string;
  type: AlertType;
  /** Listing for price / pct rules. */
  listingId?: string;
  /** Company for news rules. */
  companyId?: string;
  /** Price (in the listing currency) or absolute % for pct-move. */
  threshold?: number;
  enabled: boolean;
  createdAt: string;
}

export interface AlertEvent {
  /** Dedupe key — the same key never fires twice. */
  key: string;
  ruleId: string;
  type: AlertType;
  companyId: string | null;
  listingId: string | null;
  message: string;
  /** Triggering price/% (quote rules) — null for news. */
  triggerValue: number | null;
  currency: string | null;
  headline?: string;
  url?: string;
  /** Provider (quotes) or publisher (news). */
  source: string;
  /** Provider timestamp of the triggering data. */
  dataTime: string | null;
  triggeredAt: string;
  demo: boolean;
}

export interface AlertEngineState {
  /** price rules: false after firing until the condition clears (hysteresis prevents repeats). */
  armed: Record<string, boolean>;
  /** Keys already fired (bounded). */
  firedKeys: string[];
  /** News ids already seen (bounded); first evaluation seeds without firing. */
  seenNews: string[];
  newsSeeded: boolean;
}

export const emptyAlertState = (): AlertEngineState => ({ armed: {}, firedKeys: [], seenNews: [], newsSeeded: false });

const MAX_KEYS = 1000;
const MAX_NEWS = 3000;
export const NEWS_GRACE_MS = 15 * 60_000;

function pushBounded(arr: string[], v: string, max: number): string[] {
  const next = [...arr, v];
  return next.length > max ? next.slice(next.length - max) : next;
}

export function evaluateQuoteAlerts(
  rules: AlertRule[],
  quotes: QuoteView[],
  state: AlertEngineState,
  now: Date = new Date(),
): { events: AlertEvent[]; state: AlertEngineState } {
  let armed = { ...state.armed };
  let firedKeys = state.firedKeys;
  const fired = new Set(firedKeys);
  const events: AlertEvent[] = [];

  for (const rule of rules) {
    if (!rule.enabled || !rule.listingId || rule.type === 'news') continue;
    const q = quotes.find((x) => x.listingId === rule.listingId);
    if (!q || !isNum(q.price) || !isNum(rule.threshold)) continue;
    // Do not trigger on data we know is stale or of unknown age.
    if (q.freshness.level === 'stale' || q.freshness.level === 'unknown') continue;

    if (rule.type === 'price-above' || rule.type === 'price-below') {
      const cond = rule.type === 'price-above' ? q.price >= rule.threshold : q.price <= rule.threshold;
      const isArmed = armed[rule.id] !== false;
      if (!cond) {
        armed[rule.id] = true; // re-arm once the price moves back across the threshold
        continue;
      }
      if (!isArmed) continue;
      const key = `${rule.id}:${q.quoteTime ?? q.fetchedAt}`;
      armed[rule.id] = false;
      if (fired.has(key)) continue;
      fired.add(key);
      firedKeys = pushBounded(firedKeys, key, MAX_KEYS);
      events.push({
        key,
        ruleId: rule.id,
        type: rule.type,
        companyId: null,
        listingId: q.listingId,
        message: `${q.symbol} (${q.exchange}) ${rule.type === 'price-above' ? 'at or above' : 'at or below'} ${rule.threshold} ${q.currency}: last ${q.price} ${q.currency}`,
        triggerValue: q.price,
        currency: q.currency,
        source: q.provider,
        dataTime: q.quoteTime,
        triggeredAt: now.toISOString(),
        demo: q.freshness.level === 'demo',
      });
    } else if (rule.type === 'pct-move') {
      if (!isNum(q.changePercent)) continue;
      if (Math.abs(q.changePercent) < Math.abs(rule.threshold)) continue;
      // At most once per rule per exchange trading day.
      const key = `${rule.id}:${q.session.localDate}`;
      if (fired.has(key)) continue;
      fired.add(key);
      firedKeys = pushBounded(firedKeys, key, MAX_KEYS);
      events.push({
        key,
        ruleId: rule.id,
        type: rule.type,
        companyId: null,
        listingId: q.listingId,
        message: `${q.symbol} (${q.exchange}) daily move ${q.changePercent >= 0 ? '+' : ''}${q.changePercent.toFixed(2)}% (threshold ±${Math.abs(rule.threshold)}%) — last ${q.price} ${q.currency}`,
        triggerValue: q.changePercent,
        currency: q.currency,
        source: q.provider,
        dataTime: q.quoteTime,
        triggeredAt: now.toISOString(),
        demo: q.freshness.level === 'demo',
      });
    }
  }
  return { events, state: { ...state, armed, firedKeys } };
}

export function evaluateNewsAlerts(
  rules: AlertRule[],
  items: NewsItem[],
  state: AlertEngineState,
  now: Date = new Date(),
): { events: AlertEvent[]; state: AlertEngineState } {
  const seen = new Set(state.seenNews);
  let seenNews = state.seenNews;
  let firedKeys = state.firedKeys;
  const fired = new Set(firedKeys);
  const events: AlertEvent[] = [];
  const newItems = items.filter((i) => !seen.has(i.id));

  if (state.newsSeeded) {
    for (const rule of rules) {
      if (!rule.enabled || rule.type !== 'news' || !rule.companyId) continue;
      for (const item of newItems) {
        if (!item.companyIds.includes(rule.companyId)) continue;
        // Only stories published after the rule existed count as "new company news". A short grace
        // window absorbs second-precision feed timestamps and normal feed latency; anything older
        // that shows up late is treated as an old story and never alerted.
        if (Date.parse(item.publishedAt) < Date.parse(rule.createdAt) - NEWS_GRACE_MS) continue;
        const key = `${rule.id}:${item.id}`;
        if (fired.has(key)) continue;
        fired.add(key);
        firedKeys = pushBounded(firedKeys, key, MAX_KEYS);
        events.push({
          key,
          ruleId: rule.id,
          type: 'news',
          companyId: rule.companyId,
          listingId: null,
          message: item.headline,
          triggerValue: null,
          currency: null,
          headline: item.headline,
          url: item.url,
          source: item.publisher,
          dataTime: item.publishedAt,
          triggeredAt: now.toISOString(),
          demo: item.demo,
        });
      }
    }
  }
  for (const item of newItems) seenNews = pushBounded(seenNews, item.id, MAX_NEWS);
  return { events, state: { ...state, seenNews, firedKeys, newsSeeded: true } };
}
