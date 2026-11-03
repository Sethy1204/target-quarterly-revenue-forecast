import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { evaluateNewsAlerts, evaluateQuoteAlerts, type AlertEvent, type AlertRule } from '../shared/alerts';
import { ALL_LISTINGS, COMPANIES, getCompany } from '../shared/companies';
import { formatDateTime } from '../shared/format';
import type { ConfigResponse, EarningsResponse, FundamentalsResponse, NewsResponse, QuotesResponse } from '../shared/types';
import { api } from './api';
import { AlertsPanel } from './components/AlertsPanel';
import { ChartPanel } from './components/ChartPanel';
import { CompanyCard } from './components/CompanyCard';
import { NewsFeed } from './components/NewsFeed';
import { SetupScreen } from './components/SetupScreen';
import { SpaceXPanel } from './components/SpaceXPanel';
import { StatusPanel } from './components/StatusPanel';
import { WatchlistManager } from './components/WatchlistManager';
import { defaultPrefs, loadAlerts, loadPrefs, saveAlerts, savePrefs, type AlertsStore, type Prefs } from './storage';
import { useNow, usePoller } from './usePoller';

const nextFrom = (s: { status: { nextRefreshAt: string | null } }) => (s.status.nextRefreshAt ? Date.parse(s.status.nextRefreshAt) : null);
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export function App() {
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [alerts, setAlerts] = useState<AlertsStore>(loadAlerts);
  const alertsRef = useRef(alerts);
  alertsRef.current = alerts;
  const [toasts, setToasts] = useState<AlertEvent[]>([]);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [alertPreset, setAlertPreset] = useState<{ listingId?: string; companyId?: string } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const now = useNow(1000);

  const loadConfig = useCallback(() => {
    setConfigError(null);
    api.config().then(setConfig, (e: Error) => setConfigError(e.message));
  }, []);
  useEffect(loadConfig, [loadConfig]);
  useEffect(() => savePrefs(prefs), [prefs]);
  useEffect(() => saveAlerts(alerts), [alerts]);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  const tz = prefs.timeZone;
  const visible = prefs.order.filter((id) => !prefs.hidden.includes(id));
  const quoteIds = useMemo(() => {
    const ids = new Set(visible.map((cid) => prefs.selectedListing[cid]));
    for (const r of alerts.rules) if (r.enabled && r.listingId) ids.add(r.listingId);
    return [...ids].sort();
  }, [visible.join(','), prefs.selectedListing, alerts.rules]); // eslint-disable-line react-hooks/exhaustive-deps

  const enabled = !!config && config.mode !== 'unconfigured';
  const quotes = usePoller<QuotesResponse>((force) => api.quotes(quoteIds, force), nextFrom, { fallbackMs: 60_000, enabled: enabled && quoteIds.length > 0, deps: [quoteIds.join(',')] });
  const news = usePoller<NewsResponse>((force) => api.news(force), nextFrom, { fallbackMs: 600_000, enabled });
  const earnings = usePoller<EarningsResponse>(() => api.earnings(), nextFrom, { fallbackMs: 3_600_000, enabled });
  const fundamentals = usePoller<FundamentalsResponse>(() => api.fundamentals(), nextFrom, { fallbackMs: 3_600_000, enabled });

  // Keep last good quotes per listing so a partial failure doesn't blank cards.
  const quoteMap = useMemo(() => new Map((quotes.data?.quotes ?? []).map((q) => [q.listingId, q])), [quotes.data]);
  const errorMap = useMemo(() => new Map((quotes.data?.errors ?? []).map((e) => [e.listingId, e.message])), [quotes.data]);

  const emit = useCallback((events: AlertEvent[]) => {
    if (!events.length) return;
    setToasts((t) => [...events, ...t].slice(0, 5));
    if (alertsRef.current.browserNotifications && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      for (const e of events) {
        try {
          new Notification(`MarketPulse alert${e.demo ? ' (DEMO)' : ''}`, { body: `${e.message}\nSource: ${e.source}`, tag: e.key });
        } catch {
          /* some browsers require a service worker for notifications */
        }
      }
    }
  }, []);

  // Evaluate alerts whenever fresh data arrives (only while this page is open).
  // alertsRef is updated synchronously so a repeated effect run (e.g. React StrictMode) sees the
  // already-fired keys and cannot emit duplicates.
  const applyEval = useCallback(
    (fn: (cur: AlertsStore) => { events: AlertEvent[]; state: AlertsStore['engine'] }) => {
      const cur = alertsRef.current;
      const { events, state } = fn(cur);
      if (!events.length && JSON.stringify(state) === JSON.stringify(cur.engine)) return;
      const next = { ...cur, engine: state, history: [...events, ...cur.history].slice(0, 200) };
      alertsRef.current = next;
      setAlerts(next);
      emit(events);
    },
    [emit],
  );
  useEffect(() => {
    if (quotes.data) applyEval((cur) => evaluateQuoteAlerts(cur.rules, quotes.data!.quotes, cur.engine));
  }, [quotes.data, applyEval]);
  // Also evaluate immediately when rules are added/enabled, against the latest quotes.
  const ruleKey = alerts.rules.map((r) => `${r.id}:${r.enabled}`).join(',');
  useEffect(() => {
    if (quotes.data && ruleKey) applyEval((cur) => evaluateQuoteAlerts(cur.rules, quotes.data!.quotes, cur.engine));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ruleKey]);
  useEffect(() => {
    if (news.data) applyEval((cur) => evaluateNewsAlerts(cur.rules, news.data!.items, cur.engine));
  }, [news.data, applyEval]);

  const update = (patch: Partial<Prefs>) => setPrefs((p) => ({ ...p, ...patch }));
  const moveCompany = (id: string, d: -1 | 1) => {
    const order = [...prefs.order];
    // Move relative to the next *visible* neighbour.
    const vis = order.filter((x) => !prefs.hidden.includes(x));
    const vi = vis.indexOf(id);
    const target = vis[vi + d];
    if (!target) return;
    const a = order.indexOf(id);
    const b = order.indexOf(target);
    [order[a], order[b]] = [order[b], order[a]];
    update({ order });
  };

  const addRule = (r: Omit<AlertRule, 'id' | 'createdAt' | 'enabled'>) =>
    setAlerts((a) => ({ ...a, rules: [...a.rules, { ...r, id: uid(), enabled: true, createdAt: new Date().toISOString() }] }));

  const visibleListingIds = visible.map((cid) => prefs.selectedListing[cid]);
  const chartListing = prefs.chartListing && ALL_LISTINGS.some((l) => l.id === prefs.chartListing) ? prefs.chartListing : visibleListingIds[0] ?? ALL_LISTINGS[0].id;
  const compareIds = prefs.compareIds.length ? prefs.compareIds : visibleListingIds;

  const nextEarnings = (cid: string) => earnings.data?.events.find((e) => e.companyId === cid);
  const staleCount = (quotes.data?.quotes ?? []).filter((q) => q.freshness.level === 'stale').length;
  const demo = config?.mode === 'demo';
  const lastProviderFetch = quotes.data?.status.lastSuccessAt ?? null;
  const nextIn = quotes.paused ? null : quotes.nextAt;

  if (configError && !config) {
    return (
      <div className="app">
        <main className="center-state">
          <h1>MarketPulse</h1>
          <div className="warn">Cannot reach the MarketPulse server: {configError}</div>
          <p className="muted">Start it with <code>npm run dev</code> (development) or <code>npm start</code> after <code>npm run build</code>.</p>
          <button className="primary" onClick={loadConfig}>Retry</button>
        </main>
      </div>
    );
  }
  if (!config) {
    return (
      <div className="app">
        <main className="center-state"><span className="spinner" /> Connecting to MarketPulse server…</main>
      </div>
    );
  }

  return (
    <div className="app">
      {demo && (
        <div className="demo-banner" role="status">
          DEMO MODE — static illustrative fixtures, not market data. Prices, charts and headlines here are placeholders. Configure API keys and restart in live mode for real data.
        </div>
      )}
      <header className="topbar">
        <div className="brand">
          <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
            <rect width="32" height="32" rx="7" fill="#111a2b" />
            <path d="M4 18h6l3-8 5 14 3-6h7" fill="none" stroke="#50e3a4" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div>
            <h1>MarketPulse</h1>
            <div className="muted small">
              {config.mode === 'live' ? 'Live provider data' : config.mode === 'demo' ? 'Demo fixtures' : 'Not configured'} · times in {tz}
            </div>
          </div>
        </div>
        <div className="refresh-info" aria-live="polite">
          <div>
            {demo ? 'Last demo fixture load' : 'Last provider update'}: <b>{lastProviderFetch ? formatDateTime(lastProviderFetch, tz, { seconds: true }) : '—'}</b>
          </div>
          <div className="muted small">
            {quotes.paused
              ? 'Auto-refresh paused (tab hidden)'
              : nextIn
                ? `Next quote refresh in ${Math.max(0, Math.round((nextIn - now) / 1000))}s (every ~${quotes.data?.status.refreshIntervalSec ?? '—'}s, set by provider rate limits)`
                : quotes.loading
                  ? 'Refreshing…'
                  : ''}
          </div>
        </div>
        <div className="actions">
          <button
            className="primary"
            onClick={() => {
              quotes.refresh();
              news.refresh();
            }}
            disabled={quotes.loading}
            aria-label="Refresh now"
          >
            {quotes.loading ? <span className="spinner" /> : '↻'} Refresh
          </button>
          <button onClick={() => { setAlertPreset(null); setAlertsOpen(true); }} aria-label={`Alerts (${alerts.rules.length} rules)`}>
            🔔 Alerts{alerts.history.length ? <span className="count">{alerts.history.length}</span> : null}
          </button>
          <button onClick={() => setSettingsOpen(true)}>⚙ Watchlist</button>
        </div>
      </header>

      {!online && <div className="banner bad">Disconnected: your browser is offline. Showing the last data received; refresh resumes automatically when back online.</div>}
      {online && quotes.error && (
        <div className="banner bad">
          Quote updates failing: {quotes.error}. {quotes.data ? 'Showing last received data — it may be stale.' : ''} Retrying with backoff (attempt {quotes.failures}).
        </div>
      )}
      {quotes.data?.status.rateLimited && (
        <div className="banner warn">
          Provider rate limit reached — using cached quotes until {formatDateTime(quotes.data.status.rateLimitResetAt, tz, { seconds: true })}.
        </div>
      )}
      {staleCount > 0 && <div className="banner warn">{staleCount} quote(s) are stale — see the card badges for details.</div>}
      {config.mode === 'unconfigured' && <SetupScreen config={config} onRetry={loadConfig} />}
      {config.mode === 'live' && config.missing.length > 0 && (
        <div className="banner warn">Partially configured — missing {config.missing.map((m) => m.split(' ')[0]).join(', ')}. Some panels will be empty. Run <code>npm run setup</code>.</div>
      )}

      {config.mode !== 'unconfigured' && (
        <>
          <StatusPanel
            config={config}
            now={now}
            online={online}
            timeZone={tz}
            feeds={[
              { name: 'Quotes', status: quotes.data?.status, clientError: quotes.error, lastOkAt: quotes.lastOkAt, nextAt: quotes.nextAt, paused: quotes.paused },
              { name: 'News', status: news.data?.status, clientError: news.error, lastOkAt: news.lastOkAt, nextAt: news.nextAt, paused: news.paused },
              { name: 'Earnings calendar', status: earnings.data?.status, clientError: earnings.error, lastOkAt: earnings.lastOkAt, nextAt: earnings.nextAt, paused: earnings.paused },
              { name: 'Market cap', status: fundamentals.data?.status, clientError: fundamentals.error, lastOkAt: fundamentals.lastOkAt, nextAt: fundamentals.nextAt, paused: fundamentals.paused },
            ]}
          />

          <main className="layout">
            <section className="cards" aria-label="Companies">
              {visible.length === 0 && (
                <div className="empty-block">
                  All companies are hidden. <button onClick={() => setSettingsOpen(true)}>Manage watchlist</button>
                </div>
              )}
              {visible.map((cid, i) => {
                const c = getCompany(cid)!;
                const lid = prefs.selectedListing[cid];
                return (
                  <CompanyCard
                    key={cid}
                    company={c}
                    listingId={lid}
                    quote={quoteMap.get(lid)}
                    error={errorMap.get(lid) ?? (quotes.data ? undefined : (quotes.error ?? undefined))}
                    loading={!quotes.data && !quotes.error}
                    fundamentals={fundamentals.data?.items.find((f) => f.companyId === cid)}
                    earnings={nextEarnings(cid)}
                    timeZone={tz}
                    isFirst={i === 0}
                    isLast={i === visible.length - 1}
                    onSelectListing={(id) => update({ selectedListing: { ...prefs.selectedListing, [cid]: id } })}
                    onMove={(d) => moveCompany(cid, d)}
                    onHide={() => update({ hidden: [...prefs.hidden, cid] })}
                    onChart={() => {
                      update({ chartMode: 'single', chartListing: lid });
                      document.getElementById('chart-h')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }}
                    onAlert={() => {
                      setAlertPreset({ listingId: lid, companyId: cid });
                      setAlertsOpen(true);
                    }}
                  />
                );
              })}
            </section>

            <div className="side">
              <ChartPanel
                mode={prefs.chartMode}
                listingId={chartListing}
                compareIds={compareIds}
                range={prefs.chartRange}
                timeZone={tz}
                refreshToken={quotes.lastOkAt ?? 0}
                availableIds={ALL_LISTINGS.map((l) => l.id)}
                onMode={(m) => update({ chartMode: m })}
                onListing={(id) => update({ chartListing: id })}
                onCompare={(ids) => update({ compareIds: ids })}
                onRange={(r) => update({ chartRange: r })}
              />
              {!prefs.hidden.includes('spacex') && (
                <SpaceXPanel liveNews={(news.data?.items ?? []).filter((n) => n.companyIds.includes('spacex'))} timeZone={tz} />
              )}
              <section className="panel" aria-labelledby="earn-h">
                <div className="panel-head">
                  <h2 id="earn-h">Upcoming earnings</h2>
                </div>
                {earnings.error && <div className="warn small">⚠ {earnings.error}</div>}
                {earnings.data?.status.lastError && <div className="warn small">⚠ {earnings.data.status.lastError}</div>}
                {!earnings.data && !earnings.error ? (
                  <div className="empty-block"><span className="spinner" /> Loading…</div>
                ) : earnings.data && earnings.data.events.length === 0 ? (
                  <p className="muted small">No upcoming earnings dates reported by the provider in the look-ahead window.</p>
                ) : (
                  <table className="earn-table">
                    <thead>
                      <tr><th>Date</th><th>Company</th><th>Status</th></tr>
                    </thead>
                    <tbody>
                      {earnings.data?.events.map((e) => (
                        <tr key={`${e.companyId}-${e.date}`}>
                          <td>{e.date}{e.hour ? ` (${e.hour})` : ''}</td>
                          <td>{getCompany(e.companyId)?.name} <small className="muted">{e.symbol}</small></td>
                          <td><span className="badge est">Unconfirmed (provider estimate)</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <p className="note">The earnings provider does not flag which dates the company has confirmed. Check each company's investor-relations site before relying on a date. bmo/amc = before open / after close.</p>
              </section>
            </div>

            <NewsFeed
              news={news.data}
              error={news.error}
              loading={news.loading}
              timeZone={tz}
              company={prefs.newsCompany}
              kind={prefs.newsKind}
              onCompany={(c) => update({ newsCompany: c })}
              onKind={(k) => update({ newsKind: k })}
              now={now}
            />
          </main>
        </>
      )}

      <footer className="foot muted small">
        MarketPulse displays third-party data for information only — not investment advice. Quote timing is labelled per exchange; see "Data sources & freshness".
        Companies: {COMPANIES.map((c) => c.name).join(', ')}.
      </footer>

      <div className="toasts" aria-live="assertive">
        {toasts.map((t) => (
          <div key={t.key} className="toast" role="alert">
            <div className="toast-title">🔔 Alert{t.demo ? ' (DEMO data)' : ''}</div>
            <div>{t.url ? <a href={t.url} target="_blank" rel="noopener noreferrer">{t.message}</a> : t.message}</div>
            <div className="byline">Source: {t.source} · {formatDateTime(t.dataTime, tz)}</div>
            <button className="icon" onClick={() => setToasts((x) => x.filter((y) => y.key !== t.key))} aria-label="Dismiss alert">✕</button>
          </div>
        ))}
      </div>

      <AlertsPanel
        open={alertsOpen}
        onClose={() => setAlertsOpen(false)}
        rules={alerts.rules}
        history={alerts.history}
        timeZone={tz}
        preset={alertPreset}
        browserNotifications={alerts.browserNotifications}
        onAdd={addRule}
        onToggle={(id) => setAlerts((a) => ({ ...a, rules: a.rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)) }))}
        onDelete={(id) => setAlerts((a) => ({ ...a, rules: a.rules.filter((r) => r.id !== id) }))}
        onClearHistory={() => setAlerts((a) => ({ ...a, history: [] }))}
        onBrowserNotifications={(on) => setAlerts((a) => ({ ...a, browserNotifications: on }))}
      />
      <WatchlistManager
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        order={prefs.order}
        hidden={prefs.hidden}
        timeZone={tz}
        onOrder={(order) => update({ order })}
        onHidden={(hidden) => update({ hidden })}
        onTimeZone={(timeZone) => update({ timeZone })}
        onReset={() => setPrefs(defaultPrefs())}
      />
    </div>
  );
}
