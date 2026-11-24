// Tastenkürzel für Züge (DOM-frei): von Controller-Bildschirm und Ansicht gemeinsam genutzt.
import { movesFor } from './rules.js';

/** Tastenkürzel: Ziffern 1–n in Zugreihenfolge, dazu feste Buchstaben (Stein/Papier/sChere/Echse/spocK). */
export const MOVE_LETTERS = Object.freeze({ rock: 's', paper: 'p', scissors: 'c', lizard: 'e', spock: 'k' });

/** Taste → Zug der Variante oder null. */
export function moveForKey(key, variant) {
  const moves = movesFor(variant);
  const k = String(key).toLowerCase();
  const index = Number.parseInt(k, 10);
  if (String(index) === k && index >= 1 && index <= moves.length) return moves[index - 1];
  return moves.find((m) => MOVE_LETTERS[m] === k) ?? null;
}
