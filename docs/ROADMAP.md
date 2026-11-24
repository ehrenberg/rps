# Roadmap

Jede Phase endet mit etwas Spielbarem. Abnahme jeweils im Browser (Desktop + Handy-Breite 375 px).

## Phase 0 – Grundgerüst ✅ (Doku)
- [x] Konzept, Architektur, Deployment, Entscheidungen
- [x] AGENTS.md / CLAUDE.md
- [ ] Ordnerstruktur `public/`, `.htaccess`, leere Module, Fonts einbinden

## Phase 1 – Gegen den Computer (nur Frontend)
- [ ] `rules.js` (klassisch + Echse/Spock, Verben) mit Tests
- [ ] Startscreen, Computer-Setup, Arena-Layout (mobil zuerst)
- [ ] SVG-Hände für alle 5 Züge
- [ ] Countdown, Reveal, Ergebnissatz, Punkt-Pips, Matchende
- [ ] KI-Stufen 1–3
- **Abnahme:** Best of 3/5 gegen Zufall-KI vollständig spielbar, beide Varianten.

## Phase 2 – Effekte & Sound
- [ ] Aurora-Hintergrund, Glas-Karten, Übergänge zwischen Screens
- [ ] Canvas-Partikel (Konfetti, Funken, Regen), Screen-Shake
- [ ] Web-Audio-Sounds, Ton-Schalter
- [ ] `prefers-reduced-motion` + Schalter „Effekte reduzieren“
- **Abnahme:** 60 fps auf Mittelklasse-Handy, keine Ruckler beim Reveal.

## Phase 3 – Lernende KI & Statistik
- [ ] Gedankenleser-KI (Ensemble), Historie in localStorage, „Was denkt der Computer?“-Anzeige
- [ ] Fairness-Hash beim Computerzug
- [ ] Statistik-Screen, Zurücksetzen
- **Abnahme:** Gegen ein festes Muster (z. B. Stein, Papier, Schere im Kreis) gewinnt die KI nach < 15 Runden fast immer. Test dafür in `tests/`.

## Phase 4 – Online-Duell
- [ ] `api.php` + `src/` (SQLite, create/join/state/commit/reveal/rematch/react/claim/leave)
- [ ] Commit-Reveal inkl. Frist, Hash-Prüfung im Client
- [ ] Lobby mit Link, Kopieren, Teilen, QR-Code
- [ ] Polling mit Backoff, Online-Anzeige, Revanche + Serie
- [ ] Emoji-Reaktionen
- [ ] Auto-Löschen nach 24 h
- **Abnahme:** Zwei Browser spielen 3 Matches mit Revanche; Reload mitten im Match behält den Platz; Gegner kann über DevTools den Zug nicht vor dem eigenen Reveal sehen.

## Phase 5 – Turnier
- [ ] Turnierraum, Lobby mit Spielerliste, Host-Start
- [ ] K.-o.-Baum mit Freilosen, parallele Matches, Zuschauer-Ansicht
- [ ] Siegerehrung, neues Turnier
- **Abnahme:** Turnier mit 5 Browserfenstern läuft bis zum Sieger durch.

## Phase 6 – Feinschliff & Livegang
- [ ] Barrierefreiheit (Tastatur, Fokus, ARIA-Live für Ergebnisse, Kontrast)
- [ ] Favicon, Manifest (optional PWA ohne Service-Worker-Tracking)
- [ ] Deployment nach [DEPLOYMENT.md](DEPLOYMENT.md), Checkliste abhaken
