// Einstellungen: Name, Ton, Effekte.
import { h } from './dom.js';
import { screenLayout, nameInput, toggleButton } from './components.js';
import * as audio from '../audio.js';

export const title = 'Einstellungen';

function row(labelText, hint, control) {
  return h('div', { class: 'setting' },
    h('div', { class: 'setting__text' }, h('span', { class: 'setting__label' }, labelText), h('span', { class: 'setting__hint' }, hint)),
    control);
}

export function render({ settings, prefs }) {
  const { el, body } = screenLayout({ id: 'settings', title: 'Einstellungen' });
  const sound = toggleButton({ label: 'Ton', pressed: audio.isEnabled(), iconOn: 'soundOn', iconOff: 'soundOff', className: 'toggle--switch', onChange: (on) => prefs.setSound(on) });
  const fxToggle = toggleButton({ label: 'Effekte reduzieren', pressed: settings.getReducedFx(), iconOn: 'calm', className: 'toggle--switch', onChange: (on) => prefs.setReducedFx(on) });
  const unsubscribe = prefs.subscribe(() => {
    sound.set(audio.isEnabled());
    fxToggle.set(settings.getReducedFx());
  });
  body.append(
    h('div', { class: 'panel glass' }, nameInput({ settings, id: 'settings-name' }).el),
    h('div', { class: 'panel glass settings-list' },
      row('Ton', 'Synthetische Sounds bei Countdown, Treffern und Sieg.', sound.el),
      row('Effekte reduzieren', 'Keine Partikel, kein Wackeln – das Spiel bleibt gleich.', fxToggle.el)),
    h('p', { class: 'muted settings__privacy' }, 'Keine Cookies, keine Tracker: Name, Einstellungen und Statistik bleiben nur in diesem Browser.'));
  return { el, dispose: unsubscribe };
}
