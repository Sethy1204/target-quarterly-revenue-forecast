export type ProviderErrorKind = 'rate-limit' | 'auth' | 'plan' | 'not-found' | 'network' | 'server' | 'bad-response' | 'not-configured';

export class ProviderError extends Error {
  constructor(
    message: string,
    public kind: ProviderErrorKind,
    public retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface FetchJsonOptions {
  headers?: Record<string, string>;
  retries?: number;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  /** Base delay for exponential backoff between retries. */
  backoffMs?: number;
  /** Strings to redact from error messages (API keys). */
  redact?: string[];
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function redactText(text: string, secrets: string[] = []): string {
  let out = text;
  for (const s of secrets) if (s) out = out.split(s).join('***');
  return out.replace(/(apikey|token)=[^&\s]+/gi, '$1=***');
}

/**
 * GET JSON with timeout, bounded retries + exponential backoff (network errors / 5xx only).
 * HTTP 429 is never retried immediately: it surfaces as a `rate-limit` error so the caller
 * can enter a cooldown instead of hammering the provider.
 */
export async function fetchJson<T = unknown>(url: string, opts: FetchJsonOptions = {}): Promise<T> {
  const { headers = {}, retries = 2, timeoutMs = 10_000, fetchImpl = fetch, backoffMs = 500, redact = [], sleep = defaultSleep } = opts;
  let lastErr: ProviderError | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(backoffMs * 2 ** (attempt - 1) + Math.floor(Math.random() * 100));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(url, { headers: { Accept: 'application/json', ...headers }, signal: ctrl.signal });
    } catch (e) {
      clearTimeout(timer);
      const msg = e instanceof Error ? (e.name === 'AbortError' ? `timeout after ${timeoutMs} ms` : e.message) : String(e);
      lastErr = new ProviderError(redactText(`Network error: ${msg}`, redact), 'network');
      continue;
    }
    clearTimeout(timer);
    if (res.status === 429) {
      const ra = Number(res.headers.get('retry-after'));
      throw new ProviderError('Provider rate limit reached (HTTP 429)', 'rate-limit', Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined);
    }
    if (res.status === 401) throw new ProviderError('Provider rejected the API key (HTTP 401)', 'auth');
    if (res.status === 403) throw new ProviderError('Access denied by provider — plan may not include this data (HTTP 403)', 'plan');
    if (res.status === 404) throw new ProviderError('Not found at provider (HTTP 404)', 'not-found');
    if (res.status >= 500) {
      lastErr = new ProviderError(`Provider server error (HTTP ${res.status})`, 'server');
      continue;
    }
    if (!res.ok) throw new ProviderError(`Unexpected provider response (HTTP ${res.status})`, 'bad-response');
    try {
      return (await res.json()) as T;
    } catch {
      throw new ProviderError('Provider returned invalid JSON', 'bad-response');
    }
  }
  throw lastErr ?? new ProviderError('Request failed', 'network');
}
