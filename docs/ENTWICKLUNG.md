# Entwicklung

## Einmalig einrichten

```bash
npm run setup        # aktiviert die versionierten Git-Hooks in .githooks/
npm run up           # baut und startet den Webserver-Container
```

Benötigt lokal nur **Docker** (mit Compose) und **Node ≥ 20** (für JS-Tests/Playwright).
PHP und gitleaks laufen ausschließlich in Containern (`docker-compose.yml`):

| Service | Image | Zweck |
|---|---|---|
| `web` | `docker/web.Dockerfile` (php:8.1-apache) | App wie auf Netcup, `.htaccess` aktiv, Port `${RPS_PORT:-8088}` |
| `php` | php:8.1-cli | Tests und Lint auf der Produktions-Mindestversion (Profil `tools`) |
| `gitleaks` | zricethezav/gitleaks | Secrets-Scan (Profil `tools`) |

Port belegt? `RPS_PORT=8090 npm run up`.

## Qualitätssicherung

| Was | Befehl | Wann |
|---|---|---|
| Secrets-Scan | `npm run secrets` | automatisch bei jedem Commit (Hook) |
| PHP-Syntax | `php -l datei.php` | automatisch für geänderte PHP-Dateien (Hook) |
| JS-Unit-Tests | `node --test tests/js/` | automatisch bei JS-Änderungen (Hook) |
| PHP-Tests | `php tests/run.php` | vor jedem Commit |
| Alle Tests | `npm test` | vor jedem Commit |
| E2E (Playwright) | `npm run test:e2e` | vor Abschluss einer Phase |

Der Pre-Commit-Hook (`.githooks/pre-commit`) bricht den Commit ab, wenn gitleaks etwas findet.
Konfiguration: `.gitleaks.toml` (Standardregeln + FTP-Zugangsdaten). Falschmeldungen gezielt
über `[allowlist]` freigeben, nie den Hook umgehen.
