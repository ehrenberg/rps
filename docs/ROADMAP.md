# Roadmap

Jede Phase endet mit etwas Spielbarem. Abnahme jeweils im Browser (Desktop + Handy-Breite 375 px).

## Phase 0 – Grundgerüst ✅
- [x] Konzept, Architektur, Deployment, Entscheidungen
- [x] AGENTS.md / CLAUDE.md
- [x] Ordnerstruktur `public/`, `.htaccess`, leere Module, Fonts einbinden

## Phase 1 – Gegen den Computer (nur Frontend) ✅
- [x] `rules.js` (klassisch + Echse/Spock, Verben) mit Tests
- [x] Startscreen, Computer-Setup, Arena-Layout (mobil zuerst)
- [x] SVG-Hände für alle 5 Züge
- [x] Countdown, Reveal, Ergebnissatz, Punkt-Pips, Matchende
- [x] KI-Stufen 1–3
- **Abnahme:** Best of 3/5 gegen Zufall-KI vollständig spielbar, beide Varianten.

## Phase 2 – Effekte & Sound ✅
- [x] Aurora-Hintergrund, Glas-Karten, Übergänge zwischen Screens
- [x] Canvas-Partikel (Konfetti, Funken, Regen), Screen-Shake
- [x] Web-Audio-Sounds, Ton-Schalter
- [x] `prefers-reduced-motion` + Schalter „Effekte reduzieren“
- **Abnahme:** 60 fps auf Mittelklasse-Handy, keine Ruckler beim Reveal. ✅ emuliert (375×812, DPR 3, CPU 4×): Reveal/Konfetti/Regen/Bracket-Scroll p95 16,7 ms; Dauertest `tests/e2e/perf.test.mjs`.

## Phase 3 – Lernende KI & Statistik ✅
- [x] Gedankenleser-KI (Ensemble), Historie in localStorage, „Was denkt der Computer?“-Anzeige
- [x] Fairness-Hash beim Computerzug
- [x] Statistik-Screen, Zurücksetzen
- **Abnahme:** Gegen ein festes Muster (z. B. Stein, Papier, Schere im Kreis) gewinnt die KI nach < 15 Runden fast immer. Test dafür in `tests/`.

## Phase 4 – Online-Duell ✅
- [x] `api.php` + `src/` (SQLite, create/join/state/commit/reveal/rematch/react/claim/leave)
- [x] Commit-Reveal inkl. Frist, Hash-Prüfung im Client
- [x] Lobby mit Link, Kopieren, Teilen, QR-Code
- [x] Polling mit Backoff, Online-Anzeige, Revanche + Serie
- [x] Emoji-Reaktionen
- [x] Auto-Löschen nach 24 h
- **Abnahme:** Zwei Browser spielen 3 Matches mit Revanche; Reload mitten im Match behält den Platz; Gegner kann über DevTools den Zug nicht vor dem eigenen Reveal sehen.

## Phase 5 – Turnier ✅
- [x] Turnierraum, Lobby mit Spielerliste, Host-Start
- [x] K.-o.-Baum mit Freilosen, parallele Matches, Zuschauer-Ansicht
- [x] Siegerehrung, neues Turnier
- **Abnahme:** Turnier mit 5 Browserfenstern läuft bis zum Sieger durch.

## Phase 6 – Feinschliff & Livegang
- [x] Barrierefreiheit (Tastatur, Fokus, ARIA-Live für Ergebnisse, Kontrast) – axe-Test `tests/e2e/a11y.test.mjs` (AXE_PATH)
- [x] Favicon, Manifest (optional PWA ohne Service-Worker-Tracking)
- [ ] Deployment nach [DEPLOYMENT.md](DEPLOYMENT.md), Checkliste abhaken

## Querschnitt (Qualität)
- [x] Docker-Entwicklungsumgebung (Apache + PHP 8.1 wie Netcup)
- [x] gitleaks als Pre-Commit-Hook
- [x] Unit-Tests JS (node --test) und PHP (PHP 8.1), E2E mit Playwright
