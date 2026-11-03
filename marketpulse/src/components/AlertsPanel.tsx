import { useEffect, useState } from 'react';
import type { AlertEvent, AlertRule, AlertType } from '../../shared/alerts';
import { ALL_LISTINGS, COMPANIES, getCompany, getListing } from '../../shared/companies';
import { formatDateTime } from '../../shared/format';

interface Props {
  open: boolean;
  onClose: () => void;
  rules: AlertRule[];
  history: AlertEvent[];
  timeZone: string;
  browserNotifications: boolean;
  preset: { listingId?: string; companyId?: string } | null;
  onAdd: (r: Omit<AlertRule, 'id' | 'createdAt' | 'enabled'>) => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onClearHistory: () => void;
  onBrowserNotifications: (on: boolean) => void;
}

const TYPE_LABEL: Record<AlertType, string> = {
  'price-above': 'Price at or above',
  'price-below': 'Price at or below',
  'pct-move': 'Daily move ≥ ±%',
  news: 'New company news',
};

export function describeRule(r: AlertRule): string {
  if (r.type === 'news') return `New news: ${getCompany(r.companyId ?? '')?.name ?? r.companyId}`;
  const l = getListing(r.listingId ?? '');
  const sym = l ? `${l.symbol} (${l.exchange})` : r.listingId;
  if (r.type === 'pct-move') return `${sym} daily move ≥ ±${r.threshold}%`;
  return `${sym} ${r.type === 'price-above' ? '≥' : '≤'} ${r.threshold} ${l?.currency ?? ''}`;
}

export function AlertsPanel(p: Props) {
  const [type, setType] = useState<AlertType>('price-above');
  const [listingId, setListingId] = useState(ALL_LISTINGS[0].id);
  const [companyId, setCompanyId] = useState(COMPANIES[0].id);
  const [threshold, setThreshold] = useState('');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (p.preset?.listingId) setListingId(p.preset.listingId);
    if (p.preset?.companyId) setCompanyId(p.preset.companyId);
  }, [p.preset]);

  if (!p.open) return null;
  const listing = getListing(listingId)!;
  const notifSupported = typeof Notification !== 'undefined';

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (type === 'news') {
      p.onAdd({ type, companyId });
      return;
    }
    const n = Number(threshold);
    if (threshold.trim() === '' || !Number.isFinite(n) || n <= 0) {
      setErr(type === 'pct-move' ? 'Enter a percentage greater than 0.' : `Enter a price greater than 0 (${listing.currency}).`);
      return;
    }
    p.onAdd({ type, listingId, threshold: n });
    setThreshold('');
  };

  return (
    <div className="drawer-backdrop" onClick={p.onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="alerts-h" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h2 id="alerts-h">Alerts</h2>
          <button className="icon" onClick={p.onClose} aria-label="Close alerts">✕</button>
        </div>
        <div className="info">
          <b>Alerts run only while MarketPulse is open in this browser.</b> They are checked in this page each time new quotes or news arrive
          (polling pauses while the tab is hidden, so checks pause too). There is no server-side background monitoring, email or push service.
          Rules are saved in this browser's local storage.
        </div>

        <form className="alert-form" onSubmit={submit}>
          <label className="field">
            <span>Condition</span>
            <select value={type} onChange={(e) => setType(e.target.value as AlertType)}>
              {(Object.keys(TYPE_LABEL) as AlertType[]).map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          {type === 'news' ? (
            <label className="field">
              <span>Company</span>
              <select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                {COMPANIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <label className="field">
                <span>Listing</span>
                <select value={listingId} onChange={(e) => setListingId(e.target.value)}>
                  {ALL_LISTINGS.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.symbol} · {l.exchange} · {l.currency}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{type === 'pct-move' ? 'Threshold (%)' : `Price (${listing.currency})`}</span>
                <input inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder={type === 'pct-move' ? 'e.g. 3' : 'e.g. 250.00'} />
              </label>
            </>
          )}
          <button type="submit" className="primary">Add alert</button>
          {err && <div className="warn small" role="alert">{err}</div>}
        </form>
        <p className="note">
          Price alerts fire once when the condition becomes true and re-arm after the price moves back. Daily-move alerts fire at most once per trading day.
          News alerts fire once per story, for stories published after the alert was created. Alerts never fire on data marked stale.
        </p>

        <h3>Rules ({p.rules.length})</h3>
        {p.rules.length === 0 ? (
          <p className="muted small">No alert rules yet.</p>
        ) : (
          <ul className="rules">
            {p.rules.map((r) => (
              <li key={r.id}>
                <label>
                  <input type="checkbox" checked={r.enabled} onChange={() => p.onToggle(r.id)} /> {describeRule(r)}
                </label>
                <button className="icon" onClick={() => p.onDelete(r.id)} aria-label={`Delete alert ${describeRule(r)}`}>🗑</button>
              </li>
            ))}
          </ul>
        )}

        <div className="field-row">
          <label>
            <input
              type="checkbox"
              disabled={!notifSupported}
              checked={p.browserNotifications}
              onChange={async (e) => {
                if (e.target.checked && notifSupported && Notification.permission !== 'granted') {
                  const res = await Notification.requestPermission();
                  p.onBrowserNotifications(res === 'granted');
                } else p.onBrowserNotifications(e.target.checked);
              }}
            />{' '}
            Also show browser notifications (still only while this page is open)
          </label>
          {!notifSupported && <span className="muted small"> — not supported in this browser</span>}
        </div>

        <div className="panel-head">
          <h3>Triggered ({p.history.length})</h3>
          {p.history.length > 0 && <button onClick={p.onClearHistory}>Clear</button>}
        </div>
        {p.history.length === 0 ? (
          <p className="muted small">Nothing triggered yet.</p>
        ) : (
          <ol className="history">
            {p.history.map((h) => (
              <li key={h.key}>
                <div>
                  {h.demo && <span className="badge fresh-demo">DEMO</span>} {h.url ? <a href={h.url} target="_blank" rel="noopener noreferrer">{h.message}</a> : h.message}
                </div>
                <div className="byline">
                  Source: {h.source} · data time {formatDateTime(h.dataTime, p.timeZone)} · triggered {formatDateTime(h.triggeredAt, p.timeZone, { seconds: true })}
                </div>
              </li>
            ))}
          </ol>
        )}
      </aside>
    </div>
  );
}
