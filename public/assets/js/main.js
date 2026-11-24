// Einstieg: App-Shell, Hash-Routing, Screen-Wechsel, globale Einstellungen.
import { parseHash, hrefFor } from './router.js';
import { createSettings } from './settings.js';
import * as audio from './audio.js';
import * as fx from './fx.js';
import { mountHeader } from './ui/header.js';
import { prefersLessMotion } from './ui/dom.js';
import { initToasts } from './ui/toast.js';
import * as home from './ui/home.js';

const APP_TITLE = 'Schere Stein Papier';
const LIVE_CLEAR_MS = 50;
const PREFETCH_FALLBACK_MS = 1500;
const LOAD_ERROR_TEXT = 'Laden fehlgeschlagen – bitte Seite neu laden.';

/**
 * Routenname → Loader für das Screen-Modul { title, render(ctx) → { el, focus?, dispose? } }.
 * Nur die Startseite ist statisch importiert (weniger Requests beim ersten Laden);
 * der Rest wird nach dem ersten Rendern im Leerlauf vorgeladen.
 */
const LOADERS = Object.freeze({
  cpu: () => import('./ui/cpu-setup.js'),
  play: () => import('./ui/arena-screen.js'),
  stats: () => import('./ui/stats-screen.js'),
  settings: () => import('./ui/settings-screen.js'),
  duel: () => import('./ui/create-room.js').then((m) => m.createRoomScreen('duel')),
  tournament: () => import('./ui/create-room.js').then((m) => m.createRoomScreen('tournament')),
  room: () => import('./ui/room.js'),
});
/** Name → geladenes Modul oder laufendes Promise. */
const screens = new Map([['home', home]]);

function loadScreen(name) {
  if (!screens.has(name)) {
    screens.set(name, LOADERS[name]().then(
      (mod) => { screens.set(name, mod); return mod; },
      (err) => { screens.delete(name); throw err; },
    ));
  }
  return Promise.resolve(screens.get(name));
}

function prefetchScreens() {
  const run = () => { for (const name of Object.keys(LOADERS)) loadScreen(name).catch(() => {}); };
  if (globalThis.requestIdleCallback) requestIdleCallback(run, { timeout: PREFETCH_FALLBACK_MS });
  else setTimeout(run, PREFETCH_FALLBACK_MS);
}

const root = document.documentElement;
const app = document.getElementById('app');
const live = document.getElementById('live');
const settings = createSettings();
const reducedMotionQuery = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');

// ─── Einstellungen, die die ganze App betreffen ───
const prefListeners = new Set();
const prefs = {
  setSound(on) {
    audio.setEnabled(on);
    if (on) audio.unlock();
    notifyPrefs();
  },
  setReducedFx(on) {
    settings.setReducedFx(on);
    applyReducedFx();
    notifyPrefs();
  },
  subscribe(fn) {
    prefListeners.add(fn);
    return () => prefListeners.delete(fn);
  },
};
function notifyPrefs() {
  for (const fn of prefListeners) fn();
}

function applyReducedFx() {
  const userChoice = settings.getReducedFx();
  if (userChoice) root.dataset.reducedFx = '1';
  else delete root.dataset.reducedFx;
  fx.setReducedFx(userChoice || reducedMotionQuery?.matches === true);
}

/** Text für Screenreader (ARIA-Live-Region). */
function announce(text) {
  live.textContent = '';
  setTimeout(() => { live.textContent = text; }, LIVE_CLEAR_MS);
}

function navigate(href) {
  if (location.hash === href) render();
  else location.hash = href;
}

// ─── Routing & Screen-Wechsel ───
let current = null;
let firstRender = true;
let lastHash = location.hash;

/** Sprungziel im Dokument (z. B. Skip-Link „#app“) fokussieren, ohne den Screen neu aufzubauen. */
function focusTarget(target) {
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.focus();
}
let renderSeq = 0;

function render() {
  const route = parseHash(location.hash);
  // In-Page-Anker (#app …) sind keine Route: laufenden Screen behalten, Hash zurücksetzen.
  const anchor = route.name === 'notFound' ? document.getElementById(location.hash.slice(1)) : null;
  if (anchor && current) {
    history.replaceState(null, '', lastHash || hrefFor('home'));
    focusTarget(anchor);
    return;
  }
  if (route.name === 'notFound') {
    history.replaceState(null, '', hrefFor('home'));
    render();
    return;
  }
  lastHash = location.hash;
  const seq = ++renderSeq;
  const cached = screens.get(route.name);
  if (cached && !(cached instanceof Promise)) {
    show(route, cached);
    return;
  }
  loadScreen(route.name).then(
    (screen) => { if (seq === renderSeq) show(route, screen); },
    () => {
      if (seq !== renderSeq) return;
      const msg = document.createElement('p');
      msg.className = 'noscript';
      msg.textContent = LOAD_ERROR_TEXT;
      app.replaceChildren(msg);
      announce(LOAD_ERROR_TEXT);
    },
  );
}

function show(route, screen) {
  current?.dispose?.();
  fx.clear?.();
  const next = screen.render({ settings, prefs, announce, navigate, params: route.params });
  current = next;
  document.title = route.name === 'home' ? APP_TITLE : `${screen.title} – ${APP_TITLE}`;
  root.dataset.route = route.name;

  const swap = () => {
    app.replaceChildren(next.el);
    window.scrollTo(0, 0);
  };
  const focusScreen = () => {
    if (current !== next) return;
    if (next.focus) next.focus();
    else next.el.querySelector('h1')?.focus({ preventScroll: true });
  };
  const wasFirst = firstRender;
  firstRender = false;

  if (!wasFirst && document.startViewTransition && !prefersLessMotion()) {
    const transition = document.startViewTransition(swap);
    // Übersprungene Übergänge (schnelles Navigieren) sind kein Fehler.
    transition.ready.catch(() => {});
    transition.updateCallbackDone.catch(() => {});
    transition.finished.then(focusScreen, focusScreen);
  } else {
    swap();
    if (!wasFirst) {
      next.el.classList.add('screen--enter');
      focusScreen();
    }
  }
}

// ─── Start ───
function unlockAudioOnce() {
  audio.unlock();
  window.removeEventListener('pointerdown', unlockAudioOnce, true);
  window.removeEventListener('keydown', unlockAudioOnce, true);
}

function playClick(e) {
  const target = e.target instanceof Element ? e.target.closest('button, a.btn, a.card, a.brand') : null;
  if (target && !target.classList.contains('move-btn') && target.getAttribute('aria-disabled') !== 'true') {
    audio.play('click');
  }
}

/** Skip-Link springt per Fokus statt per Hash – sonst würde der Router den Screen wechseln. */
function onSkipLink(e) {
  e.preventDefault();
  focusTarget(app);
  app.scrollIntoView?.({ block: 'start' });
}

function init() {
  document.querySelector('.skip-link')?.addEventListener('click', onSkipLink);
  initToasts();
  applyReducedFx();
  reducedMotionQuery?.addEventListener?.('change', applyReducedFx);
  fx.initFx(document.getElementById('fx'));
  mountHeader(document.getElementById('app-header'), { settings, prefs });
  window.addEventListener('pointerdown', unlockAudioOnce, true);
  window.addEventListener('keydown', unlockAudioOnce, true);
  document.addEventListener('click', playClick);
  window.addEventListener('hashchange', render);
  render();
  prefetchScreens();
}

init();
