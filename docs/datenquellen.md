# Datenquellen für die Importmarkt-Vergleichsseite

Stand: 11.09.2026. Recherche zu Anbindungsmöglichkeiten je Herkunftsmarkt sowie zur Frage,
woher **jap-carz.com** seine USS-Auktionsdaten bezieht. Kennzeichnung: **[B]** = bestätigt
(direkt aus Seite/Doku/HTTP gelesen), **[G]** = gefolgert.

Bewertung: **A** = sofort nutzbar mit Self-Service-Key · **B** = Partner-/Händlerantrag nötig ·
**C** = Scraping/Drittanbieter-Scraper (rechtliche Grauzone) · **D** = nicht machbar.

---

## 1. jap-carz.com und USS-Daten

### Befund zu jap-carz.com

- Junges Projekt (Domain registriert 23.02.2026, Hostinger), **kein Impressum, keine AGB, keine
  Datenschutzerklärung**, FAQ „Coming Soon“, kein robots.txt. Stack: nginx, Flask-artiges Backend,
  Alpine.js + Tailwind. **[B]**
- **Offene JSON-API ohne Token** **[B]**:
  - `GET https://jap-carz.com/api/listings?page=1&per_page=N` (Filter make/model/year/mileage/
    location/transmission/steering/lot_number/sort) → `data[]`, `meta{total,last_page}`; aktuell
    nur ~269 Fahrzeuge.
  - `GET /api/filters`, `GET /api/rates`, `/api/image?…` (Bildproxy), `/api/auction-updates/{hash}/{lot}`.
  - Listing-URL: `/listing/{hash8}/{lot}/{slug}`.
  - Felder: `lot`, `site` (Auktionsort – überwiegend USS-Standorte: Kyushu, Tokyo, Yokohama, Nagoya…),
    `auction_date`, `parsed_starting_bid`, `parsed_mileage`, `parsed_displacement`, `steering_wheel`,
    `grade_label`, `equipment`, `images[]`, `images_hd[]`, `expertise` (= Auktionsblatt als WebP),
    `detail_url`.
- **Datenquelle**: Jeder Datensatz trägt eine `detail_url` auf **`https://aukcje.empe-cars.pl/listing/…`**
  (polnischer Japan-Importeur EMPE-CARS, Laravel-Portal). Lots sind dort identisch; jap-carz hält eine
  Teilmenge (269 von 368) und spiegelt Bilder/Auktionsblätter lokal. **[B]** → jap-carz.com **scrapt bzw.
  spiegelt Empe-Cars**, das seinerseits die Daten über einen USS-Mitgliedszugang bezieht. **[G]**
- CSP erlaubt `connect-src japan-auction.tokyo`; im CSS steht „Far East Imports inspired dark brand
  system“ (Far East Imports GmbH, Waldbüttelbrunn, betreibt auc.japan-auktion.de). Ein Zusammenhang
  ist naheliegend, aber nicht belegt. **[G]**
- **Kein Affiliate-, Händler- oder Partnerprogramm, kein Export, keine Nutzungsbedingungen.** Es gibt
  Login/Registrierung und „Request Inspection“ mit Kaution – also ein Vermittlermodell im Aufbau. **[B]**

**Fazit:** Die Listings von jap-carz.com sind technisch trivial abgreifbar, aber ohne Lizenz auf zwei
Stufen (jap-carz ← Empe-Cars ← USS-Member). Für ein seriöses Produkt **nicht als Quelle geeignet**.

### Wie Exporteure legal an USS-Daten kommen

- **USS-Mitgliedschaft** nur für in Japan registrierte Firmen mit Gebrauchtwarenhändler-Lizenz
  (kobutsusho). Zugang über CIS/USS-Terminals; alternativ Aggregatoren **i-AUC (Aucnet)** oder
  **ASNET** – ebenfalls nur mit japanischer Firma + Lizenz (Aucnet: ¥44.500/Monat). **[B]**
- **USS NINJA** ist der offizielle Export-Support von USS: Übersee-Käufer erhalten über einen
  lizenzierten Member Zugriff auf Suche, Auktionsblätter und Fotos – **ohne Preise/Ergebnisse, ohne
  API, nicht zur Weiterverbreitung**. **[B]**
- Ein AJES-Portal meldet: „Pictures are no longer available from a major auction house chain which is
  cutting public access through all data providers“ → USS schränkt den Zugriff für Datenanbieter
  aktuell aktiv ein. **[B]**, Zuordnung zu USS **[G]**.

### Kaufbare Japan-Auktionsdaten (B2B)

| Anbieter | Leistung | Konditionen | Kontakt | Status |
|---|---|---|---|---|
| **JPcenter** (jpcenter.co / jp.center, AJES-Engine) | „API Access – Direct API access to auction data“, TAA/JU/HAA Kobe/USS, USS-Big-Images im VIP+-Plan | API ab **188 USD** (1–12 Monate); AGB: Weiterverkauf/Redistribution nur mit schriftlicher Erlaubnis | WhatsApp +66 66 128 8288, support@jpcenter.ru | **B** [B] |
| **AJES / avto.jp** | White-Label-Auktionsportale für Händler (Engine hinter jp.center, auc.japan-auktion.de) | Preise auf Anfrage | support@ajes.com | **B** [G] |
| **Aleado** (aleado.com) | Auktionssuche/-Websites für Händler, Statistik | auf Anfrage | sales.aleado@gmail.com | **B** [B] |
| **Carapis** (carapis.com) | REST-API `api.carapis.com/v2/listings` mit Quellen Goo-net, Carsensor, **USS Auction** (auctionGrade, inspectionSheet, lotNumber) | Starter 99 USD/Mo (10k Calls), Professional 299 USD/Mo (100k, Webhooks); kommerzielle Nutzung erlaubt, Herkunft intransparent (Scraping) | carapis.com/contact | **C** [B] |
| **Carcheck.jp** | Auktions-**Historie**/Auktionsblatt-Verifizierung als JSON-API, Resale erlaubt | 6 USD/Report, min. 100 Credits | blog.carcheck.jp | **A** (nur Historie) [B] |
| **Auction Data Search** (auctiondatasearch.jp) | Suchmaschine über Auktionen, Memberships | Kaution, kein API | info@auctiondatasearch.jp | **B** [B] |

**Empfehlung Japan:** Kooperation mit einem USS-Member/Exporteur als *Partner-Importeur* (wie im
Design vorgesehen), der seinen Bestand als Feed liefert – dafür ist der generische
`JsonFeedProvider` im Backend gedacht. Parallel JPcenter-API testen (188 USD) und die
Weitergabe-Erlaubnis schriftlich einholen.

---

## 2. USA

| Quelle | Zugang | Kosten / Auth | Daten | Bewertung |
|---|---|---|---|---|
| **MarketCheck** (marketcheck.com/apis) | Public API, Self-Service-Key | Free 500 Calls/Mo; Basic 299 USD/Mo; Standard 749 USD/Mo | Händlerbestand US/CA/UK, Fotos, VIN, Preise, Historie | **A** [B] – **Adapter implementiert** (`providers/marketcheck.ts`) |
| **Auto.dev** (auto.dev) | Public API | Free 1.000 Calls/Mo; Growth ~299 USD/Mo | US-Händlerbestand | **A** [B] |
| **eBay Motors – Browse API** | Public API, Kategorie 6001 | eBay-Developer-Account, OAuth Client-Credentials | Auktionen + Festpreis, Fotos, Aspekte | **A** [G – Motors-Abdeckung im Sandbox prüfen] – **Adapter implementiert** (`providers/ebay.ts`) |
| **Copart / IAAI** | kein öffentliches API; B2B nur für Versicherer | – | Bergungsauktionen | **C** über **Apibara** (apibara.tech, Free 100 Req/Mo … 195 USD/Mo, Copart+IAAI normalisiert) [B] |
| **Manheim** (developer.manheim.com) | Partner-API (MMR, OVE) | nur Cox-Händlerbeziehung | Großhandel | **B/D** [B] |
| **Cars.com / Autotrader / CarGurus** | keine öffentlichen APIs; CarGurus-ToS verbietet Scraping ausdrücklich | – | – | **B/C/D** [B] |
| **Bring a Trailer / Cars & Bids** | über **Old Cars Data** (oldcarsdata.com/api-access), Self-Service | Starter kostenlos (letzte 20), Paid für Historie | Zuschlagspreise, VIN | **A** [B] |
| **CarsXE** | VIN-Decode (international), Marktwert, Historie | Free 5k Calls/Mo | Spezifikationen | **A** [G] |
| **Carfax / AutoCheck** | nur Partnerprogramme | – | Historie | **D** [B] |

Zoll USA: Seit **1. Juli 2026** (EU-US-Rahmenabkommen) 0 % für Fahrzeuge mit **US-Ursprung** bei
Nachweis; sonst 10 %. **[B/G]** – im Backend als `preferentialDutyRate` je Markt hinterlegt,
Standard bleibt 10 % bis `originProof` gesetzt ist.

---

## 3. Japan (ohne USS), Korea, Golfstaaten

| Quelle | Zugang | Bewertung |
|---|---|---|
| Goo-net Exchange, TCV, SBT Japan | kein API, kein Feed, kein Affiliate mit Daten | **C** [G] |
| BE FORWARD („Supporters“), CAR FROM JAPAN (Referral 100 USD) | nur Affiliate-/Referral-Programme, keine Daten | **B** (Monetarisierung) / **C** (Daten) [B] |
| **Encar (KR)** | kein offizielles API; Drittanbieter encar-api.com, xapikorea.com, Carapis | **C** [B] |
| KCar (KR) | nichts gefunden | **D** |
| **Dubizzle / Dubicars / YallaMotor (UAE)** | keine öffentlichen APIs; Scraper (Apify, auto-api.com), Carapis | **C** [B] |

Zoll Korea: EU-Korea-FTA → 0 % mit Ursprungsnachweis **[G]**. Zoll UAE: kein Abkommen → 10 %.
Zoll Japan: EU-Japan EPA → **0 % seit Feb. 2026** mit Ursprungserklärung; Exporteure können sie für
Gebrauchtwagen oft nicht liefern → Standard 10 % **[G]**.

---

## 4. Europa (Süd-/Osteuropa und Nachbarmärkte)

**Stand 14.09.2026 – Ziel: kostenlose Quellen aus Ost- und Südeuropa.** Keines der Landesportale bietet eine
offizielle Lese-API; die Händler-APIs (OLX-Gruppe, Hasznaltauto, AutoScout24) dienen nur dem Einstellen eigener
Anzeigen. Kostenlos anbindbar sind – wie bei Encar – die **JSON-Endpunkte, die die Websites selbst aufrufen**
(keyless, undokumentiert, Grauzone; von öffentlichen Scraper-Projekten belegt). Umgesetzt und je Seite schaltbar:

| Portal | Land → Markt | Endpunkt (keyless) | Adapter | Stand |
|---|---|---|---|---|
| **OLX** olx.pl / olx.ro / olx.bg / olx.pt | PL, RO, BG → EE; PT → SE | `GET https://www.olx.pl/api/v1/offers/?category_id=84&offset=&limit=40&sort_by=created_at:desc[&filter_float_year:from=2012]` → `data[]` mit `params[]` (olx.pl: `price, model, year, petrol, transmission, enginesize, enginepower, milage, drive, righthanddrive, car_body, condition, country_origin, vin`), `photos[].link` (`;s={width}x{height}`), `location.city`, `category.id` (Marke = Unterkategorie → `/api/v1/offers/metadata/breadcrumbs/`) **[B]** (Live-Probe 14.09.2026: 314.735 Pkw, max. 1.000 je Abfrage) | `providers/olx.ts` | **PL bestätigt** (Kategorie 84). CloudFront-WAF blockt Nodes Standard-TLS-Fingerprint (403 in ~10 ms, unabhängig von Headern, URL, Verbindung); mit Chrome-Cipher-Reihenfolge oder nur TLS 1.3 kommt jede Anfrage durch → Adapter nutzt einen Agent mit Chrome-TLS-Profil (`OLX_TLS_PROFILE`). Serverfilter Preis und Baujahr funktionieren (315k → 195k). RO = 84 und PT = 378 bestätigt (Kategorie-Scan); BG: Oberkategorie 360, Pkw-ID per `OLX_SITES` (`npm run probe -- olx-children bg 360`) |
| **Subito.it** | IT → SE | `GET https://hades.subito.it/v1/search/items?c=2&t=s&lim=100&start=0&sort=datedesc` → `ads[]`, `features[]` als Array `{uri, values[{key,value}]}`: `/price` (key "13400"), `/year`, `/register_date` ("06/2022"), `/mileage_scalar`, `/fuel`, `/gearbox`, `/car` (Paket: Marca/Modello/Versione), `/car_type`, `/power`; `images[].cdn_base_url` (+ `?rule=gallery-desktop-2x-jpeg`), `urls.default`, `geo.town` **[B]** (Live-Probe 14.09.2026: 535.000 Inserate) | `providers/subito.ts` | **bestätigt**, direkt aus Node ohne Proxy erreichbar; unbekannte Filterparameter liefern 0 Treffer → Mindestpreis/-baujahr nach dem Abruf |
| **Sauto.cz** (Seznam) | CZ → EE | `GET https://www.sauto.cz/api/v1/items/search?category_id=838&limit=200&offset=&price_from=&price_to=&manufacturing_date_from=` → `results[]` (`manufacturer_cb.name`, `model_cb.name`, `additional_model_name`, `tachometer`, `manufacturing_date`, `fuel_cb`, `gearbox_cb`, `locality.district`, `images[].url`, `images_total_count`, `premise.name`, `deal_type`) **[B]** (Live-Probe 14.09.2026: 71.040 Pkw ab 150.000 CZK; max. 1.000 je Abfrage → Preisfenster) | `providers/sauto.ts` | **bestätigt**; Trefferliste ohne Hubraum (aus der Ausstattungszeile gelesen) |

Prüfen: `npm run probe -w backend -- olx|subito|sauto` (Rohantwort und Zuordnung, ohne Schreiben). Alle drei Adapter
laufen ohne curl-Umweg (`nodeOnly`), weil OLX curl mit 403 abweist; `HTTP_CLIENT=curl` gilt weiterhin nur für Encar.
Alle drei liefern nur die zuletzt eingestellten Seiten je Lauf (`complete=false`) – verkaufte Fahrzeuge werden
also nicht deaktiviert; dafür später eine Nachprüfung je Inserat (wie bei Encar) ergänzen.

**Geprüft, nicht anbindbar ohne HTML-Scraping oder Bezahldienst** (Stand 14.09.2026):

| Portal | Land | Befund |
|---|---|---|
| Otomoto.pl, Autovit.ro, Standvirtual.pt (OLX-Gruppe, Händlerschwerpunkt) | PL, RO, PT | GraphQL mit *persisted queries* (Hash wechselt mit jedem Deploy) bzw. `__NEXT_DATA__` im HTML; alle öffentlichen Scraper-Projekte brechen regelmäßig („doesn't work since otomoto.pl was updated“). Kandidat für später, falls OLX zu wenig Händlerware liefert |
| AutoScout24 (.it/.es/.pt/.pl …) | IT, ES, PT, PL | Nur Schreib-API; Listen stecken als JSON im HTML (`__NEXT_DATA__`), Nutzungsbedingungen untersagen Auslesen |
| Hasznaltauto.hu, JóAutók | HU | HTML, wechselnde URLs; nur Bezahl-Scraper (Apify, Parse.bot) |
| mobile.bg, cars.bg | BG | HTML |
| car.gr | GR | HTML, Bezahl-Scraper |
| Njuškalo.hr, Index Oglasi | HR | HTML mit Bot-Schutz |
| coches.net, Milanuncios | ES | App-API (`ms-mt--api-web.spain.advgo.net`) nur mit signierten Headern; Bezahl-Scraper |
| Autoplius.lt, Autogidas.lt, Auto24.ee, SS.lv | LT, EE, LV | HTML |
| Carapis (Aggregator, 200+ Portale) | alle | 99–299 USD/Monat, im Test 42 Tage alte Daten und HTTP 429 – nicht kostenlos |

Ergänzend bleiben Partner-Feeds über `PARTNER_FEEDS` (ein Feed je Händler/Importeur, Markt aus dem Land) der
saubere Weg für Händlerbestände aus RO/PL/IT/ES. Die Länderlisten stehen in `backend/src/domain/markets.ts`
(`MARKET_COUNTRIES`). mobile.de wurde als Quelle verworfen: fast ausschließlich deutsche Anbieter.

| Portal | Offizielles API? | Für Aggregatoren nutzbar? | Bewertung |
|---|---|---|---|
| **mobile.de** (services.mobile.de) | Search-API / Ad-Integration, HTTP Basic, max. 2.000 Anzeigen je Abfrage | API-Account nur über Kundensupport (+49 30 81097500); kaum ausländische Angebote → für Süd-/Osteuropa ungeeignet | **B** [B] |
| **AutoScout24** (portal.services.as24.tech) | nur Listing-Creation (Schreibseite) | nein | **B/D** [B] |
| **Bilinfo Listing API (DK, Bilbasen)** (developer.bilinfo.net) | vollständiger Feed (JSON/XML), wird ausdrücklich an Aggregatoren verkauft | **ja**, Preis auf Anfrage | **B** (stark) [B] |
| **Autotrader Connect (UK)** (developers.autotrader.co.uk) | Search API über alle Listings | Partnerfreigabe, > 1.000 £/Mo berichtet | **B** [B/G] |
| Marktplaats (NL), Leboncoin (FR), Blocket (SE), FINN (NO), Otomoto (PL), willhaben (AT) | Händler-APIs nur für eigene Anzeigen | nein | **B/D** [B] |
| La Centrale (FR) | Preisdaten für Profis | nur Pricing | **B** [B] |
| **Carapis** | 200+ Marktplätze inkl. mobile.de, AutoScout24, Otomoto, Bilbasen, Encar, Dubizzle, Goo-net | Self-Service, 99–299 USD/Mo | **C** (Lückenfüller, rechtlich prüfen) [B] |

---

## 5. Bewertung / Bewertungsdaten

| Anbieter | Zugang | Bewertung |
|---|---|---|
| **DAT SilverDAT** (dat.de/schnittstellenpartnerschaft) | formale Schnittstellenpartnerschaft, ausdrücklich offen für „Internetplattformen für den Gebrauchtwagenhandel“, +49 711 4503-130 | **B** [B] – Kandidat für die „Handel {dest}“-Wiederverkaufswerte im Händlermodus |
| Autovista / Eurotax / Schwacke (JD Power) | Vertrieb, keine öffentlichen Preise | **B** [G] |
| Cazoo Data Services (UK/EU) | Enterprise | **B** |
| AUTO1 Remarketing API | nur Partner | **D** |

---

## 6. Import nach Deutschland – Rechenregeln (im Backend umgesetzt)

- **Zoll** HS 8703 Pkw: 10 % auf den Zollwert (CIF). Präferenzsätze (JP/KR/US) 0 % nur mit
  Ursprungsnachweis. Nutzfahrzeug-Aufbau HS 8704: 22 %. Sammlungsstück ≥ 30 Jahre (HS 9705): 0 %
  Zoll, **7 % EUSt**. Es gibt kein Zoll-API; die Sätze sind stabil und in `domain/markets.ts` versioniert.
- **Einfuhrumsatzsteuer** 19 % (DE) auf CIF + Zoll; AT 20 %, NL 21 %, PL 23 %.
- **§ 21 StVZO Vollgutachten**: Drittland-Import 1.000–3.000 € Bandbreite (TÜV SÜD / kostenlupe 2026);
  Pauschale im Modell 780 € inkl. Scheinwerfer, HU/AU bei EU-Ware 145 €.
- **Kfz-Steuer § 9 KraftStG**: kein offizielles API (BMF-Rechner nur als Web-Widget). Formel in
  `domain/vehicleTax.ts`: Hubraum (2,00 €/9,50 € je 100 cm³) + CO2-Staffel ab 95 g (EZ ≥ 2021),
  2 €/g über Freigrenze (EZ 07/2009–2020), Schadstoffklassen davor; Elektro befreit bis 2030.
  Bei Importen ohne WLTP-Wert setzt das Hauptzollamt den CO2-Wert per Abgasgutachten fest →
  Anzeige als Schätzung.

---

## 7. Empfohlener Integrationspfad

1. **Sofort (A):** MarketCheck + eBay Motors (Adapter vorhanden, nur Keys eintragen), Old Cars Data,
   CarsXE für VIN-Anreicherung, Apibara für Copart/IAAI.
2. **Parallel beantragen (B):** Bilinfo Listing API, mobile.de API-Account, Autotrader Connect,
   DAT-Schnittstellenpartnerschaft, JPcenter-API mit schriftlicher Weitergabe-Erlaubnis.
3. **Partner-Feeds (Kern des Geschäftsmodells):** Je Markt ein Partner-Importeur (USS-Member,
   Encar-Händler, Dubai-Exporteur) liefert seinen Bestand als JSON → `JsonFeedProvider`.
4. **Grauzone nur als Übergang (C):** Carapis für Japan/Korea/UAE/EU-Portale, mit rechtlicher Prüfung.
5. **Nicht verfolgen (D):** jap-carz.com-Daten, Carfax/AutoCheck, AUTO1, KCar, Lese-Zugriffe auf
   Leboncoin/Blocket/FINN/Otomoto.

## Quellen (Auswahl)

jap-carz.com · aukcje.empe-cars.pl · far-east-imports.com · jpcenter.co/api · jpcenter.co/terms ·
ajes.com · aleado.com · carapis.com/pricing · blog.carcheck.jp · providecars.co.jp (USS, USS NINJA) ·
info.aucnet.co.jp/am-exp-en.html · marketcheck.com/apis/pricing · auto.dev/pricing ·
developer.ebay.com/api-docs/buy/browse · apibara.tech · oldcarsdata.com/api-access · carsxe.com ·
services.mobile.de/manual/search-api.html · portal.services.as24.tech/api-docs ·
developer.bilinfo.net/bilinfolistingapi · developers.autotrader.co.uk/api · otomoto.pl/api/doc ·
dat.de/schnittstellenpartnerschaft · jdpower.com/business/autovista-api ·
commission.europa.eu/topics/trade/eu-us-trade-deal_en · eu-japan.eu (EPA vehicles) ·
tuvsud.com (§21) · kostenlupe.de (Vollabnahme 2026) · lxgesetze.de/kraftstg/9 ·
bundesfinanzministerium.de (Kfz-Rechner)

---


---

## 8. Anbindungsstand und Aucnet

Umgesetzte Adapter (Encar live, Apibara, auto-api.com, Carapis) und die Aucnet-Pruefung stehen in [anbindung.md](anbindung.md).
