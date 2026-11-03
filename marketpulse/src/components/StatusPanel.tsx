import { DASH, formatDateTime } from '../../shared/format';
import type { ConfigResponse, FeedStatus } from '../../shared/types';

interface FeedRow {
  name: string;
  status: FeedStatus | undefined;
  clientError: string | null;
  lastOkAt: number | null;
  nextAt: number | null;
  paused: boolean;
}

interface Props {
  config: ConfigResponse;
  feeds: FeedRow[];
  timeZone: string;
  now: number;
  online: boolean;
}

function countdown(at: number | null, now: number): string {
  if (at === null) return 'paused';
  const s = Math.max(0, Math.round((at - now) / 1000));
  return s < 90 ? `in ${s}s` : `in ${Math.round(s / 60)} min`;
}

export function StatusPanel({ config, feeds, timeZone, now, online }: Props) {
  return (
    <section className="panel status" aria-labelledby="status-h">
      <details>
        <summary>
          <h2 id="status-h">Data sources & freshness</h2>
          <span className="status-dots">
            {feeds.map((f) => {
              const bad = !!f.clientError || f.status?.rateLimited || (f.status?.lastError && !f.status.lastSuccessAt);
              const warn = !bad && !!f.status?.lastError;
              return <span key={f.name} className={`dot ${bad ? 'bad' : warn ? 'warn' : f.status ? 'ok' : ''}`} title={`${f.name}: ${f.clientError ?? f.status?.lastError ?? 'OK'}`} />;
            })}
          </span>
        </summary>
        {!online && <div className="warn">⚠ Browser is offline — showing last loaded data.</div>}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Feed</th>
                <th>Provider</th>
                <th>Last provider fetch</th>
                <th>Last checked by this page</th>
                <th>Next refresh</th>
                <th>Interval</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {feeds.map((f) => (
                <tr key={f.name}>
                  <td>{f.name}</td>
                  <td>{f.status?.provider ?? DASH}</td>
                  <td>{formatDateTime(f.status?.lastSuccessAt, timeZone, { seconds: true })}</td>
                  <td>{f.lastOkAt ? formatDateTime(new Date(f.lastOkAt).toISOString(), timeZone, { seconds: true }) : DASH}</td>
                  <td>{f.paused ? 'paused (tab hidden)' : countdown(f.nextAt, now)}</td>
                  <td>{f.status ? `${Math.round(f.status.refreshIntervalSec / 60) || '<1'} min` : DASH}</td>
                  <td className={f.clientError || f.status?.lastError ? 'warn' : 'ok'}>
                    {f.clientError
                      ? `Server unreachable: ${f.clientError}`
                      : f.status?.rateLimited
                        ? `Rate limited until ${formatDateTime(f.status.rateLimitResetAt, timeZone, { seconds: true })}`
                        : (f.status?.lastError ?? 'OK')}
                    {f.status?.budget && (
                      <div className="muted small">
                        Budget: {f.status.budget.perMinute ?? '∞'}/min, {f.status.budget.perDay ?? '∞'}/day · used today {f.status.budget.usedToday ?? DASH}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3>Declared data timing (from server configuration)</h3>
        <ul className="notes">
          {config.timing.map((t) => (
            <li key={t.exchange}>
              <b>{t.exchange}</b>: {t.timing}
              {t.timing === 'delayed' && t.delayMinutes ? ` (~${t.delayMinutes} min)` : ''} — <span className="muted">{t.source}</span>
            </li>
          ))}
          {config.timing.length === 0 && <li>No quote provider configured.</li>}
        </ul>
        <p className="note">
          "Real-time" is shown only when the provider plan is declared real-time for that exchange. Refresh frequency never changes the label. Quotes older than
          expected during an open session are marked <b>Stale</b>.
        </p>
        <h3>Providers</h3>
        <ul className="notes">
          {config.providers.map((p) => (
            <li key={p.role}>
              <b>{p.role}</b>: {p.provider} {p.docsUrl && (<a href={p.docsUrl} target="_blank" rel="noopener noreferrer">docs</a>)}
              {p.notes.map((n) => (
                <span key={n} className="muted"> — {n}</span>
              ))}
            </li>
          ))}
        </ul>
        <p className="note">Times shown in {timeZone}. Alerts are evaluated in this page only (no background monitoring).</p>
      </details>
    </section>
  );
}
