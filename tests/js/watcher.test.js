import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createWatcher, detectEvents, watchBackoff, WATCH_MS, WATCH_MAX_ROOMS, WATCH_BACKOFF_MAX_MS,
} from '../../public/assets/js/watcher.js';
import { createRoomStore } from '../../public/assets/js/rooms.js';
import { ApiError } from '../../public/assets/js/net.js';
import { memoryStorage } from './helpers.js';

const flush = () => new Promise((r) => setImmediate(r));

/** Manuelle Timer: run() führt den geplanten Timer aus. */
function fakeTimers() {
  let next = null;
  const t = {
    setTimeout(fn, ms) { next = { fn, ms }; return 1; },
    clearTimeout() { next = null; },
    async run() { const n = next; next = null; if (n) await n.fn(); await flush(); },
    get pending() { return next; },
  };
  return t;
}

const duel = (over = {}) => ({
  version: 1, type: 'duel', variant: 'classic', bestOf: 3, status: 'lobby', me: 'p_a', isHost: true, players: 1,
  spectator: false, left: false, opponent: null, myMatch: null, needsMove: false, rematchWanted: false, champion: null, updated: 1, ...over,
});
const tour = (over = {}) => duel({ type: 'tournament', players: 4, ...over });

test('detectEvents: Gegner beigetreten (Duell-Lobby → running)', () => {
  const ev = detectEvents(duel(), duel({ version: 2, status: 'running', opponent: 'Ben', players: 2, myMatch: 'm1', needsMove: true }));
  assert.deepEqual(ev.map((e) => e.kind), ['joined', 'move'], 'nach Priorität sortiert');
  assert.equal(ev[0].text, 'Ben ist da – euer Duell startet!');
  assert.equal(ev[0].title, 'Ben ist da!');
});

test('detectEvents: Turnier-Match, Zug, Revanche, Turnier vorbei', () => {
  const m = detectEvents(tour({ status: 'running' }), tour({ status: 'running', myMatch: 'm3', opponent: 'Cem' }));
  assert.deepEqual(m.map((e) => [e.kind, e.key, e.text]), [['match', 'match:m3', 'Dein Turnier-Match gegen Cem beginnt!']]);
  const mv = detectEvents(duel({ status: 'running', opponent: 'Ben', myMatch: 'm1' }), duel({ status: 'running', opponent: 'Ben', myMatch: 'm1', needsMove: true }));
  assert.deepEqual(mv.map((e) => [e.kind, e.text]), [['move', 'Du bist am Zug gegen Ben!']]);
  const re = detectEvents(duel({ status: 'running', opponent: 'Ben' }), duel({ version: 7, status: 'running', opponent: 'Ben', rematchWanted: true }));
  assert.deepEqual(re.map((e) => [e.kind, e.key, e.text]), [['rematch', 'rematch:7', 'Ben will eine Revanche!']]);
  const fin = detectEvents(tour({ status: 'running' }), tour({ version: 9, status: 'finished', champion: 'Anna' }));
  assert.deepEqual(fin.map((e) => e.text), ['Turnier vorbei – Anna gewinnt!']);
});

test('detectEvents: nichts ohne Ausgangslage, bei unchanged, für Zuschauer oder schon Gemeldetes', () => {
  assert.deepEqual(detectEvents(null, duel({ status: 'running', opponent: 'Ben' })), []);
  assert.deepEqual(detectEvents(duel(), { version: 1, unchanged: true }), []);
  assert.deepEqual(detectEvents(tour({ status: 'running', spectator: true }), tour({ status: 'running', spectator: true, myMatch: 'm2' })), []);
  const prev = duel(); const next = duel({ status: 'running', opponent: 'Ben' });
  assert.deepEqual(detectEvents(prev, next, { notified: ['joined'] }), []);
  assert.deepEqual(detectEvents(next, { ...next, version: 5, updated: 99 }), [], 'nur updated geändert → kein Ereignis');
});

function setup({ rooms = [], hidden = false, respond } = {}) {
  const now = { t: 1_000_000 };
  const store = createRoomStore({ storage: memoryStorage(), now: () => now.t, events: null });
  for (const r of rooms) store.put(r.code, { token: `tok-${r.code}`, me: 'p_a', ...r });
  const calls = [];
  const events = [];
  const gone = [];
  const timers = fakeTimers();
  const state = { hidden };
  const apiFn = async (action, params) => {
    calls.push({ action, params });
    return respond(params, calls.length);
  };
  const watcher = createWatcher({
    store, apiFn, timers, isHidden: () => state.hidden, events: null, now: () => now.t,
    onEvent: (e) => events.push(e), onGone: (code, reason) => gone.push([code, reason]),
  });
  return { store, calls, events, gone, timers, watcher, state, now };
}

test('Wächter: meldet „Gegner beigetreten“ genau einmal, auch nach Neuaufbau (Reload)', async () => {
  const joined = duel({ version: 2, status: 'running', opponent: 'Ben', players: 2 });
  const t = setup({
    rooms: [{ code: 'abc234', summary: duel() }],
    respond: (p) => ({ now: 1, rooms: { abc234: p.rooms[0].since === 2 ? { version: 2, unchanged: true } : joined } }),
  });
  t.watcher.start();
  await flush();
  assert.equal(t.calls[0].action, 'watch');
  assert.deepEqual(t.calls[0].params.rooms, [{ code: 'abc234', token: 'tok-abc234', since: 1 }]);
  assert.equal(t.events.length, 1);
  assert.equal(t.events[0].code, 'abc234');
  assert.equal(t.events[0].kind, 'joined');
  const e = t.store.get('abc234');
  assert.equal(e.summary.version, 2);
  assert.equal(e.opponent, 'Ben');
  assert.deepEqual(e.alerts.map((a) => a.kind), ['joined']);
  assert.equal(t.timers.pending.ms, WATCH_MS.visible);
  await t.timers.run();
  assert.equal(t.calls[1].params.rooms[0].since, 2, 'since pro Raum');
  assert.equal(t.events.length, 1);
  t.watcher.stop();

  // „Reload“: neuer Wächter, gleicher Speicher, Server liefert wieder die volle Kurzfassung
  const again = createWatcher({ store: t.store, apiFn: async () => ({ rooms: { abc234: joined } }), timers: fakeTimers(), isHidden: () => false, events: null, onEvent: (ev) => t.events.push(ev) });
  again.start();
  await flush();
  assert.equal(t.events.length, 1, 'nicht doppelt');
  again.stop();
});

test('Wächter: gone → Eintrag entfernen (left/forbidden/notFound), anderer Token bleibt', async () => {
  const t = setup({
    rooms: [{ code: 'abc234' }, { code: 'xyz789' }, { code: 'qqq222' }],
    respond: () => ({ rooms: { abc234: { gone: true, reason: 'left' }, xyz789: { gone: true, reason: 'forbidden' }, qqq222: { gone: true, reason: 'notFound' } } }),
  });
  // Während der Anfrage tritt man qqq222 neu bei (neues Token) → nicht löschen
  const orig = t.store.get('qqq222');
  t.watcher.start();
  t.store.put('qqq222', { ...orig, token: 'neu' });
  await flush();
  assert.equal(t.store.get('abc234'), null);
  assert.equal(t.store.get('xyz789'), null);
  assert.equal(t.store.get('qqq222').token, 'neu');
  assert.deepEqual(t.gone.sort(), [['abc234', 'left'], ['xyz789', 'forbidden']]);
  t.watcher.stop();
});

test('Wächter: aktueller Raum ist ausgenommen; ohne Räume ruht er und wacht beim Anlegen auf', async () => {
  const t = setup({ rooms: [{ code: 'abc234' }], respond: () => ({ rooms: {} }) });
  t.watcher.setActive('abc234');
  t.watcher.start();
  await flush();
  assert.equal(t.calls.length, 0);
  assert.equal(t.timers.pending, null, 'nichts geplant');
  t.store.put('xyz789', { token: 't', me: 'p' });
  assert.equal(t.timers.pending.ms, 0, 'neuer Raum weckt den Wächter');
  await t.timers.run();
  assert.deepEqual(t.calls[0].params.rooms.map((r) => r.code), ['xyz789']);
  t.watcher.setActive(null);
  await t.timers.run();
  assert.deepEqual(t.calls[1].params.rooms.map((r) => r.code).sort(), ['abc234', 'xyz789']);
  t.watcher.stop();
});

test('Wächter: Antwort für inzwischen geöffneten Raum löst kein Ereignis aus', async () => {
  let resolve;
  const t = setup({ rooms: [{ code: 'abc234', summary: duel() }], respond: () => new Promise((r) => { resolve = r; }) });
  t.watcher.start();
  await flush();
  t.watcher.setActive('abc234');
  resolve({ rooms: { abc234: duel({ version: 2, status: 'running', opponent: 'Ben' }) } });
  await flush();
  assert.equal(t.events.length, 0);
  t.watcher.stop();
});

test('Wächter: Intervall sichtbar/versteckt, Backoff bei Fehlern', async () => {
  let fail = true;
  const t = setup({
    rooms: [{ code: 'abc234' }],
    respond: () => { if (fail) throw new ApiError('Keine Verbindung zum Server.', 0); return { rooms: {} }; },
  });
  t.watcher.start();
  await flush();
  assert.equal(t.timers.pending.ms, watchBackoff(1));
  await t.timers.run();
  assert.equal(t.timers.pending.ms, watchBackoff(2));
  assert.ok(watchBackoff(2) > watchBackoff(1));
  assert.equal(watchBackoff(20), WATCH_BACKOFF_MAX_MS);
  fail = false;
  await t.timers.run();
  assert.equal(t.timers.pending.ms, WATCH_MS.visible);
  t.state.hidden = true;
  await t.timers.run();
  assert.equal(t.timers.pending.ms, WATCH_MS.hidden);
  t.watcher.stop();
  assert.equal(t.timers.pending, null);
});

test('Wächter: höchstens 10 Räume pro Anfrage, rotiert', async () => {
  const rooms = 'abcdefghjkmn'.split('').map((c) => ({ code: `${c}bc234` }));
  const t2 = setup({ rooms, respond: (p) => ({ rooms: Object.fromEntries(p.rooms.map((r) => [r.code, { version: 1, unchanged: true }])) }) });
  t2.watcher.start();
  await flush();
  assert.equal(t2.calls[0].params.rooms.length, WATCH_MAX_ROOMS);
  t2.now.t += 1000;
  await t2.timers.run();
  const second = t2.calls[1].params.rooms.map((r) => r.code);
  const missing = rooms.map((r) => r.code).filter((c) => !t2.calls[0].params.rooms.some((r) => r.code === c));
  for (const c of missing) assert.ok(second.includes(c), `${c} kommt in der zweiten Runde dran`);
  t2.watcher.stop();
});

test('Wächter: visibilitychange → sofort abfragen', async () => {
  const listeners = {};
  const store = createRoomStore({ storage: memoryStorage(), events: null });
  store.put('abc234', { token: 't', me: 'p' });
  const timers = fakeTimers();
  let hidden = true;
  let calls = 0;
  const w = createWatcher({
    store, timers, isHidden: () => hidden, apiFn: async () => { calls += 1; return { rooms: {} }; },
    events: { addEventListener: (type, fn) => { listeners[type] = fn; }, removeEventListener() {} },
  });
  w.start();
  await flush();
  assert.equal(timers.pending.ms, WATCH_MS.hidden);
  hidden = false;
  listeners.visibilitychange();
  assert.equal(timers.pending.ms, 0);
  await timers.run();
  assert.equal(calls, 2);
  w.stop();
});
