# Entscheidungen

Format: Datum – Entscheidung – Begründung. Neue Einträge unten anhängen.

### 2026-11-24 – Hochwertiges 2D statt Three.js-3D
**Entscheidung:** SVG-Hände + CSS/Web-Animations + Canvas-Partikel, keine Grafik-Bibliothek.
**Begründung:** Keine externen Abhängigkeiten nötig (Datenschutz, kein CDN), kleine Ladegröße,
läuft flüssig auf schwachen Handys, alles ohne Build-Schritt wartbar. Ein Three.js-Modus mit
3D-Händen bräuchte gute Handmodelle und ~600 KB JS. Kann später als optionaler Modus
nachgerüstet werden (Three.js dann selbst gehostet in `assets/vendor/`).
*Basti kann das jederzeit umentscheiden.*

### 2026-11-24 – PHP + SQLite + Polling
**Begründung:** Netcup Webhosting bietet PHP, aber kein Node und keine dauerhaften WebSockets.
SQLite braucht keine Einrichtung einer MySQL-Datenbank und ist für einige gleichzeitige Räume
schnell genug. Raumzustand als ein JSON-Blob pro Raum + `BEGIN IMMEDIATE` hält die Logik einfach.

### 2026-11-24 – Kein Build-Schritt, Vanilla JS mit ES-Modulen
**Begründung:** Upload per FTP soll genügen. Moderne Browser können ES-Module nativ.

### 2026-11-24 – Commit-Reveal trotz vertrauenswürdigem Server
**Begründung:** Gewünscht als sichtbares Fairness-Feature. Schützt außerdem davor, dass der
Zug in Polling-Antworten oder DevTools auftaucht, bevor der Gegner gewählt hat.

### 2026-11-24 – Token in sessionStorage, keine Cookies
**Begründung:** Keine Cookies gewünscht. sessionStorage überlebt Reload, ist aber pro Tab.

### 2026-11-24 – Sounds synthetisiert statt Audiodateien
**Begründung:** Keine Lizenzfragen, keine Downloads, frei klanglich anpassbar.

### 2026-11-24 – Turnier als K.-o.-System
**Begründung:** Spannender als Jeder-gegen-jeden, kurze Dauer, gut als Baum darstellbar.

### 2026-11-24 – Docker für Entwicklung und Tests, gitleaks von Anfang an
**Entscheidung:** Lokale Umgebung per `docker compose` (Apache 2.4 + PHP 8.1 mit aktiver
`.htaccess`, CLI-Container für Tests, gitleaks-Container). Pre-Commit-Hook scannt jeden Commit
mit gitleaks, lintet PHP auf 8.1 und führt die JS-Tests aus.
**Begründung:** Wunsch von Basti. Reproduzierbar auf jedem Rechner, testet gegen die
Produktions-Mindestversion statt gegen die zufällig installierte PHP-Version und prüft CSP,
Header und Zugriffssperren schon lokal. Produktion bleibt unverändert: `public/` per FTP.

### 2026-11-24 – Beide decken nicht auf → Runde wird wiederholt
**Entscheidung:** Läuft die 20-s-Frist ab, ohne dass einer der beiden aufgedeckt hat, zählt die
Runde nicht (`w: -1, f: true`). Deckt nur einer nicht auf, verliert er die Runde.
**Begründung:** Ein gemeinsamer Verbindungsabbruch soll niemanden bestrafen. Wer dauerhaft weg
ist, wird über `claim` (Gegner > 45 s offline) erledigt.

### 2026-11-24 – Turnier: Sieger rücken sofort nach
**Entscheidung:** Ein Turniermatch startet, sobald seine beiden Vorgänger entschieden sind –
nicht erst, wenn die ganze Runde fertig ist. Der komplette Baum (`bracket`) steht ab Start fest.
Gegangene verlieren automatisch, Zuschauer werden beim nächsten Turnier Teilnehmer.
**Begründung:** Weniger Wartezeit für schnelle Spieler, und das Frontend kann den Baum von
Anfang an vollständig zeichnen.

### 2026-11-24 – Sicherheits-Review: Maßnahmen
**Entscheidung:** Nach einem unabhängigen Security-Review (keine kritischen/hohen Befunde):
- Raumlimit gegen DoS gehärtet: verwaiste Lobbys werden nach 60 min gelöscht; bei vollem Limit
  verdrängt `create` zuerst inaktive Lobbys (≥ 10 min), Zählen + Einfügen in einer Transaktion.
- Kein synchrones `VACUUM` mehr, stattdessen `auto_vacuum = INCREMENTAL` + `incremental_vacuum`;
  `history` pro Match auf 50 Einträge begrenzt (älteste Unentschieden werden verdichtet).
- Wahl-Frist 60 s, sobald der Gegner gewählt hat (gegen Blockieren durch Nicht-Wählen).
- Namen: unsichtbare Füllzeichen (Hangul-Filler, Braille-Leerzeichen u. a.) raus, alle Leerraumarten
  → ein Leerzeichen, ZWJ nur zwischen Emoji, NFC falls `intl` vorhanden.
- Räume werden **24 h nach Erstellung** hart gelöscht (nicht erst 24 h nach letzter Änderung),
  `secure_delete = ON`.
- Raumcodes bleiben 6 Zeichen.
**Begründung:** Kurze Links sind ein Kernfeature. Enumeration ist durch die kurze Lebensdauer von
Lobbys entschärft, und das Token schützt die Plätze – ein erratener Code erlaubt nur Beitritt/Zuschauen.

### 2026-11-24 – Barrierefreiheit: Regeln für UI-Code
**Entscheidung:**
- Fokus wird als `outline` (3 px Gold, Versatz 3 px) gezeigt, nicht als `box-shadow` – eigene Schatten
  (Primär-Button, gewählte Option, Karten) haben den Ring sonst unsichtbar überschrieben.
- Screenreader-Ansagen über **eine** Live-Region (`announce`): Rundenergebnis, Matchende, Start einer Frist,
  Gegner hat gewählt/offline/verlassen, Beitritte in der Lobby, Turnier-Rolle und -Sieger. Kein Countdown,
  kein Sekunden-Ticker, keine `role=status`-Container, die beim Polling neu gebaut werden.
- In-Page-Anker (Skip-Link `#app`) sind keine Route: `main.js` fängt den Skip-Link ab und behält bei
  `#id` eines vorhandenen Elements den laufenden Screen.
- Touch-Ziele mindestens 44 × 44 px (`--tap-min`); `aria-label` nur auf Elementen mit passender Rolle,
  sonst sichtbaren Text plus `.visually-hidden`.
- axe-core wird **nicht** ins Repo aufgenommen; `tests/e2e/a11y.test.mjs` injiziert es per `AXE_PATH`.
**Begründung:** WCAG 2.1 AA ohne neue Abhängigkeiten in `public/`; Ansagen informativ, aber nicht geschwätzig.

### 2026-11-24 – Automatisches Deployment per GitHub Actions und SSH
**Entscheidung:** Statt FTP-Upload von Hand rollt `.github/workflows/deploy.yml` jeden grünen Push auf `main`
aus: Paket mit `scripts/dist.sh`, `tar` über SSH nach `releases/<Zeitstempel>`, `current` als Document Root
atomar umstellen, Datenbank in `shared/data`. Gleiche Secret-Namen und gleiches Environment (`WebHosting`)
wie bei Wunschstern. Der FTP-Weg bleibt als Rückfall dokumentiert.
**Begründung:** Ein Verfahren für beide Projekte auf demselben netcup-Webspace; atomare Releases mit Rückrollen,
alte Dateien bleiben nicht liegen, die Datenbank übersteht jedes Deployment. Auf dem Server braucht es weiterhin
nur PHP + SQLite (bash/tar nutzt nur die SSH-Sitzung beim Ausrollen).

### 2026-11-24 – Screens nachladen, Start-Graph per modulepreload
**Entscheidung:** `main.js` importiert nur die Startseite statisch; alle anderen Screens kommen per
`import()` und werden nach dem ersten Rendern im Leerlauf vorgeladen. `index.html` lädt genau den
statischen Start-Graphen per `modulepreload` (Test: `tests/js/preload.test.js`).
**Begründung:** Gemessen (375×812, DPR 3, CPU 4×, 150 ms RTT, 1,6 Mbit/s): Startseite sichtbar nach
1,2 s statt 2,1 s, 20 statt 41 Requests bis dahin. Kein Build-Schritt nötig.
