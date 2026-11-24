// Arena-Controller (DOM-frei): verbindet einen Gegner-Adapter (Computer jetzt, Online später)
// mit einer Arena-Ansicht (ui/arena-view.js). Spiellogik liegt im Adapter, Darstellung in der
// Ansicht, hier nur Ablauf, Reihenfolge, Statistik und Fairness-Prüfung.
//
// ─── Vertrag ───────────────────────────────────────────────────────────────────────────────
//
// @typedef {Object} OpponentAdapter
// @property {Object}   info
// @property {'cpu'|'online'} info.kind
// @property {string}   info.statsMode        'cpu-1'…'cpu-4' | 'duel' | 'tournament'
// @property {string}   info.variant          'classic' | 'lizard'
// @property {number}   info.bestOf           3 | 5
// @property {{status:boolean, reactions:boolean, commitBadge:boolean, insight:boolean}} info.features
// @property {(handler:(type:string, payload:object)=>void) => Promise|void} start
// @property {(move:string) => Promise<void>} submitMove   eigener Zug (online: commit)
// @property {() => Promise|void} rematch                  Nochmal/Revanche anfragen
// @property {(emoji:string) => void} sendReaction          nur wenn features.reactions
// @property {() => void} dispose                          Timer/Polling beenden
//
// Ereignisse Adapter → Controller (type, payload):
//   matchStart     { variant, bestOf, target, oppName, oppDetail?, series? }
//   opponentStatus { state: 'choosing'|'ready'|'offline'|'left' }        sofort
//   roundOpen      { round, commit: hex|null }    Zugwahl freigeben; commit = Gegner-Hash
//   roundLocked    {}                             beide haben gewählt → Countdown
//   roundResolved  { number, myMove, oppMove, outcome: 1|0|-1, result: 'w'|'d'|'l',
//                    sentence, score: [ich, Gegner], proof: {hash, move, nonce}|null, forfeit? }
//   insight        { text }                       „Was denkt der Computer?“ (Stufe 4)
//   matchOver      { winner: 'me'|'opp', score, reason: 'score'|'forfeit'|'leave'|… }
//   reaction       { emoji, fromMe }                                     sofort
//   error          { message, fatal? }                                   sofort
//
// Ereignisse ohne „sofort“ werden in Reihenfolge abgearbeitet; jede Animation (Countdown,
// Aufdecken, Matchende) läuft zu Ende, bevor das nächste Ereignis an die Reihe kommt.
// So darf ein Online-Adapter roundResolved schon während des Countdowns melden.
//
// @typedef {Object} ArenaView   (Promise-Methoden dürfen auch sofort auflösen)
//   setup({ variant, bestOf, target, moves, oppName, oppDetail, features })
//   setRoundOpen({ round, commit })        Buttons aktiv, Commit-Badge zeigen
//   setChosen(move)                        Buttons sperren, Wahl markieren
//   setOpponentStatus(state)
//   playCountdown() → Promise
//   reveal(round) → Promise                Hände, Zusammenprall, Ergebnissatz
//   setScore(score, { scorer: 'me'|'opp'|null })
//   addHistory(round)
//   setFairness({ ok: boolean, proof })
//   setInsight(text)
//   showReaction({ emoji, fromMe })
//   showMatchOver({ won, score, reason }) → Promise
//   hideMatchOver()
//   showError(message)
// ───────────────────────────────────────────────────────────────────────────────────────────

import { movesFor, isValidMove } from './rules.js';
import { verifyCommit } from './crypto.js';

/** Ereignisse, die nicht auf laufende Animationen warten. */
const IMMEDIATE_EVENTS = new Set(['opponentStatus', 'reaction', 'error']);

export const PHASE = Object.freeze({
  WAITING: 'waiting',     // auf roundOpen warten
  CHOOSING: 'choosing',   // Spieler darf wählen
  SUBMITTED: 'submitted', // gewählt, warte auf Gegner/Countdown
  PLAYING: 'playing',     // Countdown/Aufdecken
  OVER: 'over',
});

/** Tastenkürzel: Ziffern 1–n in Zugreihenfolge, dazu feste Buchstaben. */
export const MOVE_LETTERS = Object.freeze({ rock: 's', paper: 'p', scissors: 'c', lizard: 'e', spock: 'k' });

/** Taste → Zug der Variante oder null. */
export function moveForKey(key, variant) {
  const moves = movesFor(variant);
  const k = String(key).toLowerCase();
  const index = Number.parseInt(k, 10);
  if (String(index) === k && index >= 1 && index <= moves.length) return moves[index - 1];
  return moves.find((m) => MOVE_LETTERS[m] === k) ?? null;
}

/**
 * @param {{ adapter: OpponentAdapter, view: ArenaView,
 *           stats?: { recordRound: Function, recordMatch: Function },
 *           verify?: (hash:string, move:string, nonce:string) => Promise<boolean> }} deps
 */
export function createArenaController({ adapter, view, stats = null, verify = verifyCommit }) {
  const { variant } = adapter.info;
  let phase = PHASE.WAITING;
  let disposed = false;
  let queue = Promise.resolve();
  const listeners = new Set();

  const setPhase = (next) => {
    phase = next;
    for (const fn of listeners) fn(phase);
  };

  const handlers = {
    matchStart(p) {
      view.hideMatchOver();
      view.setup({ ...p, moves: movesFor(p.variant ?? variant), features: adapter.info.features });
      setPhase(PHASE.WAITING);
    },
    roundOpen(p) {
      view.setRoundOpen(p);
      setPhase(PHASE.CHOOSING);
    },
    async roundLocked() {
      setPhase(PHASE.PLAYING);
      await view.playCountdown();
    },
    async roundResolved(round) {
      setPhase(PHASE.PLAYING);
      await view.reveal(round);
      const scorer = round.outcome === 1 ? 'me' : round.outcome === -1 ? 'opp' : null;
      view.setScore(round.score, { scorer });
      view.addHistory(round);
      stats?.recordRound({ result: round.result, move: round.myMove });
      if (round.proof) {
        const { hash, move, nonce } = round.proof;
        const ok = await verify(hash, move, nonce);
        if (!disposed) view.setFairness({ ok, proof: round.proof });
      }
      setPhase(PHASE.WAITING);
    },
    insight(p) {
      view.setInsight(p.text);
    },
    async matchOver(p) {
      setPhase(PHASE.OVER);
      const won = p.winner === 'me';
      stats?.recordMatch({ mode: adapter.info.statsMode, result: won ? 'w' : 'l' });
      await view.showMatchOver({ won, score: p.score, reason: p.reason });
    },
    opponentStatus(p) {
      view.setOpponentStatus(p.state);
    },
    reaction(p) {
      view.showReaction(p);
    },
    error(p) {
      view.showError(p.message);
    },
  };

  function onEvent(type, payload) {
    if (disposed) return;
    const handler = handlers[type];
    if (!handler) return;
    if (IMMEDIATE_EVENTS.has(type)) {
      handler(payload);
      return;
    }
    queue = queue
      .then(() => (disposed ? undefined : handler(payload)))
      .catch((err) => { if (!disposed) view.showError(err?.message ?? String(err)); });
  }

  return {
    get phase() { return phase; },
    /** Für Tests/Ansicht: Callback bei Phasenwechsel. Gibt Abmeldefunktion zurück. */
    onPhase(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** Wartet, bis alle bisher eingegangenen Ereignisse abgearbeitet sind. */
    idle() { return queue; },

    start() {
      return adapter.start(onEvent);
    },

    /** Spieler wählt einen Zug. Gibt false zurück, wenn gerade nicht gewählt werden darf. */
    choose(move) {
      if (disposed || phase !== PHASE.CHOOSING || !isValidMove(variant, move)) return false;
      setPhase(PHASE.SUBMITTED);
      view.setChosen(move);
      Promise.resolve(adapter.submitMove(move)).catch((err) => {
        if (disposed) return;
        view.showError(err?.message ?? String(err));
        setPhase(PHASE.CHOOSING);
      });
      return true;
    },

    rematch() {
      if (disposed || phase !== PHASE.OVER) return false;
      setPhase(PHASE.WAITING);
      Promise.resolve(adapter.rematch()).catch((err) => view.showError(err?.message ?? String(err)));
      return true;
    },

    react(emoji) {
      if (!disposed && adapter.info.features.reactions) adapter.sendReaction(emoji);
    },

    dispose() {
      disposed = true;
      listeners.clear();
      adapter.dispose();
    },
  };
}
