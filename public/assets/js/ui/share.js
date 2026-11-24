// Einladung teilen: Raumcode, Link kopieren, navigator.share, QR-Code (qr.js, dunkel auf weiß).
import { h } from './dom.js';
import { icon } from './icons.js';
import { showToast } from './toast.js';
import { qrSvg } from '../qr.js';

export function roomUrl(code) {
  return `${location.origin}${location.pathname}#${code}`;
}

async function copyText(text, input) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    input.select();
    try { return document.execCommand('copy'); } catch { return false; }
  }
}

/** QR-Code mit Alternativtext; der Link selbst steht im Feld darüber. */
function qrImage(url) {
  const svg = qrSvg(url);
  svg.setAttribute('aria-label', `QR-Code mit dem Einladungslink ${url}`);
  return svg;
}

/** @returns {HTMLElement} */
export function shareCard({ code, title, text }) {
  const url = roomUrl(code);
  const input = h('input', { class: 'input share__link', type: 'text', readonly: true, value: url, 'aria-label': 'Einladungslink', onfocus: (e) => e.target.select() });
  const copy = h('button', {
    type: 'button', class: 'btn btn--primary',
    onclick: async () => {
      const ok = await copyText(url, input);
      showToast(ok ? 'Link kopiert – jetzt verschicken!' : 'Kopieren ging nicht – bitte Link markieren.', { kind: ok ? 'success' : 'error' });
    },
  }, icon('copy'), 'Link kopieren');
  const share = typeof navigator.share === 'function'
    ? h('button', {
      type: 'button', class: 'btn',
      onclick: () => navigator.share({ title, text, url }).catch(() => {}),
    }, icon('share'), 'Teilen')
    : null;
  return h('div', { class: 'share glass' },
    h('p', { class: 'share__code' },
      h('span', { class: 'visually-hidden' }, `Raumcode ${code.split('').join(' ')}`),
      code.split('').map((c) => h('span', { 'aria-hidden': 'true' }, c))),
    h('div', { class: 'share__row' }, input),
    h('div', { class: 'share__actions' }, copy, share),
    h('figure', { class: 'share__qr' }, qrImage(url), h('figcaption', {}, 'Mit dem Handy scannen')));
}
