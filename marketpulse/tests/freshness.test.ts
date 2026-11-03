import { describe, expect, it } from 'vitest';
import { classifyFreshness, type FreshnessInput } from '../shared/freshness';

const now = new Date('2026-11-03T15:00:00Z');
const base: FreshnessInput = {
  timing: 'delayed', delayMinutes: 15, quoteTime: '2026-11-03T14:44:00Z', now, session: 'regular',
  lastFetchFailed: false, fetchedAt: '2026-11-03T14:59:30Z', refreshIntervalSec: 90, demo: false,
};

describe('freshness classification', () => {
  it('labels a delayed feed as delayed — even if refreshed every few seconds', () => {
    const f = classifyFreshness({ ...base, refreshIntervalSec: 5 });
    expect(f.level).toBe('delayed');
    expect(f.label).toBe('Delayed ~15 min');
  });
  it('labels real-time only when the plan is declared real-time', () => {
    expect(classifyFreshness({ ...base, timing: 'real-time', delayMinutes: 0, quoteTime: '2026-11-03T14:59:00Z' }).level).toBe('real-time');
  });
  it('marks old quotes during an open session as stale', () => {
    const f = classifyFreshness({ ...base, timing: 'real-time', delayMinutes: 0, quoteTime: '2026-11-03T14:40:00Z' });
    expect(f.level).toBe('stale');
  });
  it('marks failing updates during an open session as stale', () => {
    const f = classifyFreshness({ ...base, lastFetchFailed: true, fetchedAt: '2026-11-03T14:50:00Z' });
    expect(f.level).toBe('stale');
    expect(f.warning).toMatch(/failed/);
  });
  it('uses end-of-day for EOD feeds and closed markets', () => {
    expect(classifyFreshness({ ...base, timing: 'end-of-day', quoteTime: '2026-11-02T21:00:00Z' }).level).toBe('end-of-day');
    expect(classifyFreshness({ ...base, session: 'closed', quoteTime: '2026-10-30T20:00:00Z' }).label).toBe('Last close');
  });
  it('marks very old closes as stale', () => {
    expect(classifyFreshness({ ...base, session: 'closed', quoteTime: '2026-10-20T20:00:00Z' }).level).toBe('stale');
  });
  it('handles missing timestamps and demo', () => {
    expect(classifyFreshness({ ...base, quoteTime: null }).level).toBe('unknown');
    expect(classifyFreshness({ ...base, demo: true }).level).toBe('demo');
  });
});
