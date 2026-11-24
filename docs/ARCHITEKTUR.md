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

## Ordnerstruktur (Ziel)

```
rps/
├── AGENTS.md, CLAUDE.md, README.md
├── docs/                       Konzept & Doku
├── public/                     ← das ist der Webroot (Inhalt per FTP hochladen)
│   ├── index.html
│   ├── api.php                 einziger Server-Einstiegspunkt
│   ├── .htaccess               Sicherheitsheader, Zugriffsschutz
│   ├── assets/
│   │   ├── css/app.css
│   │   ├── fonts/              selbst gehostete Fonts (OFL), woff2
│   │   └── js/
│   │       ├── main.js         Start, Routing (#hash), Screen-Wechsel
│   │       ├── rules.js        Züge, Varianten, Wer-schlägt-wen, Verben
│   │       ├── ai.js           Computer-Stufen
│   │       ├── net.js          API-Client + Polling
│   │       ├── crypto.js       SHA-256 (crypto.subtle + Fallback), Nonce
│   │       ├── arena.js        Runden-Animation, Countdown, Reveal
│   │       ├── hands.js        SVG-Hände
│   │       ├── fx.js           Canvas-Partikel, Screen-Shake
│   │       ├── audio.js        Web-Audio-Synth
│   │       ├── stats.js        localStorage-Statistik
│   │       ├── qr.js           QR-Code-Generator (eigener Code)
│   │       └── ui/…            Screens (home, lobby, bracket, stats, …)
│   ├── src/                    PHP-Logik (per .htaccess gesperrt)
│   │   ├── .htaccess           "Require all denied"
│   │   ├── db.php              PDO/SQLite, Schema, Transaktionen, Cleanup
│   │   ├── room.php            Räume, Spieler, Turnierbaum
│   │   ├── match.php           Commit-Reveal, Runden, Wertung
│   │   └── rules.php           Spiegel von rules.js
│   └── data/                   SQLite-Datei (per .htaccess gesperrt)
│       └── .htaccess
└── tests/                      PHP- und JS-Tests (werden nicht hochgeladen)
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

### Raum-JSON

```jsonc
{
  "type": "duel" | "tournament",
  "variant": "classic" | "lizard",
  "bestOf": 3 | 5,
  "host": "p_ab12",                       // öffentliche Spieler-ID
  "players": {
    "p_ab12": { "name": "Anna", "tokenHash": "…", "joined": 1764000000, "seen": 1764000123 }
  },
  "order": ["p_ab12", "p_cd34"],          // Beitrittsreihenfolge
  "matches": { "m1": { /* Match */ } },
  "current": "m1",                        // Duell: aktuelles Match
  "series": { "p_ab12": 2, "p_cd34": 1 },// Duell: Siege über Revanchen
  "rematch": ["p_ab12"],                  // wer Revanche will
  "bracket": [["m1","m2"],["m3"]],        // Turnier: Runden → Match-IDs
  "status": "lobby" | "running" | "finished",
  "champion": null,
  "reactions": [ { "id": 17, "from": "p_ab12", "emoji": "🔥", "t": 1764000100 } ] // letzte 30
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
  "history": [ { "m": ["rock","scissors"], "w": 0 } ],  // w: 0/1 = Sieger, -1 = unentschieden, Forfeit mit "f": true
  "winner": null                       // 0 | 1
}
```

### Spieler-Identität ohne Login

- Beim Erstellen/Beitreten erzeugt der Server eine öffentliche ID (`p_xxxx`) und ein geheimes
  **Token** (32 Byte, hex). Gespeichert wird nur `hash('sha256', token)`.
- Der Client legt das Token in `sessionStorage` unter `rps.token.<raumcode>` ab
  (Reload behält den Platz, neuer Tab = neuer Spieler). Keine Cookies.
- Jede Aktion schickt `{code, token}`; der Server prüft per `hash_equals`.

## API

Ein Endpunkt: `POST /api.php`, Body JSON, Antwort JSON. Fehler: HTTP 4xx + `{"error":"text"}` (deutscher Text, direkt anzeigbar).

| `action` | Parameter | Wirkung |
|---|---|---|
| `create` | `type, name, variant, bestOf` | Neuer Raum, Ersteller = Host. → `{code, token, me}` |
| `join` | `code, name` | Raum beitreten (Duell max. 2, Turnier max. 16; im laufenden Turnier → Zuschauer). → `{token, me}` |
| `state` | `code, token, since?` | Aktualisiert `seen`, wertet Fristen aus, liefert Sicht des Spielers. Bei `since == version` nur `{version, unchanged:true, online:{…}}` |
| `commit` | `code, token, hash` | Verdeckter Zug für laufende Runde des eigenen Matches |
| `reveal` | `code, token, move, nonce` | Aufdecken; Server prüft `sha256(move + ":" + nonce) == commit` |
| `rematch` | `code, token` | Duell: Revanche-Wunsch; wenn beide → neues Match |
| `start` | `code, token` | Turnier: nur Host, ab 3 Spielern; auch für „neues Turnier“ |
| `react` | `code, token, emoji` | Emoji aus fester Liste, max. 1 pro Sekunde pro Spieler |
| `claim` | `code, token` | Sieg beanspruchen, wenn Gegner > 45 s offline |
| `leave` | `code, token` | Raum verlassen (Duell: Gegner gewinnt laufendes Match) |

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
