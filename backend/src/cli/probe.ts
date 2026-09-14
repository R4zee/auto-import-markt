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

/** Gleiche URL mit verschiedenen Header-Sätzen und Clients anfragen – zeigt, welche Variante der WAF durchlässt. */
async function tryVariants(url: string, variants: Array<[string, Record<string, string>]>): Promise<void> {
  console.log('  Varianten:');
  for (const [label, headers] of variants) {
    const t0 = Date.now();
    try {
      const res = await robustFetch(url, { headers, timeoutMs: 20000, proxyUrl });
      const body = await res.text();
      console.log(`   ${res.ok ? '✔' : '✖'} ${label.padEnd(28)} HTTP ${res.status} · ${Date.now() - t0} ms · ${body.slice(0, 80).replace(/\s+/g, ' ')}`);
    } catch (e) {
      console.log(`   ✖ ${label.padEnd(28)} ${e instanceof Error ? e.message.slice(0, 100) : String(e)}`);
    }
  }
  const t0 = Date.now();
  try {
    const res = await curlFetch(url, { headers: variants[0]?.[1], timeoutMs: 20000, proxyUrl });
    const body = await res.text();
    console.log(`   ${res.ok ? '✔' : '✖'} ${'curl (HTTP_CLIENT=curl)'.padEnd(28)} HTTP ${res.status} · ${Date.now() - t0} ms · ${body.slice(0, 80).replace(/\s+/g, ' ')}`);
  } catch (e) {
    console.log(`   ✖ ${'curl (HTTP_CLIENT=curl)'.padEnd(28)} ${e instanceof Error ? e.message.slice(0, 100) : String(e)}`);
  }
}

async function probeOlx() {
  const p = new OlxProvider();
  for (const site of config.olx.sites) {
    console.log(`\n=== OLX ${site.country.toUpperCase()} · ${site.host} · Kategorie ${site.categoryId ?? '— (OLX_SITES setzen)'} · ${site.enabled ? 'an' : 'aus'}`);
    if (site.categoryId == null) continue;
    const url = p.offersUrl(site, 0).replace(/limit=\d+/, 'limit=5');
    console.log(url);
    try {
      const json = await getJson<{ data?: unknown[]; metadata?: unknown }>(url, { ...p.http(site), retries: 0 });
      console.log('metadata:', short(json.metadata, 400));
      console.log('Rohantwort data[0]:', short(json.data?.[0], 3000));
      for (const o of (json.data ?? []).slice(0, 5)) {
        const l = mapOlxOffer(o as never, site, fetchedAt);
        console.log(l ? `  ✔ ${l.year} ${l.make} ${l.model} · ${l.km} km · ${l.price} ${l.currency} · ${l.location} · ${l.photos.length} Fotos` : '  ✖ nicht abbildbar (Preis/Baujahr/Titel fehlt?)');
      }
    } catch (e) {
      console.log('  ✖', e instanceof Error ? e.message.slice(0, 200) : String(e));
      const plain = p.offersUrl(site, 0, false).replace(/limit=\d+/, 'limit=5');
      await tryVariants(plain, [
        ['browser-Header', olxHeaders(site, 'browser')],
        ['nur Accept: json', olxHeaders(site, 'minimal')],
        ['json + User-Agent', olxHeaders(site, 'json')],
        ['ohne Header', {}],
      ]);
      console.log('  Im Browser testen (liefert die Seite dort JSON?):', plain);
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
    console.log('Rohantwort ads[0]:', short(ads[0], 3500));
    for (const ad of ads.slice(0, 5)) {
      const l = mapSubito(ad as never, fetchedAt);
      console.log(l ? `  ✔ ${l.year} ${l.make} ${l.model} · ${l.km} km · ${l.price} ${l.currency} · ${l.location} · ${l.photos.length} Fotos` : '  ✖ nicht abbildbar');
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
