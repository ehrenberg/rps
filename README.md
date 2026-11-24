# Schere, Stein, Papier – rps.bastianswelt.de

Grafisch aufwendige Schere-Stein-Papier-Webapp: online gegen Freunde per Einladungslink,
gegen einen lernenden Computer oder im Turnier mit mehreren Leuten. Kein Login, keine
Registrierung, keine Cookies, keine externen Ressourcen.

- **Live:** https://rps.bastianswelt.de (geplant)
- **Hosting:** Netcup Webhosting (PHP 8.x, Apache, kein Node, keine WebSockets)
- **Stack:** Vanilla JS (ES-Module) + SVG/Canvas/CSS-Animationen, PHP 8 + SQLite (PDO)
- **Build:** keiner. Der Ordner `public/` wird 1:1 per FTP hochgeladen.

## Dokumentation

| Datei | Inhalt |
|---|---|
| [docs/KONZEPT.md](docs/KONZEPT.md) | Was die App kann: Modi, Spielablauf, Screens, Grafik, Sound |
| [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md) | Technik: Ordnerstruktur, API, Datenmodell, Commit-Reveal, Polling, KI |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Lokal starten, auf Netcup hochladen, prüfen |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Umsetzung in Phasen mit Abnahmekriterien |
| [docs/ENTSCHEIDUNGEN.md](docs/ENTSCHEIDUNGEN.md) | Getroffene Entscheidungen mit Begründung |
| [AGENTS.md](AGENTS.md) | Regeln für KI-Agenten (Claude Code, Codex, …) |

## Lokal starten

```bash
npm run setup   # einmalig: Git-Hooks (gitleaks)
npm run up      # Docker: Apache + PHP 8.1 → http://localhost:8088
npm test        # alle Tests
```

Voraussetzungen: Docker (mit Compose) und Node ≥ 20 (nur für Tests). Details: [docs/ENTWICKLUNG.md](docs/ENTWICKLUNG.md).

Für Multiplayer-Tests zwei Browserfenster (eines privat) öffnen.

## Rechtliches

Impressum und Datenschutz liegen auf bastianswelt.de und werden nur im Footer verlinkt.
