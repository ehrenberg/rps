// Wiederverwendbare Bausteine: Screen-Gerüst, Schalter, Auswahlgruppe, Namensfeld, Bestätigung.
import { h } from './dom.js';
import { icon } from './icons.js';
import { truncateName } from '../settings.js';

/**
 * Einheitliches Screen-Gerüst: optionaler Zurück-Link, Überschrift (fokussierbar), Untertitel.
 * @returns {{ el: HTMLElement, body: HTMLElement, heading: HTMLElement }}
 */
export function screenLayout({ id, title, subtitle = null, backHref = '#/', backLabel = 'Zurück', className = '' }) {
  const heading = h('h1', { class: 'screen__title', tabindex: '-1', id: `${id}-title` }, title);
  const head = h('header', { class: 'screen__head' },
    backHref ? h('a', { class: 'btn btn--ghost btn--icon screen__back', href: backHref, 'aria-label': backLabel },
      icon('back'), h('span', { class: 'screen__back-label' }, backLabel)) : null,
    h('div', { class: 'screen__titles' },
      heading,
      subtitle ? h('p', { class: 'screen__subtitle' }, subtitle) : null));
  const body = h('div', { class: 'screen__body' });
  const el = h('section', { class: ['screen', `screen--${id}`, className], 'aria-labelledby': heading.id }, head, body);
  return { el, body, heading };
}

/** Umschalter mit aria-pressed. onChange(neuerWert). */
export function toggleButton({ label, pressed = false, onChange, iconOn = null, iconOff = null, className = '', showLabel = true }) {
  const btn = h('button', { type: 'button', class: ['btn', 'toggle', className] });
  const set = (value) => {
    btn.setAttribute('aria-pressed', String(Boolean(value)));
    btn.replaceChildren(
      ...(iconOn ? [icon(value ? iconOn : iconOff ?? iconOn)] : []),
      showLabel ? h('span', { class: 'toggle__label' }, label) : h('span', { class: 'visually-hidden' }, label),
      h('span', { class: 'toggle__knob', 'aria-hidden': 'true' }),
    );
  };
  set(pressed);
  btn.addEventListener('click', () => {
    const next = btn.getAttribute('aria-pressed') !== 'true';
    set(next);
    onChange?.(next);
  });
  return { el: btn, set };
}

/**
 * Auswahlgruppe als Radiogruppe aus Buttons (Pfeiltasten wechseln).
 * options: [{ value, label, description?, extra? (Node) }]
 */
export function choiceGroup({ label, name, options, value, onChange, columns = options.length }) {
  const buttons = [];
  const group = h('div', { class: 'choice', role: 'radiogroup', 'aria-label': label, dataset: { name }, style: { '--cols': String(columns) } });
  const select = (v, focus = false) => {
    for (const b of buttons) {
      const on = b.dataset.value === String(v);
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    }
  };
  options.forEach((opt, index) => {
    const b = h('button', {
      type: 'button', role: 'radio', class: 'choice__option', dataset: { value: String(opt.value) },
      onclick: () => { select(opt.value); onChange(opt.value); },
      onkeydown: (e) => {
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
        if (!step) return;
        e.preventDefault();
        const next = options[(index + step + options.length) % options.length];
        select(next.value, true);
        onChange(next.value);
      },
    },
    opt.extra ?? null,
    h('span', { class: 'choice__label' }, opt.label),
    opt.description ? h('span', { class: 'choice__desc' }, opt.description) : null);
    buttons.push(b);
    group.append(b);
  });
  select(value);
  return { el: h('fieldset', { class: 'field' }, h('legend', { class: 'field__label' }, label), group), select };
}

/**
 * Namensfeld (rps.name), speichert beim Tippen. Kein maxlength (zählt UTF-16-Einheiten und zerschneidet
 * Emoji wie 🏳️‍🌈): stattdessen grapheme-sicher auf 20 Zeichen kürzen, sobald die Eingabe fertig ist.
 */
export function nameInput({ settings, id = 'player-name', label = 'Dein Name', onChange }) {
  const input = h('input', {
    id, class: 'input', type: 'text', autocomplete: 'nickname',
    placeholder: 'z. B. Anna', spellcheck: 'false', enterkeyhint: 'done',
  });
  input.value = settings.getName();
  input.addEventListener('input', (e) => {
    if (!e.isComposing) {
      const limited = truncateName(input.value);
      if (limited !== input.value) input.value = limited;
    }
    const name = settings.setName(input.value); // nicht in onChange?.() – das wertet ohne onChange nichts aus
    onChange?.(name);
  });
  input.addEventListener('change', () => { input.value = settings.setName(input.value); });
  const el = h('div', { class: 'field field--name' },
    h('label', { class: 'field__label', for: id }, label),
    h('div', { class: 'input-wrap' }, icon('user'), input));
  return { el, input };
}

/** Bestätigungsdialog (<dialog>), löst mit true/false auf. */
export function confirmDialog({ title, text, confirmLabel = 'OK', cancelLabel = 'Abbrechen', danger = false }) {
  return new Promise((resolve) => {
    const dialog = h('dialog', { class: 'dialog glass', 'aria-labelledby': 'dialog-title', 'aria-describedby': 'dialog-text' },
      h('h2', { class: 'dialog__title', id: 'dialog-title' }, title),
      h('p', { class: 'dialog__text', id: 'dialog-text' }, text),
      h('div', { class: 'dialog__actions' },
        h('button', { type: 'button', class: 'btn btn--ghost', value: 'cancel', onclick: () => dialog.close('cancel') }, cancelLabel),
        h('button', { type: 'button', class: ['btn', danger ? 'btn--danger' : 'btn--primary'], onclick: () => dialog.close('ok') }, confirmLabel)));
    // Fokusfalle: Tab wechselt nur zwischen den Buttons (Escape schließt nativ → Abbrechen).
    dialog.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const buttons = [...dialog.querySelectorAll('button')];
      const i = buttons.indexOf(document.activeElement);
      e.preventDefault();
      buttons[(i + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
    });
    dialog.addEventListener('close', () => { dialog.remove(); resolve(dialog.returnValue === 'ok'); });
    document.body.append(dialog);
    dialog.showModal();
  });
}
