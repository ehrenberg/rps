// Einstieg: App-Shell, Hash-Routing, Screen-Wechsel, globale Einstellungen.
import { parseHash, hrefFor } from './router.js';
import { createSettings } from './settings.js';
import * as audio from './audio.js';
import * as fx from './fx.js';
import { mountHeader } from './ui/header.js';
import { prefersLessMotion } from './ui/dom.js';
import * as home from './ui/home.js';
import * as cpuSetup from './ui/cpu-setup.js';
import * as arenaScreen from './ui/arena-screen.js';
import * as statsScreen from './ui/stats-screen.js';
import * as settingsScreen from './ui/settings-screen.js';
import { comingSoon } from './ui/coming-soon.js';

const APP_TITLE = 'Schere Stein Papier';
const LIVE_CLEAR_MS = 50;

/** Routenname → Screen-Modul { title, render(ctx) → { el, focus?, dispose? } } */
const SCREENS = Object.freeze({
  home,
  cpu: cpuSetup,
  play: arenaScreen,
  stats: statsScreen,
  settings: settingsScreen,
  duel: comingSoon('duel'),
  tournament: comingSoon('tournament'),
  room: comingSoon('room'),
});

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

function render() {
  const route = parseHash(location.hash);
  if (route.name === 'notFound') {
    history.replaceState(null, '', hrefFor('home'));
    render();
    return;
  }
  const screen = SCREENS[route.name];
  current?.dispose?.();
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

function init() {
  applyReducedFx();
  reducedMotionQuery?.addEventListener?.('change', applyReducedFx);
  fx.initFx(document.getElementById('fx'));
  mountHeader(document.getElementById('app-header'), { settings, prefs });
  window.addEventListener('pointerdown', unlockAudioOnce, true);
  window.addEventListener('keydown', unlockAudioOnce, true);
  document.addEventListener('click', playClick);
  window.addEventListener('hashchange', render);
  render();
}

init();
