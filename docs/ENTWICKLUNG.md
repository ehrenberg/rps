# Entwicklung

## Einmalig einrichten

```bash
npm run setup        # aktiviert die versionierten Git-Hooks in .githooks/
```

Benötigt lokal: `php` (8.1+, mit pdo_sqlite und mbstring), `node` (nur für Tests),
`gitleaks` (Secrets-Scan). Auf Bastis Rechner sind `php` und `gitleaks` Wrapper-Skripte in
`~/.local/bin`, die die Docker-Images `composer:2` bzw. `zricethezav/gitleaks` nutzen.

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
