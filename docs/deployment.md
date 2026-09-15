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
