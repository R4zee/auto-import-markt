/** Kleine HTTP-Hilfen für Provider: Timeout, Retry bei 429/5xx, JSON. */
export async function getJson<T>(url: string, init: RequestInit & { retries?: number; timeoutMs?: number } = {}): Promise<T> {
  const { retries = 2, timeoutMs = 20000, ...rest } = init;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status} ${url}`);
        await sleep(500 * 2 ** attempt);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return (await res.json()) as T;
    } catch (e) {
      lastErr = e;
      if (attempt === retries) break;
      await sleep(300 * 2 ** attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
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
