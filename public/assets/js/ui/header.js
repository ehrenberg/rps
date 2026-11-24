// Globaler Header: Marke (→ Start), „Meine Spiele“ (nur mit offenen Räumen, mit Badge), Ton-Schalter,
// „Effekte reduzieren“, Einstellungen.
import { h } from './dom.js';
import { icon } from './icons.js';
import { toggleButton, countBadge } from './components.js';
import { brandMark } from './logo.js';
import { hrefFor } from '../router.js';
import * as audio from '../audio.js';

export function mountHeader(container, { settings, prefs, rooms = null }) {
  const sound = toggleButton({
    label: 'Ton', pressed: audio.isEnabled(), iconOn: 'soundOn', iconOff: 'soundOff',
    className: 'btn--icon toggle--icon', showLabel: false, onChange: (on) => prefs.setSound(on),
  });
  const calm = toggleButton({
    label: 'Effekte reduzieren', pressed: settings.getReducedFx(), iconOn: 'calm', iconOff: 'sparkle',
    className: 'btn--icon toggle--icon', showLabel: false, onChange: (on) => prefs.setReducedFx(on),
  });
  sound.el.title = 'Ton an/aus';
  calm.el.title = 'Effekte reduzieren';
  prefs.subscribe(() => {
    sound.set(audio.isEnabled());
    calm.set(settings.getReducedFx());
  });
  const games = h('a', { class: 'btn btn--ghost btn--icon header__games', href: hrefFor('games'), title: 'Meine Spiele', hidden: true });
  const updateGames = () => {
    const open = rooms?.list().length ?? 0;
    games.hidden = open === 0;
    games.replaceChildren(icon('games'), h('span', { class: 'visually-hidden' }, 'Meine Spiele'), ...(countBadge(rooms?.alertCount() ?? 0) ?? []));
  };
  updateGames();
  rooms?.subscribe(updateGames);
  container.replaceChildren(
    h('a', { class: 'brand', href: hrefFor('home'), 'aria-label': 'SSP – Schere Stein Papier, zum Start' },
      brandMark(), h('span', { class: 'brand__text', 'aria-hidden': 'true' }, 'SSP')),
    h('div', { class: 'header__actions' },
      games, sound.el, calm.el,
      h('a', { class: 'btn btn--ghost btn--icon', href: hrefFor('settings'), 'aria-label': 'Einstellungen', title: 'Einstellungen' }, icon('gear'))));
}
