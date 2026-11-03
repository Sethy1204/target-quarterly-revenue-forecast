import { COMPANIES, getCompany } from '../../shared/companies';
import { formatAge, formatDateTime } from '../../shared/format';
import type { NewsItem, NewsResponse } from '../../shared/types';

interface Props {
  news: NewsResponse | null;
  error: string | null;
  loading: boolean;
  timeZone: string;
  company: string;
  kind: 'all' | 'company-announcement' | 'not-specified';
  onCompany: (c: string) => void;
  onKind: (k: 'all' | 'company-announcement' | 'not-specified') => void;
  now: number;
}

const KIND_LABEL: Record<NewsItem['kind'], string> = {
  'company-announcement': 'Company announcement',
  'not-specified': 'Type not specified by source',
};

export function NewsFeed(p: Props) {
  const items = (p.news?.items ?? []).filter(
    (i) => (p.company === 'all' || i.companyIds.includes(p.company)) && (p.kind === 'all' || i.kind === p.kind),
  );
  return (
    <section className="panel news" aria-labelledby="news-h">
      <div className="panel-head">
        <h2 id="news-h">Company news</h2>
        {p.loading && <span className="spinner" aria-label="Loading news" />}
      </div>
      <div className="filters">
        <label className="field">
          <span>Company</span>
          <select value={p.company} onChange={(e) => p.onCompany(e.target.value)}>
            <option value="all">All companies</option>
            {COMPANIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Type</span>
          <select value={p.kind} onChange={(e) => p.onKind(e.target.value as Props['kind'])}>
            <option value="all">All types</option>
            <option value="company-announcement">Company announcements</option>
            <option value="not-specified">Reporting / other (type not specified)</option>
          </select>
        </label>
      </div>
      <p className="note">
        Opinion vs. reporting is shown only when the source states it; this feed does not label opinion pieces, so most items read "type not specified".
        Announcements are identified by press-release wire publishers. Summaries are the feed's own text — never generated.
      </p>
      {p.error && <div className="warn">⚠ News update failed: {p.error}{p.news ? ' — showing previously loaded stories.' : ''}</div>}
      {p.news?.status.lastError && !p.error && <div className="warn small">⚠ {p.news.status.lastError}</div>}
      {!p.news && !p.error && <div className="empty-block"><span className="spinner" /> Loading news…</div>}
      {p.news && items.length === 0 && <div className="empty-block">No stories in the last few days for this filter.</div>}
      <ol className="news-list">
        {items.map((i) => {
          const ageSec = (p.now - Date.parse(i.publishedAt)) / 1000;
          return (
            <li key={i.id} className="news-item">
              <div className="news-meta">
                {i.companyIds.map((c) => (
                  <span key={c} className="tag">
                    {getCompany(c)?.name ?? c}
                  </span>
                ))}
                <span className={`badge kind-${i.kind}`} title={i.kindReason ?? 'The source does not classify this item.'}>
                  {KIND_LABEL[i.kind]}
                </span>
                {i.topics.map((t) => (
                  <span key={t} className="badge topic" title="Keyword tag derived from the headline">
                    {t}
                  </span>
                ))}
                {i.demo && <span className="badge fresh-demo">DEMO</span>}
              </div>
              <a className="headline" href={i.url} target="_blank" rel="noopener noreferrer">
                {i.headline}
              </a>
              <div className="byline">
                <b>{i.publisher}</b> · <time dateTime={i.publishedAt}>{formatDateTime(i.publishedAt, p.timeZone)}</time> · {formatAge(ageSec)}
              </div>
              {i.summary && (
                <p className="summary">
                  <span className="muted small">Feed summary: </span>
                  {i.summary.length > 320 ? `${i.summary.slice(0, 320)}…` : i.summary}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
