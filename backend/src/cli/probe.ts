import { config } from '../config.js';
import { allProviders } from '../providers/index.js';
import { getJson } from '../providers/http.js';
import { OlxProvider } from '../providers/olx.js';
import { SautoProvider } from '../providers/sauto.js';
import { SubitoProvider } from '../providers/subito.js';

/**
 * Probe für die Frontend-Endpunkte (OLX, Subito, Sauto): holt eine kleine Seite direkt, zeigt die Rohantwort
 * (gekürzt) und die abgebildeten Inserate, ohne in die Datenbank zu schreiben. Damit lässt sich vom eigenen
 * Rechner in einer Minute prüfen, ob Endpunkt, Kategorie-IDs und Feldnamen stimmen.
 *
 *   npm run probe -- olx        (alle konfigurierten OLX-Seiten, je 5 Inserate)
 *   npm run probe -- subito
 *   npm run probe -- sauto
 *   npm run probe -- <provider> (jeder andere Provider: fetchAll mit Ausgabe der ersten 3 Inserate)
 */
const name = process.argv[2] ?? '';
const short = (v: unknown, n = 1800) => JSON.stringify(v, null, 1).slice(0, n);

async function probeOlx() {
  const p = new OlxProvider();
  for (const site of config.olx.sites) {
    console.log(`\n=== OLX ${site.country.toUpperCase()} · ${site.host} · Kategorie ${site.categoryId ?? '— (OLX_SITES setzen)'} · ${site.enabled ? 'an' : 'aus'}`);
    if (site.categoryId == null) continue;
    const url = p.offersUrl(site, 0).replace(/limit=\d+/, 'limit=5');
    console.log(url);
    try {
      const json = await getJson<{ data?: unknown[]; metadata?: unknown }>(url, { headers: { Accept: 'application/json', 'User-Agent': config.europe.userAgent }, proxyUrl: config.europe.proxyUrl || undefined });
      console.log('metadata:', short(json.metadata, 400));
      console.log('Rohantwort data[0]:', short(json.data?.[0]));
      const { mapOlxOffer } = await import('../providers/olx.js');
      const fetchedAt = new Date().toISOString();
      for (const o of (json.data ?? []).slice(0, 5)) {
        const l = mapOlxOffer(o as never, site, fetchedAt);
        console.log(l ? `  ✔ ${l.year} ${l.make} ${l.model} · ${l.km} km · ${l.price} ${l.currency} · ${l.location} · ${l.photos.length} Fotos` : '  ✖ nicht abbildbar (Preis/Baujahr/Titel fehlt?)');
      }
    } catch (e) {
      console.log('  ✖', e instanceof Error ? e.message : String(e));
    }
  }
}

async function probeSubito() {
  const p = new SubitoProvider();
  const url = p.searchUrl(0).replace(/lim=\d+/, 'lim=5');
  console.log(`\n=== Subito.it\n${url}`);
  const json = await getJson<{ ads?: unknown[]; count_all?: number }>(url, { headers: { Accept: 'application/json', 'User-Agent': config.europe.userAgent }, proxyUrl: config.europe.proxyUrl || undefined });
  console.log('count_all:', json.count_all);
  console.log('Rohantwort ads[0]:', short(json.ads?.[0], 3000));
  const { mapSubito } = await import('../providers/subito.js');
  const fetchedAt = new Date().toISOString();
  for (const ad of (json.ads ?? []).slice(0, 5)) {
    const l = mapSubito(ad as never, fetchedAt);
    console.log(l ? `  ✔ ${l.year} ${l.make} ${l.model} · ${l.km} km · ${l.price} ${l.currency} · ${l.location} · ${l.photos.length} Fotos` : '  ✖ nicht abbildbar');
  }
}

async function probeSauto() {
  const p = new SautoProvider();
  const url = p.searchUrl(0, config.sauto.minPriceCzk, null).replace(/limit=\d+/, 'limit=5');
  console.log(`\n=== Sauto.cz\n${url}`);
  const json = await getJson<{ results?: unknown[]; pagination?: unknown }>(url, { headers: { Accept: 'application/json', 'User-Agent': config.europe.userAgent }, proxyUrl: config.europe.proxyUrl || undefined });
  console.log('pagination:', short(json.pagination, 300));
  console.log('Rohantwort results[0]:', short(json.results?.[0], 3000));
  const { mapSauto } = await import('../providers/sauto.js');
  const fetchedAt = new Date().toISOString();
  for (const it of (json.results ?? []).slice(0, 5)) {
    const l = mapSauto(it as never, fetchedAt);
    console.log(l ? `  ✔ ${l.year} ${l.make} ${l.model} · ${l.km} km · ${l.price} ${l.currency} · ${l.location} · ${l.photos.length} Fotos · ${l.url}` : '  ✖ nicht abbildbar');
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
