import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideRoute, inviteErrorKind, leaveClearsSession, MATCH_TOAST, myRunningMatch, closedInviteText } from '../../public/assets/js/room-flow.js';
import { ApiError } from '../../public/assets/js/net.js';

const A = 'p_a';
const B = 'p_b';
const C = 'p_c';

const match = (id, p, extra = {}) => ({ id, p, score: [0, 0], winner: null, end: null, history: [], ...extra });

function duel(extra = {}) {
  return { type: 'duel', status: 'running', current: 'm1', matches: { m1: match('m1', [A, B]) }, ...extra };
}

function tournament(extra = {}) {
  return {
    type: 'tournament', status: 'running', current: null, myMatch: 'm1', round: 1,
    bracket: [['m1', 'm2'], ['m3']],
    matches: { m1: match('m1', [A, B]), m2: match('m2', [C, null], { winner: 0, end: 'bye' }), m3: match('m3', [null, C]) },
    ...extra,
  };
}

test('Duell: Lobby solange kein eigenes Match, dann Arena (Modus je Matchstand)', () => {
  assert.deepEqual(decideRoute(duel({ status: 'lobby', current: null, matches: {} }), { me: A, shown: null }),
    { view: 'lobby', mode: 'idle', fresh: true });
  assert.deepEqual(decideRoute(duel(), { me: A, shown: { kind: 'lobby' } }),
    { view: 'arena', matchId: 'm1', mode: 'match', fresh: true, toast: null });
  const over = duel({ matches: { m1: match('m1', [A, B], { winner: 0, end: 'score' }) } });
  assert.deepEqual(decideRoute(over, { me: A, shown: { kind: 'arena', matchId: 'm1' } }),
    { view: 'arena', matchId: 'm1', mode: 'end', fresh: false, toast: null });
  // Zuschauer eines fremden Duells (nicht im Match) bleibt in der Lobby
  assert.equal(decideRoute(duel(), { me: C, shown: { kind: 'lobby' } }).fresh, false);
  assert.equal(decideRoute(duel(), { me: C, shown: { kind: 'lobby' } }).view, 'lobby');
});

test('Duell: Revanche (neues current) bleibt in derselben Arena', () => {
  const next = duel({ current: 'm2', matches: { m2: match('m2', [A, B]) } });
  assert.deepEqual(decideRoute(next, { me: A, shown: { kind: 'arena', matchId: 'm1' } }),
    { view: 'arena', matchId: 'm2', mode: 'match', fresh: false, toast: null });
});

test('Turnier: Lobby, dann eigenes Match mit Hinweis, Freilos → Baum', () => {
  assert.deepEqual(decideRoute(tournament({ status: 'lobby', myMatch: null, bracket: [] }), { me: A, shown: null }),
    { view: 'lobby', mode: 'idle', fresh: true });
  assert.deepEqual(decideRoute(tournament(), { me: A, shown: { kind: 'bracket' } }),
    { view: 'arena', matchId: 'm1', mode: 'match', fresh: true, toast: MATCH_TOAST });
  assert.deepEqual(decideRoute(tournament({ myMatch: null }), { me: C, shown: { kind: 'lobby' } }),
    { view: 'bracket', mode: 'idle', fresh: true });
});

test('Turnier: beendetes, gezeigtes Match bleibt bis „Zum Turnierbaum“; danach Baum', () => {
  const done = tournament({ myMatch: null, matches: { ...tournament().matches, m1: match('m1', [A, B], { winner: 0, end: 'score' }) } });
  const shown = { kind: 'arena', matchId: 'm1' };
  assert.deepEqual(decideRoute(done, { me: A, shown }), { view: 'arena', matchId: 'm1', mode: 'end', fresh: false, toast: null });
  assert.deepEqual(decideRoute(done, { me: A, shown, dismissedMatch: 'm1' }), { view: 'bracket', mode: 'idle', fresh: true });
});

test('Turnier: nächstes Match ersetzt das alte Arena-Match direkt (ohne Toast)', () => {
  const next = tournament({ myMatch: 'm3', matches: { ...tournament().matches, m3: match('m3', [A, C]) } });
  assert.deepEqual(decideRoute(next, { me: A, shown: { kind: 'arena', matchId: 'm1' }, dismissedMatch: 'm1' }),
    { view: 'arena', matchId: 'm3', mode: 'match', fresh: true, toast: null });
});

test('Turnier beendet: Baum im Modus „end“', () => {
  const fin = tournament({ status: 'finished', myMatch: null, champion: A });
  assert.deepEqual(decideRoute(fin, { me: B, shown: { kind: 'bracket' } }), { view: 'bracket', mode: 'end', fresh: false });
});

test('Einladung: nur 404 heißt „nicht gefunden“, sonst erneut versuchen', () => {
  assert.equal(inviteErrorKind(new ApiError('Diesen Raum gibt es nicht (mehr).', 404)), 'missing');
  assert.equal(inviteErrorKind(new ApiError('Keine Verbindung zum Server.', 0)), 'retry');
  assert.equal(inviteErrorKind(new ApiError('Serverfehler (500).', 500)), 'retry');
  assert.equal(inviteErrorKind(new ApiError('Zu viele Anfragen.', 429)), 'retry');
});

test('Verlassen: Sitzung nur bei Erfolg oder 403/404 löschen', () => {
  assert.equal(leaveClearsSession(null), true);
  assert.equal(leaveClearsSession(new ApiError('Platz ungültig', 403)), true);
  assert.equal(leaveClearsSession(new ApiError('Raum weg', 404)), true);
  assert.equal(leaveClearsSession(new ApiError('Keine Verbindung zum Server.', 0)), false);
  assert.equal(leaveClearsSession(new ApiError('Serverfehler (500).', 500)), false);
});

test('myRunningMatch: eigenes laufendes Match (Verlassen zählt als Niederlage, Menü fragt nach)', () => {
  assert.deepEqual(myRunningMatch(duel(), A), { id: 'm1', mode: 'duel', recordId: 'm:m1' });
  assert.equal(myRunningMatch(duel({ matches: { m1: match('m1', [A, B], { winner: 0, end: 'score' }) } }), A), null);
  assert.equal(myRunningMatch(duel(), C), null, 'Zuschauer');
  assert.equal(myRunningMatch(duel({ status: 'lobby', current: null, matches: {} }), A), null);
  assert.deepEqual(myRunningMatch(tournament(), A), { id: 'm1', mode: 'tournament', recordId: 'm:m1' });
  assert.equal(myRunningMatch(tournament({ myMatch: null }), C), null);
  assert.equal(myRunningMatch(null, A), null);
});

test('closedInviteText: beendet ≠ voll; voll mit Hinweis auf anderen Tab', () => {
  assert.equal(closedInviteText({ type: 'duel', status: 'finished' }), 'Dieses Duell ist schon beendet.');
  assert.match(closedInviteText({ type: 'duel', status: 'running' }), /schon voll.*anderen Tab.*verloren/s);
  assert.equal(closedInviteText({ type: 'tournament', status: 'running' }), 'Hier ist kein Platz mehr frei.');
});
