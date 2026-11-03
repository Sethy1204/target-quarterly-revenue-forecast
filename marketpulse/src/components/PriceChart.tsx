import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChartRange } from '../../shared/types';

export interface ChartSeries {
  id: string;
  label: string;
  color: string;
  points: { t: number; v: number }[];
}

interface Props {
  series: ChartSeries[];
  mode: 'price' | 'percent';
  currency?: string;
  range: ChartRange;
  timeZone: string;
  /** Plot by point index instead of time (removes overnight gaps for single intraday series). */
  indexAxis?: boolean;
  height?: number;
  watermark?: string;
}

const PAD = { l: 12, r: 64, t: 12, b: 28 };

function niceTicks(min: number, max: number, count = 5): number[] {
  if (!(max > min)) return [min];
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

function fmtX(t: number, range: ChartRange, tz: string): string {
  const intraday = range === '1D' || range === '5D';
  const o: Intl.DateTimeFormatOptions =
    range === '1D' ? { hour: 'numeric', minute: '2-digit' } : intraday ? { weekday: 'short', hour: 'numeric' } : { month: 'short', day: 'numeric' };
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, ...o }).format(t);
}

function fmtTip(t: number, range: ChartRange, tz: string): string {
  const intraday = range === '1D' || range === '5D';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    month: 'short',
    day: 'numeric',
    year: intraday ? undefined : 'numeric',
    hour: intraday ? 'numeric' : undefined,
    minute: intraday ? '2-digit' : undefined,
    timeZoneName: intraday ? 'short' : undefined,
  }).format(t);
}

export function PriceChart({ series, mode, currency, range, timeZone, indexAxis = false, height = 260, watermark }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(260, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const active = series.filter((s) => s.points.length > 0);
  const geo = useMemo(() => {
    if (!active.length) return null;
    const all = active.flatMap((s) => s.points);
    let vMin = Math.min(...all.map((p) => p.v));
    let vMax = Math.max(...all.map((p) => p.v));
    if (mode === 'percent') {
      vMin = Math.min(vMin, 0);
      vMax = Math.max(vMax, 0);
    }
    const padV = (vMax - vMin || Math.abs(vMax) || 1) * 0.08;
    vMin -= padV;
    vMax += padV;
    const ref = active[0].points;
    const tMin = indexAxis ? 0 : Math.min(...all.map((p) => p.t));
    const tMax = indexAxis ? Math.max(1, ref.length - 1) : Math.max(...all.map((p) => p.t));
    const iw = width - PAD.l - PAD.r;
    const ih = height - PAD.t - PAD.b;
    const xOf = (t: number, i: number) => PAD.l + ((indexAxis ? i : t) - tMin) / (tMax - tMin || 1) * iw;
    const yOf = (v: number) => PAD.t + (1 - (v - vMin) / (vMax - vMin)) * ih;
    return { vMin, vMax, tMin, tMax, xOf, yOf, iw, ih, ref };
  }, [active, mode, width, height, indexAxis]);

  if (!geo) return <div className="chart-empty">No data to plot.</div>;
  const { vMin, vMax, xOf, yOf, ref } = geo;
  const yTicks = niceTicks(vMin, vMax, 5);
  const xIdx = Array.from(new Set([0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * (ref.length - 1)))));

  const onMove = (clientX: number) => {
    const el = wrap.current;
    if (!el) return;
    const x = clientX - el.getBoundingClientRect().left;
    let best = 0;
    let bestD = Infinity;
    ref.forEach((p, i) => {
      const d = Math.abs(xOf(p.t, i) - x);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    setHover(best);
  };

  const hp = hover !== null ? ref[hover] : null;
  const hx = hp ? xOf(hp.t, hover!) : 0;
  const nearest = (s: ChartSeries, t: number) => {
    let best: { t: number; v: number } | null = null;
    for (const p of s.points) if (p.t <= t && (!best || p.t > best.t)) best = p;
    return best;
  };
  const fmtV = (v: number) => (mode === 'percent' ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : `${v.toFixed(2)}${currency ? ` ${currency}` : ''}`);

  return (
    <div
      className="chart"
      ref={wrap}
      onPointerMove={(e) => onMove(e.clientX)}
      onPointerLeave={() => setHover(null)}
      role="img"
      aria-label={`${mode === 'percent' ? 'Percentage comparison' : 'Price'} chart, ${range}`}
    >
      <svg width={width} height={height}>
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={width - PAD.r} y1={yOf(v)} y2={yOf(v)} className={mode === 'percent' && v === 0 ? 'grid zero' : 'grid'} />
            <text x={width - PAD.r + 6} y={yOf(v) + 4} className="axis">
              {mode === 'percent' ? `${v.toFixed(Math.abs(vMax - vMin) < 4 ? 1 : 0)}%` : v.toFixed(vMax - vMin < 5 ? 2 : vMax > 1000 ? 0 : 1)}
            </text>
          </g>
        ))}
        {xIdx.map((i) => (
          <text key={i} x={Math.min(Math.max(xOf(ref[i].t, i), PAD.l + 20), width - PAD.r - 20)} y={height - 8} className="axis" textAnchor="middle">
            {fmtX(ref[i].t, range, timeZone)}
          </text>
        ))}
        {active.map((s) => (
          <path
            key={s.id}
            d={s.points.map((p, i) => `${i ? 'L' : 'M'}${xOf(p.t, i).toFixed(1)},${yOf(p.v).toFixed(1)}`).join('')}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeLinejoin="round"
          />
        ))}
        {hp && (
          <g>
            <line x1={hx} x2={hx} y1={PAD.t} y2={height - PAD.b} className="crosshair" />
            {active.map((s) => {
              const p = indexAxis ? s.points[hover!] : nearest(s, hp.t);
              if (!p) return null;
              const i = indexAxis ? hover! : s.points.indexOf(p);
              return <circle key={s.id} cx={xOf(p.t, i)} cy={yOf(p.v)} r={3.5} fill={s.color} stroke="var(--bg)" strokeWidth={1.5} />;
            })}
          </g>
        )}
      </svg>
      {watermark && <div className="chart-watermark">{watermark}</div>}
      {hp && (
        <div className="chart-tip" style={{ left: Math.min(hx + 12, width - 190) }}>
          <div className="tip-time">{fmtTip(hp.t, range, timeZone)}</div>
          {active.map((s) => {
            const p = indexAxis ? s.points[hover!] : nearest(s, hp.t);
            return (
              <div key={s.id} className="tip-row">
                <span className="swatch" style={{ background: s.color }} />
                <span>{s.label}</span>
                <b>{p ? fmtV(p.v) : '—'}</b>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
