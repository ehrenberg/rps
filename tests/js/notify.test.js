import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createNotifier, createTitleBlinker, NOTIFY_KEY, NOTIFY_HINT_KEY, NOTIFY_ICON, TITLE_BLINK_MS,
} from '../../public/assets/js/notify.js';
import { memoryStorage } from './helpers.js';

/** Fake-Notification: Klasse mit statischer permission/requestPermission, merkt sich Instanzen. */
function fakeNotification(permission = 'default', answer = 'granted') {
  class N {
    constructor(title, opts) { this.title = title; this.opts = opts; this.closed = false; N.sent.push(this); }
    close() { this.closed = true; }
    static async requestPermission() { N.asked += 1; N.permission = answer; return answer; }
  }
  N.permission = permission;
  N.sent = [];
  N.asked = 0;
  return N;
}

test('Notifier: ohne Unterstützung still, kein Hinweis', async () => {
  const n = createNotifier({ NotificationImpl: undefined, storage: memoryStorage(), isHidden: () => true });
  assert.equal(n.supported, false);
  assert.equal(n.permission(), 'unsupported');
  assert.equal(n.shouldOfferHint(), false);
  assert.equal(await n.enable(), 'unsupported');
  assert.equal(n.send({ title: 'x', body: 'y', code: 'abc234' }), null);
});

test('Notifier: Hinweis nur einmal, enable fragt den Browser und merkt die Wahl', async () => {
  const N = fakeNotification();
  const storage = memoryStorage();
  const n = createNotifier({ NotificationImpl: N, storage, isHidden: () => true });
  assert.equal(n.shouldOfferHint(), true);
  assert.equal(n.isEnabled(), false);
  assert.equal(await n.enable(), 'granted');
  assert.equal(N.asked, 1);
  assert.equal(storage.getItem(NOTIFY_KEY), '1');
  assert.equal(storage.getItem(NOTIFY_HINT_KEY), '1');
  assert.equal(n.isEnabled(), true);
  assert.equal(n.shouldOfferHint(), false);
  await n.enable();
  assert.equal(N.asked, 1, 'schon erlaubt → nicht erneut fragen');
  n.disable();
  assert.equal(n.isEnabled(), false);
});

test('Notifier: abgelehnt → aus, kein erneuter Hinweis; dismissHint', async () => {
  const N = fakeNotification('default', 'denied');
  const storage = memoryStorage();
  const n = createNotifier({ NotificationImpl: N, storage, isHidden: () => true });
  assert.equal(await n.enable(), 'denied');
  assert.equal(storage.getItem(NOTIFY_KEY), '0');
  assert.equal(n.isEnabled(), false);
  const m = createNotifier({ NotificationImpl: fakeNotification(), storage: memoryStorage(), isHidden: () => true });
  m.dismissHint();
  assert.equal(m.shouldOfferHint(), false);
  const thrower = fakeNotification();
  thrower.requestPermission = async () => { throw new Error('nein'); };
  assert.equal(await createNotifier({ NotificationImpl: thrower, storage: memoryStorage() }).enable(), 'denied');
});

test('Notifier: sendet nur bei verstecktem Tab und Erlaubnis; Klick fokussiert und öffnet den Raum', () => {
  const N = fakeNotification('granted');
  const storage = memoryStorage({ [NOTIFY_KEY]: '1' });
  let hidden = false;
  const opened = [];
  let focused = 0;
  const n = createNotifier({ NotificationImpl: N, storage, isHidden: () => hidden, focus: () => { focused += 1; }, onOpen: (c) => opened.push(c) });
  assert.equal(n.send({ title: 'Ben ist da!', body: 'Ben ist da – euer Duell startet!', code: 'abc234' }), null, 'sichtbar → nichts');
  hidden = true;
  const note = n.send({ title: 'Ben ist da!', body: 'Ben ist da – euer Duell startet!', code: 'abc234' });
  assert.equal(note.title, 'Ben ist da!');
  assert.deepEqual(note.opts, { body: 'Ben ist da – euer Duell startet!', tag: 'rps-abc234', icon: NOTIFY_ICON, lang: 'de' });
  assert.ok(!NOTIFY_ICON.includes('//'), 'Icon vom eigenen Host');
  note.onclick();
  assert.equal(focused, 1);
  assert.deepEqual(opened, ['abc234']);
  assert.equal(note.closed, true);
  storage.setItem(NOTIFY_KEY, '0');
  assert.equal(n.send({ title: 'x', body: 'y', code: 'abc234' }), null, 'Schalter aus');
});

test('Notifier: Konstruktor wirft (Android ohne Service Worker) → still null', () => {
  const N = fakeNotification('granted');
  const Throwing = class extends N { constructor() { super('x', {}); throw new TypeError('Illegal constructor'); } };
  Throwing.permission = 'granted';
  const n = createNotifier({ NotificationImpl: Throwing, storage: memoryStorage({ [NOTIFY_KEY]: '1' }), isHidden: () => true });
  assert.equal(n.send({ title: 'x', body: 'y', code: 'abc234' }), null);
});

function fakeDoc(title = 'Meine Spiele – Schere Stein Papier') {
  const listeners = {};
  return {
    title, visibilityState: 'visible', listeners,
    addEventListener: (type, fn) => { listeners[type] = fn; },
    removeEventListener: (type) => { delete listeners[type]; },
  };
}
function intervalTimers() {
  const t = {
    fn: null, ms: null, cleared: 0,
    setInterval(fn, ms) { t.fn = fn; t.ms = ms; return 7; },
    clearInterval() { t.fn = null; t.cleared += 1; },
  };
  return t;
}

test('Tab-Titel: blinkt nur bei verstecktem Tab, zählt mit, setzt beim Sichtbarwerden zurück', () => {
  const doc = fakeDoc();
  const timers = intervalTimers();
  const b = createTitleBlinker({ doc, timers });
  assert.equal(b.alert('Ben ist da!'), false, 'sichtbar → kein Blinken');
  assert.equal(doc.title, 'Meine Spiele – Schere Stein Papier');
  doc.visibilityState = 'hidden';
  assert.equal(b.alert('Ben ist da!'), true);
  assert.equal(doc.title, '(1) Ben ist da!');
  assert.equal(timers.ms, TITLE_BLINK_MS);
  timers.fn();
  assert.equal(doc.title, 'Meine Spiele – Schere Stein Papier');
  timers.fn();
  assert.equal(doc.title, '(1) Ben ist da!');
  b.alert('Dein Match beginnt!');
  assert.equal(doc.title, '(2) Dein Match beginnt!');
  doc.visibilityState = 'visible';
  doc.listeners.visibilitychange();
  assert.equal(doc.title, 'Meine Spiele – Schere Stein Papier');
  assert.equal(b.active, false);
  assert.equal(b.count, 0);
});

test('Tab-Titel: Screen-Wechsel während des Blinkens wird neuer Normal-Titel; Tick bei sichtbarem Tab stoppt', () => {
  const doc = fakeDoc('Start');
  const timers = intervalTimers();
  const b = createTitleBlinker({ doc, timers });
  doc.visibilityState = 'hidden';
  b.alert('Ben ist da!');
  doc.title = 'Online-Raum – Schere Stein Papier';
  timers.fn();
  assert.equal(doc.title, 'Online-Raum – Schere Stein Papier');
  timers.fn();
  assert.equal(doc.title, '(1) Ben ist da!');
  doc.visibilityState = 'visible';
  timers.fn();
  assert.equal(doc.title, 'Online-Raum – Schere Stein Papier');
  assert.equal(b.active, false);
  b.dispose();
  assert.equal(doc.listeners.visibilitychange, undefined);
});
