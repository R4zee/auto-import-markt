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
| `ENCAR_ENABLED` | `true` | Südkorea: Encar direkt (Hauptquelle, kein Key) |
| `ENCAR_MANUFACTURERS` | `현대,기아,제네시스` | Hersteller je Lauf; Importmarken (BMW, 벤츠 …) sind zusätzlich möglich |
| `ENCAR_LIMIT_PER_MAKER` | `60` | Fahrzeuge je Hersteller und Lauf |
| `XAPIKOREA_API_KEY` | optional, Key von <https://xapikorea.com> | Fallback für Korea, falls Encar den Direktzugriff sperrt (Sensitive) |
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
