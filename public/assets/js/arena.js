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
// @property {() => Promise} [claim]                       optional: Sieg beanspruchen (online)
// @property {(recordId:string) => void} [markRecorded]    optional: Match ist in der Statistik gezählt
//
// Ereignisse Adapter → Controller (type, payload):
//   matchStart     { variant, bestOf, target, oppName, oppDetail?, series?, score?, history? }
//                  score/history: bereits gespielte Runden (Wiederaufnahme nach Reload)
//   opponentStatus { state: 'choosing'|'ready'|'offline'|'left' }        sofort
//   roundOpen      { round, commit: hex|null }    Zugwahl freigeben; commit = Gegner-Hash
//   moveRestored   { move|null }                  eigener Zug war schon abgegeben (Reload)
//   roundLocked    {}                             beide haben gewählt → Countdown
//   roundResolved  { number, myMove, oppMove, outcome: 1|0|-1, result: 'w'|'d'|'l',
//                    sentence, score: [ich, Gegner], proof: {hash, move, nonce}|null, forfeit? }
//   insight        { text }                       „Was denkt der Computer?“ (Stufe 4)
//   opponentCommit { hash }                       Gegner hat gewählt, sein Hash (online, vorab)
//   matchOver      { winner: 'me'|'opp'|null, score, reason: 'score'|'forfeit'|'leave'|'claim'|…,
//                    replay?, recordId?, oppName?, series? }
//                  replay: schon gezählt → keine Statistik; recordId → adapter.markRecorded(recordId)
//                  winner null: kein Sieger (beide weg) → neutral, keine Statistik
//   reaction       { emoji, fromMe }                                     sofort
//   error          { message, fatal? }                                   sofort
//   deadline       { seconds|null, who: 'reveal'|'commit'|'oppCommit'|null }  laufende Frist   sofort
//   claimAvailable { available }      Gegner lange offline → Sieg beanspruchbar   sofort
//   rematchStatus  { me, opp, oppLeft }  Revanche-Wünsche (Duell)          sofort
//
// Ereignisse ohne „sofort“ werden in Reihenfolge abgearbeitet; jede Animation (Countdown,
// Aufdecken, Matchende) läuft zu Ende, bevor das nächste Ereignis an die Reihe kommt.
// So darf ein Online-Adapter roundResolved schon während des Countdowns melden.
//
// @typedef {Object} ArenaView   (Promise-Methoden dürfen auch sofort auflösen)
//   setup({ variant, bestOf, target, moves, oppName, oppDetail, features })
//   setRoundOpen({ round, commit })        Buttons aktiv, Commit-Badge zeigen
//   setChosen(move)                        Buttons sperren, Wahl markieren
//   setMovesEnabled(enabled)               Buttons frei/gesperrt (z. B. nach Commit-Fehler wieder frei)
//   setOpponentStatus(state)
//   playCountdown() → Promise
//   reveal(round) → Promise                Hände, Zusammenprall, Ergebnissatz
//   setScore(score, { scorer: 'me'|'opp'|null })
//   addHistory(round)
//   setFairness({ ok: boolean, proof, reason: null|'hash'|'shown'|'own' })
//   setInsight(text)
//   showReaction({ emoji, fromMe })
//   showMatchOver({ won: boolean|null, score, reason, oppName?, series?, rematch? }) → Promise
//                                          won null = kein Sieger; rematch = letzter rematchStatus
//   hideMatchOver()
//   showError(message)
//   optional (online): setDeadline(seconds|null, who), setClaimAvailable(bool), setRematchStatus(info),
//   setSeries(series|null), setOpponentCommit(hash)
// ───────────────────────────────────────────────────────────────────────────────────────────

import { movesFor, isValidMove } from './rules.js';
import { verifyCommit } from './crypto.js';
import { singleFlight } from './throttle.js';

/** Ereignisse, die nicht auf laufende Animationen warten. */
const IMMEDIATE_EVENTS = new Set(['opponentStatus', 'reaction', 'error', 'deadline', 'claimAvailable', 'rematchStatus']);

export const PHASE = Object.freeze({
  WAITING: 'waiting',     // auf roundOpen warten
  CHOOSING: 'choosing',   // Spieler darf wählen
  SUBMITTED: 'submitted', // gewählt, warte auf Gegner/Countdown
  PLAYING: 'playing',     // Countdown/Aufdecken
  OVER: 'over',
});

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
  let restoredSinceChoice = false; // Server hat den Zug bestätigt, während der Commit noch lief
  let rematchInfo = null; // letzter rematchStatus (kommt sofort, das Overlay erst nach der Animation)
  const listeners = new Set();
  const showError = (err) => { if (!disposed) view.showError(err?.message ?? String(err)); };
  const claimOnce = singleFlight(() => adapter.claim());

  const setPhase = (next) => {
    phase = next;
    for (const fn of listeners) fn(phase);
  };

  const handlers = {
    matchStart(p) {
      view.hideMatchOver();
      view.setup({ ...p, moves: movesFor(p.variant ?? variant), features: adapter.info.features });
      if (p.score) view.setScore(p.score, { scorer: null });
      for (const round of p.history ?? []) view.addHistory(round);
      view.setSeries?.(p.series ?? null);
      setPhase(PHASE.WAITING);
    },
    roundOpen(p) {
      view.setRoundOpen(p);
      setPhase(PHASE.CHOOSING);
    },
    moveRestored(p) {
      restoredSinceChoice = true;
      setPhase(PHASE.SUBMITTED);
      view.setChosen(p.move);
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
        const reason = await fairnessProblem(round.proof);
        if (!disposed) view.setFairness({ ok: reason === null, reason, proof: round.proof });
      }
      setPhase(PHASE.WAITING);
    },
    insight(p) {
      view.setInsight(p.text);
    },
    opponentCommit(p) {
      view.setOpponentCommit?.(p.hash);
    },
    async matchOver(p) {
      setPhase(PHASE.OVER);
      // winner null: kein Sieger (z. B. beide gegangen) → neutral, zählt nicht
      const won = p.winner === null || p.winner === undefined ? null : p.winner === 'me';
      if (!p.replay && won !== null && stats) {
        stats.recordMatch({ mode: adapter.info.statsMode, result: won ? 'w' : 'l' });
        if (p.recordId) adapter.markRecorded?.(p.recordId);
      }
      view.setSeries?.(p.series ?? null);
      await view.showMatchOver({
        won, score: p.score, reason: p.reason, oppName: p.oppName, series: p.series ?? null, rematch: rematchInfo,
      });
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
    deadline(p) { view.setDeadline?.(p.seconds, p.who); },
    claimAvailable(p) { view.setClaimAvailable?.(p.available); },
    rematchStatus(p) { rematchInfo = p; view.setRematchStatus?.(p); },
  };

  /**
   * null = fair; sonst Grund: 'hash' (Zug/Nonce ergeben nicht den Hash), 'shown' (Hash weicht vom
   * vorher gezeigten ab), 'own' (Server hat für meinen Zug einen anderen Hash).
   */
  async function fairnessProblem({ hash, move, nonce, shownHash = null, ownHashOk = null }) {
    if (!(await verify(hash, move, nonce))) return 'hash';
    if (shownHash && shownHash !== hash) return 'shown';
    if (ownHashOk === false) return 'own';
    return null;
  }

  function onEvent(type, payload) {
    if (disposed) return;
    const handler = handlers[type];
    if (!handler) return;
    // Neues Match: alter Revanche-Status gilt nicht mehr (sofort, da rematchStatus sofort kommt)
    if (type === 'matchStart') rematchInfo = null;
    if (IMMEDIATE_EVENTS.has(type)) {
      handler(payload);
      return;
    }
    queue = queue
      .then(() => (disposed ? undefined : handler(payload)))
      .catch(showError);
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
      restoredSinceChoice = false;
      setPhase(PHASE.SUBMITTED);
      view.setChosen(move);
      Promise.resolve(adapter.submitMove(move)).catch((err) => {
        if (disposed) return;
        showError(err);
        // Nur zurück zur Wahl, wenn inzwischen nichts anderes passiert ist (z. B. moveRestored,
        // weil der Server den Zug doch hat) – dann auch die Buttons wieder freigeben.
        if (phase !== PHASE.SUBMITTED || restoredSinceChoice) return;
        setPhase(PHASE.CHOOSING);
        view.setMovesEnabled(true);
      });
      return true;
    },

    rematch() {
      if (disposed || phase !== PHASE.OVER) return false;
      setPhase(PHASE.WAITING);
      Promise.resolve(adapter.rematch()).catch((err) => {
        if (disposed) return;
        setPhase(PHASE.OVER);
        showError(err);
      });
      return true;
    },

    /** Sieg beanspruchen (nur Adapter mit claim); während der Anfrage keine zweite. */
    claim() {
      if (disposed || !adapter.claim) return;
      claimOnce()?.catch(showError);
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
