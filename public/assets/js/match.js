// Match-Zustand (DOM-frei, unveränderlich): Runden werten, Punkte zählen, Matchende erkennen.
// Wird vom CPU-Gegner genutzt und kann später vom Online-Adapter für Anzeige/Prüfung dienen.

import { BEST_OF, isValidMove, isValidVariant, outcome, resultSentence, targetWins } from './rules.js';

/** Index im score-Array: [ich, Gegner]. */
export const ME = 0;
export const OPP = 1;

/** outcome() → Ergebniscode für die Statistik. */
export const RESULT_CODE = Object.freeze({ 1: 'w', 0: 'd', [-1]: 'l' });

/** Neues Match: { variant, bestOf, target, score: [0,0], rounds: [], winner: null }. */
export function createMatch({ variant, bestOf }) {
  if (!isValidVariant(variant)) throw new Error(`Unbekannte Variante: ${variant}`);
  if (!BEST_OF.includes(bestOf)) throw new Error(`Ungültiges Best of: ${bestOf}`);
  return Object.freeze({
    variant,
    bestOf,
    target: targetWins(bestOf),
    score: Object.freeze([0, 0]),
    rounds: Object.freeze([]),
    winner: null,
  });
}

export function isOver(match) {
  return match.winner !== null;
}

/** Nummer der nächsten (bzw. laufenden) Runde, 1-basiert; Unentschieden zählen mit. */
export function nextRoundNumber(match) {
  return match.rounds.length + 1;
}

/**
 * Wertet eine Runde. Gibt { match, round } zurück; round =
 * { number, myMove, oppMove, outcome: 1|0|-1, result: 'w'|'d'|'l', sentence }.
 */
export function playRound(match, myMove, oppMove) {
  if (isOver(match)) throw new Error('Das Match ist bereits vorbei.');
  for (const move of [myMove, oppMove]) {
    if (!isValidMove(match.variant, move)) throw new Error(`Ungültiger Zug: ${move}`);
  }
  const o = outcome(myMove, oppMove);
  const round = Object.freeze({
    number: nextRoundNumber(match),
    myMove,
    oppMove,
    outcome: o,
    result: RESULT_CODE[o],
    sentence: resultSentence(myMove, oppMove),
  });
  const score = [...match.score];
  if (o === 1) score[ME] += 1;
  if (o === -1) score[OPP] += 1;
  let winner = null;
  if (score[ME] >= match.target) winner = ME;
  else if (score[OPP] >= match.target) winner = OPP;
  return {
    match: Object.freeze({
      ...match,
      score: Object.freeze(score),
      rounds: Object.freeze([...match.rounds, round]),
      winner,
    }),
    round,
  };
}
