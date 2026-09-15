import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type AppConfig, type DestCode, type Listing, type Partner } from './api';
import { CompareBar } from './components/CompareBar';
import { Header } from './components/Header';
import { AppContext, type AppCtx } from './context';
import { displayRates, money as fmtMoney, type DisplayCurrency } from './format';
import { useHashRoute, useLocalStorage, useNow, useStoredChoice } from './hooks';
import { makeT, type Lang } from './i18n';
import { CompareView } from './views/CompareView';
import { DetailView } from './views/DetailView';
import { DEFAULT_FILTERS, SearchView, type Filters } from './views/SearchView';
import { WatchlistView } from './views/WatchlistView';

// Standardsprache Deutsch; nur 'en' als Umgebungswert schaltet um
const ENV_LANG: Lang = String(import.meta.env.VITE_DEFAULT_LANGUAGE ?? 'de').toLowerCase() === 'en' ? 'en' : 'de';
const ENV_DEST = String(import.meta.env.VITE_DEFAULT_DESTINATION ?? 'DE').toUpperCase() as DestCode;
const ENV_DEALER = String(import.meta.env.VITE_DEALER_MODE ?? 'false') === 'true';

function toggleIn(list: string[], id: string, max?: number): string[] {
  if (list.includes(id)) return list.filter((x) => x !== id);
  if (max != null && list.length >= max) return list;
  return [...list, id];
}

export default function App() {
  const [route, navigate] = useHashRoute();
  // Neue Schlüssel: die alten ('aim.lang', 'aim.dest') wurden auch ohne Nutzerwahl mit dem damaligen Standard (en) beschrieben
  const [storedLang, setLang] = useStoredChoice<Lang>('aim.ui.lang', ENV_LANG);
  const [storedDest, setDest] = useStoredChoice<DestCode>('aim.ui.dest', ENV_DEST);
  const [ccy, setCcy] = useLocalStorage<DisplayCurrency>('aim.ccy', 'EUR');
  const [saved, setSaved] = useLocalStorage<string[]>('aim.saved', []);
  const [compare, setCompare] = useLocalStorage<string[]>('aim.compare', []);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [batch, setBatch] = useState<{ items: Listing[]; partners: Record<string, Partner> }>({ items: [], partners: {} });
  const now = useNow();

  const pro = useMemo(() => {
    const p = new URLSearchParams(window.location.search).get('dealer');
    if (p != null) return p === '1' || p === 'true';
    return ENV_DEALER;
  }, []);

  useEffect(() => { api.config().then(setConfig).catch(() => setConfig(null)); }, []);

  // Nur bekannte Werte verwenden – ein ungültiger gespeicherter/konfigurierter Wert zeigte sonst die erste
  // Option ohne passende Flagge, bis der Nutzer neu auswählte
  const lang: Lang = storedLang === 'en' || storedLang === 'de' ? storedLang : 'de';
  const dest: DestCode = useMemo(() => {
    const codes = config?.destinations.map((d) => d.code);
    if (!codes || codes.includes(storedDest)) return storedDest;
    return codes.includes('DE') ? 'DE' : (codes[0] ?? storedDest);
  }, [config, storedDest]);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  // Merkliste + Vergleich: aktuelle Endpreise für das gewählte Zielland nachladen
  const batchIds = useMemo(() => Array.from(new Set([...saved, ...compare])), [saved, compare]);
  useEffect(() => {
    let cancelled = false;
    api.batch(batchIds, dest).then((r) => { if (!cancelled) setBatch(r); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [batchIds, dest]);

  const t = useMemo(() => makeT(lang), [lang]);
  const rates = useMemo(() => displayRates(config?.fx.rates ?? {}), [config]);
  const money = useCallback((eur: number) => fmtMoney(eur, ccy, rates), [ccy, rates]);
  const destMeta = config?.destinations.find((d) => d.code === dest);

  const ctx: AppCtx = {
    t, lang, dest, destName: t('c' + dest), port: destMeta?.port ?? 'Bremerhaven', ccy, money, config, pro, now, saved, compare,
    toggleSaved: (id) => setSaved((s) => toggleIn(s, id)),
    toggleCompare: (id) => setCompare((s) => toggleIn(s, id, 4)),
    clearCompare: () => setCompare([]),
    navigate,
    marketLabel: (m) => t('m' + m),
  };

  const byId = new Map(batch.items.map((l) => [l.id, l]));
  const savedCars = saved.map((id) => byId.get(id)).filter((x): x is Listing => !!x);
  const comparedCars = compare.map((id) => byId.get(id)).filter((x): x is Listing => !!x);

  return (
    <AppContext.Provider value={ctx}>
      <div className="aim-page">
        <Header view={route.view} onLang={setLang} onDest={setDest} onCcy={setCcy} />
        {route.view === 'search' && <SearchView filters={filters} setFilters={setFilters} />}
        {route.view === 'detail' && <DetailView id={route.id} />}
        {route.view === 'watchlist' && <WatchlistView cars={savedCars} />}
        {route.view === 'compare' && <CompareView cars={comparedCars} partners={batch.partners} />}
        {route.view !== 'compare' && <CompareBar cars={comparedCars} />}
      </div>
    </AppContext.Provider>
  );
}
