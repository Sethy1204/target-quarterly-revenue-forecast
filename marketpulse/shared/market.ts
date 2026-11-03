import { EXCHANGE_TZ, type ExchangeCode } from './companies.js';

/* ------------------------------------------------------------------ */
/* Price change math — never substitutes 0 for a missing value.        */
/* ------------------------------------------------------------------ */

export function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Parses a provider numeric field. Empty strings, null, "NaN", etc. → null (never 0). */
export function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const s = v.trim();
    if (s === '' || s.toLowerCase() === 'nan' || s.toLowerCase() === 'null' || s === '-') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export interface ChangeResult {
  change: number | null;
  changePercent: number | null;
}

/** Change relative to a reference price (e.g. previous close). */
export function computeChange(price: number | null, reference: number | null): ChangeResult {
  if (!isNum(price) || !isNum(reference)) return { change: null, changePercent: null };
  const change = price - reference;
  const changePercent = reference === 0 ? null : (change / reference) * 100;
  return { change: round(change, 6), changePercent: changePercent === null ? null : round(changePercent, 6) };
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/* ------------------------------------------------------------------ */
/* Market sessions                                                     */
/* ------------------------------------------------------------------ */

export type SessionState = 'pre-market' | 'regular' | 'after-hours' | 'closed' | 'holiday';

export interface SessionInfo {
  state: SessionState;
  label: string;
  /** Exchange-local date (YYYY-MM-DD) the session belongs to. */
  localDate: string;
  /** True when holiday tables don't cover this year (status may be wrong on holidays). */
  calendarUncertain: boolean;
}

/**
 * Full-day closures. Compiled from the exchanges' published rules for 2026–2027.
 * Verify against https://www.nyse.com/markets/hours-calendars and
 * https://www.tsx.com/trading/calendars-and-trading-hours before relying on them.
 * When a provider reports market-open status, the server prefers the provider value.
 */
const US_HOLIDAYS = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19',
  '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31', '2027-06-18',
  '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);
/** US early closes (13:00 ET regular-session close). */
const US_EARLY_CLOSE = new Set(['2026-11-27', '2026-12-24', '2027-11-26']);
const TSX_HOLIDAYS = new Set([
  '2026-01-01', '2026-02-16', '2026-04-03', '2026-05-18', '2026-07-01', '2026-08-03',
  '2026-09-07', '2026-10-12', '2026-12-25', '2026-12-28',
  '2027-01-01', '2027-02-15', '2027-03-26', '2027-05-24', '2027-07-01', '2027-08-02',
  '2027-09-06', '2027-10-11', '2027-12-27', '2027-12-28',
]);
const CALENDAR_YEARS = new Set([2026, 2027]);

export interface LocalParts {
  date: string; // YYYY-MM-DD
  weekday: number; // 0 = Sunday
  minutes: number; // minutes since local midnight
  year: number;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function localParts(now: Date, timeZone: string): LocalParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(now)) p[part.type] = part.value;
  const hour = Number(p.hour) % 24;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    weekday: WEEKDAYS.indexOf(p.weekday),
    minutes: hour * 60 + Number(p.minute),
    year: Number(p.year),
  };
}

const hm = (h: number, m = 0) => h * 60 + m;

export function getSession(exchange: ExchangeCode, now: Date = new Date()): SessionInfo {
  const tz = EXCHANGE_TZ[exchange];
  const lp = localParts(now, tz);
  const calendarUncertain = !CALENDAR_YEARS.has(lp.year);
  const base = { localDate: lp.date, calendarUncertain };
  const weekend = lp.weekday === 0 || lp.weekday === 6;

  if (exchange === 'TSX') {
    if (weekend) return { ...base, state: 'closed', label: 'Closed (weekend)' };
    if (TSX_HOLIDAYS.has(lp.date)) return { ...base, state: 'holiday', label: 'Closed (TSX holiday)' };
    if (lp.minutes >= hm(9, 30) && lp.minutes < hm(16)) return { ...base, state: 'regular', label: 'Regular session' };
    if (lp.minutes >= hm(7) && lp.minutes < hm(9, 30))
      return { ...base, state: 'closed', label: 'Pre-open (no continuous trading)' };
    return { ...base, state: 'closed', label: 'Closed' };
  }

  // NYSE / Nasdaq
  if (weekend) return { ...base, state: 'closed', label: 'Closed (weekend)' };
  if (US_HOLIDAYS.has(lp.date)) return { ...base, state: 'holiday', label: 'Closed (US market holiday)' };
  const close = US_EARLY_CLOSE.has(lp.date) ? hm(13) : hm(16);
  const afterEnd = US_EARLY_CLOSE.has(lp.date) ? hm(17) : hm(20);
  if (lp.minutes >= hm(4) && lp.minutes < hm(9, 30)) return { ...base, state: 'pre-market', label: 'Pre-market' };
  if (lp.minutes >= hm(9, 30) && lp.minutes < close)
    return { ...base, state: 'regular', label: US_EARLY_CLOSE.has(lp.date) ? 'Regular session (early close 1 p.m.)' : 'Regular session' };
  if (lp.minutes >= close && lp.minutes < afterEnd) return { ...base, state: 'after-hours', label: 'After-hours' };
  return { ...base, state: 'closed', label: 'Closed' };
}

/** Start of the current year in an exchange's timezone (YYYY-MM-DD). */
export function ytdStartDate(now: Date, timeZone = 'America/Toronto'): string {
  return `${localParts(now, timeZone).year}-01-01`;
}

/**
 * Converts an exchange-local wall-clock time ("YYYY-MM-DD HH:mm[:ss]" or "YYYY-MM-DD")
 * in `timeZone` to epoch ms. Date-only values are placed at 16:00 local (regular close).
 */
export function zonedLocalToEpoch(local: string, timeZone: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(local.trim());
  if (!m) return null;
  const [, y, mo, d, h = '16', mi = '00', s = '00'] = m;
  const asUtc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  // Offset of the zone at (approximately) that instant; iterate twice for DST edges.
  let guess = asUtc;
  for (let i = 0; i < 2; i++) {
    const off = tzOffsetMs(new Date(guess), timeZone);
    guess = asUtc - off;
  }
  return guess;
}

function tzOffsetMs(date: Date, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) p[part.type] = part.value;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Calendar date (YYYY-MM-DD) shifted by whole days/months/years in a timezone. */
export function shiftLocalDate(now: Date, timeZone: string, delta: { days?: number; months?: number; years?: number }): string {
  const lp = localParts(now, timeZone);
  const [y, m, d] = lp.date.split('-').map(Number);
  const dt = new Date(Date.UTC(y + (delta.years ?? 0), m - 1 + (delta.months ?? 0), d + (delta.days ?? 0)));
  return dt.toISOString().slice(0, 10);
}
