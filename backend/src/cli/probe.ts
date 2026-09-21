import { config, type OlxSite } from '../config.js';
import { allProviders } from '../providers/index.js';
import { curlFetch, freshFetch, getJson, robustFetch } from '../providers/http.js';
import { mapOlxOffer, olxHeaders, OlxProvider, type OlxFilterLevel } from '../providers/olx.js';
import { mapSauto, SautoProvider } from '../providers/sauto.js';
import { mapSubito, SubitoProvider } from '../providers/subito.js';
import { CopartProvider, copartSkipReason, mapCopart } from '../providers/copart.js';
import { DubizzleProvider, dubizzleSkipReason, initialBands, mapDubizzle } from '../providers/dubizzle.js';
import { japcarzSkipReason, mapJapCarz, type JapCarzItem } from '../providers/japcarz.js';
import { extractItems, mapMobileItem, mobileApiUrl, mobileMakeId, MobileDeReference, mobileSearchUrl, mobileSeoUrl, type RefQuery } from '../providers/mobilede.js';
import { bucketKey, kmBandFor, kmWindow, kwWindow, summarize, titleMatches } from '../services/reference.js';
import { yearBand } from '../domain/generations.js';
import type { Fuel } from '../domain/types.js';

/**
 * Probe für die Frontend-Endpunkte (OLX, Subito, Sauto): holt eine kleine Seite direkt, zeigt die Rohantwort
 * (gekürzt) und die abgebildeten Inserate, ohne in die Datenbank zu schreiben. Damit lässt sich vom eigenen
 * Rechner in einer Minute prüfen, ob Endpunkt, Kategorie-IDs und Feldnamen stimmen.
 *
 *   npm run probe -- olx        (alle konfigurierten OLX-Seiten, je 5 Inserate; bei 403 mehrere Header-Varianten)
 *   npm run probe -- olx-scan ro [bis] | olx-scan bg von bis   (Kategorienamen der Seite – Pkw-Kategorie-ID finden)
 *   npm run probe -- olx-page pt /carros-motos-e-barcos/carros/  (Kategorie-ID aus dem Seitenquelltext der Pkw-Kategorie)
 *   npm run probe -- olx-children bg 360                          (Unterkategorien aus den Inseraten einer Oberkategorie)
 *   npm run probe -- subito
 *   npm run probe -- sauto
 *   npm run probe -- mobile BMW 320d 2019 Diesel [km]   (Vergleichspreise DE: beide mobile.de-Modi, Rohantwort, Stichproben, km-Fenster)
 *   npm run probe -- mobile Mercedes-Benz "S350 W221" 2013 Diesel   (Baureihen-Code → Bauzeitraum 2005–2013 statt Baujahr ±1)
 *   npm run probe -- mobile Mercedes-Benz "S350 W221" 2013 Diesel 80000 "S-Class"   (Modell-ID über die SEO-Modellseite statt Freitext)
 *   npm run probe -- mobile-model BMW "3 Series"   (nur die Modell-ID auflösen)
 *   npm run probe -- copart                        (Copart-Suchendpunkt: Rohantwort des ersten Loses, Zuordnung)
 *   npm run probe -- dubizzle                      (Dubizzle-Algolia-Proxy: Gesamtzahl, Roh-Treffer, Zuordnung, Preisfenster)
 *   npm run probe -- japcarz [sort] [page]         (Jap Carz JSON-API /api/listings/: Schlüssel, Paginierung, erstes Fahrzeug roh)
 *   npm run probe -- url <URL> [Header:Wert …]     (beliebige Adresse: Status, Content-Type, Anfang der Antwort – für neue Quellen)
 *   npm run probe -- <provider> (jeder andere Provider: fetchAll mit Ausgabe der ersten 3 Inserate)
 */
const name = process.argv[2] ?? '';
const short = (v: unknown, n = 1800) => JSON.stringify(v, null, 1).slice(0, n);
const proxyUrl = config.europe.proxyUrl || undefined;
const fetchedAt = new Date().toISOString();

/** Gleiche URL mit verschiedenen Header-Sätzen und Clients anfragen – zeigt, welche Variante der WAF durchlässt; liefert den ersten Treffer-Body. */
async function tryVariants(url: string, variants: Array<[string, Record<string, string>]>): Promise<string | null> {
  console.log('  Varianten:');
  let firstOk: string | null = null;
  for (const [label, headers] of variants) {
    const t0 = Date.now();
    try {
      const res = await robustFetch(url, { headers, timeoutMs: 20000, proxyUrl });
      const body = await res.text();
      console.log(`   ${res.ok ? '✔' : '✖'} ${label.padEnd(28)} HTTP ${res.status} · ${Date.now() - t0} ms · ${body.slice(0, 80).replace(/\s+/g, ' ')}`);
      if (res.ok && !firstOk) firstOk = body;
    } catch (e) {
      console.log(`   ✖ ${label.padEnd(28)} ${e instanceof Error ? e.message.slice(0, 100) : String(e)}`);
    }
  }
  if (variants.length < 2) return firstOk;
  const t0 = Date.now();
  try {
    const res = await curlFetch(url, { headers: variants[0]?.[1], timeoutMs: 20000, proxyUrl });
    const body = await res.text();
    console.log(`   ${res.ok ? '✔' : '✖'} ${'curl (HTTP_CLIENT=curl)'.padEnd(28)} HTTP ${res.status} · ${Date.now() - t0} ms · ${body.slice(0, 80).replace(/\s+/g, ' ')}`);
  } catch (e) {
    console.log(`   ✖ ${'curl (HTTP_CLIENT=curl)'.padEnd(28)} ${e instanceof Error ? e.message.slice(0, 100) : String(e)}`);
  }
  return firstOk;
}

async function showOlx(json: { data?: unknown[]; metadata?: unknown }, site: OlxSite, p: OlxProvider): Promise<void> {
  console.log('metadata:', short(json.metadata, 400));
  const first = (json.data?.[0] ?? {}) as Record<string, unknown>;
  console.log('data[0].params:', short(first.params, 2500));
  console.log('data[0] ohne params/description:', short({ ...first, params: undefined, description: undefined, user: undefined }, 1500));
  // Marke wie im Adapter über die Unterkategorie (Breadcrumbs) ermitteln
  const makeByCategory = new Map<number, string>();
  for (const o of (json.data ?? []).slice(0, 5) as Array<{ category?: { id?: number } }>) {
    const cid = o.category?.id;
    if (cid != null && cid !== site.categoryId) await p.makeForCategory(site, cid, makeByCategory);
  }
  for (const o of (json.data ?? []).slice(0, 5)) {
    const l = mapOlxOffer(o as never, site, fetchedAt, makeByCategory);
    if (l) { console.log(`  ✔ ${l.year} ${l.make} ${l.model} · ${l.trim} · ${l.km} km · ${l.price} ${l.currency} · ${l.fuel}/${l.transmission}/${l.drive}/${l.steering} · ${l.location} · ${l.photos.length} Fotos`); continue; }
    const ofr = o as { title?: string; status?: string; params?: Array<{ key: string; value?: unknown }> };
    const keys = (ofr.params ?? []).map((x) => x.key);
    console.log(`  ✖ nicht abbildbar: "${ofr.title ?? ''}" · status=${ofr.status ?? '?'} · Preis ${keys.includes('price') ? 'da' : 'FEHLT'} · Baujahr ${keys.includes('year') ? 'da' : 'FEHLT'} · Zustand ${JSON.stringify((ofr.params ?? []).find((x) => x.key === 'condition')?.value ?? null)}`);
  }
}

async function probeOlx() {
  const p = new OlxProvider();
  for (const site of config.olx.sites) {
    console.log(`\n=== OLX ${site.country.toUpperCase()} · ${site.host} · Kategorie ${site.categoryId ?? '— (OLX_SITES setzen)'} · ${site.enabled ? 'an' : 'aus'}`);
    if (site.categoryId == null) continue;
    const url = p.offersUrl(site, 0).replace(/limit=\d+/, 'limit=5');
    console.log(url);
    let json: { data?: unknown[]; metadata?: unknown } | null = null;
    // Verbindungsexperimente: dieselbe Anfrage 5× je Variante – zeigt, ob Verbindungs-Wiederverwendung die 403 auslöst
    const run = async (label: string, fn: () => Promise<Response>) => {
      const seq: string[] = [];
      for (let i = 0; i < 5; i++) {
        try { const res = await fn(); await res.text(); seq.push(String(res.status)); } catch (e) { seq.push(e instanceof Error ? e.name : 'ERR'); }
        await new Promise((r) => setTimeout(r, 250));
      }
      console.log(`  ${label.padEnd(40)} ${seq.join(' → ')}`);
    };
    const hdr = olxHeaders(site, 'browser');
    console.log('  Verbindungsexperimente (Befund 14.09.2026: WAF blockt Nodes TLS-Fingerprint; Chrome-Profil → 200):');
    const pair = async (label: string, mk: () => Promise<Response>) => {
      // Schlag auf Schlag: zwei Anfragen ohne Pause, dann 1 s Pause – dreimal
      const seq: string[] = [];
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 2; j++) { try { const r = await mk(); await r.text(); seq.push(String(r.status)); } catch (e) { seq.push(e instanceof Error ? e.name : 'ERR'); } }
        seq.push('|');
        await new Promise((r) => setTimeout(r, 1000));
      }
      console.log(`  ${label.padEnd(40)} ${seq.join(' ')}`);
    };
    await run('K Pool mit Chrome-TLS-Profil (Adapter)', () => robustFetch(url, { headers: hdr, timeoutMs: 20000, proxyUrl, nodeOnly: true, tls: 'chrome' }));
    if (process.env.PROBE_ALL_EXPERIMENTS) {
      await pair('F Pool, Paare ohne Pause', () => robustFetch(url, { headers: hdr, timeoutMs: 20000, proxyUrl, nodeOnly: true }));
      await pair('G Pool, Paare, ohne eigene Header', () => robustFetch(url, { timeoutMs: 20000, proxyUrl, nodeOnly: true }));
      await run('H frisch + Chrome-TLS-Profil', () => freshFetch(url, { headers: hdr, timeoutMs: 20000, proxyUrl, tls: 'chrome' }));
      await run('I frisch + Chrome-TLS + HTTP/2', () => freshFetch(url, { headers: hdr, timeoutMs: 20000, proxyUrl, tls: 'chrome', h2: true }));
      await run('J frisch + nur TLS 1.3', () => freshFetch(url, { headers: hdr, timeoutMs: 20000, proxyUrl, tls: 'tls13' }));
    }
    try {
      // wie im Adapter (Chrome-TLS-Profil, Wiederholung, bei 400 ohne Serverfilter)
      const state: { filters: OlxFilterLevel } = { filters: config.olx.serverFilters ? 'both' : 'none' };
      const warn: string[] = [];
      json = (await p.fetchOffers(site, 0, state, warn)) as { data?: unknown[]; metadata?: unknown };
      json = { ...json, data: (json.data ?? []).slice(0, 5) };
      console.log(`  ✔ Liste über den Adapter-Abruf geladen (Serverfilter: ${state.filters})`);
      for (const w of warn) console.log(`  ⚠ ${w}`);
    } catch (e) {
      console.log('  ✖', e instanceof Error ? e.message.slice(0, 200) : String(e));
      const body = await tryVariants(url, [
        ['browser-Header', olxHeaders(site, 'browser')],
        ['nur Accept: json', olxHeaders(site, 'minimal')],
        ['json + User-Agent', olxHeaders(site, 'json')],
        ['ohne Header', {}],
      ]);
      if (body) { try { json = JSON.parse(body); console.log('  → Treffer der ersten erfolgreichen Variante:'); } catch { /* kein JSON */ } }
      else console.log('  Im Browser testen (liefert die Seite dort JSON?):', url);
    }
    if (json) {
      await showOlx(json, site, p);
      // Serverfilter über den Adapter-Abruf – welche akzeptiert die Seite, wie viele Treffer bleiben?
      const base = p.offersUrl(site, 0, 'none').replace(/limit=\d+/, 'limit=1');
      const mp = p.minPrice(site);
      for (const [label, extra] of [['ohne Filter', ''], [`Preis ab ${mp}`, `&filter_float_price%3Afrom=${mp}`], ['Baujahr ab 2012', '&filter_float_year%3Afrom=2012'], ['Preis+Baujahr', `&filter_float_price%3Afrom=${mp}&filter_float_year%3Afrom=2012`]] as const) {
        try {
          const j = await p.get<{ metadata?: { visible_total_count?: number; total_elements?: number } }>(`${base}${extra}`, site);
          console.log(`  Filter ${label.padEnd(20)} ✔ ${j.metadata?.visible_total_count ?? '?'} Treffer`);
        } catch (e) { console.log(`  Filter ${label.padEnd(20)} ✖ ${e instanceof Error ? e.message.slice(0, 60) : String(e)}`); }
      }
    }
  }
}

/**
 * Pkw-Kategorie einer OLX-Seite finden: `npm run probe -- olx-scan ro` fragt die Kategorien 1…N nacheinander über den
 * Breadcrumb-Endpunkt ab und zeigt die Namen; die Zeile mit „Autoturisme“ / „Автомобили“ / „Carros“ ist die gesuchte ID.
 * Über den Adapter-Abruf (Sofort-Wiederholung), 400 ms Pause je Kategorie, Abbruch bei fünf Fehlern in Folge.
 */
function olxSiteFor(country: string): OlxSite {
  return config.olx.sites.find((s) => s.country === country) ?? { country, host: `www.olx.${country}`, categoryId: null, currency: 'EUR', minPrice: 5000, enabled: true };
}

async function scanOlxCategories(country: string, from: number, to: number) {
  const site = olxSiteFor(country);
  const p = new OlxProvider();
  console.log(`\n=== OLX ${country.toUpperCase()} · ${site.host} · Kategorien ${from}–${to} über /api/v1/offers/metadata/breadcrumbs/ (nur Treffer mit Unterkategorie)`);
  let failures = 0;
  for (let id = from; id <= to; id++) {
    try {
      const json = await p.get<unknown>(`https://${site.host}/api/v1/offers/metadata/breadcrumbs/?category_id=${id}`, site, 4);
      failures = 0;
      const labels = OlxProvider.breadcrumbLabels(json);
      if (labels.length > 1) console.log(`  ${String(id).padStart(5)}  ${labels.slice(1).join(' › ')}`);
    } catch (e) {
      failures++;
      const msg = e instanceof Error ? e.message : String(e);
      if (!/HTTP 404|HTTP 400/.test(msg)) console.log(`  ${String(id).padStart(4)}  ✖ ${msg.slice(0, 80)}`);
      if (failures >= 5 && !/HTTP 404|HTTP 400/.test(msg)) { console.log('  Abbruch: fünf Fehler in Folge (WAF?) – später erneut versuchen'); break; }
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

/**
 * Kategorie-ID aus der HTML-Seite der Pkw-Kategorie lesen: `npm run probe -- olx-page bg /avtomobili-i-dzhipove/`
 * Sucht im Seitenquelltext nach category_id / categoryId / "category":{"id":…}, zählt die Kandidaten und prüft die
 * häufigsten über den Breadcrumb-Endpunkt.
 */
async function olxPage(country: string, path: string) {
  const site = olxSiteFor(country);
  const p = new OlxProvider();
  const url = `https://${site.host}${path.startsWith('/') ? path : `/${path}`}`;
  console.log(`\n=== OLX ${country.toUpperCase()} · Seite ${url}`);
  const res = await robustFetch(url, { headers: { ...olxHeaders(site, 'browser'), Accept: 'text/html,application/xhtml+xml' }, timeoutMs: 30000, proxyUrl, nodeOnly: true, tls: 'chrome' });
  const html = await res.text();
  console.log(`  HTTP ${res.status} · ${(html.length / 1024).toFixed(0)} KB`);
  if (!res.ok) return;
  const counts = new Map<number, number>();
  const patterns = [/category_id(?:%3D|=|\\?["']?\s*:\s*\\?["']?)(\d{1,6})/gi, /categoryId\\?["']?\s*[:=]\s*\\?["']?(\d{1,6})/gi, /\\?["']category\\?["']\s*:\s*\{\s*\\?["']id\\?["']\s*:\s*\\?["']?(\d{1,6})/gi, /cat_l1_id\\?["']?\s*:\s*\\?["'](\d{1,6})/gi, /cat_l2_id\\?["']?\s*:\s*\\?["'](\d{1,6})/gi];
  for (const re of patterns) for (const m of html.matchAll(re)) counts.set(Number(m[1]), (counts.get(Number(m[1])) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (!top.length) { console.log('  keine Kategorie-IDs im Quelltext gefunden'); return; }
  console.log('  Kandidaten (ID × Vorkommen) und Breadcrumb:');
  for (const [id, n] of top) {
    try {
      const json = await p.get<unknown>(`https://${site.host}/api/v1/offers/metadata/breadcrumbs/?category_id=${id}`, site, 4);
      console.log(`  ${String(id).padStart(5)} ×${String(n).padEnd(4)} ${OlxProvider.breadcrumbLabels(json).slice(1).join(' › ') || '(nur Startseite)'}`);
    } catch (e) { console.log(`  ${String(id).padStart(5)} ×${String(n).padEnd(4)} ✖ ${e instanceof Error ? e.message.slice(0, 60) : String(e)}`); }
  }
}

/**
 * Unterkategorien einer OLX-Oberkategorie aus ihren Inseraten ablesen: `npm run probe -- olx-children bg 360`
 * lädt Inserate der Kategorie, sammelt die verwendeten category.id-Werte und benennt sie über den Breadcrumb-Endpunkt.
 */
async function olxChildren(country: string, parentId: number) {
  const site = olxSiteFor(country);
  const p = new OlxProvider();
  console.log(`\n=== OLX ${country.toUpperCase()} · Unterkategorien aus Inseraten der Kategorie ${parentId}`);
  const ids = new Map<number, number>();
  for (let offset = 0; offset < 200; offset += 40) {
    const json = await p.get<{ data?: Array<{ category?: { id?: number }; title?: string }> }>(`https://${site.host}/api/v1/offers/?category_id=${parentId}&offset=${offset}&limit=40&sort_by=created_at:desc`, site);
    const offers = json.data ?? [];
    for (const o of offers) if (o.category?.id != null) ids.set(o.category.id, (ids.get(o.category.id) ?? 0) + 1);
    if (offers.length < 40) break;
  }
  if (!ids.size) { console.log('  keine Inserate/Kategorien gefunden'); return; }
  const seen = new Set<string>();
  for (const [id, n] of [...ids.entries()].sort((a, b) => b[1] - a[1])) {
    try {
      const json = await p.get<unknown>(`https://${site.host}/api/v1/offers/metadata/breadcrumbs/?category_id=${id}`, site, 4);
      const labels = OlxProvider.breadcrumbLabels(json).slice(1);
      // Marken-Unterkategorien auf die Pkw-Ebene zusammenfassen: die vorletzte Ebene ist die gesuchte Kategorie
      const parentChain = labels.slice(0, -1).join(' › ');
      console.log(`  ${String(id).padStart(5)} ×${String(n).padEnd(3)} ${labels.join(' › ')}`);
      if (labels.length >= 3 && !seen.has(parentChain)) {
        seen.add(parentChain);
        console.log(`         → Oberkategorie dieser Marke: "${parentChain}" – deren ID mit olx-scan im passenden Bereich oder aus der Seite ermitteln`);
      }
    } catch (e) { console.log(`  ${String(id).padStart(5)} ×${String(n).padEnd(3)} ✖ ${e instanceof Error ? e.message.slice(0, 60) : String(e)}`); }
  }
}

async function probeSubito() {
  const p = new SubitoProvider();
  const url = p.searchUrl(0).replace(/lim=\d+/, 'lim=5');
  console.log(`\n=== Subito.it (Kategorie c=${config.subito.categoryId})\n${url}`);
  try {
    const json = await getJson<{ ads?: unknown[]; count_all?: number }>(url, { headers: { Accept: 'application/json', 'User-Agent': config.europe.userAgent }, proxyUrl, retries: 0 });
    console.log('count_all:', json.count_all, '· Schlüssel der Antwort:', Object.keys(json).join(', '));
    const ads = json.ads ?? [];
    if (!ads.length) {
      console.log('Rohantwort (gekürzt):', short(json, 1500));
      console.log('  ✖ keine Inserate – Kategorie prüfen: im Browser https://www.subito.it/annunci-italia/vendita/auto/ öffnen → Netzwerk-Tab → Aufruf hades.subito.it/v1/search/items?c=… ablesen und als SUBITO_CATEGORY_ID setzen');
      return;
    }
    const first = ads[0] as Record<string, unknown>;
    console.log('Schlüssel von ads[0]:', Object.keys(first).join(', '));
    console.log('ads[0].features:', short(first.features, 4000));
    console.log('ads[0] ohne body/images/features:', short({ ...first, body: undefined, images: undefined, features: undefined }, 1500));
    for (const ad of ads.slice(0, 5)) {
      const l = mapSubito(ad as never, fetchedAt);
      console.log(l ? `  ✔ ${l.year} ${l.make} ${l.model} · ${l.trim} · ${l.km} km · ${l.price} ${l.currency} · ${l.fuel}/${l.transmission} · ${l.location} · ${l.photos.length} Fotos` : '  ✖ nicht abbildbar');
    }
  } catch (e) {
    console.log('  ✖', e instanceof Error ? e.message.slice(0, 200) : String(e));
    await tryVariants(url, [
      ['json + User-Agent', { Accept: 'application/json', 'User-Agent': config.europe.userAgent }],
      ['browser-Header', { Accept: 'application/json, text/plain, */*', 'User-Agent': config.europe.userAgent, 'Accept-Language': 'it-IT,it;q=0.9', Origin: 'https://www.subito.it', Referer: 'https://www.subito.it/' }],
      ['ohne Header', {}],
    ]);
  }
}

async function probeSauto() {
  const p = new SautoProvider();
  const url = p.searchUrl(0, config.sauto.minPriceCzk, null).replace(/limit=\d+/, 'limit=5');
  console.log(`\n=== Sauto.cz\n${url}`);
  const json = await getJson<{ results?: unknown[]; pagination?: unknown }>(url, { headers: { Accept: 'application/json', 'User-Agent': config.europe.userAgent }, proxyUrl });
  console.log('pagination:', short(json.pagination, 300));
  const first = json.results?.[0] as Record<string, unknown> | undefined;
  console.log('Rohantwort results[0] (ohne images):', short({ ...first, images: undefined }, 2500));
  // Bilder: Feldform prüfen (Sauto liefert protokollrelative URLs ohne Größenparameter)
  console.log('results[0].images (roh):', short(first?.images, 1200));
  for (const it of (json.results ?? []).slice(0, 5)) {
    const l = mapSauto(it as never, fetchedAt);
    console.log(l ? `  ✔ ${l.year} ${l.make} ${l.model} · ${l.trim} · ${l.km} km · ${l.price} ${l.currency} · ${l.location} · ${l.photos.length}/${l.photoCount} Fotos · ${l.photos[0] ?? '–'} · ${l.url}` : '  ✖ nicht abbildbar');
  }
}

/** Modell-ID von mobile.de über die SEO-Modellseite: `probe mobile-model Mercedes-Benz "S-Class"` */
async function probeMobileModel(make: string, model: string): Promise<{ modelId: number | null; modelGroupId: number | null }> {
  const src = new MobileDeReference();
  console.log(`\n=== mobile.de Modell-ID · ${make} "${model}" → ${mobileSeoUrl(make, model)}`);
  try {
    const r = await src.resolveModel(make, model);
    const ok = r.makeId != null && (r.modelId != null || r.modelGroupId != null);
    console.log(`  ${ok ? '✔' : '✖'} make=${r.makeId ?? '–'} model=${r.modelId ?? '–'} modelGroup=${r.modelGroupId ?? '–'} · Bezeichnung "${r.label || '–'}"${ok ? ` → Suche mit ms=${r.makeId};${r.modelId ?? ''};${r.modelGroupId ?? ''};` : ''}`);
    if (!ok) console.log('  Kein Modell erkannt – Slug prüfen: im Browser suchen.mobile.de → Marke/Modell wählen → Adresse /auto/<marke>-<modell>.html vergleichen');
    return ok ? { modelId: r.modelId, modelGroupId: r.modelGroupId } : { modelId: null, modelGroupId: null };
  } catch (e) {
    console.log('  ✖', e instanceof Error ? e.message.slice(0, 200) : String(e));
    return { modelId: null, modelGroupId: null };
  }
}

/** Vergleichspreise DE: `probe mobile <Marke> <Beschreibung> [Baujahr] [Petrol|Diesel|Hybrid|Electric] [km] [Modellname] [kW]` */
async function probeMobile(make: string, description: string, year: number, fuel: Fuel | null, km: number, model: string | null, kw: number | null) {
  // Beschreibung darf einen Baureihen-Code enthalten ("S350 W221") → Bauzeitraum statt Baujahr ±1
  const band = yearBand({ make, model: description, trim: description, year }, config.reference.yearSpan);
  const cleanDesc = band.generation ? description.replace(new RegExp(`\\s*\\b${band.generation}\\b\\s*`, 'i'), ' ').trim() : description;
  const ref = model ? await probeMobileModel(make, model) : { modelId: null, modelGroupId: null };
  const power = kw ? kwWindow(kw) : null;
  const q: RefQuery = { make, description: cleanDesc, yearFrom: band.from, yearTo: band.to, fuel, generation: band.generation, kmTo: kmBandFor(km), ...ref, model: model ?? undefined, kwFrom: power?.from ?? null, kwTo: power?.to ?? null };
  const src = new MobileDeReference();
  const viaId = ref.modelId ? `Modell-ID ${ref.modelId}` : ref.modelGroupId ? `Modellgruppe ${ref.modelGroupId}` : '';
  console.log(`\n=== mobile.de · ${make} (ID ${mobileMakeId(make) ?? 'UNBEKANNT → REFERENCE_MAKE_IDS'}) · "${cleanDesc}"${viaId ? ` · ${viaId} statt Freitext` : ''} · ${q.yearFrom}–${q.yearTo}${band.generation ? ` (Baureihe ${band.generation})` : ''} · ${fuel ?? 'alle Kraftstoffe'} · ${km} km → Suche bis ${q.kmTo ?? 'unbegrenzt'} km${power ? ` · ${kw} kW → Suche ${power.from}–${power.to} kW` : ''}`);
  console.log('Such-URL (Browser):', mobileSearchUrl(q));
  let got: Awaited<ReturnType<typeof src.fetchPage>> | null = null;
  for (const mode of ['query', 'url'] as const) {
    const url = mobileApiUrl(q, 1, mode);
    const t0 = Date.now();
    try {
      const r = await src.fetchPage(q, 1, mode);
      console.log(`  ✔ Modus ${mode.padEnd(5)} HTTP 200 · ${Date.now() - t0} ms · ${r.items.length} Stichproben · Treffer gesamt ${r.total ?? '?'} · Seiten ${r.numPages ?? '?'}\n    ${url}`);
      if (!got) got = r;
    } catch (e) {
      console.log(`  ✖ Modus ${mode.padEnd(5)} ${e instanceof Error ? e.message.slice(0, 160) : String(e)}\n    ${url}`);
    }
  }
  if (!got) {
    console.log('  Beide Modi scheitern. Im Browser die Such-URL öffnen → Netzwerk-Tab → Aufruf mit "consumer/api/search" kopieren und mit `probe url <URL> x-mobile-client:de.mobile.consumer-webapp` prüfen.');
    return;
  }
  const raw = got.raw as Record<string, unknown>;
  console.log('Schlüssel der Antwort:', Object.keys(raw).join(', '));
  console.log('filters.ms:', short((raw.filters as Record<string, unknown> | undefined)?.ms, 400));
  const items = extractItems(raw);
  console.log(`Trefferliste: ${items.length} Einträge · erster Eintrag (gekürzt):`, short(items[0], 2500));
  for (const s of got.items.slice(0, 8)) console.log(`  ✔ ${s.year} · ${s.km} km · ${s.priceEur} € · ${s.kw ?? '?'} kW · ${s.ccm ?? '?'} cm³ · ${s.title} · ${s.url ?? ''}`);
  const bad = items.filter((it) => !mapMobileItem(it)).length;
  if (bad) console.log(`  ⚠ ${bad} Einträge nicht abbildbar (Werbeplätze oder andere Feldnamen – siehe Rohantwort)`);
  // mobile.de sucht die Beschreibung unscharf → Modellabgleich über shortTitle/Titel wie im Adapter
  const matching = got.items.filter((s) => titleMatches(cleanDesc, s));
  console.log(`Modellabgleich "${cleanDesc}": ${matching.length} von ${got.items.length} Treffern passen${matching.length < got.items.length ? ` – verworfen: ${got.items.filter((s) => !titleMatches(cleanDesc, s)).map((s) => s.model ?? s.title).slice(0, 6).join(' | ')}` : ''}`);
  const fake = { km, engineCcm: null, powerKw: kw };
  const bucket = { key: bucketKey(q), source: src.id, query: q, samples: got.items, total: got.total, url: mobileSearchUrl(q), fetchedAt: fetchedAt };
  const win = kmWindow(km);
  const sum = summarize(fake, 0, bucket);
  console.log(`km-Fenster für ${km} km: bis ${win.to} km → ${sum ? `${sum.count} vergleichbar, günstigstes ${sum.minEur} €` : 'kein vergleichbares Angebot auf Seite 1'}`);
}

async function probeCopart(site: 'us' | 'ca' = 'us') {
  const p = new CopartProvider(site);
  console.log(`\n=== ${p.label} · POST https://${site === 'ca' ? 'www.copart.ca' : 'www.copart.com'}/public/lots/search-results · Seite 0, 5 Lose${config.copart.makes.length ? ` · Marken ${config.copart.makes.join(',')}` : ''}`);
  try {
    const r = await p.fetchPage(0, 5);
    console.log(`  ✔ ${r.lots.length} Lose · gesamt ${r.total ?? '?'}`);
    console.log('Schlüssel der Antwort:', Object.keys((r.raw as Record<string, unknown>) ?? {}).join(', '));
    console.log('content[0] (gekürzt):', short(r.lots[0], 3000));
    // Wo beginnen die künftigen Termine? Je Seite (100 Lose) Termin des ersten und letzten Loses
    const day = (ms: unknown) => { const n = Number(ms); return n > 0 ? new Date(n).toISOString().slice(0, 16) : '–'; };
    for (const page of [0, 5, 10, 20, 40]) {
      const pg = await p.fetchPage(page, 100);
      const future = pg.lots.filter((l) => !copartSkipReason(l, site)).length;
      console.log(`  Seite ${String(page).padStart(2)}: Termine ${day(pg.lots[0]?.ad)} … ${day(pg.lots[pg.lots.length - 1]?.ad)} · ${future} von ${pg.lots.length} übernehmbar`);
    }
    for (const lot of r.lots) {
      const l = mapCopart(lot, fetchedAt, site);
      console.log(l ? `  ✔ ${l.year} ${l.make} ${l.model} · ${l.trim} · ${l.km} km · ${l.price} ${l.currency} · Titel ${l.titleKind ?? '–'} · ${l.offerType}${l.auction ? ` bis ${l.auction.endsAt}` : ''} · ${l.location} · ${l.photos.length} Fotos · ${l.url}` : `  – übersprungen (${copartSkipReason(lot, site) ?? 'unvollständig'}): ln=${lot.ln} ${lot.lcy} ${lot.mkn} ${lot.lmg ?? lot.lm} · hb=${lot.hb} bnp=${lot.bnp} cuc=${lot.cuc} loc=${lot.locCountry} ad=${lot.ad ? new Date(Number(lot.ad)).toISOString().slice(0, 10) : '–'}`);
    }
  } catch (e) {
    console.log('  ✖', e instanceof Error ? e.message.slice(0, 300) : String(e));
    console.log(`  Im Browser https://${site === 'ca' ? 'www.copart.ca' : 'www.copart.com'}/vehicleFinder öffnen → Netzwerk-Tab → Aufruf "search-results" → Request-Body und Antwort hier einfügen.`);
  }
}

async function probeDubizzle() {
  const p = new DubizzleProvider();
  console.log('\n=== Dubizzle Motors (VAE) · POST algolia.dubizzle.com/1/indexes/*/queries · Index motors.com');
  try {
    const r = await p.fetchPage([0, null], 0, 5);
    console.log(`  ✔ ${r.total} Gebrauchtwagen gesamt · ${r.hits.length} Treffer geholt`);
    const hit = r.hits[0];
    if (hit) {
      console.log('Schlüssel des Treffers:', Object.keys(hit).join(', '));
      console.log('details-Schlüssel:', Object.keys(hit.details ?? {}).join(', ') || '–', '· details_v2:', Object.keys(hit.details_v2 ?? {}).join(', ') || '–');
      console.log('hits[0] (gekürzt):', short(hit, 3500));
    }
    for (const h of r.hits) {
      const l = mapDubizzle(h, fetchedAt);
      console.log(l ? `  ✔ ${l.year} ${l.make} ${l.model} · ${l.trim} · ${l.km} km · ${l.price} ${l.currency} · ${l.engine || '–'} · ${l.transmission} · ${l.location} · ${l.photos.length}/${l.photoCount} Fotos · ${l.url}` : `  – übersprungen (${dubizzleSkipReason(h) ?? 'unvollständig'}): ${short(h.name, 80)} · price=${h.price}`);
    }
    // Wie verteilen sich die Treffer auf die Preisfenster? (Fenster > 1.000 werden im Sync halbiert)
    const bands = initialBands(config.dubizzle.minPriceAed);
    const counts: string[] = [];
    for (const b of bands) {
      const pg = await p.fetchPage(b, 0, 1);
      counts.push(`${b[0] / 1000}k–${b[1] != null ? `${b[1] / 1000}k` : '∞'}: ${pg.total}`);
    }
    console.log('  Preisfenster (AED):', counts.join(' · '));
  } catch (e) {
    console.log('  ✖', e instanceof Error ? e.message.slice(0, 400) : String(e));
    console.log('  Im Browser https://uae.dubizzle.com/motors/used-cars/ öffnen → Netzwerk-Tab → Aufruf "queries" (algolia.dubizzle.com) → Antwort hier einfügen.');
  }
}

/**
 * Jap Carz (Japan, jap-carz.com): JSON-API der Website `GET /api/listings/?sort=upcoming_auctions&per_page=30&page=1`
 * (Netzwerk-Tab 20.09.2026). Zeigt Antwortstruktur und das erste Fahrzeug roh – Grundlage für den Adapter.
 */
async function probeJapCarz(sort = 'upcoming_auctions', page = 1) {
  const url = `https://jap-carz.com/api/listings/?sort=${encodeURIComponent(sort)}&per_page=30&page=${page}`;
  console.log(`\n=== Jap Carz · ${url}`);
  const headers = { Accept: '*/*', 'Accept-Language': 'en-US,en;q=0.9', Referer: 'https://jap-carz.com/', 'User-Agent': config.europe.userAgent };
  const t0 = Date.now();
  try {
    const res = await robustFetch(url, { headers, timeoutMs: 30000, proxyUrl, nodeOnly: true, tls: 'chrome' });
    const body = await res.text();
    console.log(`  HTTP ${res.status} · ${Date.now() - t0} ms · ${res.headers.get('content-type') ?? '?'} · ${(body.length / 1024).toFixed(1)} KB`);
    let json: unknown;
    try { json = JSON.parse(body); } catch { console.log('  keine JSON-Antwort:', body.slice(0, 1500)); return; }
    const obj = json as Record<string, unknown>;
    console.log('  JSON-Schlüssel:', Array.isArray(json) ? `Array[${json.length}]` : Object.keys(obj).join(', '));
    // Trefferliste finden (Array unter einem der üblichen Schlüssel oder das erste Array-Feld)
    const listKey = Array.isArray(json) ? null : ['listings', 'results', 'items', 'data', 'cars', 'vehicles'].find((k) => Array.isArray(obj[k])) ?? Object.keys(obj).find((k) => Array.isArray(obj[k]));
    const list = (Array.isArray(json) ? json : listKey ? obj[listKey] : []) as unknown[];
    const meta = Array.isArray(json) ? {} : Object.fromEntries(Object.entries(obj).filter(([k]) => k !== listKey));
    console.log(`  Liste unter "${listKey ?? '(Array)'}": ${list.length} Einträge · übrige Felder:`, short(meta, 800));
    if (list[0]) {
      console.log('  Schlüssel des ersten Fahrzeugs:', Object.keys(list[0] as Record<string, unknown>).join(', '));
      console.log('  listings[0] (roh, gekürzt):', short(list[0], 2500));
    }
    // Zuordnung aller Fahrzeuge der Seite
    for (const item of list as JapCarzItem[]) {
      const l = mapJapCarz(item, fetchedAt);
      console.log(l
        ? `  ✔ ${l.year} ${l.make} ${l.model} · ${l.trim} · ${l.km} km · ${l.engine || '–'} · ${l.transmission} · ${l.fuel} · Start ${l.price} ${l.currency} · ${l.auction?.house} bis ${l.auction?.endsAt.slice(0, 16)} · ${l.photos.length}/${l.photoCount} Fotos · ${l.url}`
        : `  – übersprungen (${japcarzSkipReason(item) ?? 'unvollständig'}): ${item.year} ${short(item.title, 60)} · ${item.steering_wheel} · Start ${item.parsed_starting_bid} · ${item.auction_result}`);
    }
  } catch (e) {
    console.log('  ✖', e instanceof Error ? e.message.slice(0, 300) : String(e));
    console.log('  Braucht der Endpunkt das Session-Cookie? Dann im Browser die Antwort des Aufrufs "api/listings" (Reiter Antwort) kopieren und hier einfügen.');
  }
}

/** Beliebige Adresse anfragen: `probe url https://… Header:Wert …` */
async function probeUrl(url: string, headerArgs: string[]) {
  const headers: Record<string, string> = { 'User-Agent': config.europe.userAgent, Accept: 'application/json, text/html;q=0.9, */*;q=0.8' };
  for (const h of headerArgs) { const i = h.indexOf(':'); if (i > 0) headers[h.slice(0, i).trim()] = h.slice(i + 1).trim(); }
  console.log(`\n=== ${url}`);
  const t0 = Date.now();
  const res = await robustFetch(url, { headers, timeoutMs: 30000, proxyUrl, nodeOnly: true, tls: 'chrome' });
  const type = res.headers.get('content-type') ?? '?';
  // Bilder (CDN-Prüfung): nur Status, Typ und Größe – kein Binärmüll im Protokoll
  if (/^image\//i.test(type)) {
    const bytes = (await res.arrayBuffer()).byteLength;
    console.log(`  HTTP ${res.status} · ${Date.now() - t0} ms · ${type} · ${(bytes / 1024).toFixed(1)} KB · Header: ${[...res.headers.entries()].filter(([k]) => /cache|vary|access-control|x-/i.test(k)).map(([k, v]) => `${k}=${v}`).join(' · ')}`);
    return;
  }
  const body = await res.text();
  console.log(`  HTTP ${res.status} · ${Date.now() - t0} ms · ${type} · ${(body.length / 1024).toFixed(1)} KB`);
  const max = Number(process.env.PROBE_JSON_CHARS ?? 4000);
  try {
    const json = JSON.parse(body) as Record<string, unknown>;
    console.log('  JSON-Schlüssel:', Object.keys(json).join(', '));
    console.log(short(json, max));
  } catch {
    console.log(body.slice(0, Math.max(3000, max)));
  }
}

try {
  if (name === 'mobile') {
    const fuelArg = process.argv[6] ?? '';
    const fuel = (['Petrol', 'Diesel', 'Hybrid', 'Electric'] as Fuel[]).find((f) => f.toLowerCase() === fuelArg.toLowerCase()) ?? null;
    await probeMobile(process.argv[3] ?? 'BMW', process.argv[4] ?? '320d', Number(process.argv[5] ?? 2019), fuel, Number(process.argv[7] ?? 80000), process.argv[8] || null, process.argv[9] ? Number(process.argv[9]) : null);
  } else if (name === 'mobile-model') await probeMobileModel(process.argv[3] ?? 'Mercedes-Benz', process.argv[4] ?? 'S-Class');
  else if (name === 'copart') await probeCopart(process.argv[3] === 'ca' ? 'ca' : 'us');
  else if (name === 'dubizzle') await probeDubizzle();
  else if (name === 'japcarz') await probeJapCarz(process.argv[3] || 'upcoming_auctions', Number(process.argv[4] ?? 1));
  else if (name === 'url') await probeUrl(process.argv[3] ?? '', process.argv.slice(4));
  else if (name === 'olx') await probeOlx();
  else if (name === 'olx-scan') {
    const a = Number(process.argv[4] ?? 1); const b = Number(process.argv[5] ?? (process.argv[4] ? a : 120));
    await scanOlxCategories((process.argv[3] ?? 'ro').toLowerCase(), process.argv[5] ? a : 1, b);
  } else if (name === 'olx-page') await olxPage((process.argv[3] ?? 'bg').toLowerCase(), process.argv[4] ?? '/');
  else if (name === 'olx-children') await olxChildren((process.argv[3] ?? 'bg').toLowerCase(), Number(process.argv[4] ?? 360));
  else if (name === 'subito') await probeSubito();
  else if (name === 'sauto') await probeSauto();
  else {
    const p = allProviders().find((x) => x.id === name);
    if (!p) {
      console.log(`Provider angeben: ${allProviders().map((x) => x.id).join(', ')}`);
      process.exitCode = 2;
    } else {
      const res = await p.fetchAll();
      console.log(`${p.id}: ${res.listings.length} Inserate, complete=${res.complete}${res.warnings?.length ? `\n  ⚠ ${res.warnings.join('\n  ⚠ ')}` : ''}`);
      for (const l of res.listings.slice(0, 3)) console.log(short(l, 1200));
    }
  }
} catch (e) {
  console.error('✖', e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
}
