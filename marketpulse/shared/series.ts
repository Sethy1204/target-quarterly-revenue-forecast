import type { ChartPoint } from './types.js';

export interface NamedSeries {
  id: string;
  points: ChartPoint[];
}

export interface NormalizedSeries {
  id: string;
  baseline: ChartPoint | null;
  points: { t: number; pct: number }[];
}

/**
 * Normalises several price series to % change from a *common* baseline time:
 * the latest first-timestamp among all series (so every line starts at 0% at the
 * same moment). Series with no data at/after the baseline are returned empty.
 */
export function normalizeToCommonBaseline(series: NamedSeries[]): { baselineTime: number | null; series: NormalizedSeries[] } {
  const withData = series.filter((s) => s.points.length > 0);
  if (withData.length === 0) {
    return { baselineTime: null, series: series.map((s) => ({ id: s.id, baseline: null, points: [] })) };
  }
  const baselineTime = Math.max(...withData.map((s) => Math.min(...s.points.map((p) => p.t))));
  return {
    baselineTime,
    series: series.map((s) => {
      const sorted = [...s.points].sort((a, b) => a.t - b.t);
      const base = sorted.find((p) => p.t >= baselineTime && Number.isFinite(p.close) && p.close !== 0) ?? null;
      if (!base) return { id: s.id, baseline: null, points: [] };
      return {
        id: s.id,
        baseline: base,
        points: sorted.filter((p) => p.t >= base.t).map((p) => ({ t: p.t, pct: (p.close / base.close - 1) * 100 })),
      };
    }),
  };
}
