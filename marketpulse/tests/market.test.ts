import { describe, expect, it } from 'vitest';
import { computeChange, getSession, shiftLocalDate, toNum, zonedLocalToEpoch } from '../shared/market';

describe('percentage calculations', () => {
  it('computes change and % vs previous close', () => {
    expect(computeChange(105, 100)).toEqual({ change: 5, changePercent: 5 });
    expect(computeChange(98.5, 100)).toEqual({ change: -1.5, changePercent: -1.5 });
    const r = computeChange(33.33, 30)!;
    expect(r.change).toBeCloseTo(3.33, 6);
    expect(r.changePercent).toBeCloseTo(11.1, 6);
  });
  it('returns null (never 0) when inputs are missing', () => {
    expect(computeChange(null, 100)).toEqual({ change: null, changePercent: null });
    expect(computeChange(100, null)).toEqual({ change: null, changePercent: null });
    expect(computeChange(100, 0).changePercent).toBeNull();
  });
  it('parses provider numerics without inventing zeros', () => {
    expect(toNum('12.5')).toBe(12.5);
    expect(toNum('')).toBeNull();
    expect(toNum(null)).toBeNull();
    expect(toNum('NaN')).toBeNull();
    expect(toNum(undefined)).toBeNull();
    expect(toNum('0')).toBe(0);
  });
});

describe('market sessions (exchange-local time)', () => {
  // 2026-11-03 is a Tuesday. EST (UTC-5) after 2026-11-01.
  it('US regular / pre / after / closed', () => {
    expect(getSession('NASDAQ', new Date('2026-11-03T14:31:00Z')).state).toBe('regular'); // 09:31 ET
    expect(getSession('NASDAQ', new Date('2026-11-03T14:29:00Z')).state).toBe('pre-market'); // 09:29 ET
    expect(getSession('NYSE', new Date('2026-11-03T21:00:00Z')).state).toBe('after-hours'); // 16:00 ET
    expect(getSession('NYSE', new Date('2026-11-04T01:00:00Z')).state).toBe('closed'); // 20:00 ET
    expect(getSession('NYSE', new Date('2026-11-03T08:59:00Z')).state).toBe('closed'); // 03:59 ET
  });
  it('handles daylight time (EDT, UTC-4)', () => {
    expect(getSession('NASDAQ', new Date('2026-07-15T13:30:00Z')).state).toBe('regular'); // 09:30 EDT
    expect(getSession('NASDAQ', new Date('2026-07-15T13:29:00Z')).state).toBe('pre-market');
  });
  it('weekends and holidays', () => {
    expect(getSession('NASDAQ', new Date('2026-11-07T15:00:00Z')).state).toBe('closed'); // Saturday
    expect(getSession('NASDAQ', new Date('2026-11-26T15:00:00Z')).state).toBe('holiday'); // US Thanksgiving
    expect(getSession('TSX', new Date('2026-11-26T15:00:00Z')).state).toBe('regular'); // TSX open on US Thanksgiving
    expect(getSession('TSX', new Date('2026-10-12T15:00:00Z')).state).toBe('holiday'); // Canadian Thanksgiving
    expect(getSession('NYSE', new Date('2026-10-12T15:00:00Z')).state).toBe('regular');
  });
  it('US early close at 13:00 ET', () => {
    expect(getSession('NYSE', new Date('2026-11-27T17:59:00Z')).state).toBe('regular'); // 12:59 ET
    expect(getSession('NYSE', new Date('2026-11-27T18:01:00Z')).state).toBe('after-hours');
  });
  it('TSX has no extended continuous session', () => {
    expect(getSession('TSX', new Date('2026-11-03T21:30:00Z')).state).toBe('closed'); // 16:30 ET
    expect(getSession('TSX', new Date('2026-11-03T13:00:00Z')).label).toMatch(/Pre-open/); // 08:00 ET
  });
  it('flags years without a holiday table', () => {
    expect(getSession('NYSE', new Date('2029-03-01T15:00:00Z')).calendarUncertain).toBe(true);
    expect(getSession('NYSE', new Date('2026-03-02T15:00:00Z')).calendarUncertain).toBe(false);
  });
});

describe('timezone conversion', () => {
  it('converts exchange-local wall time to UTC across DST', () => {
    expect(new Date(zonedLocalToEpoch('2026-11-03 09:30:00', 'America/New_York')!).toISOString()).toBe('2026-11-03T14:30:00.000Z');
    expect(new Date(zonedLocalToEpoch('2026-07-15 09:30:00', 'America/Toronto')!).toISOString()).toBe('2026-07-15T13:30:00.000Z');
    expect(new Date(zonedLocalToEpoch('2026-07-15', 'America/Toronto')!).toISOString()).toBe('2026-07-15T20:00:00.000Z');
    expect(zonedLocalToEpoch('garbage', 'UTC')).toBeNull();
  });
  it('shifts local dates', () => {
    const now = new Date('2026-11-03T03:00:00Z'); // still Nov 2 in Toronto
    expect(shiftLocalDate(now, 'America/Toronto', {})).toBe('2026-11-02');
    expect(shiftLocalDate(now, 'America/Toronto', { months: -1 })).toBe('2026-10-02');
    expect(shiftLocalDate(now, 'America/Toronto', { days: -7 })).toBe('2026-10-26');
  });
});
