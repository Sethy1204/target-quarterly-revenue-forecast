import { isNum } from './market.js';

export const DASH = '—';

/** Always includes the ISO currency code, e.g. "112.34 CAD". */
export function formatPrice(v: number | null | undefined, currency: string | null | undefined): string {
  if (!isNum(v)) return DASH;
  const digits = Math.abs(v) < 1 ? 4 : 2;
  const n = new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
  return currency ? `${n} ${currency}` : n;
}

export function formatSigned(v: number | null | undefined, digits = 2): string {
  if (!isNum(v)) return DASH;
  const n = new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Math.abs(v));
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${n}`;
}

export function formatPercent(v: number | null | undefined): string {
  if (!isNum(v)) return DASH;
  return `${formatSigned(v, 2)}%`;
}

export function formatCompact(v: number | null | undefined): string {
  if (!isNum(v)) return DASH;
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(v);
}

export function formatMarketCap(v: number | null | undefined, currency: string | null | undefined): string {
  if (!isNum(v)) return DASH;
  return `${formatCompact(v)}${currency ? ` ${currency}` : ''}`;
}

export function formatDateTime(iso: string | null | undefined, timeZone: string, opts: { seconds?: boolean; dateOnly?: boolean } = {}): string {
  if (!iso) return DASH;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return DASH;
  if (opts.dateOnly) {
    return new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'short', day: 'numeric' }).format(d);
  }
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: opts.seconds ? '2-digit' : undefined,
    timeZoneName: 'short',
  }).format(d);
}

export function formatAge(seconds: number | null | undefined): string {
  if (!isNum(seconds)) return DASH;
  if (seconds < 60) return `${Math.round(seconds)}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86400)} d ago`;
}
