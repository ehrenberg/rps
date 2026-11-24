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
  stop(),                               // Screenwechsel: Shake-Timer/Animationen abbrechen, offenes
                                        // shake-Promise resolved sofort, onBeat danach nie mehr
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
  claim(),                    // Sieg beanspruchen; während der Anfrage ignoriert (keine Doppelanfrage)
  onPhase(fn) → unsubscribe, idle() → Promise   // idle: alle bisherigen Ereignisse abgearbeitet
}
PHASE
// move-keys.js (von Arena-Screen und Ansicht genutzt; die Ansicht importiert nie arena.js)
moveForKey(key, variant) → move | null           // '1'…'5' bzw. s/p/c/e/k (Stein/Papier/sChere/Echse/spocK)
MOVE_LETTERS

// Gegner-Adapter (OpponentAdapter)
{
  info: { kind: 'cpu'|'online', statsMode /* 'cpu-1'…'cpu-4'|'duel'|'tournament' */, variant, bestOf,
          features: { status, reactions, commitBadge, insight, claim? } },
          // claim: Adapter bietet claim() an („Sieg beanspruchen“, nur online)
  start(handler),            // handler(type, payload) – Ereignisse siehe unten
  submitMove(move) → Promise,// eigener Zug (online: commitHash + Nonce senden)
  rematch(),                 // Nochmal / Revanche anfragen
  sendReaction(emoji),       // nur wenn features.reactions
  dispose(),                 // Timer/Polling stoppen
  claim?() → Promise,        // optional: Sieg beanspruchen
  markRecorded?(recordId),   // optional: Match wurde in der Statistik gezählt (nach Reload nicht erneut)
}

// Ansicht (ArenaView, ui/arena-view.js) – vom Controller aufgerufen
setup(…), setRoundOpen({ round, commit }), setChosen(move), setMovesEnabled(enabled),
setOpponentStatus(state), playCountdown(), reveal(round), setScore(score, { scorer }), addHistory(round),
setFairness({ ok, proof, reason: null|'hash'|'shown'|'own' }), setInsight(text), showReaction(r),
showMatchOver({ won: true|false|null, score, reason, oppName?, series?, rematch? }), hideMatchOver(), showError(msg)
// optional (online): setDeadline(s, who), setClaimAvailable(bool), setRematchStatus(info), setSeries(s),
// setOpponentCommit(hash)
```
- `setMovesEnabled(true)` nach fehlgeschlagener Zugabgabe (Buttons wieder frei, Markierung weg) – nicht,
  wenn inzwischen `moveRestored` kam (Server hat den Zug doch).
- `showMatchOver`: `won: null` = Match ohne Sieger (beide gegangen) → neutrales Overlay, keine Statistik;
  `rematch` = letzter `rematchStatus` (kommt sofort, das Overlay erst nach der Animation – der Controller
  merkt ihn sich und gibt ihn mit; ein neues `matchStart` setzt ihn zurück).

Ereignisse Adapter → Controller (in Reihenfolge abgearbeitet; jede Animation läuft zu Ende,
bevor das nächste Ereignis drankommt – „sofort“ = ohne Warteschlange):

| Ereignis | Payload | Wirkung |
|---|---|---|
| `matchStart` | `{ variant, bestOf, target, oppName, oppDetail?, series? }` | Arena aufbauen, Pips leeren |
| `opponentStatus` (sofort) | `{ state: 'choosing'\|'ready'\|'offline'\|'left' }` | „wählt …“ / „bereit ✓“ (nur wenn `features.status`) |
| `roundOpen` | `{ round, commit: hex\|null }` | Zug-Buttons frei, Commit-Badge „🔒 a3f9…“ |
| `roundLocked` | `{}` | beide haben gewählt → Countdown (3 Aufschläge à 500 ms) |
| `opponentCommit` | `{ hash }` | online: Gegner hat gewählt → Badge „🔒 Ben hat gewählt: a3f9…“ |
| `roundResolved` | `{ number, myMove, oppMove, outcome: 1\|0\|-1, result: 'w'\|'d'\|'l', sentence, score: [ich, Gegner], proof: {hash, move, nonce, shownHash?, ownHashOk?}\|null, forfeit? }` | Aufdecken, Pips, Verlauf, `stats.recordRound`; fair nur, wenn `verifyCommit` stimmt, `hash === shownHash` (vorher gezeigter Hash, falls bekannt) und `ownHashOk !== false` → „fair ✓“, sonst „⚠ Hash passt nicht“ |
| `insight` | `{ text }` | „Was denkt der Computer?“ (nur `features.insight`) |
| `matchOver` | `{ winner: 'me'\|'opp'\|null, score, reason, replay?, recordId? }` | wenn nicht `replay` und mit Sieger: `stats.recordMatch({ mode: info.statsMode })` + `adapter.markRecorded(recordId)`; Matchende-Overlay (`winner: null` neutral) |
| `reaction` (sofort) | `{ emoji, fromMe }` | Emoji schwebt hoch |
| `error` (sofort) | `{ message, fatal? }` | deutscher Fehlertext in der Arena |

Zusätzlich (online, alle „sofort“ außer `moveRestored`): `moveRestored { move }`, `deadline { seconds, who }`,
`claimAvailable { available }`, `rematchStatus { me, opp, oppLeft }`; `opponentCommit { hash }` (Warteschlange);
`matchStart` kann `score`/`history`/`series` mitbringen, `matchOver` `replay`/`recordId`/`series`/`oppName`.
Details: Abschnitt „Online-Adapter“.

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
  `get/setCpuSetup`; `sanitizeName`, `cleanName`, `truncateName`, `graphemes`, `normalizeCpuSetup`,
  `safeStorage`. Schlüssel: `rps.name`, `rps.reducedFx`, `rps.insight`, `rps.cpuSetup.v1`.
  **Namensregel (Client = Server):** NFC; jeder Leerraum (inkl. NEL, U+180E, `\p{Z}`) → ein Leerzeichen;
  unsichtbare Füllzeichen, `\p{C}` (Steuer-, Format- inkl. Bidi U+202A–202E/U+2066–2069) raus;
  ZWJ nur zwischen Emoji, Variation Selector nur nach einem Zeichen; trimmen. Länge: 1–20 **Grapheme**
  (Intl.Segmenter bzw. PCRE `\X` mit Emoji-Folgen-Korrektur) und höchstens 80 Codepoints.
  Der Client kürzt grapheme-sicher (kein `maxlength`), der Server lehnt Längeres mit 400 ab.
  Gemeinsame Testfälle: `tests/fixtures/names.json` (JS- und PHP-Tests).

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
    "commit": ["<hex>", null], "lockedAt": null | 1764000120, "deadline": null | 1764000140,
    "commitDeadline": null | 1764000180          // nur wenn genau einer gewählt hat: der andere muss bis dahin wählen
  },
  "history": [ { "m": ["rock","scissors"], "n": ["<nonce>","<nonce>"], "h": ["<hex>","<hex>"], "w": 0, "f": false } ],
  "dropped": 0,                                   // verdichtete (entfernte) alte Unentschieden, s. u.
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
- Wahl-Frist: Hat nur einer gewählt, verliert der andere nach `commitDeadline` (60 s) die Runde:
  history-Eintrag `{ "m": [null,null], "n": [null,null], "h": ["<hex>",null], "w": 0, "f": true }`.
- `history` hat höchstens 50 Einträge: darüber werden die ältesten Unentschieden entfernt und in
  `dropped` gezählt (Rundenzahl = `dropped + history.length`; neue Runde erkennen am besten daran).
  Entscheidende Runden werden nie entfernt.

### `info` (ohne Token, nur lesend – für die Einladungsseite)

```jsonc
// POST {"action":"info","code":"k7f3qa"}  → 404 {"error":"Diesen Raum gibt es nicht (mehr). …"}, wenn unbekannt
{
  "code": "k7f3qa", "type": "duel" | "tournament",
  "variant": "classic" | "lizard", "bestOf": 3 | 5,
  "status": "lobby" | "running" | "finished",
  "hostName": "Anna" | null,
  "players": 1,          // aktive Teilnehmer (ohne Zuschauer und Gegangene)
  "maxPlayers": 2 | 16,
  "joinable": true,      // `join` macht dich zum Spieler
  "spectate": false,     // nur Turnier: `join` macht dich zum Zuschauer (läuft/beendet/16 voll)
  "names": ["Anna", "Ben"] // nur Turnier: Teilnehmernamen
}
```
- Beides `false` → kein Beitritt möglich (Duell voll/geschlossen oder Turnierraum mit 32 Personen voll).
- `unchanged`-Antwort: `{ "version", "unchanged": true, "now", "online": { "p_ab12": true } }`.
- Forfeit-Runde (nicht rechtzeitig aufgedeckt): fehlender Zug/Nonce ist `null`, `"f": true`.
- `create` → `{ code, token, me }`, `join` → `{ token, me, spectator }`. Danach immer `state` laden.
- Alle Fehler: HTTP 4xx/5xx + `{ "error": "Deutscher Text" }`.

### `watch` (Sammelabfrage für „Meine Spiele“)

```jsonc
// POST
{ "action": "watch", "rooms": [ { "code": "k7f3qa", "token": "<hex64>", "since": 12 /* optional */ } ] }
// 200
{
  "now": 1764000123,
  "rooms": {                                   // immer Objekt; Schlüssel = Code genau wie gesendet
    "k7f3qa": {
      "version": 12,
      "type": "duel" | "tournament", "variant": "classic" | "lizard", "bestOf": 3 | 5,
      "status": "lobby" | "running" | "finished",
      "me": "p_ab12", "isHost": true,
      "players": 2,              // aktive Teilnehmer (ohne Zuschauer/Gegangene)
      "spectator": false,
      "left": false,             // immer false – wer gegangen ist, bekommt {gone, reason:"left"}
      "opponent": "Ben" | null,  // Duell: der andere Spieler, sobald beigetreten; Turnier: Gegner in myMatch
      "myMatch": "m3" | null,    // wie in `state` (nur spielbar)
      "needsMove": true,         // myMatch existiert und ich habe in der laufenden Runde noch nicht gewählt
      "rematchWanted": true,     // Duell: Match vorbei, Gegner will Revanche, ich noch nicht
      "champion": "Anna" | null, // Turnier beendet: Name
      "updated": 1764000100      // letzte Speicherung des Raums (auch reine seen-Updates)
    },
    "m2p4xa": { "version": 7, "unchanged": true },          // since == version
    "zzzzzz": { "gone": true, "reason": "notFound" },       // unbekannt oder nach 24 h gelöscht
    "q9w8e7": { "gone": true, "reason": "forbidden" },      // Token unbekannt, Code/Token-Format ungültig
    "abc234": { "gone": true, "reason": "left" }            // ich habe den Raum verlassen
  }
}
```
- 1–10 Einträge; mehr → 400 „Zu viele Räume auf einmal.“. Kein Array, leere Liste, Eintrag ohne
  String-`code` → 400. Alles andere betrifft nur den einzelnen Eintrag.
- Doppelte Codes: der **letzte** Eintrag zählt (er steht dann auch an seiner Position in `rooms`).
- `since` muss eine ganze Zahl sein, sonst wird es ignoriert (wie bei `state`). `left` hat Vorrang vor `unchanged`.
- Turnier-Lobby: Wer dort geht, wird entfernt → danach `forbidden` (nicht `left`).
- Zählt als Anwesenheit (`seen`, gleiche 5-s-Regel wie `state`) und wertet fällige Fristen aus;
  jeder Raum in eigener kurzer Transaktion, geschrieben wird nur bei Bedarf.
- Enthält nie Züge, Nonces, Hashes oder fremde Tokens/IDs außer der eigenen (`me`).

## Online-Adapter

`online-opponent.js` implementiert den Gegner-Adapter aus „Arena-Controller“ für Duell und Turnier.
Er pollt **nicht** selbst: der Raum-Screen (`ui/room.js`) hält den Poller (`net.js`) und reicht
jeden Zustand weiter.

```js
createOnlineOpponent({ code, token, me, kind: 'duel'|'tournament', state, matchId?, apiFn, session, poke,
                       now?, commitHash?, makeNonce?, timers? }) → Adapter & {
  update(state),            // neuer Server-Zustand (onState des Pollers)
  updateOnline(map),        // { p_id: bool } aus jeder Poll-Antwort (auch „unchanged“)
  claim() → Promise,        // Sieg beanspruchen (Server prüft 45 s)
  markRecorded(recordId),   // Match gezählt (session.markRecorded) → später `replay: true`
  matchId,                  // verfolgtes Match (Duell: state.current, Turnier: festes myMatch)
}
roundCount(match) = (match.dropped ?? 0) + match.history.length
newReactions(list, lastId), maxReactionId(list), roundSentence(myMove, oppMove, oppName), CLAIM_AFTER_MS,
matchRecordId(matchId) = 'm:<id>'
```
Verlassen macht der Raum-Screen selbst (`api('leave')`); die Sitzung wird nur bei Erfolg oder 403/404
gelöscht (`room-flow.js`: `leaveClearsSession`).

```js
// room-flow.js (DOM-frei, für ui/room.js und ui/invite.js)
decideRoute(state, { me, shown, dismissedMatch? }) → { view: 'lobby'|'arena'|'bracket', matchId?, mode, fresh, toast? }
inviteErrorKind(err) → 'missing' (nur 404) | 'retry'
leaveClearsSession(err|null) → bool
myRunningMatch(state, me) → { id, mode: 'duel'|'tournament', recordId } | null
     // Verlassen zählt ein laufendes Match als Niederlage (einmal); „Menü“ in der Arena fragt dann nach
closedInviteText(info) → „schon beendet“ (Duell finished) | „schon voll … anderer Tab …“ | „kein Platz mehr“
// throttle.js
singleFlight(fn, { onChange? }) → run (gibt null zurück, solange eine Anfrage läuft; run.busy)
createCooldown(ms, { timers?, onChange? }) → { take() → bool, active }
```
`ui/reaction-bar.js`: `reactionBar({ onReact, hidden? })` – gemeinsame Reaktionsleiste (Arena + Turnierbaum),
`REACTION_COOLDOWN_MS` (1 s); die Emoji-Liste ist `REACTIONS` aus `rules.js` (Spiegel von `RPS_EMOJIS` in
`validate.php`, per JS-Test geprüft).
```

Ablauf einer Runde:
1. `roundOpen` sobald eine neue Runde (`roundCount`) beginnt. `submitMove(move)`: Nonce (16 Byte hex) →
   `commitHash` → Pending `{ matchId, round, move, nonce, hash }` in `sessionStorage`
   (`rps.pending.<code>`) → `commit` → `poke()`.
   Fehler: endgültige 4xx verwerfen das Pending. Bei Status 0/5xx (`retryable`) bleibt es (der Server hat
   den Commit evtl. gespeichert), `poke()`; zeigt der Server `cur.committed[me]`, gilt der Zug als
   abgegeben (`moveRestored`, bzw. kein Fehler, falls das schon während des Requests sichtbar war).
   409 nach so einem Fehler: das frühere Pending bleibt, wenn es zu `cur.commit[me]` passt.
2. `cur.commit[gegner]` erscheint → `opponentCommit { hash }` (einmal je Runde, Hash wird gemerkt).
   `cur.lockedAt` gesetzt → `roundLocked` (Countdown) und automatisch `reveal` mit dem Pending-Zug;
   schlägt `reveal` mit Netz-/Serverfehler fehl, wiederholt der Adapter selbst mit Backoff (1, 2, 4 … s),
   solange die Runde offen ist und er nicht entsorgt wurde.
3. Neue `history`-Einträge → `roundResolved` (Gegnerzug/Nonce/Hash als `proof`, dazu `shownHash` = vorher
   gezeigter Gegner-Hash und `ownHashOk` = eigener Hash `h[me]` passt zum Pending). Der Gegnerzug stammt
   **nur** aus `history`. Forfeit-Runden ohne Lock (Commit-Frist) lösen keinen `roundLocked` aus.
4. `winner`/`end` gesetzt → `matchOver` mit `recordId` (`m:<matchId>`); `replay: true`, wenn
   `session.wasRecorded(code, recordId)` → keine Statistik. Der Controller zählt und ruft dann
   `markRecorded(recordId)` – so zählt ein Reload mitten in der Animation weder doppelt noch gar nicht.
   Duell: `rematchStatus` aus `state.rematch` (`oppLeft` auch, wenn nach beanspruchtem Sieg der Gegner
   offline ist), Serie aus `state.series`. `matchStart.oppDetail` bleibt leer – die Turnierrunde
   („Halbfinale“) steht im Kopf der Arena, „Runde n“ in der Mitte ist die Spielrunde.

Weitere Ereignisse: `opponentStatus` (`choosing`/`ready`/`offline`/`left`), `deadline`
(`{ seconds, who: 'reveal'|'commit'|'oppCommit' }` aus `cur.deadline` bzw. `cur.commitDeadline`),
`claimAvailable` (Gegner ≥ 45 s offline), `reaction` (nur neue IDs), `moveRestored` (Reload nach
eigenem Commit), `error` (deutscher Text; Reaktionen mit 429 werden still ignoriert).

Reload: `rps.token.<code>` + `rps.me.<code>` behalten den Platz; `matchStart` liefert `score` und
`history` der bisherigen Runden; ein schon abgegebener Zug wird per `moveRestored` angezeigt und nach
`lockedAt` aus dem Pending aufgedeckt.

Weitere DOM-freie Module dazu:
- `net.js`: `api(action, params, { fetchImpl?, timeoutMs? = API_TIMEOUT_MS (8 s) })` – hängende Requests
  werden per AbortController abgebrochen → `ApiError(…, 0)` (wiederholbar); `ApiError` (`status`,
  `retryable`), `HTTP` (zentrale Statuscodes), `StateHandlerError`; `createPoller({ code, token, onState,
  onOnline, onError(err, { failures, fatal }), onConnection(ok), apiFn?, timers?, isHidden?, events? })` mit
  `start/stop/poke/setMode('match'|'idle'|'end')`, `POLL_MS` (1 s / 1 s / 5 s, versteckt ≥ 3 s),
  Backoff 1→2→4→8→10 s, `RECONNECT_TEXT`; 403/404 sind fatal. Wirft `onState`, meldet der Poller
  `StateHandlerError` an `onError` (kein Verbindungsfehler) und übernimmt die Version nicht – der Zustand
  wird beim nächsten Poll erneut verarbeitet. Meldet `events` (window) „online“, wird sofort neu geladen
  (kein Warten auf den Backoff; der Verbindungshinweis verschwindet beim ersten Erfolg).
  `createRoomSession(storage)` → `get/set/clear(code)`, `get/set/clearPending(code)`,
  `wasRecorded/markRecorded(code, id)` (IDs `m:<match>`, `t:<matches>`, `confetti:t:<matches>`; sessionStorage-Schlüssel `rps.token.`, `rps.me.`,
  `rps.pending.`, `rps.recorded.` + Code).
- `bracket.js`: `buildBracket(state, me)` → `{ rounds: [{ index, title, matches: [{ id, label, status,
  mine, slots: [{ id, name, score, won, me, left, placeholder }] }] }], champion }`,
  `roundTitle(i, total)` (Finale/Halbfinale/Viertelfinale/Achtelfinale/Runde n),
  `matchStatus(m)` (`pending`/`live`/`done`/`bye`), `tournamentRole(state, me)`
  (`spectator`/`playing`/`waiting`/`out`/`champion`), `tournamentKey(state)`, `myLiveMatchId(built)`,
  `shouldScrollToMatch(prev, next)` (Baum scrollt nur beim ersten Rendern/Matchwechsel).

Screens: `#/duel` und `#/tournament` = Raum erstellen (`ui/create-room.js`), `#<code>` = `ui/room.js`
(Einladung `ui/invite.js` → Lobby `ui/lobby.js` mit `ui/share.js` → Arena bzw. Turnierbaum
`ui/bracket-view.js`). Turnier-Statistik: `recordMatch({ mode: 'tournament' })` je Match (Statistik-Seite:
Zeile „Turnier-Matches“) und einmal `recordTournament({ won })` pro beendetem Turnier.
