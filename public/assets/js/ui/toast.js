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
 * @param {{ kind?: 'info'|'error'|'success', duration?: number }} [o] duration 0 = bleibt bis close()
 * @returns {{ close(): void }}
 */
export function showToast(message, { kind = 'info', duration = kind === 'error' ? ERROR_TOAST_MS : TOAST_MS } = {}) {
  const el = h('div', { class: ['toast', `toast--${kind}`] }, icon(KIND_ICON[kind] ?? 'sparkle', { size: 18 }), h('span', {}, message));
  getRegion().append(el);
  let timer = null;
  const close = () => {
    clearTimeout(timer);
    el.classList.add('toast--out');
    setTimeout(() => el.remove(), 250);
  };
  if (duration > 0) timer = setTimeout(close, duration);
  return { close };
}

/** Fehler aus ApiError/Error anzeigen. */
export function showError(err) {
  return showToast(err?.message ?? String(err), { kind: 'error' });
}
