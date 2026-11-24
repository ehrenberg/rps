// Matchende-Overlay (Sieg/Niederlage). Wiederverwendbar für Online-Revanche (Beschriftungen per Option).
import { h } from './dom.js';
import { icon } from './icons.js';

const VIEW = Object.freeze({
  win: { emblem: '🏆', title: 'Sieg!', text: 'Stark gespielt!' },
  lose: { emblem: '💪', title: 'Niederlage', text: 'Knapp daneben – gleich nochmal?' },
  none: { emblem: '🤝', title: 'Kein Sieger', text: 'Das Match endet ohne Sieger.' },
});

/**
 * won: true = Sieg, false = Niederlage, null = Match ohne Sieger (neutral).
 * @param {{ won:boolean|null, score:[number,number], myName:string, oppName:string,
 *           againLabel?:string, note?:string|null, series?:{me:number,opp:number}|null,
 *           onAgain:Function, onMenu?:Function }} o
 * @returns {{ el: HTMLElement, focus(): void, update(o:{status?:string|null, againDisabled?:boolean, highlight?:boolean}): void }}
 */
export function matchEndOverlay({ won, score, myName, oppName, againLabel = 'Nochmal', note = null, series = null, onAgain, onMenu }) {
  const key = won === null || won === undefined ? 'none' : won ? 'win' : 'lose';
  const again = h('button', { type: 'button', class: 'btn btn--primary btn--lg', onclick: onAgain }, icon('replay'), againLabel);
  const menu = h('a', { class: 'btn btn--ghost btn--lg', href: '#/', onclick: onMenu }, icon('home'), 'Menü');
  const status = h('p', { class: 'overlay__status', role: 'status', hidden: true });
  const card = h('div', { class: 'overlay__card glass' },
    h('div', { class: 'overlay__emblem', 'aria-hidden': 'true' }, VIEW[key].emblem),
    h('h2', { class: 'overlay__title', id: 'match-end-title' }, VIEW[key].title),
    h('p', { class: 'overlay__score' },
      h('span', { class: 'overlay__me' }, myName), ' ',
      h('strong', {}, `${score[0]} : ${score[1]}`), ' ',
      h('span', { class: 'overlay__opp' }, oppName)),
    series ? h('p', { class: 'overlay__series' }, `Serie ${series.me} : ${series.opp}`) : null,
    h('p', { class: 'overlay__text' }, note ?? VIEW[key].text),
    status,
    h('div', { class: 'overlay__actions' }, again, menu));
  const el = h('div', {
    class: ['overlay', `overlay--${key}`],
    role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'match-end-title',
  }, card);
  // Fokus im Dialog halten (nur zwei Bedienelemente)
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const order = [again, menu].filter((b) => !b.disabled);
    const i = order.indexOf(document.activeElement);
    e.preventDefault();
    order[(i + (e.shiftKey ? -1 : 1) + order.length) % order.length].focus();
  });
  return {
    el,
    focus: () => (again.disabled ? menu : again).focus(),
    update({ status: text = null, againDisabled = false, highlight = false }) {
      status.hidden = !text;
      status.textContent = text ?? '';
      status.classList.toggle('overlay__status--hot', highlight);
      const hadFocus = document.activeElement === again;
      again.disabled = againDisabled;
      if (againDisabled && hadFocus) menu.focus();
    },
  };
}
