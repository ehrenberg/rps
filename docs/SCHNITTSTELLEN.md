# Schnittstellen (Verträge zwischen den Modulen)

Verbindliche Signaturen, damit Module unabhängig voneinander entstehen können.
Ergänzt [ARCHITEKTUR.md](ARCHITEKTUR.md). Wer eine Signatur ändert, passt dieses Dokument an.

## Frontend-Module (`public/assets/js/`)

### `rules.js` ✅
`MOVES, VARIANTS, VARIANT_NAMES, MOVE_NAMES, BEST_OF, movesFor(variant), isValidVariant(v),
isValidMove(variant, move), beats(a,b), outcome(a,b) → 1|0|-1, verb(w,l), resultSentence(a,b),
countersOf(move, variant), targetWins(bestOf)`

### `crypto.js` ✅
`randomHex(n=16) → string`, `randomInt(n) → int`, `sha256Hex(str) → Promise<hex>`,
`commitHash(move, nonce) → Promise<hex>` (= sha256(`move:nonce`)), `verifyCommit(hash, move, nonce) → Promise<bool>`

### `hands.js` ✅
```js
// Große Hand für die Arena. side 'left' = Spieler (zeigt nach rechts), 'right' = Gegner (gespiegelt).
createHand({ side }) → {
  el,                                   // div.hand > svg, data-move / data-state gesetzt
  setMove(move | 'fist', { pop = true } = {}),
  shake(beats = 3, beatMs = 500, { onBeat } = {}) → Promise,
      // Faust hebt sich, Aufschläge bei beatMs, 2·beatMs, 3·beatMs → onBeat(i);
      // Promise resolved beim letzten Aufschlag (= Reveal). Countdown/Sound über onBeat takten!
  setState('idle' | 'win' | 'lose' | 'draw'),
  enter(),                              // Hand gleitet von der Seite herein
}
handIcon(move) → SVGElement             // quadratische viewBox, Manschette in --icon-accent
```
- Handformen als Daten (`HAND_SHAPES`), DOM ohne `innerHTML`, Gradient-IDs pro Instanz eindeutig.
- CSS-Variablen (alle mit Fallback): `--hand-skin`, `--hand-skin-shade`, `--hand-outline`,
  `--accent-left`, `--accent-right`, `--icon-accent`, `--hand-glow`, `--fx-hand-shadow`.
- Respektiert `html[data-reduced-fx="1"]` und `prefers-reduced-motion` (Timing bleibt gleich).

### `fx.js` ✅
```js
initFx(canvas)                          // Vollbild-Canvas .fx-canvas, DPR-korrekt, rAF nur bei aktiven Partikeln
confetti({ x?, y?, count? })
sparks(x, y, { color? })
rain({ duration = 2500, x?, y?, width? })
burst(x, y, { color? })
screenShake(el, intensity = 1)          // Arena-Element übergeben, nicht body
floatEmoji(emoji, { x?, y? })           // DOM, textContent
setReducedFx(bool)                      // setzt auch html[data-reduced-fx]
clear()                                 // alle Effekte sofort beenden (bei Screenwechsel)
```
Partikeltypen mit gemeinsamer Schnittstelle `{ blend, update, draw }`, Pool max. 700,
framerate-unabhängige Physik. Styles in `assets/css/fx.css`.
**Performance:** `backdrop-filter` auf großen Flächen halbiert die FPS bei Partikeln – vermeiden.

### `audio.js` ✅
```js
unlock(), setEnabled(bool), isEnabled(), play(name), SOUND_NAMES
// 'click','tick','shake','clash','win','lose','draw','matchWin','matchLose','pop','join','countdown'
```
Rezepte als Tabelle (`SOUND_RECIPES`), AudioContext lazy, automatisches Entsperren bei erster
Nutzeraktion, gleicher Sound max. alle 30 ms, wirft nie.

### `qr.js` ✅
```js
qrMatrix(text, { ecc = 'M', mask? } = {}) → boolean[][]   // Byte-Modus UTF-8, Version 1–10
qrSvg(text, { ecc = 'M', margin = 4 } = {}) → SVGElement  // currentColor auf Weiß → dunkle Textfarbe nötig
```
Zu langer Text wirft „Text ist zu lang für einen QR-Code.“ Echte Dekodierbarkeit per zbarimg getestet.

### `ai.js` ✅
```js
createAI(level /*1..4*/, variant, { storage = localStorage, random } = {}) → {
  level, name, pick() → move, observe(aiMove, playerMove), explain() → string | null,
}
AI_LEVELS, HISTORY_KEY ('rps.ai.history.v1'), HISTORY_MAX (300), loadHistory(storage, variant)
```
- `random`: injizierbar für deterministische Tests. `storage: null` erlaubt.
- Nur Stufe 4 liest/schreibt die Historie. `explain()` bei Stufe 4 nie null („Ich beobachte dich noch …“).
- Stufe 4: Ensemble (Häufigkeit gesamt/10, Markov 1./2. Ordnung, Paar-Markov, Win-Stay/Lose-Shift,
  Reaktion auf KI-Zug) × 3 Meta-Varianten, Punkte mit Verfall 0,9, 10 % Zufall.

### `stats.js` ✅
```js
loadStats(), recordRound({ result, move }), recordMatch({ mode, result }),
recordTournament({ won }), resetStats()            // record*/reset geben neue Stats zurück
summary(stats) → { favoriteMove, totalGames, winRate, entropy, predictability,
                   totalRounds, roundWinRate, bestStreak, currentStreak }
setStorage(storage?), STATS_KEY, emptyStats, normalizeStats, normalizedEntropy,
predictabilityText, MATCH_MODES, TOURNAMENT_MODE
```
`games.tournament` = `{ played, won, w, l }`. Unter 10 Zügen: „Noch zu wenig Daten“.

### `net.js`
```js
api(action, params) → Promise<object>   // POST api.php; wirft ApiError(message, status) mit deutschem Text
createPoller({ code, token, onState, onError, onOnline }) → { start(), stop(), poke(), setMode('match'|'idle'|'end') }
```

### `storage` (Schlüssel)
`rps.name`, `rps.sound`, `rps.reducedFx`, `rps.stats.v1`, `rps.ai.history.v1`,
`rps.token.<code>` + `rps.me.<code>` (sessionStorage).

## Arena-Controller

Trennung: **Gegner-Adapter** (Spiellogik, DOM-frei) → **Controller** `arena.js` (Ablauf, Statistik,
Fairness-Prüfung, DOM-frei) → **Ansicht** `ui/arena-view.js` (DOM, Animation, Sound, Partikel).
Computer jetzt (`cpu-opponent.js`), Online später: nur ein neuer Adapter, Controller und Ansicht bleiben.

```js
// arena.js
createArenaController({ adapter, view, stats?, verify? = verifyCommit }) → {
  phase,                      // 'waiting' | 'choosing' | 'submitted' | 'playing' | 'over'
  start(), choose(move) → bool, rematch() → bool, react(emoji), dispose(),
  onPhase(fn) → unsubscribe, idle() → Promise   // idle: alle bisherigen Ereignisse abgearbeitet
}
moveForKey(key, variant) → move | null           // '1'…'5' bzw. s/p/c/e/k (Stein/Papier/sChere/Echse/spocK)
MOVE_LETTERS, PHASE

// Gegner-Adapter (OpponentAdapter)
{
  info: { kind: 'cpu'|'online', statsMode /* 'cpu-1'…'cpu-4'|'duel'|'tournament' */, variant, bestOf,
          features: { status, reactions, commitBadge, insight } },
  start(handler),            // handler(type, payload) – Ereignisse siehe unten
  submitMove(move) → Promise,// eigener Zug (online: commitHash + Nonce senden)
  rematch(),                 // Nochmal / Revanche anfragen
  sendReaction(emoji),       // nur wenn features.reactions
  dispose(),                 // Timer/Polling stoppen
}
```

Ereignisse Adapter → Controller (in Reihenfolge abgearbeitet; jede Animation läuft zu Ende,
bevor das nächste Ereignis drankommt – „sofort“ = ohne Warteschlange):

| Ereignis | Payload | Wirkung |
|---|---|---|
| `matchStart` | `{ variant, bestOf, target, oppName, oppDetail?, series? }` | Arena aufbauen, Pips leeren |
| `opponentStatus` (sofort) | `{ state: 'choosing'\|'ready'\|'offline'\|'left' }` | „wählt …“ / „bereit ✓“ (nur wenn `features.status`) |
| `roundOpen` | `{ round, commit: hex\|null }` | Zug-Buttons frei, Commit-Badge „🔒 a3f9…“ |
| `roundLocked` | `{}` | beide haben gewählt → Countdown (3 Aufschläge à 500 ms) |
| `roundResolved` | `{ number, myMove, oppMove, outcome: 1\|0\|-1, result: 'w'\|'d'\|'l', sentence, score: [ich, Gegner], proof: {hash, move, nonce}\|null, forfeit? }` | Aufdecken, Pips, Verlauf, `stats.recordRound`, `verifyCommit` → „fair ✓“ |
| `insight` | `{ text }` | „Was denkt der Computer?“ (nur `features.insight`) |
| `matchOver` | `{ winner: 'me'\|'opp', score, reason }` | `stats.recordMatch({ mode: info.statsMode })`, Matchende-Overlay |
| `reaction` (sofort) | `{ emoji, fromMe }` | Emoji schwebt hoch |
| `error` (sofort) | `{ message, fatal? }` | deutscher Fehlertext in der Arena |

Online-Adapter (Phase 4): `roundResolved` darf schon während des Countdowns kommen (wartet in der
Warteschlange); `proof` = Gegner-Zug/Nonce/Hash aus `history`, damit der Controller nachprüft.

### Weitere DOM-freie Module
- `match.js`: `createMatch({ variant, bestOf })`, `playRound(match, myMove, oppMove) → { match, round }`,
  `isOver(match)`, `nextRoundNumber(match)`, `ME`, `OPP`, `RESULT_CODE` – unveränderlicher Zustand.
- `cpu-opponent.js`: `createCpuOpponent({ level, variant, bestOf }, { createAI?, storage? })` → Adapter.
  Legt `ai.pick()` + `commitHash(move, randomHex())` **vor** der Spielerwahl fest.
- `router.js`: `parseHash(hash) → { name, params }`, `hrefFor(name, params)`, `ROUTES`, `ROOM_CODE_RE`.
  Routen: `#/` home, `#/cpu`, `#/play`, `#/stats`, `#/settings`, `#/duel`, `#/tournament`, `#k7f3qa` room.
- `settings.js`: `createSettings(storage)` → `get/setName`, `get/setReducedFx`, `get/setInsight`,
  `get/setCpuSetup`; `sanitizeName`, `normalizeCpuSetup`, `safeStorage`. Schlüssel: `rps.name`,
  `rps.reducedFx`, `rps.insight`, `rps.cpuSetup.v1`.

### Screens (`ui/`)
Jeder Screen exportiert `title` und `render(ctx) → { el, focus?, dispose? }`;
`ctx = { settings, prefs, announce, navigate, params }`. `main.js` wechselt per View Transition
und fokussiert danach die `h1`.

## Server-API: Antwort von `state`

```jsonc
{
  "version": 12, "now": 1764000123,          // Serverzeit (Unix-Sekunden)
  "code": "k7f3qa", "type": "duel" | "tournament",
  "variant": "classic" | "lizard", "bestOf": 3 | 5,
  "status": "lobby" | "running" | "finished",
  "me": "p_ab12", "host": "p_ab12",
  "players": [ { "id": "p_ab12", "name": "Anna", "online": true, "spectator": false, "left": false } ],
  "matches": { "m1": MatchView },
  "current": "m1",                          // Duell: aktuelles Match; Turnier: null
  "myMatch": "m3" | null,                   // Match, in dem ich gerade spiele/spielen muss
  "series": { "p_ab12": 2, "p_cd34": 1 },  // Duell
  "rematch": ["p_ab12"],                    // Duell
  "bracket": [["m1","m2"],["m3"]],          // Turnier (leer im Duell)
  "round": 1,                               // Turnier: aktuelle Runde (1-basiert), sonst null
  "champion": null | "p_ab12",
  "reactions": [ { "id": 17, "from": "p_ab12", "emoji": "🔥", "t": 1764000100 } ]
}
// MatchView
{
  "id": "m1", "p": ["p_ab12", "p_cd34" | null],   // null = Freilos
  "score": [1, 0], "target": 2,
  "cur": {                                        // laufende Runde – NIE mit Zügen
    "committed": [true, false], "revealed": [false, false],
    "commit": ["<hex>", null], "lockedAt": null | 1764000120, "deadline": null | 1764000140
  },
  "history": [ { "m": ["rock","scissors"], "n": ["<nonce>","<nonce>"], "h": ["<hex>","<hex>"], "w": 0, "f": false } ],
  "winner": null | 0 | 1,
  "end": null | "score" | "forfeit" | "bye" | "claim" | "leave",
  "from": null | ["m1", "m2"]                    // Turnier ab Runde 2: Sieger dieser Matches rücken hier ein
}
```
- **Turnierbaum:** `bracket` enthält ab dem Start den *kompletten* Baum. Spätere Runden sind
  Platzhalter mit `from`; dort heißt `p[i] === null` „noch offen“ (Freilos erkennt man an `end: "bye"`).
  Ein Match startet, sobald beide Vorgänger fertig sind (nicht erst, wenn die ganze Runde durch ist).
  Freilos in Runde 1: `p: [id, null]`, `winner: 0`, `end: "bye"`. Ein Match kann ohne Sieger enden
  (`winner: null`, nur wenn beide Spieler gegangen sind); dann ggf. `champion: null`.
- `round`: erste Runde (1-basiert) mit offenem Match; bei `finished` = Anzahl Runden; in der Lobby `null`.
- `myMatch`: nur gesetzt, wenn das Match **spielbar** ist (beide Plätze besetzt, nicht beendet).
- Match-IDs laufen pro Raum weiter (`m1`, `m2`, … auch über Revanchen und neue Turniere hinweg).
  Im Duell bleiben nur die letzten 5 Matches in `matches`.
- `status` im Duell: `lobby` (1 Spieler) → `running` (auch zwischen Matches) → `finished` (jemand ist gegangen).
- Unentschieden: `w: -1`. Haben **beide** nicht rechtzeitig aufgedeckt: `w: -1, f: true`, beide Züge `null`,
  Runde wird ohne Punkt wiederholt. Endet ein Match durch eine Forfeit-Runde: `end: "forfeit"`.
- `players` enthält auch Gegangene (`left: true`, nie `online`), außer in der Turnier-Lobby (dort entfernt).
- Antwort von `commit`, `reveal`, `rematch`, `start`, `react`, `claim`, `leave`: `{ "ok": true, "version": 13 }`.
- `unchanged`-Antwort: `{ "version", "unchanged": true, "now", "online": { "p_ab12": true } }`.
- Forfeit-Runde (nicht rechtzeitig aufgedeckt): fehlender Zug/Nonce ist `null`, `"f": true`.
- `create` → `{ code, token, me }`, `join` → `{ token, me, spectator }`. Danach immer `state` laden.
- Alle Fehler: HTTP 4xx/5xx + `{ "error": "Deutscher Text" }`.
