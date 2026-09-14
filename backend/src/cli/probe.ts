import { config } from '../config.js';
import { allProviders } from '../providers/index.js';
import { curlFetch, getJson, robustFetch } from '../providers/http.js';
import { mapOlxOffer, olxHeaders, OlxProvider } from '../providers/olx.js';
import { mapSauto, SautoProvider } from '../providers/sauto.js';
import { mapSubito, SubitoProvider } from '../providers/subito.js';

/**
 * Probe für die Frontend-Endpunkte (OLX, Subito, Sauto): holt eine kleine Seite direkt, zeigt die Rohantwort
 * (gekürzt) und die abgebildeten Inserate, ohne in die Datenbank zu schreiben. Damit lässt sich vom eigenen
 * Rechner in einer Minute prüfen, ob Endpunkt, Kategorie-IDs und Feldnamen stimmen.
 *
 *   npm run probe -- olx        (alle konfigurierten OLX-Seiten, je 5 Inserate; bei 403 mehrere Header-Varianten)
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
    console.log(l ? `  ✔ ${l.year} ${l.make} ${l.model} · ${l.trim} · ${l.km} km · ${l.price} ${l.currency} · ${l.location} · ${l.photos.length} Fotos` : '  ✖ nicht abbildbar (Preis/Baujahr/Titel fehlt?)');
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
    try {
      // wie im Adapter: 403 bis zu dreimal wiederholen
      json = await getJson<{ data?: unknown[]; metadata?: unknown }>(url, p.http(site));
      console.log('  ✔ Liste geladen (Adapter-Header, ggf. nach Wiederholung)');
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
      const base = p.offersUrl(site, 0, false).replace(/limit=\d+/, 'limit=1');
      await tryVariants(`${base}&filter_float_price%3Afrom=20000`, [['nur Preisfilter', olxHeaders(site, 'browser')]]);
      await tryVariants(`${base}&filter_float_year%3Afrom=2012`, [['nur Baujahrfilter', olxHeaders(site, 'browser')]]);
    }
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
