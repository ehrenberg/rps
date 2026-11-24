# Architektur

## Überblick

```
Browser (Vanilla JS, ES-Module)                Netcup (Apache + PHP 8.x)
┌──────────────────────────────┐   fetch POST   ┌───────────────────────────┐
│ UI / Animation / Sound       │ ─────────────► │ public/api.php            │
│ Computer-KI (lokal)          │  JSON, ~1 s    │  └─ src/*.php (Logik)     │
│ Statistik (localStorage)     │ ◄───────────── │ data/rps.sqlite (PDO)     │
└──────────────────────────────┘    Polling     └───────────────────────────┘
```

- Gegen den Computer läuft **alles im Browser**, der Server wird nicht gebraucht.
- Online-Duell und Turnier: der Server hält den Raumzustand, Clients pollen.

## Ordnerstruktur

```
rps/
├── AGENTS.md, CLAUDE.md, README.md
├── docs/                       Konzept & Doku
├── public/                     ← das ist der Webroot (Inhalt per FTP hochladen)
│   ├── index.html
│   ├── api.php                 einziger Server-Einstiegspunkt
│   ├── .htaccess               Sicherheitsheader, Zugriffsschutz
│   ├── assets/
│   │   ├── css/app.css         Design-Tokens, Layout, Screens
│   │   ├── css/fx.css          Hände, Effekt-Keyframes, Emoji-Float
│   │   ├── fonts/              selbst gehostete Fonts (OFL), woff2
│   │   ├── img/                Favicon/App-Icons (SVG)
│   │   └── js/
│   │       ├── main.js         Start, Routing, Screen-Wechsel, globale Einstellungen
│   │       ├── router.js       Hash-Routen parsen/erzeugen (DOM-frei)
│   │       ├── settings.js     lokale Einstellungen, Name, Computer-Setup (DOM-frei)
│   │       ├── rules.js        Züge, Varianten, Wer-schlägt-wen, Verben
│   │       ├── match.js        Match-Zustand: Runden, Punkte, Ende (DOM-frei, unveränderlich)
│   │       ├── arena.js        Arena-Controller: Ablauf einer Runde, Adapter-Vertrag
│   │       ├── cpu-opponent.js Adapter: Computer-Gegner (Commit vor Spielerwahl)
│   │       ├── online-opponent.js Adapter: Online-Gegner (Commit-Reveal über API)
│   │       ├── ai.js           Computer-Stufen
│   │       ├── net.js          API-Client + Polling
│   │       ├── crypto.js       SHA-256 (crypto.subtle + Fallback), Nonce
│   │       ├── hands.js        SVG-Hände
│   │       ├── fx.js           Canvas-Partikel, Screen-Shake
│   │       ├── audio.js        Web-Audio-Synth
│   │       ├── stats.js        localStorage-Statistik
│   │       ├── qr.js           QR-Code-Generator (eigener Code)
│   │       └── ui/…            Screens + Komponenten (home, arena-view, lobby, bracket, stats, …)
│   ├── src/                    PHP-Logik (per .htaccess gesperrt)
│   │   ├── .htaccess           "Require all denied"
│   │   ├── handler.php         Aktionen: Eingabe → Logik → DB (ohne HTTP, testbar)
│   │   ├── db.php              PDO/SQLite, Schema, Transaktionen, Cleanup (einziger Ort mit SQL)
│   │   ├── game.php            lädt die reine Spiellogik:
│   │   ├── validate.php        RpsError, Eingabeprüfung (Name, Code, Hash, Emoji …)
│   │   ├── match.php           Commit-Reveal, Runden, Wertung, Frist
│   │   ├── room.php            Raum, Spieler, Token, Online, Reaktionen, Claim
│   │   ├── duel.php            Duell: Beitritt, Revanche, Serie, Verlassen
│   │   ├── tournament.php      Turnier: Setzung, K.-o.-Baum, Freilose, Champion
│   │   ├── view.php            Sicht des Spielers (state-Antwort)
│   │   └── rules.php           Spiegel von rules.js
│   └── data/                   SQLite-Datei (per .htaccess gesperrt)
│       └── .htaccess
├── docker/, docker-compose.yml  Entwicklungsumgebung (Apache + PHP 8.1, gitleaks)
├── .githooks/                  Pre-Commit: gitleaks, php -l, JS-Tests
└── tests/                      werden nicht hochgeladen
    ├── run.php, php/           PHP-Unit-Tests (eigener Mini-Runner)
    ├── js/                     JS-Unit-Tests (node --test)
    ├── e2e/                    Playwright-Tests gegen den Docker-Server
    ├── demo/                   Demo-Seite für Hände/Effekte/Sounds
    └── api_smoke.sh            HTTP-Smoke-Test
```

> Wenn Netcup erlaubt, `data/` außerhalb des Webroots abzulegen, ist das besser.
> Der Pfad ist in `src/db.php` per Konstante `RPS_DATA_DIR` konfigurierbar.

## Keine externen Abhängigkeiten

- Kein npm im Produktivcode, kein CDN, kein Build. Alles, was der Browser lädt, liegt in `public/`.
- Fonts: z. B. *Lilita One* (Überschriften) und *Outfit* (Text), beide SIL OFL, als woff2 in `assets/fonts/`, Lizenzdatei daneben.
- Dev-Werkzeuge (Tests, Linter) dürfen npm/composer nutzen, landen aber nie in `public/`.

## Datenmodell (Server)

Eine Tabelle, Raumzustand als JSON. Einfach, atomar, für die erwartete Last ausreichend.

```sql
CREATE TABLE rooms (
  code     TEXT PRIMARY KEY,      -- 6 Zeichen aus [23456789abcdefghjkmnpqrstuvwxyz]
  data     TEXT NOT NULL,         -- JSON, siehe unten
  version  INTEGER NOT NULL,      -- +1 bei jeder Änderung
  created  INTEGER NOT NULL,      -- Unix-Zeit
  updated  INTEGER NOT NULL
);
CREATE INDEX rooms_updated ON rooms(updated);
```

Jede schreibende Aktion: `BEGIN IMMEDIATE` → Raum laden → ändern → speichern → `COMMIT`.
`PRAGMA busy_timeout = 3000`, `journal_mode = WAL` (falls vom Hosting unterstützt, sonst DELETE).
`version` steigt nur bei inhaltlichen Änderungen; reine `seen`-Updates werden ohne neue Version gespeichert.
Datenpfad: Konstante `RPS_DATA_DIR` (vorher definierbar), sonst Umgebungsvariable `RPS_DATA_DIR`, sonst `public/data`.

### Raum-JSON

```jsonc
{
  "type": "duel" | "tournament",
  "variant": "classic" | "lizard",
  "bestOf": 3 | 5,
  "host": "p_ab12",                       // öffentliche Spieler-ID
  "players": {
    "p_ab12": { "name": "Anna", "tokenHash": "…", "joined": 1764000000, "seen": 1764000123,
                "spectator": false, "left": false, "lastReact": null }
  },
  "order": ["p_ab12", "p_cd34"],          // Beitrittsreihenfolge
  "matches": { "m1": { /* Match */ } },
  "current": "m1",                        // Duell: aktuelles Match
  "series": { "p_ab12": 2, "p_cd34": 1 },// Duell: Siege über Revanchen
  "rematch": ["p_ab12"],                  // wer Revanche will
  "bracket": [["m1","m2"],["m3"]],        // Turnier: Runden → Match-IDs
  "status": "lobby" | "running" | "finished",
  "champion": null,
  "reactions": [ { "id": 17, "from": "p_ab12", "emoji": "🔥", "t": 1764000100 } ], // letzte 30
  "nextMatch": 4,                         // Zähler für Match-IDs (laufen im Raum weiter)
  "nextReaction": 18
}
```

### Match

```jsonc
{
  "p": ["p_ab12", "p_cd34"],          // null = Freilos
  "score": [1, 0],
  "target": 2,                         // Siege nötig (bestOf 3 → 2)
  "cur": {                             // laufende Runde
    "commit": ["<sha256 hex>", null],
    "move":   [null, null],            // erst nach Reveal gefüllt
    "nonce":  [null, null],
    "lockedAt": null                   // Zeit, zu der beide committed haben
  },
  "history": [ { "m": ["rock","scissors"], "n": ["…","…"], "h": ["…","…"], "w": 0, "f": false } ],
                                       // w: 0/1 = Sieger, -1 = unentschieden (Runde wird wiederholt)
  "winner": null,                      // 0 | 1
  "end": null,                         // "score" | "forfeit" | "bye" | "claim" | "leave"
  "from": null                         // Turnier-Platzhalter: ["m1","m2"] = Sieger dieser Matches
}
```

**Fristen & Sonderfälle**
- Deckt nur einer innerhalb von 20 s auf, gewinnt er die Runde (`f: true`, fehlender Zug/Nonce `null`).
  Decken **beide** nicht auf, wird die Runde ohne Punkt neu gestartet (`w: -1`, `f: true`) –
  so verliert niemand durch einen gemeinsamen Verbindungsabbruch; Dauer-Abwesenheit löst `claim`.
  Endet ein Match durch eine Forfeit-Runde, ist `end = "forfeit"`.
- Duell: `status` bleibt `running` zwischen Matches (Revanche); `finished`, sobald jemand geht.
  Alte Duell-Matches werden auf die letzten 5 gekürzt.
- Turnier: Der ganze Baum entsteht beim Start (spätere Runden als Platzhalter mit `from`).
  Sieger rücken **sofort** nach, d. h. ein Match der nächsten Runde startet, sobald beide
  Vorgänger fertig sind – nicht erst, wenn die ganze Runde durch ist.
  Gegangene verlieren laufende und künftige Matches (`end = "leave"`); bleibt ein Platz leer
  (Vorgänger ohne Sieger), bekommt der andere ein Freilos.
  In der Lobby wird ein gehender Spieler ganz entfernt. Neues Turnier (`start` bei `finished`):
  Gegangene fliegen raus, Zuschauer werden Teilnehmer (max. 16, Beitrittsreihenfolge).

### Spieler-Identität ohne Login

- Beim Erstellen/Beitreten erzeugt der Server eine öffentliche ID (`p_xxxx`) und ein geheimes
  **Token** (32 Byte, hex). Gespeichert wird nur `hash('sha256', token)`.
- Der Client legt das Token in `sessionStorage` unter `rps.token.<raumcode>` ab
  (Reload behält den Platz, neuer Tab = neuer Spieler). Keine Cookies.
- Jede Aktion schickt `{code, token}`; der Server prüft per `hash_equals`.

## API

Ein Endpunkt: `POST /api.php`, Body JSON (max. 4 KB), Antwort JSON (`Cache-Control: no-store`).
Fehler: HTTP-Status + `{"error":"text"}` (deutscher Text, direkt anzeigbar).

| `action` | Parameter | Wirkung |
|---|---|---|
| `create` | `type, name, variant?, bestOf?` | Neuer Raum, Ersteller = Host (Default `classic`, 3). → `{code, token, me}` |
| `join` | `code, name` | Raum beitreten (Duell max. 2, Turnier max. 16 Teilnehmer; im laufenden/beendeten oder vollen Turnier → Zuschauer, insgesamt max. 32). → `{token, me, spectator}` |
| `state` | `code, token, since?` | Wertet Fristen aus, aktualisiert `seen` (nur wenn > 5 s alt, ohne `version` zu erhöhen), liefert Sicht des Spielers. Bei `since == version` nur `{version, unchanged:true, now, online:{…}}` |
| `commit` | `code, token, hash` | Verdeckter Zug für laufende Runde des eigenen Matches → `{ok, version}` |
| `reveal` | `code, token, move, nonce` | Aufdecken; Server prüft `sha256(move + ":" + nonce) == commit` → `{ok, version}` |
| `rematch` | `code, token` | Duell: Revanche-Wunsch; wenn beide → neues Match → `{ok, version}` |
| `start` | `code, token` | Turnier: nur Host, ab 3 Spielern; auch für „neues Turnier“ → `{ok, version}` |
| `react` | `code, token, emoji` | Emoji aus `👍 😂 😱 🔥 😭 🤝 👏 😈`, max. 1 pro Sekunde pro Spieler (auch Zuschauer) → `{ok, version}` |
| `claim` | `code, token` | Sieg im eigenen Match beanspruchen, wenn Gegner > 45 s nicht gesehen → `{ok, version}` |
| `leave` | `code, token` | Raum verlassen (laufendes Match verloren; Host-Rolle wandert weiter) → `{ok, version}` |

Statuscodes: `400` ungültige Eingabe, `403` Token unbekannt / nicht Host, `404` Raum fehlt,
`405` nicht POST, `409` passt gerade nicht zum Spielstand, `413` Body zu groß, `429` zu schnell,
`500` interner Fehler, `503` DB ausgelastet / zu viele Räume.

### Sicht des Spielers (`state`)

Der Server schickt **nie** einen Zug, bevor beide aufgedeckt haben. Für die laufende Runde
nur: `committed: [bool,bool]`, `revealed: [bool,bool]` und die Commit-Hashes. Abgeschlossene
Runden kommen mit Zügen und Nonces in `history`, damit der Client die Hashes nachprüfen kann.

## Commit-Reveal

```
Client A                          Server                         Client B
 wählt "rock"
 nonce = 16 Zufallsbytes (hex)
 h = sha256("rock:" + nonce)
 ── commit(h) ──────────────────► speichert h
                                  ◄──────────────── commit(h') ── wählt …
                         beide committed → lockedAt = now
 ◄── state: locked ───────────────────────────── state: locked ──►
 ── reveal("rock", nonce) ──────► prüft Hash
                                  ◄───────── reveal("paper", n') ─
                         beide aufgedeckt → Wertung, history, nächste Runde
```

- Clients decken automatisch auf, sobald sie `locked` sehen; parallel läuft der Countdown, das Ergebnis wird erst am Ende des Countdowns gezeigt.
- **Frist:** Deckt jemand 20 s nach `lockedAt` nicht auf, verliert er die Runde (`f: true`). Fristen werden bei jedem Request lazy ausgewertet (kein Cron nötig).
- Clients prüfen zusätzlich selbst die Hashes des Gegners aus `history` und zeigen ein Schloss-Symbol „fair ✓“.
- `crypto.subtle` braucht HTTPS bzw. localhost; `crypto.js` hat einen reinen JS-SHA-256-Fallback.

## Polling

- Intervall 1 s während Match/Lobby, 3 s wenn Tab versteckt (`visibilitychange`), 5 s auf Matchende-Screen.
- `since=version` spart Rendern; `online`-Status wird trotzdem mitgeliefert (`seen` < 15 s = online).
- `seen` wird nur geschrieben, wenn älter als 5 s (weniger Schreibzugriffe).
- Bei Netzwerkfehlern: Backoff bis 10 s, Hinweis „Verbindung wird wiederhergestellt …“.

## Aufräumen (24 h)

- Bei jedem `create` und zusätzlich mit 5 % Wahrscheinlichkeit bei anderen Requests:
  `DELETE FROM rooms WHERE updated < now - 86400`.
- Gelegentlich `VACUUM` (z. B. 1 % bei `create`).
- Obergrenze 5 000 Räume; darüber lehnt `create` freundlich ab.

## Computer-KI (`ai.js`)

Gemeinsame Schnittstelle:

```js
createAI(level, variant) → { pick(history) → move, observe(myMove, theirMove), explain() → string|null }
```

- **Zufall:** `crypto.getRandomValues`.
- **Gewohnheitstier:** 60 % „Gewinner bleibt, Verlierer wechselt zum Konter“, sonst Zufall.
- **Taktiker:** Kontert häufigsten Zug der letzten 10 Runden; erkennt einfache Muster (immer gleich, Kreis-Rotation).
- **Gedankenleser:** Ensemble von Prädiktoren, jeder sagt deinen nächsten Zug vorher:
  Häufigkeit (gesamt/letzte 10), Markov 1. und 2. Ordnung, Markov auf (dein Zug, mein Zug),
  Win-Stay/Lose-Shift. Jeder Prädiktor wird zusätzlich in 3 Meta-Varianten bewertet
  (direkt kontern, Gegner kontert mich, doppelt um die Ecke). Punkte mit Verfall (0,9);
  der beste wird gespielt, mit 10 % Zufall. Historie (max. 300 Züge) in `localStorage`
  `rps.ai.history.v1`, getrennt nach Variante.
- Bei 5 Zügen (Echse/Spock) „kontern“ = einer der Züge, die den vorhergesagten schlagen.

## Statistik (`localStorage`)

```jsonc
// rps.stats.v1
{
  "games":  { "cpu-1": {"w":0,"l":0,"d":0}, "cpu-4": {…}, "duel": {…}, "tournament": {"played":0,"won":0} },
  "rounds": { "w":0, "l":0, "d":0 },
  "moves":  { "rock":0, "paper":0, "scissors":0, "lizard":0, "spock":0 },
  "streak": { "current":0, "best":0 },
  "since": "2026-11-24"
}
```

Weitere lokale Schlüssel: `rps.name`, `rps.sound`, `rps.reducedFx`, `rps.ai.history.v1`.

## Sicherheit

- Eingaben validieren: Name 1–20 Zeichen (Unicode, getrimmt, Steuerzeichen raus), Emoji nur aus Liste, `move` nur aus Variante, `hash` = 64 hex, `nonce` = 32 hex.
- Ausgabe im Client immer per `textContent`, nie `innerHTML` mit Nutzertext.
- `.htaccess`: `Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Permissions-Policy` restriktiv.
- `src/` und `data/` per `.htaccess` gesperrt (`Require all denied`), zusätzlich leere `index.html`.
- Raumcodes per `random_int`, Tokens per `random_bytes`.
- Keine IP-Adressen speichern. PHP-Fehler nicht ausgeben (`display_errors=0`).
