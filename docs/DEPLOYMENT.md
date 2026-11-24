# Deployment auf Netcup Webhosting

## Voraussetzungen

- Subdomain `rps.bastianswelt.de` im Netcup-CCP (Webhosting Control Panel / Plesk) anlegen,
  Dokumentenstamm auf einen eigenen Ordner zeigen lassen, z. B. `/rps/public`.
- PHP 8.1 oder neuer auswählen; Erweiterungen `pdo_sqlite` und `json` (Standard bei Netcup).
- SSL-Zertifikat (Let's Encrypt) für die Subdomain aktivieren und HTTPS erzwingen.
  HTTPS ist Pflicht, weil `crypto.subtle` nur in sicheren Kontexten verfügbar ist (Fallback existiert trotzdem).

## Hochladen

1. Per FTP/SFTP den **Inhalt** von `public/` in den Dokumentenstamm hochladen.
2. Prüfen, dass `data/` vom Webserver beschreibbar ist (meist automatisch; sonst Rechte 755/775).
3. Wenn möglich `data/` außerhalb des Webroots anlegen und `RPS_DATA_DIR` in `src/db.php` anpassen.

Nicht hochladen: `docs/`, `tests/`, `AGENTS.md`, `CLAUDE.md`, `.git/`.

## Nach dem Upload prüfen

- [ ] `https://rps.bastianswelt.de/` lädt ohne Fehler in der Konsole
- [ ] Netzwerk-Tab: **keine** Requests an fremde Domains
- [ ] `https://rps.bastianswelt.de/data/rps.sqlite` → 403
- [ ] `https://rps.bastianswelt.de/src/db.php` → 403
- [ ] Antwort-Header enthalten CSP, `Referrer-Policy: no-referrer`
- [ ] Keine Cookies gesetzt (DevTools → Application → Cookies leer)
- [ ] Duell mit zwei Geräten (z. B. Handy + Laptop) einmal durchspielen
- [ ] Footer-Links auf Impressum und Datenschutz von bastianswelt.de funktionieren

## Datenschutzerklärung (Hinweis)

Die Datenschutzerklärung auf bastianswelt.de sollte einen Abschnitt zu rps.bastianswelt.de
bekommen. Inhaltlich relevant: Spielername und Spielzüge werden für max. 24 h serverseitig
gespeichert, Statistik/Name/Einstellungen nur lokal im Browser (localStorage), keine Cookies,
keine Drittanbieter, Server-Logs wie beim restlichen Hosting.

## Lokale Entwicklung

```bash
php -S localhost:8000 -t public
```

Der eingebaute PHP-Server wertet `.htaccess` nicht aus. Sicherheitsheader und Sperren daher
zusätzlich auf dem echten Hosting prüfen.
