/** Kleine HTTP-Hilfen für Provider: Timeout, Retry bei 429/5xx (mit Retry-After), JSON. */
export class HttpError extends Error {
  readonly status: number;
  readonly url: string;
  readonly body: string;
  readonly retryAfterSec: number | null;

  constructor(status: number, url: string, body: string, retryAfterSec: number | null) {
    super(`HTTP ${status} ${url}${body ? ` – ${body.slice(0, 200)}` : ''}${retryAfterSec ? ` (Retry-After ${retryAfterSec}s)` : ''}`);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.body = body;
    this.retryAfterSec = retryAfterSec;
  }
  get rateLimited(): boolean {
    return this.status === 429;
  }
}

export async function getJson<T>(url: string, init: RequestInit & { retries?: number; timeoutMs?: number; maxRetryWaitMs?: number } = {}): Promise<T> {
  const { retries = 2, timeoutMs = 20000, maxRetryWaitMs = 15000, ...rest } = init;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) return (await res.json()) as T;
      const body = await res.text().catch(() => '');
      const retryAfter = Number(res.headers.get('retry-after'));
      const err = new HttpError(res.status, url, body, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null);
      if (res.status === 429 || res.status >= 500) {
        lastErr = err;
        if (attempt < retries) {
          const wait = Math.min(maxRetryWaitMs, err.retryAfterSec ? err.retryAfterSec * 1000 : 500 * 2 ** attempt);
          await sleep(wait);
          continue;
        }
        break;
      }
      throw err;
    } catch (e) {
      if (e instanceof HttpError) throw e;
      lastErr = describeNetworkError(e, url);
      if (attempt === retries) break;
      await sleep(300 * 2 ** attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** "fetch failed" um die eigentliche Ursache (DNS, TLS, Reset, Timeout) ergänzen. */
export function describeNetworkError(e: unknown, url: string): Error {
  if (!(e instanceof Error)) return new Error(`${String(e)} (${url})`);
  const parts = [e.message];
  // Ursachenkette (undici verpackt Netzwerkfehler, teils als AggregateError)
  let cur: unknown = (e as Error & { cause?: unknown }).cause;
  for (let depth = 0; cur && depth < 4; depth++) {
    const c = cur as Error & { code?: string; syscall?: string; hostname?: string; errors?: unknown[] };
    const inner = Array.isArray(c.errors) ? c.errors.map((x) => (x as Error & { code?: string }).code ?? (x as Error).message).join(',') : '';
    parts.push([c.name, c.code, c.syscall, c.hostname, c.message, inner].filter(Boolean).join(' '));
    cur = (c as Error & { cause?: unknown }).cause;
  }
  if (e.name === 'TimeoutError') parts.push('timeout');
  const err = new Error(`${parts.filter(Boolean).join(' – ')} (${new URL(url).host})`);
  err.name = e.name;
  return err;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) && v.trim() !== '' ? n : null;
  }
  return null;
}

export function str(v: unknown): string {
  return v == null ? '' : String(v);
}
