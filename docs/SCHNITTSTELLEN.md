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

### `hands.js`
```js
// Große Hand für die Arena. side 'left' = Spieler (zeigt nach rechts), 'right' = Gegner (gespiegelt).
createHand({ side }) → {
  el,                            // HTMLElement (div.hand > svg), Größe per CSS (füllt Container)
  setMove(move | 'fist', { pop = true } = {}),  // Form wechseln, optional mit Pop-Animation
  shake(beats = 3, beatMs = 500) → Promise,     // Faust schüttelt im Takt (resolved am Ende)
  setState('idle' | 'win' | 'lose' | 'draw'),   // Nachglühen/Absacken nach Reveal
}
handIcon(move) → SVGElement      // kleines Icon (für Zug-Buttons, Verlauf, Statistik), viewBox quadratisch
```
- Keine Abhängigkeit von anderen Modulen außer `rules.js`. Farben über CSS-Variablen
  (`--hand-skin`, `--hand-skin-shade`, `--hand-outline`, `--accent-left`, `--accent-right`).
- Respektiert `document.documentElement.dataset.reducedFx === '1'` und `prefers-reduced-motion`.

### `fx.js`
```js
initFx(canvas)                         // Vollbild-Canvas (position:fixed, pointer-events:none)
confetti({ x?, y?, count? })           // Matchsieg
sparks(x, y, { color? })               // Zusammenprall (Viewport-Koordinaten)
rain({ duration = 2500 })              // Niederlage: Regenwolke
burst(x, y, { color? })                // kleiner Treffer-Effekt (z. B. Punkt-Pip)
screenShake(el = document.body, intensity = 1)
floatEmoji(emoji, { x? })              // Emoji-Reaktion schwebt hoch (DOM, nicht Canvas)
setReducedFx(bool)                      // reduziert: keine Partikel/Shake, Spiel bleibt gleich
```

### `audio.js`
```js
unlock()                 // bei erster Nutzeraktion aufrufen (AudioContext erzeugen/resumen)
setEnabled(bool), isEnabled() → bool   // Zustand in localStorage 'rps.sound' ('1'/'0'), Standard an
play(name)               // 'click','tick','shake','clash','win','lose','draw','matchWin','matchLose','pop','join','countdown'
```

### `qr.js`
```js
qrMatrix(text, { ecc = 'M' } = {}) → boolean[][]   // true = dunkles Modul
qrSvg(text, { ecc = 'M', margin = 4 } = {}) → SVGElement
```

### `ai.js`
```js
createAI(level /*1..4*/, variant, { storage = localStorage } = {}) → {
  level, name,               // name: 'Zufall' | 'Gewohnheitstier' | 'Taktiker' | 'Gedankenleser'
  pick() → move,             // Zug des Computers für die nächste Runde (vor der Spielerwahl!)
  observe(aiMove, playerMove),// nach jeder Runde (auch Unentschieden)
  explain() → string | null, // nur Stufe 4: „Ich glaube, du wechselst nach einer Niederlage …“
}
AI_LEVELS → [{ level, name, description }]
```

### `stats.js`
```js
loadStats() → Stats              // Struktur wie in ARCHITEKTUR.md (rps.stats.v1), robust gegen kaputte Daten
recordRound({ result: 'w'|'l'|'d', move })   // Rundenergebnis + eigener Zug
recordMatch({ mode, result: 'w'|'l' })        // mode: 'cpu-1'…'cpu-4' | 'duel' | 'tournament'
recordTournament({ won: bool })
resetStats()
summary(stats) → { favoriteMove, totalGames, winRate, entropy /*0..1*/, predictability /*Text*/ }
```

### `net.js`
```js
api(action, params) → Promise<object>   // POST api.php; wirft ApiError(message, status) mit deutschem Text
createPoller({ code, token, onState, onError, onOnline }) → { start(), stop(), poke(), setMode('match'|'idle'|'end') }
```

### `storage` (Schlüssel)
`rps.name`, `rps.sound`, `rps.reducedFx`, `rps.stats.v1`, `rps.ai.history.v1`,
`rps.token.<code>` + `rps.me.<code>` (sessionStorage).

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
