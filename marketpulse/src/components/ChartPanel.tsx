import { useEffect, useState } from 'react';
import { ALL_LISTINGS, getCompany, getListing } from '../../shared/companies';
import { formatDateTime } from '../../shared/format';
import { normalizeToCommonBaseline } from '../../shared/series';
import { CHART_RANGES, type ChartRange, type ChartResponse } from '../../shared/types';
import { api } from '../api';
import { PriceChart, type ChartSeries } from './PriceChart';

const COLORS = ['#60a5fa', '#f59e0b', '#34d399', '#f472b6', '#a78bfa', '#22d3ee', '#fb7185', '#a3e635', '#fbbf24', '#94a3b8'];

interface Props {
  mode: 'single' | 'compare';
  listingId: string;
  compareIds: string[];
  range: ChartRange;
  timeZone: string;
  /** Changes when quotes refresh, so the 1D chart re-requests (server cache decides whether to call the provider). */
  refreshToken: number;
  availableIds: string[];
  onMode: (m: 'single' | 'compare') => void;
  onListing: (id: string) => void;
  onCompare: (ids: string[]) => void;
  onRange: (r: ChartRange) => void;
}

const labelOf = (id: string) => {
  const l = getListing(id)!;
  return `${l.symbol} · ${l.exchange} · ${l.currency}`;
};

export function ChartPanel(p: Props) {
  const ids = p.mode === 'single' ? [p.listingId] : p.compareIds;
  const [data, setData] = useState<Record<string, ChartResponse | { error: string }>>({});
  const [loading, setLoading] = useState(false);
  const key = `${ids.join(',')}|${p.range}`;
  const tokenDep = p.range === '1D' ? p.refreshToken : 0;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all(
      ids.map((id) =>
        api
          .chart(id, p.range)
          .then((r) => [id, r] as const)
          .catch((e: Error) => [id, { error: e.message }] as const),
      ),
    ).then((rows) => {
      if (cancelled) return;
      setData(Object.fromEntries(rows));
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tokenDep]);

  const responses = ids.map((id) => ({ id, r: data[id] }));
  const problems = responses
    .map(({ id, r }) => (!r ? null : 'error' in r ? `${labelOf(id)}: ${r.error}` : r.unavailableReason ? `${labelOf(id)}: ${r.unavailableReason}` : null))
    .filter(Boolean) as string[];
  const ok = responses.filter((x): x is { id: string; r: ChartResponse } => !!x.r && !('error' in x.r) && x.r.points.length > 0);
  const demo = ok.some((x) => x.r.demo);

  let series: ChartSeries[] = [];
  let baselineNote = '';
  if (p.mode === 'single' && ok[0]) {
    series = [{ id: ok[0].id, label: labelOf(ok[0].id), color: COLORS[0], points: ok[0].r.points.map((pt) => ({ t: pt.t, v: pt.close })) }];
  } else if (p.mode === 'compare') {
    const norm = normalizeToCommonBaseline(ok.map((x) => ({ id: x.id, points: x.r.points })));
    series = norm.series.map((s) => ({
      id: s.id,
      label: getListing(s.id)!.symbol,
      color: COLORS[ALL_LISTINGS.findIndex((l) => l.id === s.id) % COLORS.length],
      points: s.points.map((pt) => ({ t: pt.t, v: pt.pct })),
    }));
    if (norm.baselineTime) baselineNote = `All lines = % change from the first price at or after ${formatDateTime(new Date(norm.baselineTime).toISOString(), p.timeZone)} (common baseline). % change is currency-neutral; prices are not converted between CAD and USD.`;
  }
  const single = p.mode === 'single' ? ok[0]?.r : undefined;
  const first = single?.points[0]?.close;
  const last = single?.points[single.points.length - 1]?.close;
  const rangeChange = first !== undefined && last !== undefined && first !== 0 ? ((last - first) / first) * 100 : null;

  return (
    <section className="panel chart-panel" aria-labelledby="chart-h">
      <div className="panel-head">
        <h2 id="chart-h">Price chart</h2>
        <div className="seg" role="tablist" aria-label="Chart mode">
          <button role="tab" aria-selected={p.mode === 'single'} className={p.mode === 'single' ? 'on' : ''} onClick={() => p.onMode('single')}>
            Single
          </button>
          <button role="tab" aria-selected={p.mode === 'compare'} className={p.mode === 'compare' ? 'on' : ''} onClick={() => p.onMode('compare')}>
            Compare %
          </button>
        </div>
      </div>

      <div className="chart-controls">
        {p.mode === 'single' ? (
          <label className="field">
            <span className="sr-only">Listing</span>
            <select value={p.listingId} onChange={(e) => p.onListing(e.target.value)}>
              {p.availableIds.map((id) => (
                <option key={id} value={id}>
                  {getCompany(getListing(id)!.companyId)!.name} — {labelOf(id)}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="compare-picks" role="group" aria-label="Listings to compare">
            {p.availableIds.map((id) => {
              const on = p.compareIds.includes(id);
              return (
                <label key={id} className={`chip ${on ? 'on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => p.onCompare(on ? p.compareIds.filter((x) => x !== id) : [...p.compareIds, id])}
                  />
                  <span className="swatch" style={{ background: COLORS[ALL_LISTINGS.findIndex((l) => l.id === id) % COLORS.length] }} />
                  {getListing(id)!.symbol}
                  <small>{getListing(id)!.currency}</small>
                </label>
              );
            })}
          </div>
        )}
        <div className="seg" role="tablist" aria-label="Range">
          {CHART_RANGES.map((r) => (
            <button key={r} role="tab" aria-selected={p.range === r} className={p.range === r ? 'on' : ''} onClick={() => p.onRange(r)}>
              {r}
            </button>
          ))}
        </div>
      </div>

      {single && rangeChange !== null && (
        <div className="range-summary">
          {p.range} change (first → last point in series):{' '}
          <b className={rangeChange >= 0 ? 'up' : 'down'}>
            {rangeChange >= 0 ? '+' : ''}
            {rangeChange.toFixed(2)}%
          </b>{' '}
          <span className="muted">
            · {single.interval} bars · {single.provider} · {single.timing === 'end-of-day' ? 'end-of-day data' : `${single.timing} data`}
          </span>
        </div>
      )}

      <div className={`chart-box ${loading ? 'is-loading' : ''}`}>
        {ids.length === 0 ? (
          <div className="chart-empty">Select at least one listing to compare.</div>
        ) : loading && !series.length ? (
          <div className="chart-empty"><span className="spinner" /> Loading chart…</div>
        ) : series.length ? (
          <PriceChart
            series={series}
            mode={p.mode === 'compare' ? 'percent' : 'price'}
            currency={single?.currency}
            range={p.range}
            timeZone={p.timeZone}
            indexAxis={p.mode === 'single' && (p.range === '1D' || p.range === '5D')}
            watermark={demo ? 'DEMO DATA — NOT MARKET PRICES' : undefined}
          />
        ) : (
          <div className="chart-empty">No chart data available for this selection.</div>
        )}
      </div>
      {baselineNote && <p className="note">{baselineNote}</p>}
      {problems.length > 0 && (
        <ul className="problems" aria-live="polite">
          {problems.map((m) => (
            <li key={m}>⚠ {m}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
