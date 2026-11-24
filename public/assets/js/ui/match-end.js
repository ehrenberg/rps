// Matchende-Overlay (Sieg/Niederlage). Wiederverwendbar für Online-Revanche (Beschriftungen per Option).
import { h } from './dom.js';
import { icon } from './icons.js';

/**
 * @param {{ won:boolean, score:[number,number], myName:string, oppName:string,
 *           againLabel?:string, note?:string|null, onAgain:Function, onMenu?:Function }} o
 * @returns {{ el: HTMLElement, focus(): void }}
 */
export function matchEndOverlay({ won, score, myName, oppName, againLabel = 'Nochmal', note = null, onAgain, onMenu }) {
  const again = h('button', { type: 'button', class: 'btn btn--primary btn--lg', onclick: onAgain }, icon('replay'), againLabel);
  const menu = h('a', { class: 'btn btn--ghost btn--lg', href: '#/', onclick: onMenu }, icon('home'), 'Menü');
  const card = h('div', { class: 'overlay__card glass' },
    h('div', { class: 'overlay__emblem', 'aria-hidden': 'true' }, won ? '🏆' : '💪'),
    h('h2', { class: 'overlay__title', id: 'match-end-title' }, won ? 'Sieg!' : 'Niederlage'),
    h('p', { class: 'overlay__score' },
      h('span', { class: 'overlay__me' }, myName), ' ',
      h('strong', {}, `${score[0]} : ${score[1]}`), ' ',
      h('span', { class: 'overlay__opp' }, oppName)),
    h('p', { class: 'overlay__text' }, note ?? (won ? 'Stark gespielt!' : 'Knapp daneben – gleich nochmal?')),
    h('div', { class: 'overlay__actions' }, again, menu));
  const el = h('div', {
    class: ['overlay', won ? 'overlay--win' : 'overlay--lose'],
    role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'match-end-title',
  }, card);
  // Fokus im Dialog halten (nur zwei Bedienelemente)
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const order = [again, menu];
    const i = order.indexOf(document.activeElement);
    e.preventDefault();
    order[(i + (e.shiftKey ? -1 : 1) + order.length) % order.length].focus();
  });
  return { el, focus: () => again.focus() };
}
