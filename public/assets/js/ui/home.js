// Startscreen: Logo, Name, Spielmodi.
import { h } from './dom.js';
import { icon } from './icons.js';
import { nameInput } from './components.js';
import { logo } from './logo.js';
import { hrefFor } from '../router.js';

export const title = 'Start';

const MODES = Object.freeze([
  { route: 'cpu', icon: 'cpu', title: 'Gegen Computer', text: 'Vier Stufen – vom Zufall bis zum Gedankenleser.', accent: 'a' },
  { route: 'duel', icon: 'duel', title: 'Online-Duell', text: 'Link schicken, Freund fordern, fair spielen.', accent: 'b' },
  { route: 'tournament', icon: 'trophy', title: 'Turnier', text: 'Bis zu 16 Leute im K.-o.-System.', accent: 'c' },
  { route: 'stats', icon: 'chart', title: 'Statistik', text: 'Siege, Serien und wie vorhersehbar du bist.', accent: 'd' },
]);

function modeCard(mode) {
  return h('a', { class: ['card', 'glass', `card--${mode.accent}`], href: hrefFor(mode.route) },
    h('span', { class: 'card__icon' }, icon(mode.icon, { size: 30 })),
    h('span', { class: 'card__body' },
      h('span', { class: 'card__title' }, mode.title),
      h('span', { class: 'card__text' }, mode.text)),
    h('span', { class: 'card__arrow', 'aria-hidden': 'true' }, '›'));
}

export function render({ settings }) {
  const el = h('section', { class: 'screen screen--home', 'aria-labelledby': 'home-title' },
    h('div', { class: 'hero' },
      logo(),
      h('p', { class: 'hero__tagline' }, 'Das älteste Duell der Welt – schöner als je zuvor.')),
    h('div', { class: 'home__name glass' }, nameInput({ settings }).el),
    h('nav', { class: 'cards', 'aria-label': 'Spielmodi' }, MODES.map(modeCard)));
  return { el };
}
