// Gegner-Adapter „Computer“ (DOM-frei). Implementiert den Vertrag aus arena.js
// bzw. docs/SCHNITTSTELLEN.md („Arena-Controller“).
//
// Fairness: Der Computer legt seinen Zug VOR der Spielerwahl fest (ai.pick()) und
// veröffentlicht nur commitHash(move, nonce). Nach der Runde liefert er move + nonce als Beweis.

import { createAI as defaultCreateAI, AI_LEVELS } from './ai.js';
import { commitHash, randomHex } from './crypto.js';
import { createMatch, isOver, nextRoundNumber, playRound, ME } from './match.js';
import { isValidMove } from './rules.js';

export const CPU_NAME = 'Computer';
const NONCE_BYTES = 16;

/**
 * @param {{ level: number, variant: string, bestOf: number }} setup
 * @param {{ createAI?: Function, storage?: Storage }} [deps]
 * @returns {import('./arena.js').OpponentAdapter}
 */
export function createCpuOpponent({ level, variant, bestOf }, deps = {}) {
  const createAI = deps.createAI ?? defaultCreateAI;
  const aiOptions = deps.storage ? { storage: deps.storage } : undefined;
  const ai = createAI(level, variant, aiOptions);
  const levelInfo = AI_LEVELS.find((l) => l.level === level);

  let emit = () => {};
  let match = null;
  let pending = null; // { move, nonce, hash } der laufenden Runde
  let disposed = false;

  async function openRound() {
    const move = ai.pick();
    const nonce = randomHex(NONCE_BYTES);
    const hash = await commitHash(move, nonce);
    if (disposed) return;
    pending = { move, nonce, hash };
    emit('opponentStatus', { state: 'ready' });
    emit('roundOpen', { round: nextRoundNumber(match), commit: hash });
  }

  function startMatch() {
    match = createMatch({ variant, bestOf });
    pending = null;
    emit('matchStart', {
      variant,
      bestOf,
      target: match.target,
      oppName: CPU_NAME,
      oppDetail: levelInfo?.name ?? '',
    });
    return openRound();
  }

  return {
    info: Object.freeze({
      kind: 'cpu',
      statsMode: `cpu-${level}`,
      variant,
      bestOf,
      features: Object.freeze({
        status: false,
        reactions: false,
        commitBadge: true,
        insight: level === AI_LEVELS.length,
      }),
    }),

    start(handler) {
      emit = (type, payload = {}) => { if (!disposed) handler(type, payload); };
      return startMatch();
    },

    async submitMove(myMove) {
      if (!pending) throw new Error('Gerade läuft keine Runde.');
      if (!isValidMove(variant, myMove)) throw new Error(`Ungültiger Zug: ${myMove}`);
      const proof = pending;
      pending = null;
      emit('roundLocked', {});
      const why = ai.explain();
      const { match: next, round } = playRound(match, myMove, proof.move);
      match = next;
      ai.observe(proof.move, myMove);
      emit('roundResolved', { ...round, score: [...match.score], proof });
      if (why !== null && why !== undefined) emit('insight', { text: why });
      if (isOver(match)) {
        emit('matchOver', { winner: match.winner === ME ? 'me' : 'opp', score: [...match.score], reason: 'score' });
        return;
      }
      await openRound();
    },

    rematch() {
      return startMatch();
    },

    sendReaction() { /* Computer-Modus: keine Reaktionen */ },

    dispose() {
      disposed = true;
      pending = null;
    },
  };
}
