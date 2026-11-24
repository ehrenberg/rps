// STUB – wird ersetzt. Vertrag: docs/SCHNITTSTELLEN.md
import { movesFor } from './rules.js';
import { randomInt } from './crypto.js';
export const AI_LEVELS = [
  { level: 1, name: 'Zufall', description: 'Spielt völlig zufällig.' },
  { level: 2, name: 'Gewohnheitstier', description: 'Leicht vorhersehbar – gut zum Üben.' },
  { level: 3, name: 'Taktiker', description: 'Kontert deinen Lieblingszug und einfache Muster.' },
  { level: 4, name: 'Gedankenleser', description: 'Lernt deine Muster – auch über Spiele hinweg.' },
];
export function createAI(level, variant) {
  const moves = movesFor(variant);
  return { level, name: AI_LEVELS[level - 1].name, pick: () => moves[randomInt(moves.length)], observe() {}, explain: () => null };
}
