# Deployment: GitHub → Vercel → Turso, Umgebungsvariablen hinterlegen

Stand 11.09.2026. Das Repository ist lokal initialisiert (Branch `main`, erster Commit vorhanden).
Die Architektur auf Vercel:

```
Vercel-Projekt (Root = Repo-Root, Framework "Other")
├─ frontend/dist        statische Vite-App (Build: npm run build)
├─ api/index.ts         eine Serverless Function; /api/* wird per Rewrite hierher geleitet (Fastify-App)
├─ Cron 04:00 UTC       GET /api/cron/sync  → holt Listings aller aktiven Provider
└─ Turso (libsql)       gehostete SQLite-Datenbank; lokal weiter Datei backend/data/aim.sqlite
```

Auf Vercel gibt es kein dauerhaftes Dateisystem und keinen Dauerprozess, daher die gehostete
Datenbank und der Cron statt des Intervall-Syncs. Lokal ändert sich nichts.

---

## Teil A – GitHub-Repository anlegen und Code hochladen

1. Öffne <https://github.com/new> (eingeloggt).
2. **Repository name:** `auto-import-markt`. **Private** auswählen.
3. **Nichts** ankreuzen bei „Add a README“, „.gitignore“, „license“ (das Repo hat schon alles).
4. Klick **Create repository**.
5. GitHub zeigt jetzt die Seite „Quick setup“. Kopiere die HTTPS-URL, sie lautet
   `https://github.com/<dein-user>/auto-import-markt.git`.
6. Öffne im Projektordner ein Terminal (VS Code: Terminal → New Terminal, oder in Claude Code den
   Terminal-Tab) und führe aus (URL anpassen):

```bash
git remote add origin https://github.com/<dein-user>/auto-import-markt.git
```

```bash
git push -u origin main
```

7. Beim ersten Push öffnet sich das Fenster „Git Credential Manager“: **Sign in with your browser**
   → im Browser bei GitHub **Authorize git-ecosystem** klicken. Danach läuft der Push durch.
8. Lade die GitHub-Seite neu: Ordner `api`, `backend`, `frontend`, `docs`, `design` sind sichtbar.

Falls `git` im Terminal fehlt: Git ist installiert (2.55), PowerShell ggf. neu öffnen.

---

## Teil B – Vercel-Projekt anlegen und mit GitHub verbinden

1. Öffne <https://vercel.com/signup> → **Continue with GitHub** → GitHub-Autorisierung bestätigen.
   (Hast du schon einen Vercel-Account: <https://vercel.com/new>.)
2. Auf **Import Git Repository** erscheint deine GitHub-Repo-Liste. Falls leer: Klick
   **Adjust GitHub App Permissions** → im GitHub-Dialog **Only select repositories** →
   `auto-import-markt` wählen → **Install / Save**.
3. Neben `auto-import-markt` **Import** klicken.
4. Auf der Seite **Configure Project**:
   - **Project Name:** `auto-import-markt` (beliebig).
   - **Framework Preset:** wird aus `vercel.json` übernommen („Other“). Falls ein Preset wie
     „Vite“ vorgeschlagen wird: Dropdown öffnen und **Other** wählen.
   - **Root Directory:** leer lassen (`./`) – **nicht** `frontend` wählen.
   - **Build and Output Settings:** nichts ändern (kommen aus `vercel.json`:
     Build `npm run build`, Output `frontend/dist`, Install `npm install`).
   - **Environment Variables:** jetzt noch leer lassen, kommen in Teil C und D.
5. Klick **Deploy**. Der erste Build dauert 1–2 Minuten. Er ist erfolgreich, die Seite zeigt aber
   noch **0 Fahrzeuge**, weil die Datenbank fehlt. Klick **Continue to Dashboard**.
6. Unter **Settings → General → Node.js Version** prüfen, dass **22.x** (oder höher) steht.
7. Unter **Settings → Functions** sollte **Fluid Compute** aktiv sein (Standard). Region wird aus
   `vercel.json` gesetzt (`fra1` = Frankfurt).

---

## Teil C – Datenbank (Turso) über den Vercel Marketplace anbinden

1. Im Vercel-Projekt oben auf den Tab **Storage** klicken.
2. **Create Database** → in der Liste **Turso** wählen (Kategorie „Marketplace Database Providers“;
   falls du es nicht siehst: **Browse Marketplace** → suchen „Turso“ → **Install**).
3. Dialog **Create Database**:
   - **Plan:** Free/Starter (reicht: 9 GB Speicher, 1 Mrd. Zeilen-Reads/Monat).
   - **Database Name:** `auto-import-markt`.
   - **Primary Region:** `fra` (Frankfurt) oder `ams`.
   - Klick **Create** → dann **Connect Project** → Projekt `auto-import-markt` wählen,
     **Environments:** Production, Preview, Development alle angehakt lassen → **Connect**.
4. Vercel legt automatisch die Umgebungsvariablen **`TURSO_DATABASE_URL`** und
   **`TURSO_AUTH_TOKEN`** an. Prüfen: **Settings → Environment Variables** – beide müssen dort
   stehen. Das Backend liest genau diese Namen. Tabellen werden beim ersten Aufruf automatisch angelegt.

Alternative ohne Marketplace: Account auf <https://turso.tech> → **Create Database** → im
Dashboard **Generate Token** → die beiden Werte manuell als `TURSO_DATABASE_URL`
(`libsql://…turso.io`) und `TURSO_AUTH_TOKEN` in Vercel eintragen (siehe Teil D, Schritt 2).

---

## Teil D – Umgebungsvariablen hinterlegen

1. Im Vercel-Projekt: **Settings** (oben) → linke Leiste **Environment Variables**.
2. Für jede Variable: **Key** eintippen, **Value** einfügen, **Environments** = alle drei angehakt
   lassen, dann **Save**. Bei Secrets zusätzlich den Schalter **Sensitive** aktivieren.

| Key | Value | Zweck |
|---|---|---|
| `ENCAR_ENABLED` | `false` | Der Encar-Vollabgleich läuft per GitHub Actions (Teil I), nicht in der Vercel-Function |
| `XAPIKOREA_API_KEY` | optional, Key von <https://xapikorea.com> | Fallback für Korea (Sensitive) |
| `ADMIN_KEY` | ein langes Zufallspasswort | schützt `/api/admin/*` (Sensitive) |
| `CRON_SECRET` | ein weiteres langes Zufallspasswort | Vercel sendet es beim Cron-Aufruf mit (Sensitive) |
| `ENABLE_MOCK_PROVIDER` | `false` | Beispieldaten aus dem Design abschalten (für Demo: `true`) |
| `CORS_ORIGINS` | `https://<projekt>.vercel.app` | eigene Domain später ergänzen (kommagetrennt) |

Zufallspasswörter erzeugen (PowerShell):

```powershell
-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 40 | ForEach-Object {[char]$_})
```

3. **Wichtig:** Variablen gelten erst für den nächsten Deploy. Tab **Deployments** → oberster
   Eintrag → Menü **⋯** → **Redeploy** → **Redeploy** bestätigen.

Der Vercel-Cron liest `CRON_SECRET` automatisch aus den Environment Variables und sendet ihn als
`Authorization: Bearer …`; du musst dafür nichts weiter konfigurieren. Cron-Läufe siehst du unter
**Settings → Cron Jobs** (Hobby-Plan: maximal ein Lauf pro Tag, so ist es in `vercel.json` eingestellt).

---

## Teil E – Erstbefüllung und Kontrolle

Nach dem Redeploy ist die Datenbank leer. Einmal den Sync von Hand anstoßen (PowerShell, Werte
einsetzen; der Encar-Lauf mit drei Herstellern dauert 30–60 Sekunden):

```powershell
$h = @{ "x-admin-key" = "<ADMIN_KEY>" }; Invoke-RestMethod -Method Post -Headers $h -ContentType "application/json" -Body "{}" "https://<projekt>.vercel.app/api/admin/sync"
```

Antwort ist eine Liste mit `provider`, `status`, `upserted`. Danach <https://<projekt>.vercel.app>
neu laden.

Status je Provider und letzte Läufe (inkl. Warnungen, z. B. Drosselung):

```powershell
Invoke-RestMethod -Headers $h "https://<projekt>.vercel.app/api/admin/status" | ConvertTo-Json -Depth 4
```

Bestände entfernter Anbieter (z. B. Carapis) deaktivieren – passiert auch automatisch am Ende jedes Sync-Laufs:

```powershell
Invoke-RestMethod -Method Post -Headers $h -ContentType "application/json" -Body "{}" "https://<projekt>.vercel.app/api/admin/cleanup"
```

Beides geht auch lokal gegen `http://localhost:4000` (dort ist `ADMIN_KEY=dev-admin-key`).

---

## Teil F – Ab jetzt: Änderungen veröffentlichen

Jeder Push auf `main` löst automatisch einen Production-Deploy aus, jeder andere Branch einen
Preview-Deploy mit eigener URL:

```bash
git add -A && git commit -m "Beschreibung" && git push
```

Eigene Domain: **Settings → Domains → Add** → Domain eintragen → die angezeigten DNS-Einträge
(CNAME `cname.vercel-dns.com` bzw. A-Record) beim Registrar setzen → danach `CORS_ORIGINS`
ergänzen und redeployen.

## Fehlersuche

- **Build fehlgeschlagen:** Deployments → Eintrag → **Building** aufklappen. Häufig: Node-Version
  (Settings → General → 22.x) oder fehlende Variable.
- **`/api/health` liefert 500:** Turso-Variablen fehlen → Storage-Tab prüfen, Redeploy.
- **Cron läuft nicht:** Settings → Cron Jobs → Status; `CRON_SECRET` muss gesetzt sein.
- **0 Fahrzeuge trotz Sync:** `/api/admin/status` zeigt `lastRuns` mit Fehlermeldung je Provider.
- Logs live: Tab **Logs** im Projekt (Function-Ausgaben, auch `enquiry stored`).

---

## Teil G – Korea-Sync vom eigenen Rechner (Encar sperrt Cloud-IPs)

Befund 11.09.2026: api.encar.com bricht Verbindungen aus Rechenzentren (Vercel Frankfurt und
Seoul, alle HTTP-Clients) nach dem ersten Kontakt ab. Von einer Wohnsitz-IP funktioniert der Abruf
zuverlässig. Deshalb läuft der Encar-Sync vom eigenen Rechner direkt in die Turso-Datenbank; Vercel
liefert die Daten nur aus.

1. In Vercel `ENCAR_ENABLED` auf `false` setzen (sonst meldet der tägliche Cron einen Fehler). Die
   Encar-Bestände bleiben erhalten, weil nur Quellen ohne bekannten Provider bereinigt werden.
2. Datei `backend/.env.turso` anlegen (Vorlage: `backend/.env.turso.example`) und dort
   `TURSO_DATABASE_URL` und `TURSO_AUTH_TOKEN` aus Vercel → Settings → Environment Variables
   eintragen (Auge-Symbol zeigt den Wert). Die Datei ist per `.gitignore` ausgeschlossen.
3. Sync starten (PowerShell im Projektordner, dauert 30–60 Sekunden):

```powershell
npm run sync:turso
```

Ausgabe: eine Zeile je Provider plus „Bestand je Quelle“. Danach die Seite neu laden.

4. Täglich automatisch (Windows-Aufgabenplanung), einmal ausführen:

```powershell
$act = New-ScheduledTaskAction -Execute "cmd.exe" -Argument '/c cd /d "C:\Users\BenKretschmann\Desktop\auto_import_markt" && "C:\Program Files\nodejs\npm.cmd" run sync:turso >> backend\data\sync.log 2>&1'
$trg = New-ScheduledTaskTrigger -Daily -At 06:30
Register-ScheduledTask -TaskName "auto-import-markt Sync" -Action $act -Trigger $trg -Description "Encar → Turso"
```

Entfernen mit `Unregister-ScheduledTask -TaskName "auto-import-markt Sync" -Confirm:$false`.
Der Rechner muss zur Laufzeit an sein. Alternative ohne eigenen Rechner: xapikorea.com-Key
(`XAPIKOREA_API_KEY`, ab 20 €/Monat für 10.000 Aufrufe) – deren Server rufen Encar ab.

## Teil H – Encar aus der Cloud über Residential-Proxy (Alternative zu Teil G)

Encar filtert ausschließlich nach IP-Typ: Wohnsitz- und Mobil-IPs kommen durch (30/30 Anfragen aus
einem deutschen Vodafone-Anschluss, auch ohne User-Agent), Rechenzentrums-Bereiche werden gedroppt.
Genau so arbeiten alle „Encar-API“-Anbieter, die nichts anderes tun als Anfragen über solche IPs zu
leiten. Mit einem eigenen Residential-Proxy läuft der Sync deshalb auch aus der Vercel-Function:

Empfohlener Anbieter: **DataImpulse** (1 $/GB, Guthaben verfällt nicht, Mindestaufladung ca. 5 $).
Ein Encar-Sync mit 180 Fahrzeugen inkl. Details überträgt rund 5 MB; 30 Läufe pro Monat liegen
damit unter 0,20 $. Korea-Targeting ist nicht nötig, eine deutsche Wohnsitz-IP genügt.

**Schritt 1 – Konto und Guthaben (dataimpulse.com)**
1. <https://dataimpulse.com> → oben rechts **Sign up** → E-Mail + Passwort → Bestätigungsmail anklicken.
2. Im Dashboard links **Residential** (Residential Proxies) → **Buy** / **Top up balance** → Betrag
   (5 $ reicht für Monate) → Zahlung per Karte oder PayPal abschließen.
3. Im Bereich Residential erscheint der **Proxy-Zugang**: `Host gw.dataimpulse.com`, `Port 823` (HTTP),
   `Login` und `Password`. Falls ein Knopf **Create proxy user / Generate credentials** angeboten wird,
   einmal klicken. Beide Werte kopieren.
4. Dort ist auch **IP whitelist** möglich – leer lassen; Vercel hat keine feste Ausgangs-IP, wir
   nutzen Login/Passwort.

**Schritt 2 – Proxy-URL zusammensetzen**
Format: `http://LOGIN__cr.de:PASSWORD@gw.dataimpulse.com:823`
- `__cr.de` (zwei Unterstriche) hängt die Länderwahl Deutschland an den Login; ohne Zusatz kommt eine
  zufällige Wohnsitz-IP weltweit, was ebenfalls funktioniert.
- Enthält das Passwort Sonderzeichen wie `@`, `:`, `/`, `#`, `?`, müssen sie URL-kodiert werden
  (`@` → `%40`, `:` → `%3A`, `/` → `%2F`, `#` → `%23`, `?` → `%3F`).
- Test vom eigenen Rechner (PowerShell), zeigt zuerst die Austritts-IP, dann Encar durch den Proxy:

```powershell
curl.exe -s -x "http://LOGIN__cr.de:PASSWORD@gw.dataimpulse.com:823" https://ipinfo.io/json
```

```powershell
curl.exe -s -x "http://LOGIN__cr.de:PASSWORD@gw.dataimpulse.com:823" "https://api.encar.com/search/car/list/premium?count=true&q=(And.Hidden.N._.CarType.Y.)&sr=%7CModifiedDate%7C0%7C1"
```

Die zweite Antwort muss mit `{"Count":` beginnen.

**Schritt 3 – In Vercel eintragen**
1. Vercel → Projekt `auto-import-markt` → **Settings** → **Environment Variables**.
2. **Add**: Key `ENCAR_PROXY_URL`, Value = die URL aus Schritt 2, alle Environments, Schalter **Sensitive** an → **Save**.
3. `ENCAR_ENABLED` auf `true` stellen (Stift-Symbol → Wert ändern → Save).
4. **Deployments** → oberster Eintrag → **⋯** → **Redeploy** → bestätigen, 1–2 Minuten warten.

**Schritt 4 – Prüfen und Sync**
```powershell
Invoke-RestMethod -Headers $h "https://auto-import-markt.vercel.app/api/admin/diag" | ConvertTo-Json -Depth 5
```
Neu ist der Client `proxy`; er muss für die api.encar.com-URLs `ok: true`, `status: 200` melden.
Dann der Sync (30–60 Sekunden):

```powershell
Invoke-RestMethod -Method Post -Headers $h -ContentType "application/json" -Body "{}" "https://auto-import-markt.vercel.app/api/admin/sync" | ConvertTo-Json -Depth 4
```

Danach übernimmt der tägliche Cron (04:00 UTC). Verbrauch im DataImpulse-Dashboard unter
**Usage/Statistics** kontrollierbar.

Alternative Anbieter mit gleichem Prinzip: Webshare (`p.webshare.io:80`, Login `user-de-rotate`,
ab 3,50 $/GB), Decodo (4 $/GB, 3-Tage-Test).

Bewertung der Wege: (1) eigener Proxy = volle Kontrolle über Aktualität (Sortierung nach
`ModifiedDate`, 404 = verkauft), Kosten unter 1 €/Monat; (2) lokaler PC (Teil G) = 0 €, aber
Rechner muss laufen; (3) xapikorea.com = Live-Durchgriff mit 60 s/5 min Cache, 20 €/Monat, Einzelbetreiber
ohne Impressum und SLA. Offizieller Weg parallel: partnership@encar.com / price@encar.com.

---

## Teil I – Vollständiger Encar-Bestand per GitHub Actions (löst Teil G/H ab)

Stand 11.09.2026 abends. Encar liefert 500 Inserate je Seite, erlaubt aber nur Offsets bis 10.000 je
Abfrage. Der Adapter zerlegt den Bestand deshalb in Teilabfragen (Baujahr, bei Bedarf Preisklasse),
lädt alles (rund 94.000 koreanische + 55.000 importierte Fahrzeuge ab 10 Mio. KRW und Baujahr 2012),
lernt englische Modellnamen und Hubraum je Ausstattungskombination in einen Cache (1.500 neue
Kombinationen je Lauf) und deaktiviert alles, was nicht mehr gelistet ist. Ein Lauf dauert 10–20
Minuten und übersteigt damit Vercels Function-Limit; er läuft deshalb als **GitHub-Actions-Job**
(`.github/workflows/sync.yml`, alle 6 Stunden, kostenlos im Rahmen der 2.000 Minuten/Monat).

**Schritt 1 – Secrets im GitHub-Repository**
1. <https://github.com/R4zee/auto-import-markt> → **Settings** (Tab oben) → linke Leiste
   **Secrets and variables** → **Actions**.
2. **New repository secret**, dreimal:
   - Name `TURSO_DATABASE_URL`, Secret = Wert aus Vercel (Settings → Environment Variables, Auge-Symbol)
   - Name `TURSO_AUTH_TOKEN`, Secret = Wert aus Vercel
   - Name `ENCAR_PROXY_URL`, Secret = `http://LOGIN__cr.de:PASSWORD@gw.dataimpulse.com:823`
   Jeweils **Add secret**.

**Schritt 2 – Ersten Lauf von Hand starten**
1. Tab **Actions** → links **Sync Listings** → rechts **Run workflow** → Feld
   „Max. Inserate je Teilabfrage“ leer lassen (oder für einen 3-Minuten-Test `500` eintragen) → **Run workflow**.
2. Auf den laufenden Job klicken → Schritt **Sync → Turso** aufklappen. Am Ende steht eine Zeile
   `✔ encar upserted=… deactivated=…` mit der Zusammenfassung (Partitionen, geladen, gelernt,
   zurückgestellt) und „Bestand je Quelle“.
3. Der erste volle Lauf schreibt rund 150.000 Zeilen (10–20 Minuten). Folgeläufe schreiben nur
   geänderte Inserate. Inserate, deren Ausstattung noch nicht übersetzt ist, kommen in den nächsten
   Läufen nach (1.500 Kombinationen je Lauf; die häufigsten zuerst, damit der Großteil sofort sichtbar ist).

**Schritt 3 – Vercel entlasten**
- `ENCAR_ENABLED` in Vercel auf `false` (der 300-Sekunden-Cron dort würde den Vollabgleich nie schaffen).
  Der Vercel-Cron bleibt für leichte Provider bestehen.
- Vercel liest nur noch aus Turso; Suche, Filter und Sortierung laufen in SQL mit vorberechneten
  Endpreisen je Zielland (werden bei Kursänderung im Sync neu berechnet).

## Teil J – Abfragezeit und Vercel-Kosten (Stand 14.09.2026)

Befund: Ein Markenfilter (z. B. BMW) brauchte 1–2 Minuten. Ursache waren nicht die Trefferzeilen, sondern
vier Begleitabfragen je Suche (Gesamtzahl, Marktzähler, Marken-, Modell- und Standortlisten), die SQLite ohne
passenden Index als Vollscan über alle 150.000 Zeilen ausführte – für `year >= 1985` wählte der Planer sogar den
Baujahr-Index und las damit jede Zeile einzeln. Auf Turso zählt und kostet jede gelesene Zeile; bei
600.000 Zeilen-Reads je Suche war das Monatskontingent nach wenigen Tagen erschöpft, und die Function lief
minutenlang (Vercel rechnet die aktive Zeit ab).

Maßnahmen (alle in dieser Version, keine Konfiguration nötig):

1. Abdeckender Suchindex + Bereichsfilter mit unärem Plus → jede Suche liest nur Indexeinträge plus 48 Zeilen.
2. Filterlisten und Marktzähler werden je Sync-Lauf vorberechnet (`meta`-Tabelle), nicht je Anfrage.
3. 48 Treffer je Seite statt 200, nur das erste Foto je Treffer; „Mehr laden“ im Frontend.
4. CDN-Cache: Lese-Antworten tragen `Cache-Control: s-maxage=600, stale-while-revalidate=3600`
   (`API_CACHE_SECONDS`, Standard 10 Minuten). Wiederholte Suchen – auch die Startseite jedes Besuchers –
   beantwortet das Vercel-CDN ohne Function-Aufruf. Daten sind damit bis zu 10 Minuten nach einem Sync alt;
   für sofortige Aktualität `API_CACHE_SECONDS=0` setzen (kostet Function-Aufrufe).

Weitere Stellschrauben, falls die Rechnung noch zu hoch ist: `memory` in `vercel.json` von 1024 auf 512 MB
(Function braucht mit SQL-Suche deutlich weniger als vorher), Cron in `vercel.json` entfernen, wenn alle
Provider über GitHub Actions laufen (der Cron ruft dann nur noch Facetten-/Kursaktualisierung auf).

**Neue kostenlose Quellen Süd-/Osteuropa** (OLX PL/RO/BG/PT, Subito.it, Sauto.cz – Frontend-Endpunkte ohne Key):

1. Vom eigenen Rechner prüfen, ob Endpunkt und Zuordnung stimmen (schreibt nichts):
   `npm run probe -w backend -- olx`, dann `subito`, dann `sauto`. Die Ausgabe zeigt die Rohantwort und je
   Inserat eine Zeile `✔ Baujahr Marke Modell · km · Preis`. Steht dort `✖`, Feldnamen in
   `backend/src/providers/<quelle>.ts` an die Rohantwort anpassen.
2. Die Pkw-Kategorien aller vier OLX-Seiten sind vorbelegt (PL 84, RO 84, BG 1117, PT 378, Live-Proben 14.09.2026);
   `OLX_SITES` als Variable nur, um eine Seite abzuschalten, z. B. `[{"country":"pt","enabled":false}]`.
3. Als Variables (GitHub → Settings → Secrets and variables → Actions → Variables): `OLX_ENABLED=true`, `SUBITO_ENABLED=true`, `SAUTO_ENABLED=true`. Optional als Secret
   `EUROPE_PROXY_URL` (Residential-Proxy wie bei Encar), falls eine Seite den GitHub-Runner mit 403 abweist.
4. Testlauf: Actions → Sync Listings → Run workflow → „Nur diese Provider“ = `olx,subito,sauto`. Der Lauf meldet je
   Seite die Anzahl; danach läuft alles im 6-Stunden-Rhythmus mit.

Optional weiterhin `PARTNER_FEEDS` (JSON-Array, Format in `backend/.env.example`) für direkte Händler-Feeds.

**Kosten/Volumen:** rund 300 Listen- und 1.500 Detailabrufe je Lauf. Encar liefert gzip-komprimiert,
Erfahrungswert nach dem ersten Lauf im DataImpulse-Dashboard unter **Usage** prüfen; erwartet werden
1–6 $ pro Monat bei vier Läufen täglich. Frequenz in `sync.yml` unter `cron` anpassen
(`'15 */6 * * *'` = alle 6 h; `'15 */3 * * *'` = alle 3 h).

**Ablauf ändern:** Zeitplan oder Umfang (`ENCAR_MIN_PRICE_MANWON`, `ENCAR_MIN_YEAR`, `ENCAR_CAR_TYPES`)
in `.github/workflows/sync.yml` bzw. als weitere `env:`-Einträge dort setzen, committen, pushen.

## Teil K – Vergleichspreise DE auf den Kacheln (Stand 15.09.2026)

Jede Kachel zeigt „DE ab €X“ (günstigstes vergleichbares Angebot in Deutschland) und den Abstand des Endpreises
inkl. Zoll, Steuer, TÜV und Zulassung in Prozent (grün = günstiger als das deutsche Angebot). Vergleichbar heißt:
gleiche Marke, Modell bzw. Variantenkennung (z. B. „320d“, „E 220 d“), gleicher Kraftstoff, Baujahrband der
Baureihe (nennt das Inserat einen Code wie W221, E93 oder F30, gilt deren Bauzeitraum aus
`backend/src/domain/generations.ts` – eine 2011er W221 zählt zur 2013er W221, eine W222 nicht; ohne Code wird die
Baureihe seit 20.09.2026 aus Modellfamilie und Baujahr bestimmt, z. B. „Maybach S 650, 2020“ → W222 2013–2020, im
Wechseljahr die auslaufende Reihe; bei Exoten ist das Modell selbst die Baureihe, z. B. Aventador 2011–2022; erst ohne
bekannte Familie Baujahr ±1). Sondermodelle, die mobile.de nur im Freitext führt, wandern in den Suchtext: „Aventador
Superveloce“ → „Aventador SV“, „911 GT3 RS“, „488 Pista“ – sonst wurde ein SV mit jedem Aventador ab 350.000 € verglichen. Wer
solche Regeln ändert, zählt `REF_KEY_VERSION` in `db.ts` hoch; der Job setzt die Sortierspalten dann neu,
Laufleistung höchstens +50 % unter 100.000 km bzw. +30 % darüber, mindestens aber bis 20.000 km (`REFERENCE_KM_FLOOR`;
ein 1.600-km-Aventador fand sonst nur Angebote bis 2.400 km; nach unten offen), Hubraum ±12 % und Leistung
±15 % sofern beide Seiten die Werte kennen. Weil mobile.de die Beschreibung unscharf sucht („S350“ liefert auch
CLS 350 und E 350), muss die Variantenkennung zusätzlich als eigenes Wort im mobile.de-Modellnamen oder Titel stehen.

Quelle ist der JSON-Endpunkt der mobile.de-Web-App (`/consumer/api/search/srp`, kein Key, Grauzone wie Encar).
Damit die Suche schnell und günstig bleibt, holt nicht die API die Preise, sondern ein Job nach dem Sync
(`backend/src/cli/reference.ts`): je Suchbucket (Marke, Variante, Kraftstoff, Baujahrband, Laufleistungsband) die
günstigsten Angebote in die Tabelle `ref_prices`; die API liest je Trefferseite nur diese Buckets (eine Abfrage).

1. Vom eigenen Rechner prüfen (schreibt nichts):
   `npm run probe -w backend -- mobile BMW 320d 2019 Diesel`. Bestätigt 15.09.2026: `✔ Modus url HTTP 200 · 21 Stichproben ·
   Treffer gesamt 730 · Seiten 37` und darunter Zeilen `✔ 2019 · 95000 km · 21500 € · 140 kW · 1995 cm³ · …`
   (der Modus `query` liefert 400 und ist nur noch Rückfall).
   Zeigt die Probe „ID UNBEKANNT“, fehlt die mobile.de-Marken-ID → als Variable `REFERENCE_MAKE_IDS`
   ergänzen, z. B. `{"Genesis":8501}` (ID aus der mobile.de-Such-URL `ms=<id>;;;` ablesen).
2. Die Funktion ist standardmäßig an (seit 15.09.2026). Abschalten: GitHub-Variable und Vercel-Variable
   `REFERENCE_ENABLED=false`. Optional als GitHub-Variable `REFERENCE_MAX_PER_RUN` (Standard 1500 Buckets je Lauf
   ≈ 25 Minuten). Sperrt mobile.de die Runner-IP (403), als Secret `REFERENCE_PROXY_URL` den Residential-Proxy eintragen.
3. Vercel deployt `main` automatisch; ohne Buckets in `ref_prices` bleiben die Kacheln zunächst ohne Vergleichspreis.
4. Actions → Sync Listings → Run workflow (der Schritt läuft auch, wenn der Sync rot endet). Der Schritt „Vergleichspreise DE“ meldet
   `✔ reference buckets=… · aktuell=… · Kandidaten=…`. Mit 1500 Buckets je Lauf und vier Läufen am Tag sind
   die häufigsten Kombinationen nach dem ersten Tag abgedeckt, der Rest folgt in den nächsten Tagen; danach
   werden Buckets alle 7 Tage (`REFERENCE_TTL_DAYS`) erneuert. Die Detailansicht lädt fehlende Buckets live nach
   (`REFERENCE_LIVE_LOOKUP`, eine mobile.de-Anfrage).

**Sortierung nach Abstand (seit 20.09.2026):** Die Trefferliste kann nach dem Abstand zum DE-Vergleichspreis sortieren
(auf- und absteigend, Inserate ohne Vergleichspreis zuletzt). Dafür trägt jedes Inserat vorberechnete Spalten:
`ref_key` (Bucket-Schlüssel, beim Upsert gesetzt), `ref_min_eur` (günstigstes vergleichbares DE-Angebot; 0 = geprüft,
kein vergleichbares Angebot; NULL = noch nicht berechnet) und `ref_diff_de/at/nl/pl` (Abstand des Endpreises je Zielland
in Prozent). Der Job `reference.ts` trägt zuerst fehlende Schlüssel nach, versorgt dann offene Inserate (Teilindex
`idx_listings_ref_pending`) mit bereits geladenen Buckets (Meldung `✔ columns … offen …`; erster Lauf 20.09.2026: 271.892
Schlüssel in 13 min, danach ~900 Buckets/min) und schreibt nach jedem neu geladenen Bucket dessen Inserate fort;
Kursänderungen ziehen die Abstände in `recomputeDerived` nach. Die dafür nötigen
Indizes (`idx_listings_search_v2`, `idx_listings_active_refdiff_*`, `idx_listings_ref_key`) legt nur der Job an, nicht
die Vercel-Function – bis zum ersten Job-Lauf nach dem Deploy ist diese eine Sortierung langsamer. Referenz ist immer
das günstigste Angebot, kein Median: Importe liegen erfahrungsgemäß unter dem heimischen Angebot.

Kosten: der Job läuft auf GitHub Actions – im privaten Repository zählt er gegen das Minutenkontingent (Teil L);
Turso liest je Trefferseite bis zu 48 kleine Zeilen mehr. Auf Vercel entsteht keine zusätzliche externe Anfrage
außer in der Detailansicht.

**Fotos (21.09.2026):** Die Detailseite zeigt alle Fotos der Quelle als Galerie (Hauptbild mit Blättern, alle Vorschaubilder
darunter). Die vier Prüfblatt-Platzhalter (Front, Innenraum, Motorraum, Unterboden) erscheinen nur noch bei japanischen
Auktionen ohne Fotos. Sauto-Bilder tragen genau den Parametersatz, den die Sauto-Seite selbst nutzt
(`?fl=exf|res,1024,768,1|wrm,/watermark/sauto.png,10,10|jpg,80,,1`, `SAUTO_IMAGE_PARAMS`): Probe 21.09.2026 gegen
d19-a.sdn.cz – nackte URL HTTP 401, andere `fl=`-Varianten HTTP 400, nur diese Form liefert das Bild (ohne Referer-Pflicht).
Der Bestand wurde einmalig umgeschrieben (Merker `sauto_photos_wrm`).

**Vergleichspreise je Leistungsband (21.09.2026):** mobile.de sortiert nach Preis; ohne Leistungsfilter zeigen die ersten
Seiten nur die schwächsten Motoren eines Modells (ein X6 xDrive30d aus Rumänien wurde mit einem einzigen 101.990-€-Angebot
verglichen, ein X6 M fand keins). Der Bucket-Schlüssel trägt deshalb das Leistungsband (`KW_BANDS`, Suchparameter
`pw=<von>:<bis>` mit 15 % Rand); `REF_KEY_VERSION` 4 hat Schlüssel und Sortierspalten zurückgesetzt, die Buckets werden
über die stündlichen Läufe neu geladen (~1.500 je 45 min). Modell-IDs kommen zuerst aus der Modellliste der Marke
(`/consumer/api/search/reference-data/models/<makeId>`, 30 Tage in `meta`: „7-Series“ → Gruppe 7er, „760i“ → Modell 760,
„X6 M“), erst dann über die SEO-Modellseite. Ein Vergleichspreis braucht mindestens zwei Angebote (`MIN_COMPARABLES`);
Einzelstücke (gepanzert, „1of1“) zählen nicht – für einen 760i aus Dubai gab es in DE genau einen Wagen, gepanzert,
788.800 €. Probe: `npm run probe -- mobile BMW "X6 M" 2020 Petrol 156000 "X6 M" 460` (Leistung in kW als letztes
Argument), `mobile-models 3500 7`, `sauto-detail <id>`; auf dem Runner über den Workflow **Probe** (Feld `args`).

**Auktionen ohne Abstand (21.09.2026):** Bei Auktionen ist `price` nur das Start- bzw. aktuelle Höchstgebot (Copart:
Gebot, Jap Carz: Startgebot), kein Kaufpreis. Die Sortierung „Größte Differenz zum DE-Preis“ zeigte deshalb Copart-Lose
mit 175 $ Gebot als „−94 %“ ganz vorn. Seither bekommen Auktionen den Vergleichspreis („DE ab …“), aber keinen Abstand:
`firmPrice()` in `services/reference.ts` (Karte, Detail, Job) und die Bedingung `offer_type <> 'auction'` in
`refDiffSql()` (Upsert, Kursnachzug) schreiben `ref_diff_*` = NULL, die Abstandssortierung reiht sie damit hinten ein;
`heavyMigrations` hat vorhandene Abstände von Auktionen einmalig gelöscht (Merker `ref_diff_auction_null`). Die
Detailansicht erklärt das in einer Zeile (`refAuction`). Stand der Spalten ohne Datenbankzugang: `/api/health/reference`
(Migrationsmerker, offene Inserate, Inserate mit Abstand, Auktionen mit Abstand – sollen 0 sein – samt drei Beispielen);
unter Schreiblast dauert die Antwort über 30 s, Probe deshalb mit `url <Adresse> timeout=120000`.

**Turso-Schreibsperre (21.09.2026):** Nach den Massenläufen des Tages (Schlüssel-Reset über 273.000 Inserate, Nachzug
der Sortierspalten, Nachhol-Lauf der Buckets) sperrte Turso alle Schreibzugriffe: „BLOCKED: … SQL write operations are
forbidden (writes are blocked, do you need to upgrade your plan?)“ – das Kontingent des Plans (Zeilen-Schreibvorgänge
bzw. Speicher) war erschöpft. Die Vercel-Function meldete daraufhin bei jeder Anfrage `startup_failed`, weil `migrate()`
beim Kaltstart schreibt (`CREATE … IF NOT EXISTS`), obwohl alle Daten lesbar waren. Seither fängt `ready()` diese
Sperre auf Vercel ab (`isWriteBlocked`, `dbReadOnly`) und die Website läuft lesend weiter; `/api/health` zeigt
`writes: BLOCKED …`. Jobs (Sync, Vergleichspreise) schlagen bis zur Freigabe fehl. Prüfen: Turso-Dashboard → Usage
(Rows written, Storage) und Plan; Abhilfe: Plan erhöhen oder auf den Monatswechsel warten. Jede UPDATE-Zeile zählt
mit ihren Indexeinträgen (abdeckender Suchindex v3 mit 24 Spalten) mehrfach – Massenläufe wie der Schlüssel-Reset sind
deshalb teuer und sollten selten bleiben.

**Transportkosten EU (21.09.2026):** Innerhalb der EU rechnet die Kalkulation mit 0,3 % Transportversicherung statt 1,1 %
Seefracht-Versicherung (`FEES.insurancePctEU`) – ein 440.000-€-Fahrzeug aus Prag stand sonst mit über 5.000 € „Seefracht“ da.
Nach Änderungen an Gebühren `LANDED_VERSION` in `services/sync.ts` hochzählen, dann rechnet der nächste Sync alle
Endpreis-Spalten neu.

## Teil L – GitHub-Actions-Minuten: Läufe schlagen nach Sekunden fehl (Stand 20.09.2026)

**Symptom:** Seit dem 18.09.2026 abends enden alle Läufe von „Sync Listings“ und „Reference Prices“ nach 3–40 Sekunden
rot, ohne dass ein Schritt startet (kein Runner, kein Protokoll). In der Laufansicht steht als Hinweis sinngemäß
„The job was not started because recent account payments have failed or your spending limit needs to be increased“.

**Ursache:** Das Repository ist privat. GitHub-Runner sind dort auf **2.000 Minuten je Monat** (Free) bzw. 3.000 (Pro)
begrenzt; öffentliche Repositories haben kein Limit. Seit dem 16.09. laufen je Tag vier Sync-Läufe à 60–85 Minuten
(≈ 300 min) und zwölf Vergleichspreis-Läufe à 50 Minuten (600 min), zusammen **≈ 900 Minuten am Tag** – das
Kontingent war nach gut zwei Tagen aufgebraucht. Nachsehen: Profil → Settings → Billing and plans → Plans and usage
→ „Actions“. Das Kontingent setzt sich zum Beginn des Abrechnungsmonats zurück; bis dahin startet kein Lauf.

**Lösungen** (eine reicht):

1. **Eigener Runner (empfohlen, ~4 €/Monat).** Selbst gehostete Runner sind bei GitHub auch im privaten Repository
   kostenlos und ohne Minutenlimit. Ein kleiner Linux-Server genügt (z. B. Hetzner CX22, 2 vCPU/4 GB, Ubuntu 24.04;
   alternativ der eigene PC unter WSL2, der dann aber durchlaufen muss).
   - Auf dem Server: `sudo apt install -y curl git` (Node lädt `actions/setup-node` selbst).
   - GitHub: Repository → Settings → Actions → Runners → **New self-hosted runner** → Linux x64. Die dort angezeigten
     Befehle (Download, `./config.sh --url … --token …`) auf dem Server ausführen; als Name z. B. `hetzner-1`, Labels
     bei `self-hosted,Linux,X64` belassen.
   - Als Dienst einrichten, damit er Neustarts überlebt: `sudo ./svc.sh install && sudo ./svc.sh start`.
   - Repository → Settings → Secrets and variables → Actions → Variables → **`RUNNER` = `self-hosted`**. Beide
     Workflows lesen `runs-on: ${{ vars.RUNNER || 'ubuntu-latest' }}`; Variable löschen = zurück auf GitHub-Runner.
   - Actions → Sync Listings → Run workflow. Läuft ein Schritt mit 403 (mobile.de, OLX, Copart sperren Hosting-IPs
     mitunter), als Secret `REFERENCE_PROXY_URL` bzw. `EUROPE_PROXY_URL`/`COPART_PROXY_URL` den Residential-Proxy
     eintragen; Encar läuft ohnehin über `ENCAR_PROXY_URL`.
   - Sicherheit: Der Runner führt nur Workflows dieses Repositories aus. Settings → Actions → General → „Fork pull
     request workflows“ auf „Require approval for all outside collaborators“ lassen.
2. **Repository öffentlich stellen.** Settings → General → Danger Zone → Change visibility → Public. Dann laufen
   GitHub-Runner ohne Limit. Secrets bleiben geheim; der Code (inklusive der Grauzonen-Adapter für Encar,
   mobile.de, Dubizzle, Copart) ist dann einsehbar.
3. **Bezahlen.** Settings → Billing → Spending limit für Actions erhöhen. Linux-Minuten kosten 0,008 USD; bei
   900 Minuten am Tag sind das ≈ 7 USD am Tag bzw. ≈ 220 USD im Monat – nicht sinnvoll.
4. **Nur drosseln reicht nicht.** Selbst ein Sync am Tag (≈ 70 min) plus zwei Vergleichspreis-Läufe (100 min)
   ergeben ≈ 5.000 Minuten im Monat, mehr als das doppelte Kontingent. Das Free-Kontingent passt zu diesem
   Arbeitsumfang nicht.

Solange nichts davon greift, bleiben Bestand und Vergleichspreise auf dem Stand vom 18.09.; die Website läuft
unverändert weiter (Vercel und Turso sind nicht betroffen).
