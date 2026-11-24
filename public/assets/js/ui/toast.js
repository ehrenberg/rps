// Kurze Meldungen unten am Bildschirm (Fehler, Hinweise). Text nur per textContent.
import { h } from './dom.js';
import { icon } from './icons.js';

export const TOAST_MS = 4500;
export const ERROR_TOAST_MS = 8000; // Fehler länger lesbar (WCAG 2.2.1)
const KIND_ICON = Object.freeze({ error: 'warn', info: 'sparkle', success: 'check' });

let region = null;
function getRegion() {
  if (!region || !region.isConnected) {
    region = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(region);
  }
  return region;
}

/** Live-Region beim Start anlegen: frisch eingefügte Regionen kündigen Screenreader oft nicht an. */
export function initToasts() {
  getRegion();
}

/**
 * @param {string} message
 * @param {{ kind?: 'info'|'error'|'success', duration?: number, action?: { label:string, onClick:()=>void } }} [o]
 *   duration 0 = bleibt bis close(); action: Button im Toast (schließt ihn), dazu ein Schließen-Knopf
 * @returns {{ close(): void, el: HTMLElement }}
 */
export function showToast(message, { kind = 'info', duration = kind === 'error' ? ERROR_TOAST_MS : TOAST_MS, action = null } = {}) {
  const el = h('div', { class: ['toast', `toast--${kind}`, action && 'toast--action'] }, icon(KIND_ICON[kind] ?? 'sparkle', { size: 18 }), h('span', { class: 'toast__text' }, message));
  let timer = null;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    el.classList.add('toast--out');
    setTimeout(() => el.remove(), 250);
  };
  if (action) {
    el.append(
      h('button', { type: 'button', class: 'btn btn--primary toast__action', onclick: () => { close(); action.onClick(); } }, action.label),
      h('button', { type: 'button', class: 'btn btn--ghost btn--icon toast__close', 'aria-label': 'Meldung schließen', title: 'Schließen', onclick: close }, icon('close', { size: 18 })));
  }
  getRegion().append(el);
  if (duration > 0) timer = setTimeout(close, duration);
  return { close, el };
}

/** Fehler aus ApiError/Error anzeigen. */
export function showError(err) {
  return showToast(err?.message ?? String(err), { kind: 'error' });
}
