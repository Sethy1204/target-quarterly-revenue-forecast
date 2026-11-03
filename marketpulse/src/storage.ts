import { COMPANIES } from '../shared/companies';
import { emptyAlertState, type AlertEngineState, type AlertEvent, type AlertRule } from '../shared/alerts';
import type { ChartRange } from '../shared/types';

/** Preferences and alerts are stored in this browser's localStorage (per device/browser). */

export interface Prefs {
  order: string[];
  hidden: string[];
  selectedListing: Record<string, string>;
  timeZone: string;
  chartRange: ChartRange;
  chartListing: string | null;
  chartMode: 'single' | 'compare';
  compareIds: string[];
  newsCompany: string; // 'all' | companyId
  newsKind: 'all' | 'company-announcement' | 'not-specified';
}

export interface AlertsStore {
  rules: AlertRule[];
  engine: AlertEngineState;
  history: AlertEvent[];
  browserNotifications: boolean;
}

const PREFS_KEY = 'marketpulse:v1:prefs';
const ALERTS_KEY = 'marketpulse:v1:alerts';

export const defaultPrefs = (): Prefs => ({
  order: COMPANIES.map((c) => c.id),
  hidden: [],
  selectedListing: Object.fromEntries(COMPANIES.map((c) => [c.id, c.listings.find((l) => l.primary)!.id])),
  timeZone: 'America/Toronto',
  chartRange: '1M',
  chartListing: null,
  chartMode: 'single',
  compareIds: [],
  newsCompany: 'all',
  newsKind: 'all',
});

function read<T>(key: string): Partial<T> | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Partial<T>) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode/quota) — app keeps working in-memory */
  }
}

export function loadPrefs(): Prefs {
  const d = defaultPrefs();
  const s = read<Prefs>(PREFS_KEY);
  if (!s) return d;
  const known = new Set(COMPANIES.map((c) => c.id));
  // Keep stored order but drop unknown ids and append any new companies.
  const order = [...(s.order ?? []).filter((id) => known.has(id))];
  for (const id of d.order) if (!order.includes(id)) order.push(id);
  const selectedListing = { ...d.selectedListing };
  for (const [cid, lid] of Object.entries(s.selectedListing ?? {})) {
    if (COMPANIES.find((c) => c.id === cid)?.listings.some((l) => l.id === lid)) selectedListing[cid] = lid;
  }
  return { ...d, ...s, order, selectedListing, hidden: (s.hidden ?? []).filter((id) => known.has(id)) };
}

export const savePrefs = (p: Prefs) => write(PREFS_KEY, p);

export function loadAlerts(): AlertsStore {
  const s = read<AlertsStore>(ALERTS_KEY);
  return {
    rules: s?.rules ?? [],
    engine: { ...emptyAlertState(), ...(s?.engine ?? {}) },
    history: s?.history ?? [],
    browserNotifications: s?.browserNotifications ?? false,
  };
}

export const saveAlerts = (a: AlertsStore) => write(ALERTS_KEY, a);
