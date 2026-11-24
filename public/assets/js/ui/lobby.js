// Lobby: Einladung teilen, warten (Duell) bzw. Spielerliste + Start (Turnier).
import { h, replaceChildren } from './dom.js';
import { icon } from './icons.js';
import { screenLayout } from './components.js';
import { shareCard } from './share.js';
import { handIcon } from '../hands.js';
import { VARIANT_NAMES } from '../rules.js';
import { singleFlight } from '../throttle.js';
import { hrefFor } from '../router.js';

export const MIN_TOURNAMENT_PLAYERS = 3;
export const MAX_TOURNAMENT_PLAYERS = 16;

const activePlayers = (state) => (state.players ?? []).filter((p) => !p.spectator && !p.left);

function waitingAnimation(text) {
  return h('div', { class: 'waiting' },
    h('div', { class: 'waiting__hands', 'aria-hidden': 'true' },
      ['rock', 'paper', 'scissors'].map((m) => h('span', { class: 'waiting__hand' }, handIcon(m)))),
    h('p', { class: 'waiting__text' }, text, h('span', { class: 'waiting__dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'))));
}

/** Hinweis: Warten muss man nicht hier – das Spiel bleibt unter „Meine Spiele“. */
function awayNote(isDuel) {
  return h('div', { class: 'lobby__away' },
    icon('bell', { size: 20 }),
    h('div', {},
      h('p', {}, `Du kannst die Seite verlassen – wir sagen Bescheid, ${isDuel ? 'wenn jemand beitritt' : 'wenn dein Match beginnt'}. Deine Spiele findest du unter „Meine Spiele“.`),
      h('a', { class: 'btn btn--ghost lobby__games', href: hrefFor('games') }, icon('games', { size: 20 }), 'Meine Spiele')));
}

/** Einmaliges Angebot für System-Benachrichtigungen (Erlaubnis nur per Klick anfragen). */
function notifyOffer(notifier, isDuel) {
  if (!notifier?.shouldOfferHint()) return null;
  const box = h('section', { class: 'notify-offer glass', 'aria-labelledby': 'notify-offer-title' });
  const done = (text) => {
    const msg = h('p', { class: 'notify-offer__done', tabindex: '-1' }, text);
    replaceChildren(box, msg);
    msg.focus({ preventScroll: true });
  };
  const yes = h('button', {
    type: 'button', class: 'btn btn--primary',
    onclick: async () => {
      yes.disabled = true;
      const result = await notifier.enable();
      done(result === 'granted'
        ? 'Alles klar – du bekommst eine Benachrichtigung, auch wenn der Tab im Hintergrund ist.'
        : 'Benachrichtigungen sind im Browser blockiert. Du siehst Neuigkeiten trotzdem hier in der App.');
    },
  }, icon('bell'), 'Ja, benachrichtigen');
  const no = h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => { notifier.dismissHint(); done('Okay – du kannst das jederzeit in den Einstellungen ändern.'); } }, 'Nein, danke');
  box.append(
    h('h2', { class: 'notify-offer__title', id: 'notify-offer-title' }, `Soll ich dich benachrichtigen, wenn ${isDuel ? 'jemand beitritt' : 'dein Match beginnt'}?`),
    h('p', { class: 'muted' }, 'Klappt auch, wenn der Tab im Hintergrund ist. Dein Browser fragt einmal nach.'),
    h('div', { class: 'notify-offer__actions' }, yes, no));
  return box;
}

/**
 * @param {{ state, me, code, onStart:()=>Promise|void, onLeave:()=>void, announce?:(text:string)=>void, notifier? }} o
 * @returns {{ el, focus, update(state), dispose }}
 */
export function lobbyView({ state: initial, me, code, onStart, onLeave, announce = null, notifier = null }) {
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
  body.append(...[status, awayNote(isDuel), notifyOffer(notifier, isDuel), share, isDuel ? null : listPanel, h('div', { class: 'lobby__footer' }, leave)].filter(Boolean));
  let lastState = initial;
  // „Turnier starten“ nur einmal anfragen, bis die Antwort da ist
  const start = singleFlight(() => onStart(), { onChange: () => update(lastState) });

  let known = null; // Spieler-IDs für Beitritts-Ansagen
  function update(state) {
    lastState = state;
    const players = activePlayers(state);
    // Start-Button wird neu gebaut: Fokus übernehmen statt an <body> zu verlieren.
    const hadFocus = status.contains(document.activeElement);
    if (known) {
      for (const p of players) if (!known.has(p.id) && p.id !== me) announce?.(`${p.name} ist beigetreten.`);
    }
    known = new Set(players.map((p) => p.id));
    const isHost = state.host === me;
    if (isDuel) {
      replaceChildren(status, waitingAnimation('Warte auf deinen Gegner'),
        h('p', { class: 'muted' }, 'Schick den Link – das Match startet, sobald jemand beitritt.'));
      return;
    }
    replaceChildren(list, players.map((p) => h('li', { class: ['player-row', p.id === me && 'player-row--me'] },
      h('span', { class: ['dot', p.online ? 'dot--on' : 'dot--off'], 'aria-hidden': 'true' }),
      h('span', { class: 'player-row__name' }, p.name, h('span', { class: 'visually-hidden' }, p.online ? ' (online)' : ' (offline)')),
      p.id === state.host ? h('span', { class: 'player-row__tag', title: 'Host' }, icon('crown', { size: 16 }), 'Host') : null,
      p.id === me ? h('span', { class: 'player-row__tag player-row__tag--me' }, 'du') : null)));
    const count = h('p', { class: 'lobby__count' }, h('strong', {}, String(players.length)), ` / ${MAX_TOURNAMENT_PLAYERS} Spieler`);
    if (isHost) {
      const enough = players.length >= MIN_TOURNAMENT_PLAYERS;
      replaceChildren(status, count,
        h('button', { type: 'button', class: 'btn btn--primary btn--lg btn--start', disabled: !enough || start.busy, onclick: () => start() }, 'Turnier starten', icon('trophy')),
        h('p', { class: 'muted' }, enough ? 'Alle da? Dann los!' : `Ab ${MIN_TOURNAMENT_PLAYERS} Spielern – teil den Link.`));
    } else {
      const host = (state.players ?? []).find((p) => p.id === state.host)?.name ?? 'Host';
      replaceChildren(status, count, waitingAnimation(`Warte auf ${host}`));
    }
    if (hadFocus) (status.querySelector('button:not([disabled])') ?? heading).focus({ preventScroll: true });
  }
  update(initial);
  return { el, focus: () => heading.focus({ preventScroll: true }), update, dispose() {} };
}
