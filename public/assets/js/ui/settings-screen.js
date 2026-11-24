// Einstellungen: Name, Ton, Effekte, Benachrichtigungen.
import { h } from './dom.js';
import { screenLayout, nameInput, toggleButton } from './components.js';
import { showToast } from './toast.js';
import * as audio from '../audio.js';
import { createNotifier } from '../notify.js';

export const title = 'Einstellungen';

function row(labelText, hint, control) {
  return h('div', { class: 'setting' },
    h('div', { class: 'setting__text' }, h('span', { class: 'setting__label' }, labelText), h('span', { class: 'setting__hint' }, hint)),
    control);
}

const NOTIFY_LABEL = 'Benachrichtigungen, wenn dein Gegner da ist';

function notifyHint(notifier) {
  const p = notifier?.permission() ?? 'unsupported';
  if (p === 'unsupported') return 'Dein Browser unterstützt keine Benachrichtigungen – Hinweise kommen dann nur in der App.';
  if (p === 'denied') return 'Im Browser blockiert. Erlaube Benachrichtigungen in den Website-Einstellungen, dann klappt es.';
  return 'Systemmeldung, wenn jemand deinem Spiel beitritt oder dein Match beginnt – auch im Hintergrund-Tab.';
}

/** Schalter für System-Benachrichtigungen; fragt den Browser nur beim Einschalten (Klick). */
function notifyRow(notifier) {
  const hint = h('span', { class: 'setting__hint' }, notifyHint(notifier));
  const toggle = toggleButton({
    label: NOTIFY_LABEL, pressed: Boolean(notifier?.isEnabled()), iconOn: 'bell', className: 'toggle--switch',
    onChange: async (on) => {
      if (!notifier) return;
      if (!on) { notifier.disable(); return; }
      const result = await notifier.enable();
      if (result !== 'granted') {
        toggle.set(false);
        showToast(result === 'denied' ? 'Benachrichtigungen sind im Browser blockiert.' : 'Benachrichtigungen sind hier nicht möglich.', { kind: 'error' });
      }
      hint.textContent = notifyHint(notifier);
    },
  });
  if (!notifier?.supported) toggle.el.disabled = true;
  return h('div', { class: 'setting' },
    h('div', { class: 'setting__text' }, h('span', { class: 'setting__label' }, NOTIFY_LABEL), hint),
    toggle.el);
}

export function render({ settings, prefs, notifier = createNotifier() }) {
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
      row('Effekte reduzieren', 'Keine Partikel, kein Wackeln – das Spiel bleibt gleich.', fxToggle.el),
      notifyRow(notifier)),
    h('p', { class: 'muted settings__privacy' }, 'Keine Cookies, keine Tracker: Name, Einstellungen und Statistik bleiben nur in diesem Browser.'));
  return { el, dispose: unsubscribe };
}
