// Turnierbaum: Runden-Spalten mit Live-Status, eigenes Match hervorgehoben, Reaktionen, Siegerehrung.
import { h, replaceChildren } from './dom.js';
import { icon } from './icons.js';
import { screenLayout } from './components.js';
import { REACTIONS } from './arena-view.js';
import { buildBracket, tournamentRole, MATCH_STATUS } from '../bracket.js';
import { VARIANT_NAMES } from '../rules.js';
import * as fx from '../fx.js';
import * as audio from '../audio.js';
import { centerOf } from './dom.js';

const REACTION_COOLDOWN_MS = 1000;
const STATUS_TEXT = Object.freeze({ live: 'läuft', done: 'fertig', bye: 'Freilos', pending: 'wartet' });
const ROLE_TEXT = Object.freeze({
  spectator: 'Du schaust zu – feuere alle an!',
  playing: 'Dein Match läuft!',
  waiting: 'Du bist weiter – warte auf deinen nächsten Gegner …',
  out: 'Ausgeschieden – aber zuschauen macht auch Spaß.',
  champion: 'Du hast das Turnier gewonnen!',
});

function slotEl(slot) {
  if (!slot.id) return h('li', { class: 'slot slot--empty' }, h('span', { class: 'slot__name' }, slot.placeholder));
  return h('li', { class: ['slot', slot.won && 'slot--won', slot.me && 'slot--me', slot.left && 'slot--left'] },
    h('span', { class: 'slot__name' }, slot.name),
    slot.score !== null ? h('span', { class: 'slot__score' }, String(slot.score)) : null);
}

/** Vorlesetext je Platz: „Anna (du) 2, weiter“. */
function slotText(s) {
  if (!s.id) return s.placeholder;
  return [s.name, s.me ? '(du)' : null, s.score !== null ? String(s.score) : null, s.won ? 'weiter' : null, s.left ? 'hat verlassen' : null]
    .filter(Boolean).join(' ');
}

function matchEl(m) {
  return h('li', { class: ['bmatch', `bmatch--${m.status}`, m.mine && 'bmatch--mine'], 'aria-label': `${m.label}: ${m.slots.map(slotText).join(' gegen ')}, ${STATUS_TEXT[m.status]}${m.mine ? ', dein Match' : ''}` },
    h('div', { class: 'bmatch__head' }, h('span', {}, m.label), h('span', { class: `bmatch__badge bmatch__badge--${m.status}` }, STATUS_TEXT[m.status])),
    h('ol', { class: 'bmatch__slots' }, m.slots.map(slotEl)));
}

/**
 * @param {{ state, me, onReact:(emoji)=>void, onRestart:()=>void, onPlay:()=>void, onLeave:()=>void,
 *           announce?:(text:string)=>void }} o
 */
export function bracketView({ state: initial, me, onReact, onRestart, onPlay, onLeave, announce = null }) {
  const { el, body, heading } = screenLayout({
    id: 'bracket', title: 'Turnier',
    subtitle: `${VARIANT_NAMES[initial.variant]} · Best of ${initial.bestOf}`,
  });
  // Kein role=status: der Inhalt wird bei jeder Zustandsversion neu gebaut; Änderungen der Rolle werden einzeln angesagt.
  const role = h('div', { class: 'bracket__role glass' });
  let lastRole = tournamentRole(initial, me);
  const tree = h('div', { class: 'bracket', role: 'region', tabindex: '0', 'aria-label': 'Turnierbaum (seitlich scrollbar)' });
  let cooldown = false;
  const reactions = h('div', { class: 'reactions', role: 'group', 'aria-label': 'Reaktion senden' },
    REACTIONS.map((emoji) => h('button', {
      type: 'button', class: 'reactions__btn', 'aria-label': `Reaktion ${emoji}`,
      onclick: (e) => {
        if (cooldown) return;
        cooldown = true;
        setTimeout(() => { cooldown = false; }, REACTION_COOLDOWN_MS);
        fx.floatEmoji(emoji, { x: centerOf(e.currentTarget).x });
        audio.play('pop');
        onReact(emoji);
      },
    }, emoji)));
  const champion = h('div', { class: 'champion', hidden: true });
  const leave = h('button', { type: 'button', class: 'btn btn--ghost', onclick: onLeave }, icon('door', { size: 18 }), 'Turnier verlassen');
  body.append(champion, role, tree, reactions, h('div', { class: 'lobby__footer' }, leave));
  let celebrated = null;

  function update(state) {
    // Neu gebaute Buttons (Zu deinem Match / Neues Turnier) übernehmen den Fokus – kein Fokusverlust beim Polling.
    const refocus = [role, champion].find((c) => c.contains(document.activeElement));
    const b = buildBracket(state, me);
    const r = tournamentRole(state, me);
    if (r !== lastRole && r !== 'champion') announce?.(ROLE_TEXT[r]);
    lastRole = r;
    replaceChildren(role,
      h('p', { class: 'bracket__role-text' }, ROLE_TEXT[r]),
      r === 'playing' ? h('button', { type: 'button', class: 'btn btn--primary', onclick: onPlay }, icon('duel', { size: 18 }), 'Zu deinem Match') : null);
    replaceChildren(tree, b.rounds.map((round) => h('section', { class: ['bround', round.index + 1 === state.round && state.status === 'running' && 'bround--current'] },
      h('h2', { class: 'bround__title' }, round.title),
      h('ol', { class: 'bround__matches' }, round.matches.map(matchEl)))));
    const mine = tree.querySelector('.bmatch--mine.bmatch--live');
    mine?.scrollIntoView?.({ block: 'nearest', inline: 'center' });

    champion.hidden = !b.champion && state.status !== 'finished';
    if (state.status === 'finished') {
      const isHost = state.host === me;
      replaceChildren(champion,
        h('div', { class: 'champion__cup', 'aria-hidden': 'true' }, '🏆'),
        h('p', { class: 'champion__label' }, 'Turniersieg'),
        h('h2', { class: 'champion__name' }, b.champion ? b.champion.name : 'Kein Sieger'),
        h('p', { class: 'champion__text' }, b.champion?.id === me ? 'Das bist du! Unschlagbar.' : 'Herzlichen Glückwunsch!'),
        isHost
          ? h('button', { type: 'button', class: 'btn btn--primary btn--lg', onclick: onRestart }, icon('replay'), 'Neues Turnier')
          : h('p', { class: 'muted' }, 'Der Host kann ein neues Turnier mit allen starten.'));
      const key = b.rounds.flatMap((rd) => rd.matches.map((m) => m.id)).join(',');
      if (b.champion && celebrated !== key) {
        announce?.(b.champion.id === me ? 'Du hast das Turnier gewonnen!' : `${b.champion.name} gewinnt das Turnier!`);
        celebrated = key;
        fx.confetti({});
        audio.play(b.champion.id === me ? 'matchWin' : 'win');
      }
    }
    if (refocus) (refocus.querySelector('button') ?? heading).focus({ preventScroll: true });
  }
  update(initial);
  return { el, focus: () => heading.focus({ preventScroll: true }), update, dispose() {} };
}
