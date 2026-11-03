import { describe, expect, it } from 'vitest';
import { emptyAlertState, evaluateNewsAlerts, evaluateQuoteAlerts, type AlertRule } from '../shared/alerts';
import type { NewsItem, QuoteView } from '../shared/types';

function q(price: number | null, opts: Partial<QuoteView> = {}): QuoteView {
  return {
    listingId: 'MSFT:XNAS', symbol: 'MSFT', exchange: 'NASDAQ', currency: 'USD', providerCurrency: 'USD',
    price, change: null, changePercent: opts.changePercent ?? null, previousClose: 100, open: null, high: null, low: null, volume: null,
    quoteTime: opts.quoteTime ?? '2026-11-03T15:00:00Z', extended: null, providerMarketOpen: true, provider: 'Test', fetchedAt: '2026-11-03T15:00:05Z',
    session: { state: 'regular', label: 'Regular', localDate: opts.session?.localDate ?? '2026-11-03', calendarUncertain: false },
    freshness: opts.freshness ?? { level: 'delayed', label: 'Delayed', detail: '', ageSeconds: 10 },
    timing: 'delayed', delayMinutes: 15,
  };
}
const rule = (r: Partial<AlertRule>): AlertRule => ({ id: 'r1', type: 'price-above', listingId: 'MSFT:XNAS', threshold: 110, enabled: true, createdAt: '2026-11-01T00:00:00Z', ...r });

describe('price alerts', () => {
  it('fires once when crossing, not again while above, re-arms after dropping below', () => {
    let s = emptyAlertState();
    const rules = [rule({})];
    let r = evaluateQuoteAlerts(rules, [q(105)], s); s = r.state; expect(r.events).toHaveLength(0);
    r = evaluateQuoteAlerts(rules, [q(111, { quoteTime: '2026-11-03T15:01:00Z' })], s); s = r.state;
    expect(r.events).toHaveLength(1);
    expect(r.events[0].triggerValue).toBe(111);
    expect(r.events[0].currency).toBe('USD');
    expect(r.events[0].source).toBe('Test');
    expect(r.events[0].dataTime).toBe('2026-11-03T15:01:00Z');
    r = evaluateQuoteAlerts(rules, [q(112, { quoteTime: '2026-11-03T15:02:00Z' })], s); s = r.state; expect(r.events).toHaveLength(0);
    r = evaluateQuoteAlerts(rules, [q(112, { quoteTime: '2026-11-03T15:02:00Z' })], s); s = r.state; expect(r.events).toHaveLength(0);
    r = evaluateQuoteAlerts(rules, [q(108, { quoteTime: '2026-11-03T15:03:00Z' })], s); s = r.state; expect(r.events).toHaveLength(0);
    r = evaluateQuoteAlerts(rules, [q(110, { quoteTime: '2026-11-03T15:04:00Z' })], s); expect(r.events).toHaveLength(1);
  });
  it('price-below works and ignores missing/stale prices and disabled rules', () => {
    const rules = [rule({ type: 'price-below', threshold: 90 })];
    expect(evaluateQuoteAlerts(rules, [q(null)], emptyAlertState()).events).toHaveLength(0);
    expect(evaluateQuoteAlerts(rules, [q(80, { freshness: { level: 'stale', label: '', detail: '', ageSeconds: 9999 } })], emptyAlertState()).events).toHaveLength(0);
    expect(evaluateQuoteAlerts([{ ...rules[0], enabled: false }], [q(80)], emptyAlertState()).events).toHaveLength(0);
    expect(evaluateQuoteAlerts(rules, [q(80)], emptyAlertState()).events).toHaveLength(1);
  });
});

describe('daily % move alerts', () => {
  it('fires at most once per trading day per rule, in either direction', () => {
    const rules = [rule({ type: 'pct-move', threshold: 3 })];
    let s = emptyAlertState();
    let r = evaluateQuoteAlerts(rules, [q(96, { changePercent: -2.9 })], s); s = r.state; expect(r.events).toHaveLength(0);
    r = evaluateQuoteAlerts(rules, [q(96, { changePercent: -3.2 })], s); s = r.state; expect(r.events).toHaveLength(1);
    r = evaluateQuoteAlerts(rules, [q(95, { changePercent: -4.5 })], s); s = r.state; expect(r.events).toHaveLength(0);
    r = evaluateQuoteAlerts(rules, [q(104, { changePercent: 4, session: { state: 'regular', label: '', localDate: '2026-11-04', calendarUncertain: false } })], s);
    expect(r.events).toHaveLength(1);
  });
});

describe('news alerts', () => {
  const item = (id: string, at: string, companyIds = ['tesla']): NewsItem => ({
    id, headline: `Headline ${id}`, publisher: 'Pub', publishedAt: at, url: `https://example.com/${id}`, companyIds, summary: '', kind: 'not-specified', topics: [], provider: 'Finnhub', demo: false,
  });
  const rules: AlertRule[] = [{ id: 'n1', type: 'news', companyId: 'tesla', enabled: true, createdAt: '2026-11-03T12:00:00Z' }];
  it('seeds on first load, then fires once per new story', () => {
    let s = emptyAlertState();
    let r = evaluateNewsAlerts(rules, [item('a', '2026-11-03T13:00:00Z')], s); s = r.state;
    expect(r.events).toHaveLength(0); // initial snapshot is not "new"
    r = evaluateNewsAlerts(rules, [item('a', '2026-11-03T13:00:00Z'), item('b', '2026-11-03T14:00:00Z'), item('c', '2026-11-03T14:05:00Z', ['microsoft'])], s); s = r.state;
    expect(r.events.map((e) => e.headline)).toEqual(['Headline b']);
    expect(r.events[0].source).toBe('Pub');
    expect(r.events[0].url).toBe('https://example.com/b');
    r = evaluateNewsAlerts(rules, [item('b', '2026-11-03T14:00:00Z')], s);
    expect(r.events).toHaveLength(0); // duplicate prevented
  });
  it('does not alert on old stories that appear late', () => {
    const s = evaluateNewsAlerts(rules, [], emptyAlertState()).state;
    expect(evaluateNewsAlerts(rules, [item('old', '2026-10-01T00:00:00Z')], s).events).toHaveLength(0);
  });
});
