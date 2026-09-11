import { useEffect, useMemo, useState } from 'react';
import { api, type Fuel, type MarketCode, type OfferType, type SearchResult, type SortKey } from '../api';
import { CarCard } from '../components/CarCard';
import { Flag } from '../components/Flag';
import { useApp } from '../context';
import { km } from '../format';
import { useDebounced } from '../hooks';

export interface Filters {
  offer: 'all' | OfferType; markets: MarketCode[]; query: string; sort: SortKey; make: string; model: string; loc: string;
  maxPrice: number; yearFrom: number; yearTo: number; maxKm: number; fuels: Fuel[]; trans: Array<'Automatic' | 'Manual'>; cocOnly: boolean;
}

export const DEFAULT_FILTERS: Filters = {
  offer: 'all', markets: [], query: '', sort: 'landed-asc', make: '', model: '', loc: '',
  maxPrice: 300000, yearFrom: 1985, yearTo: 2026, maxKm: 300000, fuels: [], trans: [], cocOnly: false,
};

const MARKET_ORDER: MarketCode[] = ['JP', 'KR', 'US', 'GCC', 'SE', 'EE'];
const FUELS: Fuel[] = ['Petrol', 'Diesel', 'Hybrid', 'Electric'];
const TRANS: Array<'Automatic' | 'Manual'> = ['Automatic', 'Manual'];

function toggle<T>(list: T[], v: T): T[] { return list.includes(v) ? list.filter((x) => x !== v) : [...list, v]; }

export function SearchView({ filters, setFilters }: { filters: Filters; setFilters: (f: Filters) => void }) {
  const { t, dest, destName, port, money, config, pro, marketLabel, ccy } = useApp();
  const [result, setResult] = useState<SearchResult | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [marketsOpen, setMarketsOpen] = useState(false);
  const debouncedQuery = useDebounced(filters.query, 250);
  const [reload, setReload] = useState(0);

  const f = filters;
  const set = (patch: Partial<Filters>) => setFilters({ ...f, ...patch });

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    api.search({
      q: debouncedQuery, offer: f.offer, markets: f.markets, make: f.make, model: f.model, location: f.loc,
      yearFrom: f.yearFrom, yearTo: f.yearTo, maxKm: f.maxKm, fuels: f.fuels, transmissions: f.trans, cocOnly: f.cocOnly,
      maxLanded: f.maxPrice, dest, sort: f.sort,
    }).then((r) => { if (!cancelled) { setResult(r); setState('ok'); } })
      .catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, f.offer, f.markets, f.make, f.model, f.loc, f.yearFrom, f.yearTo, f.maxKm, f.fuels, f.trans, f.cocOnly, f.maxPrice, f.sort, dest, reload]);

  const cars = result?.items ?? [];
  const fxLine = useMemo(() => {
    const r = config?.fx.rates ?? {};
    const jpy = r.JPY ?? 0.0061; const usd = r.USD ?? 0.92;
    return t('fxLine', { dest: destName, port, fx: `¥1 = €${jpy.toFixed(4)} · $1 = €${usd.toFixed(2)}` });
  }, [config, destName, port, t]);

  const exportCsv = () => {
    const rows = [[t('sYear'), 'Make', 'Model', t('rTrim'), t('thMarket'), t('thOffer'), t('thMileage') + ' km', t('thSource'), t('thLanded') + ' EUR']];
    cars.forEach((c) => rows.push([String(c.year), c.make, c.model, c.trim, marketLabel(c.market), c.offerType === 'auction' ? t('auctionLot') : t('fixedPrice'), String(c.km), `${c.price} ${c.currency}`, String(Math.round(c.landed.totalEur))]));
    const text = rows.map((r) => r.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    a.download = 'auto-import-markt-shortlist.csv';
    a.click();
  };

  const chipStyle = (on: boolean) => ({ borderColor: on ? 'var(--color-accent)' : 'var(--color-divider)', color: on ? 'var(--color-accent)' : 'var(--color-neutral-300)', height: 28, fontSize: 12, padding: '0 10px' });

  return (
    <div>
      <div className="aim-wrap" style={{ padding: '26px 28px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 280 }}>
            <i className="ph ph-magnifying-glass" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', fontSize: 17, color: 'var(--color-neutral-500)' }} />
            <input className="input" value={f.query} onChange={(e) => set({ query: e.target.value })} placeholder={t('searchPlaceholder')} style={{ minHeight: 46, paddingLeft: 42, fontSize: 15, borderRadius: 'var(--radius-lg)' }} />
          </div>
          <div className="seg" style={{ borderRadius: 'var(--radius-lg)', height: 46 }}>
            {([['all', 'ph-squares-four', 'allOffers'], ['fixed', 'ph-tag', 'fixedPrice'], ['auction', 'ph-gavel', 'auction']] as const).map(([v, icon, label]) => (
              <label key={v} className="seg-opt" style={{ padding: '0 18px' }}>
                <input type="radio" name="offer" checked={f.offer === v} onChange={() => set({ offer: v })} />
                <i className={`ph ${icon}`} style={{ fontSize: 15 }} />{t(label)}
              </label>
            ))}
          </div>
        </div>
        <div className="hr" style={{ margin: '22px 0 0' }} />
      </div>

      <div className="aim-wrap" style={{ padding: '20px 28px', display: 'flex', flexWrap: 'wrap', gap: 26, alignItems: 'flex-start' }}>
        <aside className="aim-sidebar">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-neutral-500)' }}>{t('filters')}</span>
            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setFilters(DEFAULT_FILTERS)}>{t('reset')}</button>
          </div>

          <div>
            <button onClick={() => setMarketsOpen((v) => !v)} className="btn" style={{ width: '100%', justifyContent: 'flex-start', gap: 7, padding: 0, height: 20, border: 0, fontFamily: 'var(--font-body)', fontWeight: 400, fontSize: 12, color: 'var(--color-neutral-400)' }}>
              <i className={marketsOpen ? 'ph ph-caret-down' : 'ph ph-caret-right'} style={{ fontSize: 13 }} />
              {t('markets')}
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--color-neutral-500)' }}>{f.markets.length ? t('nSelected', { n: f.markets.length }) : t('allMarkets')}</span>
            </button>
            {marketsOpen && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                {MARKET_ORDER.map((m) => {
                  const on = f.markets.includes(m);
                  const meta = config?.markets.find((x) => x.code === m);
                  return (
                    <button key={m} onClick={() => set({ markets: toggle(f.markets, m) })} className="btn" style={{ borderColor: on ? 'var(--color-accent)' : 'var(--color-divider)', color: on ? 'var(--color-accent)' : 'var(--color-text)', background: on ? 'color-mix(in srgb, var(--color-accent) 12%, transparent)' : 'transparent', height: 30, width: '100%', justifyContent: 'flex-start', fontSize: 12.5, padding: '0 10px', gap: 8 }}>
                      <Flag code={meta?.flag ?? m.toLowerCase()} />
                      {marketLabel(m)}
                      <span style={{ opacity: 0.6, fontSize: 11, marginLeft: 'auto' }}>{result?.marketCounts[m] ?? ''}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <div style={{ fontSize: 12, color: 'var(--color-neutral-400)', marginBottom: 7 }}>{t('make')}</div>
            <select className="input" value={f.make} onChange={(e) => set({ make: e.target.value, model: '' })} style={{ minHeight: 32, fontSize: 12.5 }}>
              <option value="">{t('allMakes')}</option>
              {result?.facets.makes.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--color-neutral-400)', marginBottom: 7 }}>{t('model')}</div>
            <select className="input" value={f.model} onChange={(e) => set({ model: e.target.value })} style={{ minHeight: 32, fontSize: 12.5 }}>
              <option value="">{t('allModels')}</option>
              {result?.facets.models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--color-neutral-400)', marginBottom: 7 }}>{t('location')}</div>
            <select className="input" value={f.loc} onChange={(e) => set({ loc: e.target.value })} style={{ minHeight: 32, fontSize: 12.5 }}>
              <option value="">{t('allLocations')}</option>
              {result?.facets.locations.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 7 }}>
              <span style={{ color: 'var(--color-neutral-400)' }}>{t('landedMax')}</span>
              <span className="tabular">{money(f.maxPrice)}</span>
            </div>
            <input type="range" min={20000} max={300000} step={5000} value={f.maxPrice} onChange={(e) => set({ maxPrice: +e.target.value })} style={{ width: '100%' }} aria-label={t('landedMax')} />
          </div>

          <div>
            <div style={{ fontSize: 12, color: 'var(--color-neutral-400)', marginBottom: 7 }}>{t('year')}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <input className="input tabular" type="number" min={1985} max={2026} value={f.yearFrom} onChange={(e) => set({ yearFrom: +e.target.value || 1985 })} style={{ minHeight: 32, fontSize: 12.5, padding: '4px 8px', minWidth: 0 }} />
              <span style={{ color: 'var(--color-neutral-600)', fontSize: 12 }}>–</span>
              <input className="input tabular" type="number" min={1985} max={2026} value={f.yearTo} onChange={(e) => set({ yearTo: +e.target.value || 2026 })} style={{ minHeight: 32, fontSize: 12.5, padding: '4px 8px', minWidth: 0 }} />
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 7 }}>
              <span style={{ color: 'var(--color-neutral-400)' }}>{t('mileageMax')}</span>
              <span className="tabular">{km(f.maxKm)}</span>
            </div>
            <input type="range" min={10000} max={300000} step={10000} value={f.maxKm} onChange={(e) => set({ maxKm: +e.target.value })} style={{ width: '100%' }} aria-label={t('mileageMax')} />
          </div>

          <div>
            <div style={{ fontSize: 12, color: 'var(--color-neutral-400)', marginBottom: 8 }}>{t('fuel')}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {FUELS.map((x) => <button key={x} className="btn" style={chipStyle(f.fuels.includes(x))} onClick={() => set({ fuels: toggle(f.fuels, x) })}>{t(x)}</button>)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--color-neutral-400)', marginBottom: 8 }}>{t('transmission')}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {TRANS.map((x) => <button key={x} className="btn" style={chipStyle(f.trans.includes(x))} onClick={() => set({ trans: toggle(f.trans, x) })}>{t(x)}</button>)}
            </div>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={f.cocOnly} onChange={(e) => set({ cocOnly: e.target.checked })} style={{ accentColor: 'var(--color-accent)', width: 15, height: 15 }} />
            {t('cocOnly')}
          </label>

          <div style={{ padding: '11px 12px', borderRadius: 'var(--radius-md)', background: 'var(--color-accent-900)', display: 'flex', gap: 9, alignItems: 'flex-start' }}>
            <i className="ph ph-steering-wheel" style={{ fontSize: 16, color: 'var(--color-accent-300)', marginTop: 1 }} />
            <div style={{ fontSize: 11.5, lineHeight: 1.45, color: 'var(--color-accent-200)' }}>
              <strong style={{ fontWeight: 600 }}>{t('lhdTitle')}</strong> {t('lhdBody')}
            </div>
          </div>

          <div style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--color-neutral-600)' }}>{fxLine}</div>
        </aside>

        <main style={{ flex: '999 1 520px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span style={{ fontFamily: 'var(--font-heading)', fontSize: 22 }}>{state === 'loading' && !result ? t('loading') : t('vehicles', { n: result?.total ?? 0 })}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {pro && (
                <button className="btn btn-secondary" style={{ height: 32, fontSize: 12.5 }} onClick={exportCsv}><i className="ph ph-download-simple" style={{ fontSize: 14 }} />{t('exportCsv')}</button>
              )}
              <select className="input" value={f.sort} onChange={(e) => set({ sort: e.target.value as SortKey })} style={{ width: 'auto', minHeight: 32, fontSize: 12.5 }} aria-label="Sort">
                <option value="landed-asc">{t('sortLowHigh')}</option>
                <option value="landed-desc">{t('sortHighLow')}</option>
                <option value="year-desc">{t('sortNewest')}</option>
                <option value="km-asc">{t('sortKm')}</option>
                <option value="ending">{t('sortEnding')}</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(258px, 1fr))', gap: 16, opacity: state === 'loading' ? 0.6 : 1, transition: 'opacity 120ms' }}>
            {cars.map((c) => <CarCard key={`${c.id}-${ccy}`} car={c} />)}
          </div>

          {state === 'error' && (
            <div style={{ padding: '70px 20px', textAlign: 'center', color: 'var(--color-neutral-500)' }}>
              <i className="ph ph-plugs" style={{ fontSize: 34, display: 'block', marginBottom: 12 }} />
              <div style={{ fontSize: 15 }}>{t('loadError')}</div>
              <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => setReload((n) => n + 1)}><i className="ph ph-arrow-clockwise" />{t('reset')}</button>
            </div>
          )}

          {state === 'ok' && cars.length === 0 && (
            <div style={{ padding: '70px 20px', textAlign: 'center', color: 'var(--color-neutral-500)' }}>
              <i className="ph ph-car-profile" style={{ fontSize: 34, display: 'block', marginBottom: 12 }} />
              <div style={{ fontSize: 15 }}>{t('noResults')}</div>
              <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => setFilters(DEFAULT_FILTERS)}>{t('resetFilters')}</button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

