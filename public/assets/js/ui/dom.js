// Kleine DOM-Helfer. Text wird ausschließlich über textContent/Textknoten gesetzt (nie innerHTML).

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Element bauen: h('button', { class: 'btn', onclick, 'aria-label': 'x' }, 'Text', kindElement)
 * Attribute: class, text, dataset {…}, style {…}, on<event> (Funktion), hidden (bool), sonst setAttribute.
 * Kinder: Strings/Zahlen → Textknoten, Nodes, Arrays, null/false werden übersprungen.
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  applyAttrs(el, attrs);
  append(el, children);
  return el;
}

/** SVG-Element (für Icons/Logo); Attribute werden 1:1 gesetzt. */
export function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined && v !== false) el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

function applyAttrs(el, attrs) {
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = Array.isArray(value) ? value.filter(Boolean).join(' ') : value;
    else if (key === 'text') el.textContent = String(value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style') applyStyle(el, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
}

/** Inline-Styles setzen; Custom Properties („--x“) wirken nur über style.setProperty. */
export function applyStyle(el, style) {
  for (const [prop, val] of Object.entries(style ?? {})) {
    if (prop.startsWith('--')) el.style.setProperty(prop, String(val));
    else el.style[prop] = val;
  }
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** Alle Kinder entfernen und optional neue setzen. */
export function replaceChildren(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

/** Nutzer bevorzugt weniger Bewegung (System oder Schalter „Effekte reduzieren“). */
export function prefersLessMotion() {
  return document.documentElement.dataset.reducedFx === '1'
    || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/** Wartet ms Millisekunden. */
export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Mittelpunkt eines Elements in Viewport-Koordinaten. */
export function centerOf(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Web-Animation abspielen, wenn Bewegung erlaubt ist; Promise löst am Ende auf. */
export function animate(el, keyframes, options) {
  if (prefersLessMotion() || typeof el.animate !== 'function') return Promise.resolve();
  return el.animate(keyframes, options).finished.catch(() => {});
}
