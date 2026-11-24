// Lobby: Einladung teilen, warten (Duell) bzw. Spielerliste + Start (Turnier).
import { h, replaceChildren } from './dom.js';
import { icon } from './icons.js';
import { screenLayout } from './components.js';
import { shareCard } from './share.js';
import { handIcon } from '../hands.js';
import { VARIANT_NAMES } from '../rules.js';

export const MIN_TOURNAMENT_PLAYERS = 3;
export const MAX_TOURNAMENT_PLAYERS = 16;

const activePlayers = (state) => (state.players ?? []).filter((p) => !p.spectator && !p.left);

function waitingAnimation(text) {
  return h('div', { class: 'waiting' },
    h('div', { class: 'waiting__hands', 'aria-hidden': 'true' },
      ['rock', 'paper', 'scissors'].map((m) => h('span', { class: 'waiting__hand' }, handIcon(m)))),
    h('p', { class: 'waiting__text' }, text, h('span', { class: 'waiting__dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'))));
}

/**
 * @param {{ state, me, code, onStart:()=>void, onLeave:()=>void }} o
 * @returns {{ el, focus, update(state), dispose }}
 */
export function lobbyView({ state: initial, me, code, onStart, onLeave }) {
  const isDuel = initial.type === 'duel';
  const { el, body, heading } = screenLayout({
    id: 'lobby',
    title: isDuel ? 'Online-Duell' : 'Turnier-Lobby',
    subtitle: `${VARIANT_NAMES[initial.variant]} · Best of ${initial.bestOf}`,
  });
  const share = shareCard({
    code,
    title: 'Schere Stein Papier',
    text: isDuel ? 'Ich fordere dich heraus – Schere, Stein, Papier!' : 'Spiel mit beim Schere-Stein-Papier-Turnier!',
  });
  const status = h('div', { class: 'lobby__status glass' });
  const list = h('ul', { class: 'players', 'aria-label': 'Spieler' });
  const listPanel = h('section', { class: 'panel glass' }, h('h2', { class: 'panel__title' }, 'Spieler'), list);
  const leave = h('button', { type: 'button', class: 'btn btn--ghost', onclick: onLeave }, icon('door', { size: 18 }), 'Raum verlassen');
  body.append(...[status, share, isDuel ? null : listPanel, h('div', { class: 'lobby__footer' }, leave)].filter(Boolean));

  function update(state) {
    const players = activePlayers(state);
    const isHost = state.host === me;
    if (isDuel) {
      replaceChildren(status, waitingAnimation('Warte auf deinen Gegner'),
        h('p', { class: 'muted' }, 'Schick den Link – das Match startet, sobald jemand beitritt.'));
      return;
    }
    replaceChildren(list, players.map((p) => h('li', { class: ['player-row', p.id === me && 'player-row--me'] },
      h('span', { class: ['dot', p.online ? 'dot--on' : 'dot--off'], 'aria-label': p.online ? 'online' : 'offline' }),
      h('span', { class: 'player-row__name' }, p.name),
      p.id === state.host ? h('span', { class: 'player-row__tag', title: 'Host' }, icon('crown', { size: 16 }), 'Host') : null,
      p.id === me ? h('span', { class: 'player-row__tag player-row__tag--me' }, 'du') : null)));
    const count = h('p', { class: 'lobby__count' }, h('strong', {}, String(players.length)), ` / ${MAX_TOURNAMENT_PLAYERS} Spieler`);
    if (isHost) {
      const enough = players.length >= MIN_TOURNAMENT_PLAYERS;
      replaceChildren(status, count,
        h('button', { type: 'button', class: 'btn btn--primary btn--lg btn--start', disabled: !enough, onclick: onStart }, 'Turnier starten', icon('trophy')),
        h('p', { class: 'muted' }, enough ? 'Alle da? Dann los!' : `Ab ${MIN_TOURNAMENT_PLAYERS} Spielern – teil den Link.`));
    } else {
      const host = (state.players ?? []).find((p) => p.id === state.host)?.name ?? 'Host';
      replaceChildren(status, count, waitingAnimation(`Warte auf ${host}`));
    }
  }
  update(initial);
  return { el, focus: () => heading.focus({ preventScroll: true }), update, dispose() {} };
}
