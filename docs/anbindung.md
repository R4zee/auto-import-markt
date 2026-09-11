# Anbindungsstand USA · Dubai · Südkorea und Aucnet-Prüfung

Stand: 11.09.2026. Ergänzt [datenquellen.md](datenquellen.md). **[B]** = bestätigt (Doku/Live-Abruf),
**[G]** = gefolgert.

## 1. Umgesetzte Adapter (`backend/src/providers`)

| Markt | Adapter | Quelle / Vertrag | Status |
|---|---|---|---|
| **Südkorea** | `encar` | Encar-Frontend-Endpunkte, keyless: Liste `GET https://api.encar.com/search/car/list/premium?count=true&q=…&sr=…`, Detail `GET https://api.encar.com/v1/readside/vehicle/{id}?include=CATEGORY,SPEC,ADVERTISEMENT`. Filtersprache `(And.Hidden.N._.SellType.일반._.CarType.Y._.Manufacturer.현대._.Price.range(1000..).)`, Sortierung `\|ModifiedDate\|offset\|limit`. Preise in 만원 (× 10.000 KRW), Fotos `https://ci.encar.com` + Pfad, Listing-URL `https://fem.encar.com/cars/detail/{Id}` **[B]** | **Live getestet**: 45 Fahrzeuge mit Fotos, englischen Modellnamen und Hubraum importiert. Undokumentierter Endpunkt → Grauzone; darum per `ENCAR_ENABLED` schaltbar, 250 ms Drosselung, nur `SellType.일반` (keine Leasingangebote), Hersteller konfigurierbar |
| Südkorea, Alternative | `carapis` (`encar:KR`) | `GET https://api.carapis.com/v2/listings?source=encar&page=&limit=`, Header `Authorization: Bearer <key>`, Antwort `{count, page, limit, results[]}`; Preise bereits in KRW **[B]** | Adapter fertig, Key nötig (14 Tage Test, 99–299 USD/Mo) |
| Südkorea, Alternative | – | xapikorea.com: `X-API-Key`, `GET https://api.xapikorea.com/v1/search`, englische Felder inkl. `price_eur`, Free 500 Req/Mo, Starter 20 €/Mo **[B]** | nicht implementiert; Fallback, falls Encar den Direktzugriff sperrt |
| **VAE / Dubai** | `autoapi` | auto-api.com: `https://{access_name}.auto-api.com/api/v2/dubizzle/offers?page=N&api_key=…` (auch `/dubicars`), Änderungs-Feed `/changes?change_id=`; Felder `mark, model, configuration, complectation, year, price (AED), km_age, engine_type, transmission_type, address, images[], extra{}` **[B]** | Adapter fertig. **Zugang beantragen**: access@auto-api.com bzw. Telegram @autodatabase; Preise nur auf Anfrage |
| VAE, Alternative | `carapis` (`dubizzle-motors:GCC`, `yallamotor:GCC`) | wie oben; **kein Dubicars-Slug** bei Carapis **[B]** | Adapter fertig, Key nötig |
| VAE, Alternative | – | Apify-Actors `powerbox/dubizzle-motors-used-cars-listing-scraper` (ab 3,99 USD/1.000), `real_spidery/dubicars-scraper`, `stealth_mode/yallamotor-cars-search-scraper` **[B]** | nicht implementiert |
| **USA – Auktionen** | `apibara` | `GET https://apibara.tech/api/v1/vehicle-auction/vehicles?platform=copart\|iaai&per_page=20&lot_sub_status=Open`, Header `X-API-Key`, Cursor-Paginierung über `meta.next_cursor`; Antwort `{ok, data[], meta}` **[B]** | Adapter fertig, liest flaches und verschachteltes Schema. **Test-Key anlegen** (0 USD, 100 Req/Mo; Basic 25 USD/Mo für 30.000 Req) |
| **USA – Händler** | `marketcheck` | MarketCheck v2, Self-Service-Key, Free 500 Calls/Mo | Adapter fertig, Key nötig |
| **USA – eBay Motors** | `ebay` | Browse API, Kategorie 6001, OAuth Client-Credentials | Adapter fertig, Keys nötig |
| Japan | `jpfeed`, `carapis` (`uss-auction:JP`) | Partner-Feed bzw. Carapis | siehe Abschnitt 2 |

Dubizzle, Dubicars und YallaMotor selbst bieten **kein** öffentliches oder Frontend-JSON-API
(serverseitig gerendert, keine Such-Keys im Markup) **[B]**. Dubai läuft daher nur über einen der
drei Zwischenhändler.

### Konfiguration

```
# Südkorea (sofort, keyless)
ENCAR_ENABLED=true
ENCAR_MANUFACTURERS=현대,기아,제네시스
ENCAR_LIMIT_PER_MAKER=40

# USA
APIBARA_API_KEY=…            # https://apibara.tech
MARKETCHECK_API_KEY=…        # https://www.marketcheck.com/apis
EBAY_CLIENT_ID=… / EBAY_CLIENT_SECRET=…

# Dubai
AUTOAPI_ACCESS_NAME=… / AUTOAPI_API_KEY=…   # nach Freischaltung durch auto-api.com
# oder
CARAPIS_API_KEY=… / CARAPIS_SOURCES=dubizzle-motors:GCC,yallamotor:GCC
```

Manueller Sync je Quelle: `POST /api/admin/sync?provider=encar` mit Header `x-admin-key`.

## 2. Aucnet (Japan) – Prüfergebnis

**Kurzfassung:** Aucnet ist als Direktquelle für ein deutsches Portal nicht erreichbar. Die
Mitgliedschaft setzt eine japanische Gesellschaft mit Gebrauchtwarenhändler-Lizenz voraus, und die
Weitergabe von Auktionsdaten ist Mitgliedern seit August 2026 ausdrücklich untersagt. Ein
Gesprächsansatz besteht beim Festpreis-Bestand („Shared Inventory“) mit AIS-Prüfberichten.

### Mitgliedschaft und Exporteur-Programm **[B]**

- Plattform seit 01.10.2025: **AUCNET CARS** (aucnetcars.com), Zugang zu 113 Partnerauktionen
  (~5 Mio. Fahrzeuge/Jahr), eigene TV-Auktion (Sa–Mo) und Festpreis-Bestand „Shared Inventory“
  (60.000–70.000 Fahrzeuge, über 30 % AIS-geprüft). Auktionsgeschäft über die Tochter **i-Auc Inc.**
  (~19.000 Mitgliedsfirmen).
- Aucnet-Vollmitglied: Firma oder Niederlassung **in Japan** + **古物商-Lizenz** (Secondhand Dealer),
  **¥44.500/Monat** zzgl. MwSt., erster Monat frei. i-Auc: ¥6.800/Monat, Erfolgsgebühr ab ¥20.000 je
  Fahrzeug, Gebotsgebühr ¥300, Formular: „Japanese domestic company only“.
- Das **„Exporter Program“** (info.aucnet.co.jp/am-exp-en.html) ist keine Auslandsmitgliedschaft,
  sondern das normale Mitgliedspaket mit Exporteur-Extras (Zahlungsziel bis 9 Wochen, Autobid,
  Sammelabrechnung). Übersee-Händler kaufen laut Aucnet „through a Japan-based partner“.
- Die Auslandsgesellschaften (Aucnet Europe ApS Kopenhagen, AUCNET UK, USA, HK) betreiben nur
  Luxusgüter-Auktionen, keinen Kfz-Zugang.

### Daten, API, Lizenzierung **[B]**

- **Kein öffentliches API-, Developer- oder Datenlizenzprogramm.** Vorhandene Integrationen sind
  eingehend (Händler-DMS → Shared Inventory) oder Verteilung von Händler-Retail-Bestand an japanische
  Portale (kakaku.com, MOTA, Carsensor) – keine Auktionsdaten.
- **Redistributionsverbot:** i-Auc-Mitteilung vom 10.08.2026 („Prohibition on Unauthorized
  Reproduction of Auction Screens and Auction Information“, iauc.co.jp/static_contents/pdf/260810info.pdf):
  Auktionsbildschirme, Auktionsblätter, Fahrzeugbilder, Zuschlagspreise und Gebotsstände sind
  vertrauliche Informationen; Weitergabe an Dritte ist untersagt, Sanktionen bis Ausschluss und
  Schadensersatz. Für Aucnet-Vollmitglieder analog anzunehmen **[G]**.
- Aggregierte Marktdaten: Das **Aucnet 循環型経済ラボ** veröffentlicht einen monatlichen
  Gebrauchtwagen-Preisindex (>400.000 Transaktionen/Jahr) und lädt zu Forschungskooperationen ein –
  realistischer Einstieg für Marktvergleiche, nicht für Einzel-Listings.
- **Präzedenzfall AUCNET GLOBAL (2011):** Aucnet bot Exporteuren für ¥15.000/Monat eine einbettbare
  „Satellite“-Suche des Shared Inventory (~40.000 Fahrzeuge inkl. AIS-Daten) für deren eigene
  Websites an; Anfragen liefen zum Exporteur. aucnetglobal.com ist heute offline **[G]: eingestellt**.
  Das ist der beste Anknüpfungspunkt für eine Anfrage.

### AIS-Prüfberichte **[B]**

AIS (100 %-Tochter, 1,58 Mio. Prüfungen 2025, 10-stufige Skala S/6/5/4.5/…/R) werden auf Drittseiten
angezeigt (Yanase, Carsensor, MOTA) – aber nur für **Retail-Fahrzeuge**, deren Händler die Prüfung
beauftragt hat, mit Pflichtattribution „System: Aucnet Inc. / Prüforganisation: AIS Inc.“.
Auktions-Prüfbögen fallen unter das Vertraulichkeitsregime.

### Europäische Portale auf Aucnet-Basis **[B/G]**

auc.japan-auktion.de (Far East Imports, AJES/avto.jp-Engine, „AUCNET“ als Auktionshaus im Filter),
aukcje.sakuramotors.pl, Provide Cars „AUCNET STOCK“. Datenweg **[G]**: japanischer Exporteur mit
Aucnet/i-Auc-Konto → Aggregator (AJES/avto.jp) → White-Label-Portal. Keine Aucnet-Aussage erlaubt
diese Weitergabe; die Mitteilung 2026 zeigt eher aktives Vorgehen dagegen.

### Empfehlung

1. **Nicht** auf AJES/avto.jp-Weitergabe aufbauen (Vertragsbruch des Partners, Abschaltrisiko wie
   bei USS 2020).
2. **Offiziell anfragen** (Automobil-Geschäft, 商品統括室 +81 3-6440-2235, Formular
   „オートモビル事業“ auf aucnet.co.jp/contactsindex, Kopie an request@ns.aucnet.co.jp):
   Nachfolger der „Satellite“-Funktion für den Festpreis-Bestand inkl. AIS-Bewertung auf einer
   deutschen Website, Anfragen an einen Mitglieds-Exporteur geroutet; Nutzungsrechte am
   AIS-Bewertungsblatt; Index-Lizenz beim 循環型経済ラボ für Marktvergleiche.
3. **Parallel** einen japanischen Aucnet-Mitglieds-Exporteur als Partner-Importeur sichern (z. B.
   Provide Cars, Beyond Cars Japan, Japan Motor) – für die Kaufabwicklung ohnehin nötig; er kann die
   Datenfreigabe mitbeantragen. Sein Bestand läuft dann über den `jpfeed`-Adapter.
4. Zuschlagspreise und Auktionsblätter werden voraussichtlich verweigert; Festpreis-Bestand mit
   AIS-Report ist der wahrscheinlichste lizenzierbare Datensatz **[G]**.

Quellen: info.aucnet.co.jp/am-exp-en.html · aucnetcars.com/en · aucnet.co.jp/news/2025/20251001-1 ·
iauc.co.jp/en · iauc.co.jp/static_contents/pdf/260810info.pdf · dreamnews.jp/press/0000031095 ·
aucnet.co.jp/company/profile/group · aucnet.co.jp/contactsindex · ais-inc.jp · yanase.jp/parts/about_ais.php ·
aucnet.co.jp/aucnet-reseach · auc.japan-auktion.de · providecars.co.jp/blog/aucnet-used-car-stock-from-japan ·
prestigemotorsport.com.au/uss-auctions-stop-auction-images · carapis.com/api/listings · apibara.tech/en/products/vehicle-auction-data-api/docs ·
auto-api.com/documentation · xapikorea.com
