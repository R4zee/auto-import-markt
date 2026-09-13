import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fetch as undiciFetch, ProxyAgent, type Dispatcher, type RequestInit as UndiciRequestInit } from 'undici';

const execFileAsync = promisify(execFile);

const proxyAgents = new Map<string, Dispatcher>();

/**
 * Dispatcher für einen HTTP(S)-Proxy (z. B. Residential-Proxy mit Wohnsitz-IP).
 * URL-Form: http://user:pass@host:port – wird je URL einmal angelegt und wiederverwendet.
 */
export function proxyDispatcher(proxyUrl: string): Dispatcher {
  let agent = proxyAgents.get(proxyUrl);
  if (!agent) {
    // connectTimeout: Verbindung zum Proxy; requestTls.timeout: TLS-Aufbau zum Ziel durch den Tunnel
    agent = new ProxyAgent({ uri: proxyUrl, connectTimeout: 30000, requestTls: { timeout: 30000 } });
    proxyAgents.set(proxyUrl, agent);
  }
  return agent;
}

/**
 * HTTP über das System-curl (HTTP_CLIENT=curl). Auf GitHub-Runnern kommt curl durch den Residential-
 * Proxy zuverlässig zu Encar, während der undici-Tunnel dort in den Connect-Timeout läuft.
 * Antwort wird als Standard-Response zurückgegeben (Status, Header, Body).
 */
export async function curlFetch(url: string, o: { proxyUrl?: string; timeoutMs?: number; headers?: Record<string, string> }): Promise<Response> {
  const args = ['-sS', '--compressed', '--max-time', String(Math.ceil((o.timeoutMs ?? 20000) / 1000)), '-D', '-'];
  if (o.proxyUrl) args.push('-x', o.proxyUrl);
  for (const [k, v] of Object.entries(o.headers ?? {})) args.push('-H', `${k}: ${v}`);
  args.push(url);
  const { stdout } = await execFileAsync('curl', args, { maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' });
  // Header-Blöcke (bei Proxy ggf. "HTTP/1.1 200 Connection established" zuerst) vom Body trennen
  let buf: Buffer = stdout as Buffer;
  let status = 0;
  const headers = new Headers();
  for (;;) {
    const sep = buf.indexOf('\r\n\r\n');
    if (sep < 0 || !buf.subarray(0, 5).toString().startsWith('HTTP/')) break;
    const block = buf.subarray(0, sep).toString('utf8').split('\r\n');
    buf = buf.subarray(sep + 4);
    const m = /^HTTP\/\S+\s+(\d{3})/.exec(block[0] ?? '');
    status = m ? Number(m[1]) : status;
    if (status === 200 && /connection established/i.test(block[0] ?? '')) { status = 0; continue; } // Proxy-Tunnel-Zeile überspringen
    for (const line of block.slice(1)) {
      const i = line.indexOf(':');
      if (i > 0) headers.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
    }
    if (status >= 200 && status !== 100) break;
  }
  if (!status) throw new Error(`curl: keine HTTP-Statuszeile erhalten (${new URL(url).host})`);
  headers.delete('content-encoding'); // curl hat bereits dekomprimiert
  headers.delete('content-length');
  return new Response(new Uint8Array(buf), { status, headers });
}

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

/**
 * HTTP-Abruf: zuerst das globale fetch; schlägt es ohne Netzwerkursache fehl (auf Vercel ist
 * fetch instrumentiert und lehnt manche URLs ab), Wiederholung mit dem ungepatchten undici-Client.
 */
export async function robustFetch(url: string, init: RequestInit & { timeoutMs?: number; proxyUrl?: string } = {}): Promise<Response> {
  const { timeoutMs = 20000, proxyUrl, ...rest } = init;
  if (process.env.HTTP_CLIENT === 'curl') {
    return curlFetch(url, { proxyUrl, timeoutMs, headers: rest.headers as Record<string, string> | undefined });
  }
  if (proxyUrl) {
    // Über Proxy immer der undici-Client (das globale fetch kennt keinen Dispatcher)
    const res = await undiciFetch(url, { ...(rest as UndiciRequestInit), dispatcher: proxyDispatcher(proxyUrl), signal: AbortSignal.timeout(timeoutMs) });
    return res as unknown as Response;
  }
  try {
    return await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const cause = (e as Error & { cause?: { code?: string } }).cause;
    if (e instanceof Error && e.name !== 'TimeoutError' && !(cause && cause.code)) {
      const res = await undiciFetch(url, { ...(rest as UndiciRequestInit), signal: AbortSignal.timeout(timeoutMs) });
      return res as unknown as Response;
    }
    throw e;
  }
}

export async function getJson<T>(url: string, init: RequestInit & { retries?: number; timeoutMs?: number; maxRetryWaitMs?: number; proxyUrl?: string } = {}): Promise<T> {
  const { retries = 2, timeoutMs = 20000, maxRetryWaitMs = 15000, proxyUrl, ...rest } = init;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await robustFetch(url, { ...rest, timeoutMs, proxyUrl });
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
