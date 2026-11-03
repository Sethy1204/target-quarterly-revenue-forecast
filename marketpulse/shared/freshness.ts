import type { SessionState } from './market.js';
import type { FeedTiming, Freshness } from './types.js';

export interface FreshnessInput {
  timing: FeedTiming;
  delayMinutes: number;
  quoteTime: string | null;
  now: Date;
  session: SessionState;
  /** True when the most recent attempt to refresh this listing failed. */
  lastFetchFailed: boolean;
  /** When this data was fetched from the provider. */
  fetchedAt: string | null;
  refreshIntervalSec: number;
  demo: boolean;
}

/** A closed market's last price is stale only if older than a long weekend + holiday. */
const CLOSED_STALE_SEC = 4 * 24 * 3600;
/** Extra tolerance for thinly traded symbols between prints during the session. */
const SESSION_GRACE_SEC = 5 * 60;

/**
 * Classifies quote freshness. The level comes from the provider/plan's *declared*
 * timing plus the observed age of the provider timestamp — never from how often
 * this app refreshes.
 */
export function classifyFreshness(i: FreshnessInput): Freshness {
  if (i.demo) {
    return { level: 'demo', label: 'DEMO', detail: 'Static demo fixture — not market data.', ageSeconds: null };
  }
  if (!i.quoteTime) {
    return { level: 'unknown', label: 'Unknown', detail: 'Provider returned no quote timestamp.', ageSeconds: null };
  }
  const ageSeconds = Math.max(0, Math.round((i.now.getTime() - Date.parse(i.quoteTime)) / 1000));
  const fetchAge = i.fetchedAt ? (i.now.getTime() - Date.parse(i.fetchedAt)) / 1000 : null;
  const failedWarning = i.lastFetchFailed
    ? `Latest update attempt failed; showing data fetched ${fetchAge === null ? 'earlier' : fetchAge < 90 ? `${Math.round(fetchAge)} s ago` : `${Math.round(fetchAge / 60)} min ago`}.`
    : undefined;
  const sessionOpen = i.session === 'regular';

  if (i.timing === 'end-of-day') {
    if (ageSeconds > CLOSED_STALE_SEC) {
      return { level: 'stale', label: 'Stale', detail: 'End-of-day data older than the last expected trading session.', ageSeconds, warning: failedWarning };
    }
    return {
      level: 'end-of-day',
      label: 'End-of-day',
      detail: 'The configured provider/plan supplies end-of-day data for this exchange. Not intraday prices.',
      ageSeconds,
      warning: failedWarning,
    };
  }

  if (!sessionOpen) {
    if (ageSeconds > CLOSED_STALE_SEC) {
      return { level: 'stale', label: 'Stale', detail: 'Last price is older than the most recent trading session.', ageSeconds, warning: failedWarning };
    }
    return {
      level: 'end-of-day',
      label: 'Last close',
      detail: 'Regular session closed; price is the latest regular-session close/last trade. See extended-hours line for pre/after-market prices.',
      ageSeconds,
      warning: failedWarning,
    };
  }

  // Regular session open.
  const expectedMax = i.delayMinutes * 60 + i.refreshIntervalSec + SESSION_GRACE_SEC;
  if (i.lastFetchFailed && fetchAge !== null && fetchAge > i.refreshIntervalSec * 2) {
    return { level: 'stale', label: 'Stale', detail: 'Updates are failing during an open session.', ageSeconds, warning: failedWarning };
  }
  if (ageSeconds > expectedMax) {
    return {
      level: 'stale',
      label: 'Stale',
      detail: `Quote is ${Math.round(ageSeconds / 60)} min old during an open session (expected ≤ ${Math.round(expectedMax / 60)} min).`,
      ageSeconds,
      warning: failedWarning,
    };
  }
  if (i.timing === 'real-time') {
    return { level: 'real-time', label: 'Real-time', detail: 'Provider plan declared as real-time for this exchange.', ageSeconds, warning: failedWarning };
  }
  return {
    level: 'delayed',
    label: i.delayMinutes > 0 ? `Delayed ~${i.delayMinutes} min` : 'Delayed',
    detail: 'Provider plan declared as delayed for this exchange.',
    ageSeconds,
    warning: failedWarning,
  };
}
