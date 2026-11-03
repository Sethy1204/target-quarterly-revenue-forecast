import { formatDateTime } from '../../shared/format';
import { SPACEX_COMPILED_ON, SPACEX_DEVELOPMENTS, SPACEX_DISTINCTIONS } from '../../shared/spacex';
import type { NewsItem } from '../../shared/types';

interface Props {
  liveNews: NewsItem[];
  timeZone: string;
}

export function SpaceXPanel({ liveNews, timeZone }: Props) {
  const launch = liveNews.filter((n) => n.topics.includes('launch') || n.topics.includes('starlink')).slice(0, 5);
  const finance = liveNews.filter((n) => n.topics.includes('financing/valuation')).slice(0, 5);
  return (
    <section className="panel spacex" aria-labelledby="spx-h">
      <div className="panel-head">
        <h2 id="spx-h">SpaceX developments</h2>
        <span className="badge">Nasdaq: SPCX · USD</span>
      </div>
      <ul className="notes">
        {SPACEX_DISTINCTIONS.map((d) => (
          <li key={d}>{d}</li>
        ))}
      </ul>

      <div className="spx-cols">
        <div>
          <h3>Live: launch & Starlink headlines</h3>
          {launch.length === 0 ? (
            <p className="muted small">No matching headlines in the current news window.</p>
          ) : (
            <ul className="mini-news">
              {launch.map((n) => (
                <li key={n.id}>
                  <a href={n.url} target="_blank" rel="noopener noreferrer">{n.headline}</a>
                  <div className="byline">{n.publisher} · {formatDateTime(n.publishedAt, timeZone)}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3>Live: financing & valuation headlines</h3>
          {finance.length === 0 ? (
            <p className="muted small">No matching headlines in the current news window.</p>
          ) : (
            <ul className="mini-news">
              {finance.map((n) => (
                <li key={n.id}>
                  <a href={n.url} target="_blank" rel="noopener noreferrer">{n.headline}</a>
                  <div className="byline">{n.publisher} · {formatDateTime(n.publishedAt, timeZone)}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <p className="note">Live sections filter the news feed by headline keywords (launch, Starship, Falcon, Starlink, IPO, shares, valuation…).</p>

      <details className="timeline">
        <summary>Key verified milestones (static list compiled {SPACEX_COMPILED_ON} — does not auto-update)</summary>
        <ol>
          {SPACEX_DEVELOPMENTS.map((d) => (
            <li key={d.title}>
              <div className="tl-date">{d.date}</div>
              <div>
                <b>{d.title}</b> <span className="badge topic">{d.category}</span>
                {d.valuationEstimate && <span className="badge est">Private valuation estimate — not a trading price</span>}
                <p>{d.detail}</p>
                <div className="small">
                  Sources:{' '}
                  {d.sources.map((s, i) => (
                    <span key={s.url}>
                      {i > 0 && ' · '}
                      <a href={s.url} target="_blank" rel="noopener noreferrer">{s.label}</a>
                    </span>
                  ))}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}
