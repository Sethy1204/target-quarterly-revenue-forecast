import { useCallback, useEffect, useRef, useState } from 'react';

export interface PollerState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** When this browser last received a successful response. */
  lastOkAt: number | null;
  /** When the next automatic request is scheduled (null while paused). */
  nextAt: number | null;
  paused: boolean;
  failures: number;
  refresh: () => void;
}

const MAX_BACKOFF = 10 * 60_000;

/**
 * Polls `fetcher` on the schedule the server returns (`nextAt(data)`), pauses while the
 * tab is hidden, resumes immediately when visible if a refresh is due, and backs off
 * exponentially after failures. `deps` changes trigger an immediate refetch.
 */
export function usePoller<T>(
  fetcher: (force: boolean) => Promise<T>,
  nextAt: (data: T) => number | null,
  opts: { fallbackMs: number; enabled?: boolean; deps?: unknown[] },
): PollerState<T> {
  const { fallbackMs, enabled = true, deps = [] } = opts;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastOkAt, setLastOkAt] = useState<number | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [paused, setPaused] = useState(typeof document !== 'undefined' ? document.hidden : false);
  const [failures, setFailures] = useState(0);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextRef = useRef<number | null>(null);
  const failRef = useRef(0);
  const running = useRef(false);
  const pending = useRef<{ force: boolean } | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const nextAtRef = useRef(nextAt);
  nextAtRef.current = nextAt;
  const alive = useRef(true);
  const runRef = useRef<(force: boolean) => Promise<void>>(async () => {});

  const schedule = useCallback((at: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    nextRef.current = at;
    if (document.hidden) {
      setNext(null);
      return;
    }
    setNext(at);
    timer.current = setTimeout(() => void runRef.current(false), Math.max(0, at - Date.now()));
  }, []);

  const run = useCallback(
    async (force: boolean) => {
      if (running.current) {
        // Queue one follow-up run (e.g. ids changed or manual refresh mid-request).
        pending.current = { force: (pending.current?.force ?? false) || force };
        return;
      }
      running.current = true;
      setLoading(true);
      try {
        const d = await fetcherRef.current(force);
        if (!alive.current) return;
        failRef.current = 0;
        setFailures(0);
        setData(d);
        setError(null);
        setLastOkAt(Date.now());
        const n = nextAtRef.current(d);
        schedule(Math.max(Date.now() + 2_000, (n ?? Date.now() + fallbackMs) + 500));
      } catch (e) {
        if (!alive.current) return;
        failRef.current += 1;
        setFailures(failRef.current);
        setError(e instanceof Error ? e.message : String(e));
        schedule(Date.now() + Math.min(15_000 * 2 ** (failRef.current - 1), MAX_BACKOFF));
      } finally {
        running.current = false;
        if (alive.current) setLoading(false);
        const p = pending.current;
        pending.current = null;
        if (p && alive.current) void runRef.current(p.force);
      }
    },
    [fallbackMs, schedule],
  );
  runRef.current = run;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // Initial load / dependency change.
  useEffect(() => {
    if (!enabled) return;
    void run(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  // Pause while hidden; resume (and catch up) when visible; retry when back online.
  useEffect(() => {
    if (!enabled) return;
    const onVis = () => {
      if (document.hidden) {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        setPaused(true);
        setNext(null);
      } else {
        setPaused(false);
        const at = nextRef.current ?? Date.now();
        if (at <= Date.now()) void run(false);
        else schedule(at);
      }
    };
    const onOnline = () => void run(false);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('online', onOnline);
    };
  }, [enabled, run, schedule]);

  const refresh = useCallback(() => void run(true), [run]);
  return { data, error, loading, lastOkAt, nextAt: next, paused, failures, refresh };
}

/** Re-renders every `ms` (for countdowns / relative ages). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
