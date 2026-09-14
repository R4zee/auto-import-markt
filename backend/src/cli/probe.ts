import { config } from '../config.js';
import { allProviders } from '../providers/index.js';
import { curlFetch, freshFetch, getJson, robustFetch } from '../providers/http.js';
import { mapOlxOffer, olxHeaders, OlxProvider } from '../providers/olx.js';
import { mapSauto, SautoProvider } from '../providers/sauto.js';
import { mapSubito, SubitoProvider } from '../providers/subito.js';

/**
 * Probe für die Frontend-Endpunkte (OLX, Subito, Sauto): holt eine kleine Seite direkt, zeigt die Rohantwort
 * (gekürzt) und die abgebildeten Inserate, ohne in die Datenbank zu schreiben. Damit lässt sich vom eigenen
 * Rechner in einer Minute prüfen, ob Endpunkt, Kategorie-IDs und Feldnamen stimmen.
 *
 *   npm run probe -- olx        (alle konfigurierten OLX-Seiten, je 5 Inserate; bei 403 mehrere Header-Varianten)
 *   npm run probe -- olx-scan ro [120]   (Kategorienamen 1…120 der Seite olx.ro – Pkw-Kategorie-ID finden)
 *   npm run probe -- subito
 *   npm run probe -- sauto
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

function showOlx(json: { data?: unknown[]; metadata?: unknown }, site: (typeof config.olx.sites)[number]): void {
  console.log('metadata:', short(json.metadata, 400));
  const first = (json.data?.[0] ?? {}) as Record<string, unknown>;
  console.log('data[0].params:', short(first.params, 2500));
  console.log('data[0] ohne params/description:', short({ ...first, params: undefined, description: undefined, user: undefined }, 1500));
  for (const o of (json.data ?? []).slice(0, 5)) {
    const l = mapOlxOffer(o as never, site, fetchedAt);
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
      // wie im Adapter: bis zu sechs Versuche mit wechselnden Header-Sätzen
      json = await p.get<{ data?: unknown[]; metadata?: unknown }>(url, site);
      console.log('  ✔ Liste über den Adapter-Abruf geladen');
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
      showOlx(json, site);
      // Welche Serverfilter der WAF durchlässt (nur zur Information; Standard ist ohne)
      // Serverfilter über den Adapter-Abruf – welche lässt der WAF durch, wie viele Treffer bleiben?
      const base = p.offersUrl(site, 0, false).replace(/limit=\d+/, 'limit=1');
      for (const [label, extra] of [['ohne Filter', ''], ['nur Preisfilter', '&filter_float_price%3Afrom=20000'], ['nur Baujahrfilter', '&filter_float_year%3Afrom=2012'], ['Preis+Baujahr', '&filter_float_price%3Afrom=20000&filter_float_year%3Afrom=2012']] as const) {
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
async function scanOlxCategories(country: string, max: number) {
  const site = config.olx.sites.find((s) => s.country === country) ?? { country, host: `www.olx.${country}`, categoryId: null, currency: 'EUR', enabled: true };
  const p = new OlxProvider();
  console.log(`\n=== OLX ${country.toUpperCase()} · ${site.host} · Kategorien 1–${max} über /api/v1/offers/metadata/breadcrumbs/`);
  let failures = 0;
  let shownRaw = false;
  for (let id = 1; id <= max; id++) {
    try {
      const json = await p.get<unknown>(`https://${site.host}/api/v1/offers/metadata/breadcrumbs/?category_id=${id}`, site, 4);
      failures = 0;
      if (!shownRaw) { console.log('  Rohantwort (erste):', short(json, 700)); shownRaw = true; }
      const chain = OlxProvider.breadcrumbLabels(json).join(' › ');
      if (chain) console.log(`  ${String(id).padStart(4)}  ${chain}`);
    } catch (e) {
      failures++;
      const msg = e instanceof Error ? e.message : String(e);
      if (!/HTTP 404|HTTP 400/.test(msg)) console.log(`  ${String(id).padStart(4)}  ✖ ${msg.slice(0, 80)}`);
      if (failures >= 5 && !/HTTP 404|HTTP 400/.test(msg)) { console.log('  Abbruch: fünf Fehler in Folge (WAF?) – später erneut versuchen'); break; }
    }
    await new Promise((r) => setTimeout(r, 400));
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
  console.log('Rohantwort results[0]:', short(json.results?.[0], 3000));
  for (const it of (json.results ?? []).slice(0, 5)) {
    const l = mapSauto(it as never, fetchedAt);
    console.log(l ? `  ✔ ${l.year} ${l.make} ${l.model} · ${l.trim} · ${l.km} km · ${l.price} ${l.currency} · ${l.location} · ${l.photoCount} Fotos · ${l.url}` : '  ✖ nicht abbildbar');
  }
}

try {
  if (name === 'olx') await probeOlx();
  else if (name === 'olx-scan') await scanOlxCategories((process.argv[3] ?? 'ro').toLowerCase(), Number(process.argv[4] ?? 120));
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
