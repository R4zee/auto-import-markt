import { useEffect, useRef, useState } from 'react';

export function useLocalStorage<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
  }, [key, value]);
  return [value, setValue];
}

/** Aktuelle Zeit, jede Sekunde aktualisiert (für Auktions-Countdowns). */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

/** Hash-Routing: '#/', '#/listing/<id>', '#/watchlist', '#/compare' */
export type Route = { view: 'search' } | { view: 'detail'; id: string } | { view: 'watchlist' } | { view: 'compare' };

function parseHash(hash: string): Route {
  const h = hash.replace(/^#\/?/, '');
  if (h.startsWith('listing/')) return { view: 'detail', id: decodeURIComponent(h.slice('listing/'.length)) };
  if (h === 'watchlist') return { view: 'watchlist' };
  if (h === 'compare') return { view: 'compare' };
  return { view: 'search' };
}

export function toHash(r: Route): string {
  switch (r.view) {
    case 'detail': return `#/listing/${encodeURIComponent(r.id)}`;
    case 'watchlist': return '#/watchlist';
    case 'compare': return '#/compare';
    default: return '#/';
  }
}

export function useHashRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const navigate = (r: Route) => {
    const h = toHash(r);
    if (window.location.hash !== h) window.location.hash = h;
    else setRoute(r);
    window.scrollTo({ top: 0 });
  };
  return [route, navigate];
}

export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  useEffect(() => { ref.current = value; }, [value]);
  return ref.current;
}
