import { describe, expect, it } from 'vitest';
import { normalizeToCommonBaseline } from '../shared/series';

describe('comparison normalisation', () => {
  it('uses a common baseline (latest series start) for every line', () => {
    const r = normalizeToCommonBaseline([
      { id: 'a', points: [{ t: 1, close: 50 }, { t: 2, close: 100 }, { t: 3, close: 110 }] },
      { id: 'b', points: [{ t: 2, close: 20 }, { t: 3, close: 18 }] },
    ]);
    expect(r.baselineTime).toBe(2);
    expect(r.series[0].points).toEqual([{ t: 2, pct: 0 }, { t: 3, pct: expect.closeTo(10, 9) }]);
    expect(r.series[1].points).toEqual([{ t: 2, pct: 0 }, { t: 3, pct: expect.closeTo(-10, 9) }]);
  });
  it('handles empty series without inventing data', () => {
    const r = normalizeToCommonBaseline([{ id: 'a', points: [] }, { id: 'b', points: [{ t: 5, close: 10 }] }]);
    expect(r.series[0].points).toEqual([]);
    expect(r.series[1].points).toEqual([{ t: 5, pct: 0 }]);
    expect(normalizeToCommonBaseline([]).baselineTime).toBeNull();
  });
});
