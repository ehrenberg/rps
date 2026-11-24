// Spielregeln – Spiegel von public/src/rules.php. Immer beide gleichzeitig ändern!

/** Alle Züge in kanonischer Reihenfolge. */
export const MOVES = Object.freeze(['rock', 'paper', 'scissors', 'lizard', 'spock']);

/** Züge je Variante. */
export const VARIANTS = Object.freeze({
  classic: Object.freeze(['rock', 'paper', 'scissors']),
  lizard: Object.freeze(['rock', 'paper', 'scissors', 'lizard', 'spock']),
});

export const VARIANT_NAMES = Object.freeze({
  classic: 'Klassisch',
  lizard: 'Echse & Spock',
});

export const MOVE_NAMES = Object.freeze({
  rock: 'Stein',
  paper: 'Papier',
  scissors: 'Schere',
  lizard: 'Echse',
  spock: 'Spock',
});

export const BEST_OF = Object.freeze([3, 5]);

/** Erlaubte Reaktionen – Spiegel der Whitelist RPS_EMOJIS in public/src/validate.php. */
export const REACTIONS = Object.freeze(['👍', '😂', '😱', '🔥', '😭', '🤝', '👏', '😈']);

/** Gewinner → { Verlierer: Verb } */
const VERBS = Object.freeze({
  scissors: { paper: 'schneidet', lizard: 'köpft' },
  paper: { rock: 'bedeckt', spock: 'widerlegt' },
  rock: { lizard: 'zerquetscht', scissors: 'schleift' },
  lizard: { spock: 'vergiftet', paper: 'frisst' },
  spock: { scissors: 'zertrümmert', rock: 'verdampft' },
});

export function movesFor(variant) {
  const moves = VARIANTS[variant];
  if (!moves) throw new Error(`Unbekannte Variante: ${variant}`);
  return moves;
}

export function isValidVariant(variant) {
  return Object.hasOwn(VARIANTS, variant);
}

export function isValidMove(variant, move) {
  return isValidVariant(variant) && VARIANTS[variant].includes(move);
}

/** true, wenn a gegen b gewinnt. */
export function beats(a, b) {
  return Boolean(VERBS[a] && Object.hasOwn(VERBS[a], b));
}

/** 1 = a gewinnt, -1 = b gewinnt, 0 = unentschieden. */
export function outcome(a, b) {
  if (a === b) return 0;
  if (beats(a, b)) return 1;
  if (beats(b, a)) return -1;
  throw new Error(`Ungültige Paarung: ${a} / ${b}`);
}

export function verb(winner, loser) {
  return beats(winner, loser) ? VERBS[winner][loser] : null;
}

/** Ergebnissatz, z. B. „Spock verdampft Stein“ oder „Unentschieden – beide Stein“. */
export function resultSentence(a, b) {
  const o = outcome(a, b);
  if (o === 0) return `Unentschieden – beide ${MOVE_NAMES[a]}`;
  const [w, l] = o === 1 ? [a, b] : [b, a];
  return `${MOVE_NAMES[w]} ${VERBS[w][l]} ${MOVE_NAMES[l]}`;
}

/** Alle Züge der Variante, die `move` schlagen. */
export function countersOf(move, variant) {
  return movesFor(variant).filter((m) => beats(m, move));
}

/** Siege nötig für Best of n (3 → 2, 5 → 3). */
export function targetWins(bestOf) {
  return Math.floor(bestOf / 2) + 1;
}
