# Deployment auf Netcup Webhosting

Kurzfassung: **automatisch** per GitHub Actions nach jedem grünen Push auf `main`
(siehe [Automatisches Deployment](#automatisches-deployment-github-actions--ssh)).
Von Hand weiterhin möglich: `npm run dist` → Inhalt von `dist/public/` per FTP hochladen →
`npm run check:deploy -- https://rps.bastianswelt.de` → Handprüfung.

## Automatisches Deployment (GitHub Actions + SSH)

Gleiches Verfahren und gleiche Secret-Namen wie bei Wunschstern.

| Datei | Läuft wo | Zweck |
|---|---|---|
| `.github/workflows/ci.yml` | GitHub Actions | gitleaks, PHP-Lint + PHP-Tests auf 8.1, JS-Tests, Paket bauen (`dist`) |
| `.github/workflows/deploy.yml` | GitHub Actions | nach grüner CI auf `main` (oder „Run workflow“): `scripts/dist.sh`, per `tar` über SSH hochladen, Server-Skript, `check:deploy` gegen die Live-Adresse |
| `deploy/remote-release.sh` | Server (per SSH-stdin) | `data` → `shared/data` verlinken, `current` atomar umstellen, alte Releases (> 5) löschen |

### Verzeichnisstruktur auf dem Server

```
/rps/                               (Sicht der SSH-Sitzung; PHP-FPM: /var/www/vhosts/<webspace>/rps)
  releases/20261201-120000/         Inhalt von dist/public/, ein Ordner pro Deployment
    data -> ../../shared/data
  shared/data/                      rps.sqlite + Sperr-.htaccess, bleibt über alle Releases erhalten
  current -> releases/20261201-120000   = Document Root der Subdomain
```

### Einmalig einrichten

1. **Plesk:** Subdomain `rps.bastianswelt.de`, Document Root **`rps/current`**, PHP ≥ 8.1, Let's Encrypt +
   HTTP→HTTPS-Weiterleitung. Den leeren Ordner, den Plesk für `current` anlegt, entfernt das Deploy-Skript selbst.
2. **GitHub-Environment `WebHosting`** im Repo anlegen (*Settings → Environments*) und dort dieselben Werte wie bei
   Wunschstern eintragen. Secrets lassen sich auf GitHub nicht auslesen, also neu setzen, z. B. mit `gh`:

   | Name | Art | Wert |
   |---|---|---|
   | `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_PORT` | Secret | wie bei Wunschstern |
   | `DEPLOY_SSH_KEY` | Secret | derselbe Deploy-Schlüssel (`~/.ssh/wunschstern_deploy`) oder ein eigener |
   | `DEPLOY_KNOWN_HOSTS` | Secret | Ausgabe von `ssh-keyscan -p <PORT> <HOST>` |
   | `DEPLOY_PATH` | Secret | **`/rps`** (Sicht der SSH-Sitzung, kein `~`, nicht `/var/www/vhosts/…`) |
   | `RPS_DATA_DIR` | Variable, empfohlen | `/var/www/vhosts/<webspace>/rps/shared/data` (Sicht von PHP-FPM) → `SetEnv` in der Paket-`.htaccess` |
   | `DEPLOY_URL` | Variable, optional | Standard `https://rps.bastianswelt.de` |

   Unter *Deployment branches* auf `main` beschränken (das Repo ist öffentlich).
3. Erstes Deployment: *Actions → Deploy → Run workflow*. Ab dann rollt jeder grüne Push auf `main` aus.

Solange ein Pflicht-Secret fehlt, wird der Deploy-Job übersprungen (grau mit Hinweis), nicht rot.
Ohne `RPS_DATA_DIR` landet die Datenbank trotzdem in `shared/data` (über den `data`-Symlink, per `.htaccess`
gesperrt). Mit `RPS_DATA_DIR` greift PHP direkt auf denselben Ordner zu, ohne Umweg über den Webroot.

**Rückrollen:** per SSH `cd /rps && ls -1 releases && ln -sfn releases/<VORHERIGES> current.tmp && mv -Tf current.tmp current`,
danach den fehlerhaften Commit auf `main` reverten.

## Einmalig: Hosting vorbereiten

- Subdomain `rps.bastianswelt.de` im Netcup-CCP (Webhosting Control Panel / Plesk) anlegen,
  Dokumentenstamm auf einen eigenen Ordner zeigen lassen, z. B. `/rps/public`.
- PHP 8.1 oder neuer auswählen; Erweiterungen `pdo_sqlite` und `json` (Standard bei Netcup).
- SSL-Zertifikat (Let's Encrypt) für die Subdomain aktivieren und HTTPS erzwingen.
  HTTPS ist Pflicht, weil `crypto.subtle` nur in sicheren Kontexten verfügbar ist (Fallback existiert trotzdem).
- **Datenordner außerhalb des Webroots** anlegen (empfohlen), z. B. `/rps/data` neben `/rps/public`,
  siehe [Datenbank außerhalb des Webroots](#datenbank-außerhalb-des-webroots-rps_data_dir).

## Schritt für Schritt

### 1. Paket bauen

```bash
npm run dist
# mit Datenordner außerhalb des Webroots (empfohlen, Pfad siehe unten):
RPS_DATA_DIR=/var/www/vhosts/<hauptdomain>/rps/data npm run dist
```

`scripts/dist.sh` bricht ab, wenn

- das Arbeitsverzeichnis nicht sauber ist (alles committet?),
- `npm test` (JS + PHP) fehlschlägt,
- gitleaks in `public/` etwas findet.

Ergebnis:

- `dist/public/` – genau das, was hochgeladen wird: Inhalt von `public/` **ohne** `data/*.sqlite*`,
  ohne Dotfiles (außer den `.htaccess`-Dateien), ohne Editor-/OS-Reste (`*~`, `*.swp`, `.DS_Store` …).
- `dist/rps-public-<git-sha>.zip` – dasselbe als Zip (Archiv/Rollback, oder Upload + Entpacken im Plesk-Dateimanager).
- Dateiliste und Gesamtgröße (aktuell rund 70 Dateien, ca. 560 KB, Zip ca. 340 KB).

Zum Ausprobieren ohne Commit: `npm run dist -- --allow-dirty` (Paketname bekommt `-dirty`, nicht hochladen).

### 2. Hochladen (FTP/SFTP)

1. **Vorher** das zuletzt hochgeladene Zip als Rollback-Stand aufheben (liegt in `dist/` bzw. Archiv).
2. Den **Inhalt** von `dist/public/` in den Dokumentenstamm laden (FileZilla: „Überschreiben, wenn neuer“
   reicht nicht – immer alle Dateien überschreiben). Versteckte Dateien im FTP-Client einblenden,
   damit `.htaccess`, `src/.htaccess` und `data/.htaccess` mitkommen.
3. Dateien, die es im neuen Paket nicht mehr gibt, auf dem Server löschen (das Paket ist vollständig;
   `data/` mit der laufenden Datenbank **nicht** löschen).
4. Ohne `RPS_DATA_DIR`: prüfen, dass `data/` vom Webserver beschreibbar ist (meist automatisch; sonst 755/775).

Nicht hochladen: `docs/`, `tests/`, `scripts/`, `AGENTS.md`, `CLAUDE.md`, `.git/`, `node_modules/` –
liegen ohnehin nicht in `dist/public/`.

### 3. Automatisch prüfen

```bash
npm run check:deploy -- https://rps.bastianswelt.de
```

`scripts/check-deploy.mjs` (Node, ohne Abhängigkeiten) prüft und gibt eine ✔/✘-Liste aus,
Exit-Code ≠ 0 bei Fehlern:

| Bereich | Prüfung |
|---|---|
| Startseite | 200, `text/html; charset=utf-8` |
| Header | CSP exakt wie in `.htaccess`, `Referrer-Policy: no-referrer`, `nosniff`, `X-Frame-Options: DENY`, Permissions-Policy, COOP, CORP; HSTS und HTTP→HTTPS-Umleitung (nur bei `https://`, lokal „übersprungen (kein HTTPS)“) |
| Sperren | 403 für `/data/rps.sqlite`, `/data/`, `/data/.htaccess`, `/src/`, `/src/db.php`, `/src/rules.php`, `/.htaccess` |
| API | `GET /api.php` → 405 + `Allow: POST`; `info` mit unbekanntem Code → 404, JSON, deutscher Fehlertext, `no-store` |
| Assets | alle von `index.html` aus erreichbaren Dateien (CSS, JS-Imports, Fonts, Manifest-Icons) → 200 mit richtigem Content-Type (`.js` = `text/javascript`, `.woff2` = `font/woff2`, `.webmanifest` = `application/manifest+json` …) |
| Fremde Ressourcen | keine `http(s)://`- oder `//host`-URLs in HTML/CSS/JS/Manifest außer den Footer-Links auf bastianswelt.de und SVG-Namespaces |
| Kompression | `main.js` und `app.css` kommen gzip/deflate-komprimiert |
| Caching | HTML/API `no-store`, JS/CSS mit `max-age`, Fonts/PNG ≥ 1 Tag |
| Alle Antworten | kein `Set-Cookie`, Sicherheitsheader auch auf 403/404/405 |

Lokal gegen den Docker-Container: `npm run check:deploy -- http://localhost:8088`.

### 4. Von Hand prüfen (Checkliste)

- [ ] `npm run check:deploy -- https://rps.bastianswelt.de` komplett grün
- [ ] `https://rps.bastianswelt.de/` lädt ohne Fehler in der Konsole (Desktop und Handy)
- [ ] Netzwerk-Tab: **keine** Requests an fremde Domains
- [ ] Keine Cookies gesetzt (DevTools → Application → Cookies leer)
- [ ] Duell mit zwei Geräten (z. B. Handy + Laptop) einmal durchspielen
- [ ] Mit `RPS_DATA_DIR`: nach dem Duell liegt `rps.sqlite` im Datenordner, `data/` im Webroot
      enthält weiterhin nur `.htaccess` und `index.html`
- [ ] „Zum Startbildschirm hinzufügen“ zeigt Name „SSP“ und das App-Icon
- [ ] Footer-Links auf Impressum und Datenschutz von bastianswelt.de funktionieren

### Rollback

1. Das vorherige Zip (`dist/rps-public-<alter-sha>.zip`, oder `git checkout <alter-sha> && npm run dist`)
   entpacken und wie oben hochladen. Die Datenbank bleibt unberührt.
2. `npm run check:deploy -- https://rps.bastianswelt.de` erneut laufen lassen.
3. Bei kaputter Datenbank: Datei `rps.sqlite*` im Datenordner löschen – sie wird beim nächsten
   API-Aufruf neu angelegt (Räume leben ohnehin nur 24 h, es gehen nur laufende Spiele verloren).

## Datenbank außerhalb des Webroots (`RPS_DATA_DIR`)

`src/db.php` liest das Verzeichnis per `getenv('RPS_DATA_DIR')`; ohne Variable nimmt es `data/` im
Webroot (dort per `Require all denied` + leerer `index.html` gesperrt – sicher, aber zweite Wahl).

Auf Shared Hosting gibt es keinen Zugriff auf die Server-Umgebung, deshalb setzt **die `.htaccess`
des Pakets** die Variable: `RPS_DATA_DIR=/abs/pfad npm run dist` hängt an `dist/public/.htaccess` an:

```apache
<IfModule mod_env.c>
  SetEnv RPS_DATA_DIR "/abs/pfad"
</IfModule>
```

So bleibt die Einstellung bei jedem Upload erhalten (ein von Hand in der Server-`.htaccess`
nachgetragenes `SetEnv` würde beim nächsten Upload überschrieben). Der Pfad steht nicht im Repo.

- **Getestet** im Docker-Nachbau (Apache 2.4 + mod_php 8.1): Container ohne Umgebungsvariable,
  nur mit `SetEnv` aus der Paket-`.htaccess` → `rps.sqlite` entsteht im angegebenen Ordner, `data/` bleibt leer.
- Netcup/Plesk betreibt PHP als FastCGI/FPM hinter Apache. `SetEnv` landet dort als CGI-Variable bei PHP,
  `getenv()` findet sie ebenfalls. Trotzdem nach dem ersten Upload mit der Checkliste oben verifizieren
  (`rps.sqlite` liegt im Datenordner, nicht in `data/`). Fehlt `mod_env`, greift still der sichere Fallback `data/`.
- **Pfad finden:** absoluter Pfad des Webspace steht in Plesk unter „Hosting-Einstellungen“ bzw. im
  Dateimanager (bei Plesk typischerweise `/var/www/vhosts/<hauptdomain>/…`). Den Datenordner per FTP
  anlegen, z. B. `rps/data` neben `rps/public`. Er muss innerhalb des Webspace liegen, sonst verbietet
  `open_basedir` den Zugriff. PHP läuft unter dem FTP-Benutzer, daher ist ein per FTP angelegter
  Ordner beschreibbar (sonst Rechte 750/770).

## PWA, Icons, Service Worker

- `manifest.webmanifest` mit Name, Kurzname, `lang: de`, `start_url`/`scope`, `display: standalone`,
  Farben aus den Design-Tokens (`--bg-0`/`--bg-1`) und Icons als SVG + PNG 192/512, jeweils `any` und `maskable`.
- `apple-touch-icon.png` (180 px, vollflächig – iOS rundet selbst ab und kann kein SVG) und `favicon.ico`
  (16/32/48) für Browser/Crawler, die `/favicon.ico` ungefragt abrufen.
- PNG/ICO werden mit `npm run icons` aus `icon.svg`/`icon-maskable.svg` erzeugt (rsvg-convert/ImageMagick,
  sonst Docker-Image `dpokidov/imagemagick`) und committet.
- **Kein Service Worker.** Installierbar ist die App heute auch ohne (Chrome verlangt keinen Fetch-Handler
  mehr, iOS hat das nie getan). Ein Offline-Cache brächte nur den Computer-Modus offline, kostet aber
  Update-Probleme (Assets ohne Hash im Dateinamen → alte Versionen hängen im Cache) und zusätzliche
  Komplexität. Gegebenenfalls später nachrüsten, dann ohne jegliches Tracking.
- `robots.txt`: alles erlaubt außer `/api.php`, `/src/`, `/data/`.
- Keine eigene 404-Seite / kein `ErrorDocument`: Die App nutzt Hash-Routing (`#/…`), der Server sieht nie
  App-Routen. Ein 404 betrifft nur wirklich fehlende Dateien und bleibt ehrlich ein 404.

## Härtung in `public/.htaccess`

Zusätzlich zu CSP & Co.:

- `Cross-Origin-Resource-Policy: same-origin` – fremde Seiten dürfen Bilder/Skripte/JSON nicht einbetten
  (alles wird nur same-origin geladen, bricht nichts).
- `*.md`, `*.sh`, `*.sql`, `*.sqlite*`, `*.db`, `*.bak`, `*.orig`, `*.swp`, `*.log`, `*.ini`, `*.env`,
  Archive und `*~` → 403, falls so etwas versehentlich mit hochgeladen wird.
- `ServerSignature Off` – keine Apache-Version in Fehlerseiten.
- `SetEnvIf X-Forwarded-Proto https` → HSTS wird auch hinter einem TLS-terminierenden Proxy gesendet.
- `X-Content-Type-Options` wird nicht doppelt gesendet (`api.php` setzt ihn selbst).

## Datenschutzerklärung (Hinweis)

Die Datenschutzerklärung auf bastianswelt.de sollte einen Abschnitt zu rps.bastianswelt.de
bekommen. Inhaltlich relevant: Spielername und Spielzüge werden für max. 24 h serverseitig
gespeichert, Statistik/Name/Einstellungen nur lokal im Browser (localStorage), keine Cookies,
keine Drittanbieter, Server-Logs wie beim restlichen Hosting.

## Lokale Entwicklung

```bash
npm run up    # docker compose: Apache 2.4 + PHP 8.1, .htaccess aktiv → http://localhost:8088
npm run check:deploy -- http://localhost:8088
```

Der Container bildet das Hosting nach (Apache, `AllowOverride All`, PHP 8.1, `display_errors=Off`),
die SQLite-Datei liegt dort außerhalb des Webroots (`RPS_DATA_DIR=/var/www/data`, tmpfs –
nach `npm run down` ist sie weg). Header und Sperren trotzdem einmal auf dem echten Hosting prüfen.
Das gebaute Paket lässt sich genauso testen:
`docker run --rm -p 8097:80 -v "$PWD/dist/public:/var/www/html:ro" -e RPS_DATA_DIR=/tmp/d --tmpfs /tmp/d:uid=33,gid=33 rps-web`.
