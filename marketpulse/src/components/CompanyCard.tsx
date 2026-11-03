import type { CompanyDef } from '../../shared/companies';
import { DASH, formatAge, formatCompact, formatDateTime, formatMarketCap, formatPercent, formatPrice, formatSigned } from '../../shared/format';
import type { EarningsEvent, Fundamentals, QuoteView } from '../../shared/types';

interface Props {
  company: CompanyDef;
  listingId: string;
  quote: QuoteView | undefined;
  error: string | undefined;
  loading: boolean;
  fundamentals: Fundamentals | undefined;
  earnings: EarningsEvent | undefined;
  timeZone: string;
  isFirst: boolean;
  isLast: boolean;
  onSelectListing: (id: string) => void;
  onMove: (dir: -1 | 1) => void;
  onHide: () => void;
  onChart: () => void;
  onAlert: () => void;
}

const dir = (v: number | null | undefined) => (v === null || v === undefined ? '' : v > 0 ? 'up' : v < 0 ? 'down' : 'flat');

export function FreshnessBadge({ q }: { q: QuoteView }) {
  return (
    <span className={`badge fresh-${q.freshness.level}`} title={`${q.freshness.detail}${q.freshness.warning ? `\n${q.freshness.warning}` : ''}`}>
      {q.freshness.label}
    </span>
  );
}

const HOUR: Record<string, string> = { bmo: 'before market open', amc: 'after market close', dmh: 'during market hours' };

export function CompanyCard(p: Props) {
  const { company, quote: q } = p;
  const listing = company.listings.find((l) => l.id === p.listingId)!;
  const stale = q?.freshness.level === 'stale';

  return (
    <article className={`card ${stale ? 'is-stale' : ''}`} aria-labelledby={`h-${company.id}`}>
      <header className="card-head">
        <div>
          <h3 id={`h-${company.id}`}>{company.name}</h3>
          <div className="legal">{company.legalName}</div>
        </div>
        <div className="card-tools">
          <button className="icon" onClick={() => p.onMove(-1)} disabled={p.isFirst} aria-label={`Move ${company.name} up`} title="Move up">↑</button>
          <button className="icon" onClick={() => p.onMove(1)} disabled={p.isLast} aria-label={`Move ${company.name} down`} title="Move down">↓</button>
          <button className="icon" onClick={p.onHide} aria-label={`Hide ${company.name}`} title="Hide from dashboard">✕</button>
        </div>
      </header>

      {company.listings.length > 1 && (
        <div className="listing-tabs" role="tablist" aria-label={`${company.name} listings`}>
          {company.listings.map((l) => (
            <button key={l.id} role="tab" aria-selected={l.id === p.listingId} className={l.id === p.listingId ? 'on' : ''} onClick={() => p.onSelectListing(l.id)}>
              {l.exchange}: {l.symbol} <small>{l.currency}</small>
              {l.shareClass && <small> · {l.shareClass}</small>}
            </button>
          ))}
        </div>
      )}

      <div className="ticker-line">
        <span className="ticker">{listing.symbol}</span>
        <span className="exch">{listing.exchange}</span>
        <span className="ccy" title="Trading currency">{listing.currency}</span>
        {listing.shareClass && company.listings.length === 1 && <span className="exch">{listing.shareClass}</span>}
        {q && <FreshnessBadge q={q} />}
        {q && <span className={`badge session-${q.session.state}`}>{q.session.label}</span>}
      </div>

      {!q && p.loading && (
        <div className="skeleton-block" aria-busy="true">
          <span className="spinner" /> Loading quote…
        </div>
      )}
      {!q && !p.loading && (
        <div className="empty-block">
          <b>Quote unavailable.</b>
          <div className="muted small">{p.error ?? 'No data yet.'}</div>
        </div>
      )}

      {q && (
        <>
          <div className="price-row">
            <div className="price" aria-label="Last price">
              {formatPrice(q.price, null)} <span className="price-ccy">{q.currency}</span>
            </div>
            <div className={`chg ${dir(q.change)}`}>
              <span>{formatSigned(q.change)}</span>
              <span>({formatPercent(q.changePercent)})</span>
              <small className="muted">today vs prev. close</small>
            </div>
          </div>

          {q.extended ? (
            <div className="ext-row" title="Extended-hours trade vs. the latest regular-session close. Separate from the daily change above.">
              <span className="badge ext">{q.session.state === 'pre-market' ? 'Pre-market' : q.session.state === 'after-hours' ? 'After-hours' : 'Extended hrs'}</span>
              <b>{formatPrice(q.extended.price, q.currency)}</b>
              <span className={dir(q.extended.change)}>
                {formatSigned(q.extended.change)} ({formatPercent(q.extended.changePercent)})
              </span>
              <small className="muted">vs regular close · {formatDateTime(q.extended.time, p.timeZone)}</small>
            </div>
          ) : (
            listing.exchange !== 'TSX' && <div className="ext-row muted small">Extended-hours price: not provided by current feed/plan.</div>
          )}

          <dl className="stats">
            <div><dt>Prev. close</dt><dd>{formatPrice(q.previousClose, q.currency)}</dd></div>
            <div><dt>Open</dt><dd>{formatPrice(q.open, q.currency)}</dd></div>
            <div><dt>Day high</dt><dd>{formatPrice(q.high, q.currency)}</dd></div>
            <div><dt>Day low</dt><dd>{formatPrice(q.low, q.currency)}</dd></div>
            <div><dt>Volume</dt><dd title={q.volume === null ? 'Not provided by this feed' : undefined}>{formatCompact(q.volume)}</dd></div>
            <div>
              <dt>Market cap</dt>
              <dd title={p.fundamentals ? `${p.fundamentals.provider}, profile of ${p.fundamentals.sourceSymbol}, fetched ${p.fundamentals.fetchedAt}` : 'Unavailable'}>
                {formatMarketCap(p.fundamentals?.marketCap, p.fundamentals?.marketCapCurrency)}
              </dd>
            </div>
          </dl>

          <div className="meta">
            <span>Quote time: <b>{formatDateTime(q.quoteTime, p.timeZone)}</b> ({formatAge(q.freshness.ageSeconds)})</span>
            <span>Exchange: {q.exchange} · Provider: {q.provider}</span>
            {q.timing !== 'real-time' && q.freshness.level !== 'demo' && (
              <span className="muted small">
                Feed declared {q.timing}
                {q.delayMinutes ? ` (~${q.delayMinutes} min)` : ''} for {q.exchange}.
              </span>
            )}
          </div>
          {q.freshness.warning && <div className="warn small">⚠ {q.freshness.warning}</div>}
          {stale && <div className="warn small">⚠ Stale: {q.freshness.detail}</div>}
          {p.error && <div className="warn small">⚠ Last update error: {p.error}</div>}
          {q.session.calendarUncertain && <div className="muted small">Holiday calendar not loaded for this year; session status may be wrong on holidays.</div>}
        </>
      )}

      <div className="earn">
        {p.earnings ? (
          <>
            Next earnings: <b>{formatDateTime(`${p.earnings.date}T12:00:00Z`, 'UTC', { dateOnly: true })}</b>
            {p.earnings.hour && HOUR[p.earnings.hour] ? ` (${HOUR[p.earnings.hour]})` : ''}{' '}
            <span className="badge est" title="Provider does not indicate whether the company has confirmed this date.">Estimated / unconfirmed</span>
          </>
        ) : (
          <span className="muted small">Next earnings date: {DASH} (none reported by provider)</span>
        )}
      </div>

      {company.notes.length > 0 && (
        <ul className="notes">
          {company.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      <footer className="card-actions">
        <button onClick={p.onChart}>Chart</button>
        <button onClick={p.onAlert}>Add alert</button>
      </footer>
    </article>
  );
}
