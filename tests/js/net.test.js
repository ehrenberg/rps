import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  api, ApiError, createPoller, backoffDelay, pollInterval, POLL_MS, BACKOFF_MAX_MS, createRoomSession, SESSION_KEYS,
} from '../../public/assets/js/net.js';

const jsonResponse = (status, body) => ({ ok: status < 400, status, json: async () => body });

test('api: POST mit JSON, Antwort als Objekt', async () => {
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init }; return jsonResponse(200, { ok: true, version: 3 }); };
  const res = await api('commit', { code: 'abc234', hash: 'x' }, { fetchImpl });
  assert.deepEqual(res, { ok: true, version: 3 });
  assert.equal(seen.url, 'api.php');
  assert.equal(seen.init.method, 'POST');
  assert.deepEqual(JSON.parse(seen.init.body), { action: 'commit', code: 'abc234', hash: 'x' });
});

test('api: Serverfehler → ApiError mit deutschem Text und Status', async () => {
  const fetchImpl = async () => jsonResponse(409, { error: 'Passt gerade nicht.' });
  await assert.rejects(api('commit', {}, { fetchImpl }), (err) => err instanceof ApiError && err.status === 409 && err.message === 'Passt gerade nicht.' && !err.retryable);
});

test('api: Netzwerkfehler → Status 0, wiederholbar', async () => {
  const fetchImpl = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(api('state', {}, { fetchImpl }), (err) => err.status === 0 && err.retryable && /Verbindung/.test(err.message));
});

test('api: kaputtes JSON bei Fehler → Fallback-Text', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, json: async () => { throw new Error('x'); } });
  await assert.rejects(api('state', {}, { fetchImpl }), (err) => err.status === 500 && /Serverfehler/.test(err.message));
});

test('backoffDelay und pollInterval', () => {
  assert.equal(backoffDelay(1), 1000);
  assert.equal(backoffDelay(2), 2000);
  assert.equal(backoffDelay(4), 8000);
  assert.equal(backoffDelay(9), BACKOFF_MAX_MS);
  assert.equal(pollInterval('match', false), POLL_MS.match);
  assert.equal(pollInterval('match', true), POLL_MS.hidden);
  assert.equal(pollInterval('end', true), POLL_MS.end);
});

/** Manuelle Timer: run() führt den nächsten fälligen Timer aus. */
function fakeTimers() {
  let next = null;
  const t = {
    delays: [],
    setTimeout(fn, ms) { next = { fn, ms }; t.delays.push(ms); return 1; },
    clearTimeout() { next = null; },
    async run() { const n = next; next = null; if (n) await n.fn(); await new Promise((r) => setImmediate(r)); },
    get pending() { return next; },
  };
  return t;
}

const flush = () => new Promise((r) => setImmediate(r));

test('Poller: since=version, unchanged → nur onOnline', async () => {
  const calls = [];
  const responses = [
    { version: 5, players: [{ id: 'p_a', online: true }, { id: 'p_b', online: false }] },
    { version: 5, unchanged: true, online: { p_a: true, p_b: true } },
  ];
  const apiFn = async (action, params) => { calls.push(params); return responses.shift(); };
  const states = []; const onlines = [];
  const timers = fakeTimers();
  const poller = createPoller({ code: 'abc234', token: 't', apiFn, timers, isHidden: () => false,
    onState: (s) => states.push(s), onOnline: (o) => onlines.push(o) });
  poller.start();
  await flush();
  assert.equal(calls[0].since, undefined);
  assert.equal(states.length, 1);
  assert.deepEqual(onlines[0], { p_a: true, p_b: false });
  assert.equal(timers.pending.ms, POLL_MS.match);
  await timers.run();
  assert.equal(calls[1].since, 5);
  assert.equal(states.length, 1, 'unchanged löst kein onState aus');
  assert.deepEqual(onlines[1], { p_a: true, p_b: true });
  poller.stop();
});

test('Poller: Backoff bei Netzfehlern, Verbindungsmeldung, Erholung', async () => {
  let fail = 3;
  const apiFn = async () => { if (fail-- > 0) throw new ApiError('weg', 0); return { version: 1, players: [] }; };
  const timers = fakeTimers();
  const conn = []; const errors = [];
  const poller = createPoller({ code: 'abc234', token: 't', apiFn, timers, isHidden: () => false,
    onState() {}, onError: (e, info) => errors.push(info), onConnection: (ok) => conn.push(ok) });
  poller.start();
  await flush();
  await timers.run();
  await timers.run();
  await timers.run();
  assert.deepEqual(timers.delays.slice(0, 3), [1000, 2000, 4000]);
  assert.deepEqual(errors.map((e) => e.failures), [1, 2, 3]);
  assert.deepEqual(conn, [false, true]);
  assert.equal(timers.pending.ms, POLL_MS.match, 'nach Erholung normales Intervall');
  poller.stop();
});

test('Poller: 403/404 sind fatal und stoppen', async () => {
  const apiFn = async () => { throw new ApiError('Unbekannt', 404); };
  const timers = fakeTimers();
  let info;
  const poller = createPoller({ code: 'abc234', token: 't', apiFn, timers, onState() {}, onError: (e, i) => { info = i; } });
  poller.start();
  await flush();
  assert.equal(info.fatal, true);
  assert.equal(timers.pending, null);
});

test('Poller: Modus „end“, versteckter Tab, poke', async () => {
  let n = 0;
  const apiFn = async () => ({ version: ++n, players: [] });
  const timers = fakeTimers();
  let hidden = false;
  const poller = createPoller({ code: 'abc234', token: 't', apiFn, timers, isHidden: () => hidden, onState() {} });
  poller.setMode('end');
  poller.start();
  await flush();
  assert.equal(timers.pending.ms, POLL_MS.end);
  poller.setMode('match');
  hidden = true;
  await timers.run();
  assert.equal(timers.pending.ms, POLL_MS.hidden);
  poller.poke();
  assert.equal(timers.pending.ms, 0);
  assert.throws(() => poller.setMode('quatsch'));
  poller.stop();
});

test('Poller: poke während laufender Anfrage → direkt danach erneut', async () => {
  let resolve;
  const apiFn = () => new Promise((r) => { resolve = r; });
  const timers = fakeTimers();
  const poller = createPoller({ code: 'abc234', token: 't', apiFn, timers, onState() {} });
  poller.start();
  poller.poke();
  resolve({ version: 1, players: [] });
  await flush();
  assert.equal(timers.pending.ms, 0);
  poller.stop();
});

function memory() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}

test('Raum-Sitzung: Token/ID, Pending-Zug, gezählte Matches, clear', () => {
  const st = memory();
  const s = createRoomSession(st);
  assert.equal(s.get('abc234'), null);
  s.set('abc234', { token: 'tok', me: 'p_a' });
  assert.deepEqual(s.get('abc234'), { token: 'tok', me: 'p_a' });
  assert.equal(st.getItem(SESSION_KEYS.token('abc234')), 'tok');
  s.setPending('abc234', { matchId: 'm1', round: 0, move: 'rock', nonce: 'n' });
  assert.equal(s.getPending('abc234').move, 'rock');
  s.markRecorded('abc234', 'm1');
  s.markRecorded('abc234', 'm1');
  assert.equal(s.wasRecorded('abc234', 'm1'), true);
  assert.equal(s.wasRecorded('abc234', 'm2'), false);
  s.clear('abc234');
  assert.equal(s.get('abc234'), null);
  assert.equal(s.getPending('abc234'), null);
  assert.equal(st.m.size, 0);
});
