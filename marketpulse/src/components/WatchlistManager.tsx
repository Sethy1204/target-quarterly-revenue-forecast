import { getCompany } from '../../shared/companies';

interface Props {
  open: boolean;
  onClose: () => void;
  order: string[];
  hidden: string[];
  timeZone: string;
  onOrder: (order: string[]) => void;
  onHidden: (hidden: string[]) => void;
  onTimeZone: (tz: string) => void;
  onReset: () => void;
}

const TIMEZONES = ['America/Toronto', 'America/New_York', 'America/Vancouver', 'America/Chicago', 'America/Los_Angeles', 'Europe/London', 'UTC'];

export function WatchlistManager(p: Props) {
  if (!p.open) return null;
  const move = (i: number, d: -1 | 1) => {
    const next = [...p.order];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    p.onOrder(next);
  };
  return (
    <div className="drawer-backdrop" onClick={p.onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="wl-h" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h2 id="wl-h">Watchlist & settings</h2>
          <button className="icon" onClick={p.onClose} aria-label="Close settings">✕</button>
        </div>
        <p className="note">Order and visibility are saved in this browser. Hidden companies are not polled for quotes (saves provider credits) unless an alert uses them.</p>
        <ol className="wl">
          {p.order.map((id, i) => {
            const c = getCompany(id)!;
            const hidden = p.hidden.includes(id);
            return (
              <li key={id} className={hidden ? 'is-hidden' : ''}>
                <label>
                  <input type="checkbox" checked={!hidden} onChange={() => p.onHidden(hidden ? p.hidden.filter((x) => x !== id) : [...p.hidden, id])} />{' '}
                  {c.name} <small className="muted">{c.listings.map((l) => `${l.exchange}:${l.symbol}`).join(', ')}</small>
                </label>
                <span>
                  <button className="icon" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${c.name} up`}>↑</button>
                  <button className="icon" disabled={i === p.order.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${c.name} down`}>↓</button>
                </span>
              </li>
            );
          })}
        </ol>
        <label className="field">
          <span>Display timezone</span>
          <select value={p.timeZone} onChange={(e) => p.onTimeZone(e.target.value)}>
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
                {tz === 'America/Toronto' ? ' (default)' : ''}
              </option>
            ))}
          </select>
        </label>
        <button onClick={p.onReset}>Reset layout to defaults</button>
      </aside>
    </div>
  );
}
