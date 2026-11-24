import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRoomStore, createRoomSession, ROOMS_KEY, ROOM_TTL_MS, summaryFromState, describeRoom, ageText, normalizeEntry,
} from '../../public/assets/js/rooms.js';
import { memoryStorage, throwingStorage } from './helpers.js';

/** sessionStorage-Ersatz mit key(i)/length (für die Migration). */
function legacyStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

const clock = (t = 1_000_000) => { const c = () => c.t; c.t = t; return c; };

test('Store: anlegen, lesen, ändern, löschen – alles unter rps.rooms.v1', () => {
  const storage = memoryStorage();
  const now = clock();
  const store = createRoomStore({ storage, now, events: null });
  assert.deepEqual(store.list(), []);
  assert.equal(store.put('abc234', { type: 'duel' }), null, 'ohne Token wird nichts angelegt');
  store.put('abc234', { token: 't1', me: 'p_a', type: 'duel', role: 'host', variant: 'classic', bestOf: 3 });
  const e = store.get('abc234');
  assert.equal(e.token, 't1');
  assert.equal(e.created, now.t);
  assert.equal(e.role, 'host');
  assert.deepEqual(Object.keys(JSON.parse(storage.getItem(ROOMS_KEY))), ['abc234']);
  now.t += 1000;
  store.put('xyz789', { token: 't2', me: 'p_b' });
  assert.deepEqual(store.list().map((r) => r.code), ['xyz789', 'abc234'], 'neueste zuerst');
  store.update('abc234', (r) => ({ ...r, opponent: 'Ben' }));
  assert.equal(store.get('abc234').opponent, 'Ben');
  store.remove('abc234');
  assert.equal(store.get('abc234'), null);
  store.remove('xyz789');
  assert.equal(storage.getItem(ROOMS_KEY), null, 'leerer Speicher → Schlüssel weg');
});

test('Store: Einträge verfallen 24 h nach Erstellung, purge räumt auf', () => {
  const storage = memoryStorage();
  const now = clock();
  const store = createRoomStore({ storage, now, events: null });
  store.put('abc234', { token: 't', me: 'p' });
  now.t += ROOM_TTL_MS - 1;
  assert.ok(store.get('abc234'));
  now.t += 1;
  assert.equal(store.get('abc234'), null);
  assert.deepEqual(store.list(), []);
  assert.ok(storage.getItem(ROOMS_KEY), 'erst purge löscht physisch');
  store.purge();
  assert.equal(storage.getItem(ROOMS_KEY), null);
});

test('Store: kaputte Daten werden ignoriert statt zu werfen', () => {
  for (const raw of ['{kaputt', '42', '[]', 'null', JSON.stringify({ abc234: 'x', 'BAD!!!': { token: 't', me: 'p', created: 1 }, xyz789: { token: '', me: 'p', created: 1 } })]) {
    const store = createRoomStore({ storage: memoryStorage({ [ROOMS_KEY]: raw }), now: clock(), events: null });
    assert.deepEqual(store.list(), [], raw);
  }
  const ok = normalizeEntry('abc234', { token: 't', me: 'p', created: 5, alerts: [{ kind: 'joined', text: 'x' }, 'müll'], recorded: ['m:m1', 3], type: 'quatsch' });
  assert.deepEqual(ok.alerts, [{ kind: 'joined', text: 'x', at: 5 }]);
  assert.deepEqual(ok.recorded, ['m:m1']);
  assert.equal(ok.type, null);
});

test('Store: gesperrter oder voller Speicher wirft nie', () => {
  const store = createRoomStore({ storage: throwingStorage, now: clock(), events: null });
  assert.doesNotThrow(() => store.put('abc234', { token: 't', me: 'p' }));
  assert.deepEqual(store.list(), []);
  // Speicher voll: großer Eintrag scheitert, schlanke Fassung (ohne beendete Räume) klappt
  const inner = memoryStorage();
  let limit = Infinity;
  const full = { ...inner, getItem: inner.getItem, removeItem: inner.removeItem, setItem(k, v) { if (v.length > limit) throw new Error('QuotaExceeded'); inner.setItem(k, v); } };
  const s2 = createRoomStore({ storage: full, now: clock(), events: null });
  s2.put('abc234', { token: 't', me: 'p', summary: { status: 'finished' } });
  s2.put('xyz789', { token: 't', me: 'p' });
  limit = inner.getItem(ROOMS_KEY).length - 1;
  s2.update('xyz789', (e) => ({ ...e, opponent: 'Ben' }));
  assert.equal(s2.get('xyz789').opponent, 'Ben');
  assert.equal(s2.get('abc234'), null, 'beendeter Raum wurde für Platz geopfert');
});

test('Store: subscribe bei eigenen Änderungen und beim storage-Ereignis anderer Tabs', () => {
  const listeners = {};
  const events = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    removeEventListener: (type) => { delete listeners[type]; },
  };
  const store = createRoomStore({ storage: memoryStorage(), now: clock(), events });
  let calls = 0;
  const off = store.subscribe(() => { calls += 1; });
  store.put('abc234', { token: 't', me: 'p' });
  assert.equal(calls, 1);
  listeners.storage({ key: 'rps.name' });
  assert.equal(calls, 1, 'fremde Schlüssel ignorieren');
  listeners.storage({ key: ROOMS_KEY });
  assert.equal(calls, 2);
  off();
  assert.equal(listeners.storage, undefined, 'nach letztem Abmelden kein Listener mehr');
});

test('Zwei Tabs (gleicher Speicher): Pending und Recorded bleiben konsistent', () => {
  const storage = memoryStorage();
  const now = clock();
  const tab1 = createRoomSession(storage, { now });
  const tab2 = createRoomSession(storage, { now });
  tab1.set('abc234', { token: 't', me: 'p_a' });
  assert.deepEqual(tab2.get('abc234'), { token: 't', me: 'p_a' });
  tab2.setPending('abc234', { matchId: 'm1', round: 0, move: 'rock', nonce: 'n', hash: 'h' });
  assert.equal(tab1.getPending('abc234').move, 'rock');
  tab1.markRecorded('abc234', 'm:m1');
  assert.equal(tab2.wasRecorded('abc234', 'm:m1'), true);
  tab2.clearPending('abc234');
  assert.equal(tab1.getPending('abc234'), null);
  assert.equal(tab1.get('abc234').token, 't', 'Platz bleibt beim Löschen des Pending');
});

test('Migration: alte sessionStorage-Sitzungen werden übernommen und dort gelöscht', () => {
  const legacy = legacyStorage({
    'rps.token.abc234': 'tok', 'rps.me.abc234': 'p_a',
    'rps.pending.abc234': JSON.stringify({ matchId: 'm1', round: 2, move: 'paper' }),
    'rps.recorded.abc234': JSON.stringify(['m:m1']),
    'rps.me.xyz789': 'p_b', // ohne Token → unbrauchbar, trotzdem aufräumen
    'rps.pending.xyz789': '{kaputt',
    'andere.app': 'bleibt',
  });
  const store = createRoomStore({ storage: memoryStorage(), now: clock(), events: null });
  assert.deepEqual(store.migrate(legacy), ['abc234']);
  const e = store.get('abc234');
  assert.equal(e.token, 'tok');
  assert.equal(e.pending.move, 'paper');
  assert.deepEqual(e.recorded, ['m:m1']);
  assert.equal(store.get('xyz789'), null);
  assert.deepEqual([...legacy.map.keys()], ['andere.app']);
  assert.deepEqual(store.migrate(legacy), [], 'zweiter Lauf: nichts mehr zu tun');
  assert.deepEqual(store.migrate(null), []);
  assert.deepEqual(store.migrate(throwingStorage), []);
});

test('Migration überschreibt keinen vorhandenen Eintrag', () => {
  const store = createRoomStore({ storage: memoryStorage(), now: clock(), events: null });
  store.put('abc234', { token: 'neu', me: 'p_a' });
  store.migrate(legacyStorage({ 'rps.token.abc234': 'alt', 'rps.me.abc234': 'p_x' }));
  assert.equal(store.get('abc234').token, 'neu');
});

test('markOpened: Hinweise gelesen, „am Zug“ wieder scharf, Badge-Zähler', () => {
  const now = clock();
  const store = createRoomStore({ storage: memoryStorage(), now, events: null });
  store.put('abc234', { token: 't', me: 'p', alerts: [{ kind: 'joined', text: 'Ben ist da' }], notified: ['joined', 'move:m1'] });
  store.put('xyz789', { token: 't', me: 'p', alerts: [{ kind: 'move', text: 'x' }] });
  store.put('qqq222', { token: 't', me: 'p' });
  assert.equal(store.alertCount(), 2);
  now.t += 5000;
  store.markOpened('abc234');
  const e = store.get('abc234');
  assert.deepEqual(e.alerts, []);
  assert.deepEqual(e.notified, ['joined']);
  assert.equal(e.opened, now.t);
  assert.equal(store.alertCount(), 1);
});

const P = (id, name, extra = {}) => ({ id, name, online: true, spectator: false, left: false, ...extra });

test('summaryFromState: Duell-Lobby, laufend (am Zug), Revanche', () => {
  const lobby = { version: 2, type: 'duel', variant: 'classic', bestOf: 3, status: 'lobby', host: 'p_a', players: [P('p_a', 'Anna')], matches: {}, current: null, rematch: [] };
  const s0 = summaryFromState(lobby, 'p_a');
  assert.deepEqual({ status: s0.status, opponent: s0.opponent, needsMove: s0.needsMove, isHost: s0.isHost, players: s0.players, version: s0.version },
    { status: 'lobby', opponent: null, needsMove: false, isHost: true, players: 1, version: 2 });
  const m1 = { id: 'm1', p: ['p_a', 'p_b'], score: [0, 0], cur: { committed: [false, true] }, history: [], winner: null, end: null };
  const run = { ...lobby, version: 3, status: 'running', players: [P('p_a', 'Anna'), P('p_b', 'Ben')], matches: { m1 }, current: 'm1', myMatch: 'm1' };
  const s1 = summaryFromState(run, 'p_a');
  assert.equal(s1.opponent, 'Ben');
  assert.equal(s1.needsMove, true);
  assert.equal(s1.myMatch, 'm1');
  assert.equal(summaryFromState(run, 'p_b').needsMove, false, 'B hat schon gewählt');
  const over = { ...run, myMatch: null, matches: { m1: { ...m1, winner: 1, end: 'score' } }, rematch: ['p_b'] };
  const s2 = summaryFromState(over, 'p_a');
  assert.equal(s2.rematchWanted, true);
  assert.equal(s2.needsMove, false);
  assert.equal(summaryFromState(over, 'p_b').rematchWanted, false, 'eigener Wunsch zählt nicht');
});

test('summaryFromState: Turnier mit eigenem Match, Zuschauer, Champion', () => {
  const players = [P('p_a', 'Anna'), P('p_b', 'Ben'), P('p_c', 'Cem'), P('p_z', 'Zoe', { spectator: true })];
  const m1 = { id: 'm1', p: ['p_a', 'p_b'], cur: { committed: [false, false] }, history: [], winner: null, end: null };
  const st = { version: 9, type: 'tournament', variant: 'lizard', bestOf: 5, status: 'running', host: 'p_a', players, matches: { m1 }, myMatch: 'm1', champion: null };
  const s = summaryFromState(st, 'p_b');
  assert.equal(s.opponent, 'Anna');
  assert.equal(s.players, 3);
  assert.equal(s.needsMove, true);
  const z = summaryFromState({ ...st, myMatch: null }, 'p_z');
  assert.equal(z.spectator, true);
  assert.equal(z.opponent, null);
  const fin = summaryFromState({ ...st, status: 'finished', myMatch: null, champion: 'p_c' }, 'p_a');
  assert.equal(fin.champion, 'Cem');
});

test('describeRoom: Status in Worten', () => {
  const e = (summary, extra = {}) => ({ code: 'abc234', summary, opponent: null, stage: null, ...extra });
  assert.equal(describeRoom(e(null)).text, 'Wird geladen …');
  assert.equal(describeRoom(e({ type: 'duel', status: 'lobby' })).text, 'Wartet auf Gegner …');
  assert.equal(describeRoom(e({ type: 'duel', status: 'running', opponent: 'Ben', needsMove: true })).text, 'Läuft – du bist dran!');
  assert.equal(describeRoom(e({ type: 'duel', status: 'running', opponent: 'Ben', rematchWanted: true })).text, 'Ben will Revanche');
  assert.equal(describeRoom(e({ type: 'duel', status: 'running', opponent: 'Ben' })).who, 'gegen Ben');
  assert.equal(describeRoom(e({ type: 'tournament', status: 'running', players: 5 }, { stage: 'Halbfinale' })).text, 'Turnier: Halbfinale');
  assert.equal(describeRoom(e({ type: 'tournament', status: 'finished', champion: 'Anna', players: 5 })).text, 'Beendet – Anna gewinnt');
  assert.equal(describeRoom(e({ type: 'tournament', status: 'lobby', isHost: true, players: 2 })).who, '2 Spieler');
  assert.equal(describeRoom(e({ type: 'tournament', status: 'running', myMatch: 'm3', needsMove: true, opponent: 'Cem' })).tone, 'turn');
});

test('ageText', () => {
  assert.equal(ageText(10_000), 'gerade eben');
  assert.equal(ageText(5 * 60_000), 'vor 5 Min.');
  assert.equal(ageText(3 * 3600_000 + 1), 'vor 3 Std.');
});
