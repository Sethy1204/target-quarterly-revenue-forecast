import { describe, expect, it } from 'vitest';
import { fetchJson, ProviderError, redactText } from '../server/http';
import { RateGate } from '../server/rateGate';
import { jsonResponse } from './fixtures';

const noSleep = async () => {};
const failure = (p: Promise<unknown>): Promise<ProviderError> => p.then(() => { throw new Error('expected failure'); }, (e) => e as ProviderError);

describe('fetchJson retry/backoff', () => {
  it('retries network errors and 5xx, then succeeds', async () => {
    let n = 0;
    const delays: number[] = [];
    const out = await fetchJson('https://x.test/a', {
      retries: 2,
      sleep: async (ms) => { delays.push(ms); },
      fetchImpl: async () => {
        n++;
        if (n === 1) throw new TypeError('fetch failed');
        if (n === 2) return jsonResponse({}, 503);
        return jsonResponse({ ok: 1 });
      },
    });
    expect(out).toEqual({ ok: 1 });
    expect(n).toBe(3);
    expect(delays[1]).toBeGreaterThan(delays[0] - 100); // exponential-ish
  });
  it('does not retry 429 and reports Retry-After', async () => {
    let n = 0;
    const err = await failure(fetchJson('https://x.test/a', { sleep: noSleep, fetchImpl: async () => { n++; return jsonResponse({}, 429, { 'retry-after': '30' }); } }));
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.kind).toBe('rate-limit');
    expect(err.retryAfterMs).toBe(30_000);
    expect(n).toBe(1);
  });
  it('gives up after bounded retries', async () => {
    let n = 0;
    const err = await failure(fetchJson('https://x.test/a', { retries: 2, sleep: noSleep, fetchImpl: async () => { n++; throw new TypeError('down'); } }));
    expect(err.kind).toBe('network');
    expect(n).toBe(3);
  });
  it('maps auth/plan errors and redacts secrets', async () => {
    expect((await failure(fetchJson('u', { fetchImpl: async () => jsonResponse({}, 401) }))).kind).toBe('auth');
    expect((await failure(fetchJson('u', { fetchImpl: async () => jsonResponse({}, 403) }))).kind).toBe('plan');
    expect(redactText('GET https://a/b?apikey=SECRET123&x=1 failed SECRET123', ['SECRET123'])).not.toContain('SECRET123');
  });
});

describe('RateGate', () => {
  it('enforces per-minute budget and refills over time', () => {
    let t = 0;
    const g = new RateGate({ name: 'T', perMinute: 8, perDay: null, now: () => t });
    g.take(8);
    expect(() => g.take(1)).toThrow(/budget/);
    expect(g.msUntil(1)).toBe(7500);
    t = 7500;
    expect(() => g.take(1)).not.toThrow();
  });
  it('enforces the daily cap until the next UTC day', () => {
    let t = Date.parse('2026-11-03T23:00:00Z');
    const g = new RateGate({ name: 'T', perMinute: null, perDay: 10, now: () => t });
    g.take(10);
    expect(() => g.take(1)).toThrow();
    expect(g.msUntil(1)).toBe(3_600_000);
    t = Date.parse('2026-11-04T00:00:01Z');
    expect(() => g.take(1)).not.toThrow();
  });
  it('backs off exponentially after provider 429s', async () => {
    let t = 0;
    const g = new RateGate({ name: 'T', perMinute: null, perDay: null, now: () => t });
    const r429 = () => g.run(1, async () => { throw new ProviderError('429', 'rate-limit'); });
    await expect(r429()).rejects.toThrow();
    expect(g.msUntil(1)).toBe(60_000);
    t = 60_000;
    await expect(r429()).rejects.toThrow();
    expect(g.msUntil(1)).toBe(120_000);
    t = 180_000;
    await g.run(1, async () => 1);
    t = 180_001;
    await expect(r429()).rejects.toThrow();
    expect(g.msUntil(1)).toBe(60_000); // reset after success
  });
  it('rejects requests larger than the per-minute budget', () => {
    const g = new RateGate({ name: 'T', perMinute: 8, perDay: null });
    expect(g.msUntil(9)).toBe(Infinity);
  });
});
