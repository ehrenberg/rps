# AGENTS.md

Leitfaden für KI-Agenten (Claude Code, Codex & Co.) in diesem Repository.

## Projekt in einem Satz

Schere-Stein-Papier-Webapp für **rps.bastianswelt.de**: online per Einladungslink, gegen eine
lernende KI und im Turnier. Vanilla JS + SVG/Canvas im Browser, PHP 8 + SQLite auf Netcup
Shared Hosting. Details: [docs/KONZEPT.md](docs/KONZEPT.md), [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md).

## Kommunikation

- Mit Basti **auf Deutsch** sprechen. UI-Texte auf Deutsch, Code (Bezeichner) auf Englisch,
  Kommentare kurz und auf Deutsch oder Englisch – pro Datei einheitlich.
- Vor größeren Abweichungen vom Konzept fragen, statt eigenmächtig umzubauen.

## Harte Regeln (nicht verhandelbar)

1. **Keine externen Ressourcen.** Kein CDN, keine Google Fonts, keine Analytics, keine fremden
   Requests. Alles, was der Browser lädt, liegt in `public/`.
2. **Keine Cookies.** Speichern nur in `localStorage` / `sessionStorage` (Schlüssel mit Präfix `rps.`).
3. **Kein Build-Schritt für Produktion.** `public/` muss so, wie es ist, per FTP lauffähig sein.
   Keine Bundler, kein TypeScript im Produktivcode, keine npm-Pakete in `public/`.
4. **Server: nur PHP 8.1+ und SQLite (PDO).** Kein Node, keine WebSockets, kein Cron voraussetzen.
5. **Fairness:** Der Server darf einen Zug nie ausliefern, bevor beide Spieler aufgedeckt haben.
6. **Nutzertext nie per `innerHTML`.** Immer `textContent` / DOM-APIs.
7. **Räume werden nach 24 h gelöscht.** Keine IP-Adressen oder sonstige Kennungen speichern.
8. **Impressum/Datenschutz nicht selbst schreiben**, nur auf bastianswelt.de verlinken.

## Arbeitsweise

- Nach der Roadmap in [docs/ROADMAP.md](docs/ROADMAP.md) vorgehen; erledigte Punkte dort abhaken.
- Neue Grundsatzentscheidungen in [docs/ENTSCHEIDUNGEN.md](docs/ENTSCHEIDUNGEN.md) eintragen.
- Spielregeln existieren doppelt (`public/assets/js/rules.js` und `public/src/rules.php`) –
  **immer beide gleichzeitig ändern** und die Tests laufen lassen.
- API-Änderungen in `docs/ARCHITEKTUR.md` (Tabelle „API“) nachziehen.
- Kleine, thematisch saubere Commits auf Deutsch oder Englisch, Präfix optional (`feat:`, `fix:` …).

## Lokal starten & prüfen

Alles läuft über Docker (Details: [docs/ENTWICKLUNG.md](docs/ENTWICKLUNG.md)):

```bash
npm run setup        # einmalig: Git-Hooks aktivieren (gitleaks, php -l, JS-Tests)
npm run up           # Apache 2.4 + PHP 8.1 mit .htaccess → http://localhost:8088
npm test             # JS-Unit-Tests (Node) + PHP-Tests (Container php:8.1-cli)
npm run lint:php     # Syntax-Check aller PHP-Dateien auf 8.1
npm run secrets      # gitleaks über Historie und Arbeitskopie
npm run down         # Umgebung stoppen
```

Multiplayer testen: zwei Browserfenster (eins privat) oder Playwright mit zwei Kontexten.
Vor dem Abschluss einer Aufgabe die App im Browser tatsächlich ausprobieren
(Desktop und 375 px Breite) und die Konsole auf Fehler prüfen.

## Code-Stil

- JS: ES-Module, `const`/`let`, keine Frameworks. Ein Modul = eine Aufgabe (siehe Ordnerstruktur).
  Animationen über CSS-Klassen bzw. Web Animations API; Canvas nur für Partikel.
- CSS: Design-Tokens als Custom Properties in `:root`, mobil zuerst, `prefers-reduced-motion` beachten.
- PHP: `declare(strict_types=1);`, reine Funktionen wo möglich, alle DB-Zugriffe über `src/db.php`
  mit Prepared Statements, schreibende Aktionen in `BEGIN IMMEDIATE`-Transaktion.
- Fehlertexte an den Client auf Deutsch und anzeigbar.

## Was nicht ins Repo / auf den Server gehört

- `public/data/*.sqlite*` (Laufzeitdaten), `.env`, Zugangsdaten zum FTP.
- `node_modules/`, Testartefakte.
