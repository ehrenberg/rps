// Wortmarke „Schere · Stein · Papier“ mit drei Hand-Icons (Typo + SVG, keine Bilddatei).
import { h } from './dom.js';
import { handIcon } from '../hands.js';

const WORDS = Object.freeze([
  { move: 'scissors', text: 'Schere' },
  { move: 'rock', text: 'Stein' },
  { move: 'paper', text: 'Papier' },
]);

/** Großes Logo für den Startscreen; als h1 fokussierbar. */
export function logo({ id = 'home-title' } = {}) {
  return h('h1', { class: 'logo', id, tabindex: '-1' },
    WORDS.map(({ move, text }, i) => h('span', { class: `logo__word logo__word--${i + 1}` },
      h('span', { class: 'logo__icon', 'aria-hidden': 'true' }, handIcon(move)),
      h('span', { class: 'logo__text' }, text))));
}

/** Kleine Marke für den Header. */
export function brandMark() {
  return h('span', { class: 'brand__mark', 'aria-hidden': 'true' }, handIcon('scissors'));
}
