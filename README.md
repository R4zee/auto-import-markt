# auto import markt

Vergleichsseite für Kfz-Importmärkte (Japan, Südkorea, USA, Golfstaaten, Süd-/Osteuropa) mit
Endpreis-Kalkulation frei Deutschland/Österreich/Niederlande/Polen – Zoll, Einfuhrumsatzsteuer,
TÜV § 21, Zulassung und Partnergebühr inklusive. UI nach dem Claude-Design „Auto Import Markt“
(Designsystem **Nocturne**).

```
auto_import_markt/
├─ backend/    Fastify 5 + TypeScript, libsql (lokal SQLite-Datei, produktiv Turso)
├─ api/        Vercel Serverless Function (leitet /api/* an die Fastify-App)
├─ frontend/   Vite + React 19 + TypeScript, Nocturne-Tokens, Phosphor Icons
├─ design/     Original-Export aus Claude Design (Auto Import Markt.dc.html, _ds/…)
└─ docs/       datenquellen.md, anbindung.md, deployment.md (GitHub → Vercel → Turso, Schritt für Schritt)
```

## Schnellstart

Voraussetzung: Node.js ≥ 22.18 (lokal ist 24 installiert unter `C:\Program Files\nodejs`).
npm-Workspaces, einmal am Repo-Root installieren:

```bash
npm install && cp backend/.env.example backend/.env
```

```bash
npm run dev:backend
```

```bash
npm run dev:frontend
```

Frontend: <http://localhost:5173> (proxyt `/api` auf `http://localhost:4000`).
Händlermodus (Vergleichs-Checkbox, Marge, CSV, Sammelanfrage): `http://localhost:5173/?dealer=1`.

Alternativ über die Claude-Code-Vorschau: `.claude/launch.json` enthält die Konfigurationen
`backend` und `frontend`.

## Backend

| Route | Zweck |
|---|---|
| `GET /api/health` | Status + Listings je Quelle |
| `GET /api/config` | Märkte, Zielländer, Steuersätze, Wechselkurse (EZB via frankfurter.dev, 6 h Cache) |
| `GET /api/listings?…` | Suche/Filter/Sortierung, jede Position mit `landed`-Kalkulation für `dest` |
| `GET /api/listings/:id?dest=` | Detail inkl. Partner und Kfz-Steuer (nur DE) |
| `GET /api/listings/batch?ids=` | Merkliste/Vergleich |
| `POST /api/calc/landed-cost` | Freie Kalkulation (Markt, Preis, Währung, Oldtimer, Präferenzursprung, Fahrzeugdaten) |
| `POST /api/enquiries`, `POST /api/enquiries/bulk` | Anfrage an den Partner-Importeur / Sammelanfrage je Partner |
| `GET /api/listings/:id/reference` | Referenzpreise im Zielmarkt – Provider-Registry in `services/reference.ts`, derzeit ohne Quelle → 204 |
| `GET /api/cron/sync` | Vercel-Cron (Header `Authorization: Bearer CRON_SECRET`) |
| `GET /api/partners` | Partner-Importeure |
| `POST /api/admin/sync`, `POST /api/admin/cleanup`, `GET /api/admin/status`, `GET /api/admin/enquiries` | Admin (Header `x-admin-key`); `cleanup` deaktiviert Bestände entfernter Anbieter |

Filter-Parameter: `q, offer, markets, make, model, location, yearFrom, yearTo, maxKm, fuels,
transmissions, cocOnly, maxLanded, dest, sort (landed-asc|landed-desc|year-desc|km-asc|ending)`.

### Provider-Adapter (`backend/src/providers`)

| Adapter | Markt | Aktivierung |
|---|---|---|
| `mock` | alle | `ENABLE_MOCK_PROVIDER=true` – die 14 Fahrzeuge aus dem Design |
| `marketcheck` | USA (Händler, Festpreis) | `MARKETCHECK_API_KEY` |
| `ebay` | USA (eBay Motors, Auktion + Festpreis) | `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET` |
| `apibara` | USA (Copart/IAAI-Auktionen) | `APIBARA_API_KEY` (Test-Plan kostenlos, 100 Req/Monat) |
| `encar` | **Südkorea (Hauptquelle)** – Encar direkt, Vollabgleich (~150.000 Inserate) | `ENCAR_ENABLED=true` + `ENCAR_PROXY_URL` (Residential-Proxy); läuft per GitHub Actions alle 6 h, Teilabfragen < 10.000, Übersetzungs-Cache `encar_grades` |
| `xapikorea` | Südkorea (Fallback, Encar-Wrapper mit englischen Feldern) | `XAPIKOREA_API_KEY` (Free 500 Req/Monat) |
| `autoapi` | VAE (Dubizzle, Dubicars) | `AUTOAPI_ACCESS_NAME`, `AUTOAPI_API_KEY` (Zugang via access@auto-api.com) |
| `jpfeed` | Japan / beliebig (Partner-Feed JSON) | `JP_FEED_URL`, `JP_FEED_MAPPING` (Feldzuordnung, siehe `feed.ts`) |

Marktplatzweit werden nur Linkslenker übernommen. Große Bestände synchronisiert der GitHub-Actions-Job
`.github/workflows/sync.yml` direkt in Turso (Vercel liest nur). Lokal: `npm run sync` (Datei-DB) bzw. `npm run sync:turso`.
Suche/Filter/Sortierung laufen in SQL mit vorberechneten Endpreisen je Zielland (`landed_de/at/nl/pl`).

### Rechenmodell (`backend/src/domain`)

- `landedCost.ts`: FOB → Seefracht + 1,1 % Versicherung → CIF → Zoll (10 % / 22 % LCV / 0 % Oldtimer,
  Präferenzursprung, EU-Ware) → EUSt je Zielland (7 % Oldtimer) → Zollabwicklung 240 € → TÜV § 21
  780 € bzw. HU/AU 145 € → Zulassung 98 € → Partnergebühr 950 €/450 €.
- `vehicleTax.ts`: Kfz-Steuer nach § 9 KraftStG (Hubraum + CO2-Staffel, Altregelungen, Elektro-Befreiung).
- `markets.ts`: Frachtpauschalen, Zollsätze, Präferenzregeln (EPA Japan, FTA Korea, EU-US 07/2026), Zielländer.

Tests: `npm test` (36 Tests: Kalkulation, Kfz-Steuer, API, Provider-Mappings).

Manueller Sync eines Providers: `curl -X POST -H "x-admin-key: …" "http://localhost:4000/api/admin/sync?provider=encar"`.

## Frontend

Ein-Seiten-App mit Hash-Routing (`#/`, `#/listing/<id>`, `#/watchlist`, `#/compare`).
Sprache (EN/DE), Zielland, Anzeigewährung, Merkliste und Vergleich liegen im `localStorage`.
Alle Farben, Abstände und Radien kommen aus `src/styles/nocturne.css` (Designsystem-Export).

## Deployment

GitHub → Vercel (Function + statisches Frontend, Cron 04:00 UTC) → Turso: Schritt-für-Schritt in
[docs/deployment.md](docs/deployment.md). Umgebungsvariablen: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`,
`ENCAR_ENABLED`, `ADMIN_KEY`, `CRON_SECRET`.

## Datenquellen

Siehe [docs/datenquellen.md](docs/datenquellen.md) – u. a.: jap-carz.com spiegelt die Lots des
polnischen Importeurs aukcje.empe-cars.pl (USS-Member-Daten ohne Lizenz) und ist als Quelle nicht
geeignet; legale Wege sind Partner-Importeure mit Feed, JPcenter-API (ab 188 USD), MarketCheck /
eBay Motors für die USA, Bilinfo-Feed (DK) und mobile.de-API-Account für Europa.
