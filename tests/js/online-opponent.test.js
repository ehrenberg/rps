import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOnlineOpponent, CLAIM_AFTER_MS, roundCount, newReactions, roundSentence } from '../../public/assets/js/online-opponent.js';
import { createRoomSession, ApiError } from '../../public/assets/js/net.js';
import { commitHash, verifyCommit } from '../../public/assets/js/crypto.js';

const CODE = 'abc234';
const A = 'p_a';
const B = 'p_b';

function memory() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

/** Server-Zustand eines Duells mit Match m1 (A = Index 0, B = Index 1). */
function duel({ history = [], cur = {}, winner = null, end = null, score = [0, 0], dropped = 0,
  players = null, rematch = [], series = {}, reactions = [], current = 'm1', extraMatches = {}, version = 1 } = {}) {
  return {
    version, now: 1000, code: CODE, type: 'duel', variant: 'classic', bestOf: 3, status: 'running',
    me: A, host: A,
    players: players ?? [
      { id: A, name: 'Anna', online: true, spectator: false, left: false },
      { id: B, name: 'Ben', online: true, spectator: false, left: false },
    ],
    matches: {
      ...extraMatches,
      [current]: {
        id: current, p: [A, B], score, target: 2, dropped,
        cur: { committed: [false, false], revealed: [false, false], commit: [null, null], lockedAt: null, deadline: null, ...cur },
        history, winner, end, from: null,
      },
    },
    current, myMatch: winner === null && end === null ? current : null,
    series, rematch, bracket: [], round: null, champion: null, reactions,
  };
}

function setup(state, { me = A, now = () => 0, session = createRoomSession(memory()) } = {}) {
  const calls = [];
  const events = [];
  let pokes = 0;
  const apiFn = async (action, params) => {
    calls.push({ action, ...params });
    if (apiFn.fail?.[action]) throw apiFn.fail[action];
    return { ok: true, version: 2 };
  };
  const adapter = createOnlineOpponent({
    code: CODE, token: 'tok', me, kind: state.type, state, apiFn, session, poke: () => { pokes += 1; }, now,
    makeNonce: () => 'n'.repeat(32),
  });
  adapter.start((type, payload) => events.push([type, payload]));
  return {
    adapter, apiFn, calls, events, session,
    get pokes() { return pokes; },
    types: () => events.map((e) => e[0]),
    last: (type) => [...events].reverse().find((e) => e[0] === type)?.[1],
    clear: () => { events.length = 0; },
  };
}

const settle = () => new Promise((r) => setImmediate(r));

test('Hilfsfunktionen: roundCount, newReactions, roundSentence', () => {
  assert.equal(roundCount({ dropped: 3, history: [1, 2] }), 5);
  assert.equal(roundCount({ history: [1] }), 1);
  assert.deepEqual(newReactions([{ id: 3 }, { id: 1 }, { id: 2 }], 1).map((r) => r.id), [2, 3]);
  assert.equal(roundSentence('rock', 'paper', 'Ben'), 'Papier bedeckt Stein');
  assert.equal(roundSentence('rock', null, 'Ben'), 'Ben hat nicht rechtzeitig aufgedeckt');
  assert.equal(roundSentence(null, 'rock', 'Ben'), 'Du hast nicht rechtzeitig aufgedeckt');
  assert.equal(roundSentence(null, null, 'Ben'), 'Keiner hat rechtzeitig aufgedeckt');
  assert.equal(roundSentence(null, null, 'Ben', 1), 'Zeit abgelaufen – Runde an dich');
  assert.equal(roundSentence(null, null, 'Ben', -1), 'Zeit abgelaufen – Runde an Ben');
});

test('Start: matchStart mit Gegnername, Runde 1 offen, Status „wählt“', () => {
  const t = setup(duel());
  assert.equal(t.types()[0], 'matchStart');
  const start = t.last('matchStart');
  assert.equal(start.oppName, 'Ben');
  assert.equal(start.target, 2);
  assert.deepEqual(start.score, [0, 0]);
  assert.deepEqual(t.last('roundOpen'), { round: 1, commit: null });
  assert.equal(t.last('opponentStatus').state, 'choosing');
  assert.equal(t.adapter.info.statsMode, 'duel');
  assert.equal(t.adapter.info.features.reactions, true);
});

test('Ablauf: commit → locked → automatisches reveal → Ergebnis mit geprüftem Beweis', async () => {
  const t = setup(duel());
  await t.adapter.submitMove('rock');
  const commit = t.calls.find((c) => c.action === 'commit');
  assert.equal(commit.hash, await commitHash('rock', 'n'.repeat(32)));
  assert.equal(t.session.getPending(CODE).move, 'rock');
  assert.ok(t.pokes >= 1);

  t.clear();
  t.adapter.update(duel({ version: 2, cur: { committed: [true, false] } }));
  assert.equal(t.types().includes('roundLocked'), false, 'Gegner noch nicht bereit');
  t.adapter.update(duel({ version: 3, cur: { committed: [true, true], commit: ['h1', 'h2'], lockedAt: 990, deadline: 1010 } }));
  assert.ok(t.types().includes('roundLocked'));
  assert.equal(t.last('opponentStatus').state, 'ready');
  await settle();
  const reveal = t.calls.find((c) => c.action === 'reveal');
  assert.deepEqual([reveal.move, reveal.nonce], ['rock', 'n'.repeat(32)]);

  // Ich habe aufgedeckt, Gegner noch nicht → Frist
  t.adapter.update(duel({ version: 4, cur: { committed: [true, true], revealed: [true, false], lockedAt: 990, deadline: 1010 } }));
  assert.deepEqual(t.last('deadline'), { seconds: 10, who: 'reveal' });

  const bNonce = 'b'.repeat(32);
  const bHash = await commitHash('scissors', bNonce);
  t.clear();
  t.adapter.update(duel({ version: 5, score: [1, 0], history: [{ m: ['rock', 'scissors'], n: ['n'.repeat(32), bNonce], h: ['x', bHash], w: 0, f: false }] }));
  const resolved = t.last('roundResolved');
  assert.equal(resolved.myMove, 'rock');
  assert.equal(resolved.oppMove, 'scissors');
  assert.equal(resolved.outcome, 1);
  assert.equal(resolved.sentence, 'Stein schleift Schere');
  assert.deepEqual(resolved.score, [1, 0]);
  assert.equal(await verifyCommit(resolved.proof.hash, resolved.proof.move, resolved.proof.nonce), true);
  assert.equal(t.session.getPending(CODE), null, 'Pending nach Wertung gelöscht');
  assert.deepEqual(t.last('roundOpen'), { round: 2, commit: null });
  assert.deepEqual(t.last('deadline'), { seconds: null, who: null });
});

test('Fairness: vor history taucht kein Gegnerzug in Ereignissen auf', async () => {
  const t = setup(duel());
  await t.adapter.submitMove('paper');
  t.adapter.update(duel({ cur: { committed: [true, true], commit: ['h1', 'h2'], lockedAt: 990, deadline: 1010 } }));
  t.adapter.update(duel({ cur: { committed: [true, true], revealed: [true, true], lockedAt: 990, deadline: 1010 } }));
  for (const [type, payload] of t.events) {
    assert.notEqual(type, 'roundResolved');
    assert.equal(JSON.stringify(payload).includes('oppMove'), false);
  }
});

test('Reload nach eigenem Commit: Zug wiederhergestellt und später aufgedeckt', async () => {
  const session = createRoomSession(memory());
  session.set(CODE, { token: 'tok', me: A });
  session.setPending(CODE, { matchId: 'm1', round: 1, move: 'paper', nonce: 'p'.repeat(32), hash: 'h' });
  const history = [{ m: ['rock', 'rock'], n: ['a', 'b'], h: ['c', 'd'], w: -1, f: false }];
  const t = setup(duel({ history, cur: { committed: [true, false] } }), { session });
  assert.equal(t.last('matchStart').history.length, 1, 'gespielte Runden für den Verlauf');
  assert.deepEqual(t.last('roundOpen'), { round: 2, commit: null });
  assert.deepEqual(t.last('moveRestored'), { move: 'paper' });
  assert.equal(t.types().includes('roundResolved'), false, 'alte Runden nicht erneut auflösen');
  t.adapter.update(duel({ history, cur: { committed: [true, true], lockedAt: 990, deadline: 1010 } }));
  await settle();
  const reveal = t.calls.find((c) => c.action === 'reveal');
  assert.equal(reveal.move, 'paper');
});

test('Reload ohne gemerkten Zug: verständliche Fehlermeldung statt Absturz', () => {
  const t = setup(duel({ cur: { committed: [true, true], lockedAt: 990, deadline: 1010 } }));
  assert.match(t.last('error').message, /nicht mehr bekannt/);
  assert.equal(t.calls.some((c) => c.action === 'reveal'), false);
});

test('Perspektive als Spieler B (Index 1)', async () => {
  const t = setup(duel({ score: [0, 1], history: [{ m: ['rock', 'paper'], n: ['x', 'y'], h: ['h', 'i'], w: 1, f: false }] }), { me: B });
  const start = t.last('matchStart');
  assert.equal(start.oppName, 'Anna');
  assert.deepEqual(start.score, [1, 0]);
  assert.equal(start.history[0].myMove, 'paper');
  assert.equal(start.history[0].outcome, 1);
});

test('Matchende im Spiel: matchOver (kein replay), Revanche-Status, Serie', () => {
  const t = setup(duel({ score: [1, 0], history: [{ m: ['rock', 'scissors'], n: ['a', 'b'], h: ['c', 'd'], w: 0 }] }));
  t.adapter.update(duel({
    score: [2, 0], winner: 0, end: 'score', series: { [A]: 1, [B]: 0 }, rematch: [B],
    history: [{ m: ['rock', 'scissors'], n: ['a', 'b'], h: ['c', 'd'], w: 0 }, { m: ['paper', 'rock'], n: ['a', 'b'], h: ['c', 'd'], w: 0 }],
  }));
  const over = t.last('matchOver');
  assert.equal(over.winner, 'me');
  assert.deepEqual(over.score, [2, 0]);
  assert.equal(over.replay, false);
  assert.deepEqual(over.series, { me: 1, opp: 0 });
  assert.deepEqual(t.last('rematchStatus'), { me: false, opp: true, oppLeft: false });
});

test('Schon beendetes Match beim Start → replay (keine doppelte Statistik)', () => {
  const t = setup(duel({ score: [0, 2], winner: 1, end: 'score' }));
  assert.equal(t.last('matchOver').replay, true);
  assert.equal(t.last('matchOver').winner, 'opp');
});

test('Revanche: neues current → neues matchStart', async () => {
  const t = setup(duel({ score: [2, 0], winner: 0, end: 'score' }));
  await t.adapter.rematch();
  assert.equal(t.calls.at(-1).action, 'rematch');
  t.clear();
  t.adapter.update(duel({ current: 'm2' }));
  assert.equal(t.types()[0], 'matchStart');
  assert.equal(t.adapter.matchId, 'm2');
  assert.deepEqual(t.last('roundOpen'), { round: 1, commit: null });
});

test('Verdichtete history (dropped) erzeugt keine Geisterrunden', () => {
  const draw = { m: ['rock', 'rock'], n: ['a', 'b'], h: ['c', 'd'], w: -1 };
  const t = setup(duel({ history: [draw, draw, draw] }));
  t.clear();
  t.adapter.update(duel({ dropped: 2, history: [draw] })); // weiterhin 3 Runden insgesamt
  assert.equal(t.types().includes('roundResolved'), false);
  assert.equal(t.types().includes('roundOpen'), false, 'Runde 4 war schon offen');
});

test('Verdichtung + neue Runde → genau ein roundResolved mit richtiger Nummer', () => {
  const draw = { m: ['rock', 'rock'], n: ['a', 'b'], h: ['c', 'd'], w: -1 };
  const t = setup(duel({ history: [draw, draw, draw] }));
  t.clear();
  t.adapter.update(duel({ dropped: 2, history: [draw, { ...draw, m: ['paper', 'rock'], w: 0 }, draw] }));
  const resolved = t.events.filter((e) => e[0] === 'roundResolved');
  assert.equal(resolved.length, 2);
  assert.deepEqual(resolved.map((e) => e[1].number), [4, 5]);
});

test('Reaktionen: alte ignorieren, neue melden (fromMe/Name)', () => {
  const t = setup(duel({ reactions: [{ id: 1, from: B, emoji: '🔥', t: 1 }] }));
  assert.equal(t.types().includes('reaction'), false);
  t.adapter.update(duel({ reactions: [{ id: 1, from: B, emoji: '🔥', t: 1 }, { id: 2, from: B, emoji: '😂', t: 2 }, { id: 3, from: A, emoji: '👍', t: 3 }] }));
  const r = t.events.filter((e) => e[0] === 'reaction').map((e) => e[1]);
  assert.deepEqual(r, [{ emoji: '😂', fromMe: false, name: 'Ben' }, { emoji: '👍', fromMe: true, name: 'Anna' }]);
});

test('Reaktion: 429 wird still ignoriert, andere Fehler gemeldet', async () => {
  const t = setup(duel());
  t.apiFn.fail = { react: new ApiError('Zu schnell', 429) };
  t.adapter.sendReaction('🔥');
  await settle();
  assert.equal(t.types().includes('error'), false);
  t.apiFn.fail = { react: new ApiError('Kaputt', 500) };
  t.adapter.sendReaction('🔥');
  await settle();
  assert.equal(t.last('error').message, 'Kaputt');
});

test('Gegner offline → nach 45 s Sieg beanspruchbar; online → wieder weg', () => {
  let clock = 0;
  const t = setup(duel(), { now: () => clock });
  t.adapter.updateOnline({ [A]: true, [B]: false });
  assert.equal(t.last('opponentStatus').state, 'offline');
  clock = CLAIM_AFTER_MS - 1;
  t.adapter.updateOnline({ [A]: true, [B]: false });
  assert.notEqual(t.last('claimAvailable')?.available, true);
  clock = CLAIM_AFTER_MS + 1;
  t.adapter.updateOnline({ [A]: true, [B]: false });
  assert.equal(t.last('claimAvailable').available, true);
  t.adapter.updateOnline({ [A]: true, [B]: true });
  assert.equal(t.last('claimAvailable').available, false);
  assert.equal(t.last('opponentStatus').state, 'choosing');
});

test('Gegner verlassen → Status „left“, Matchende mit Grund leave', () => {
  const players = [
    { id: A, name: 'Anna', online: true, spectator: false, left: false },
    { id: B, name: 'Ben', online: false, spectator: false, left: true },
  ];
  const t = setup(duel());
  t.adapter.update(duel({ players, winner: 0, end: 'leave', score: [0, 0] }));
  assert.equal(t.last('matchOver').reason, 'leave');
  assert.equal(t.last('rematchStatus').oppLeft, true);
  assert.equal(t.last('opponentStatus').state, 'left');
});

test('Commit-Fehler: Pending wird verworfen und Fehler weitergereicht', async () => {
  const t = setup(duel());
  t.apiFn.fail = { commit: new ApiError('Passt nicht', 409) };
  await assert.rejects(t.adapter.submitMove('rock'), /Passt nicht/);
  assert.equal(t.session.getPending(CODE), null);
});

test('Verlassen: API leave + Sitzung gelöscht', async () => {
  const session = createRoomSession(memory());
  session.set(CODE, { token: 'tok', me: A });
  const t = setup(duel(), { session });
  await t.adapter.leave();
  assert.equal(t.calls.at(-1).action, 'leave');
  assert.equal(session.get(CODE), null);
});

test('Turnier: verfolgt festes Match, statsMode tournament', () => {
  const state = { ...duel(), type: 'tournament', current: null, myMatch: 'm1', bracket: [['m1']], round: 1 };
  const t = setup(state);
  assert.equal(t.adapter.info.statsMode, 'tournament');
  assert.equal(t.adapter.matchId, 'm1');
  assert.match(t.last('matchStart').oppDetail, /Runde 1/);
});

test('Commit-Frist: Säumiger sieht eigene Frist, Wartender die des Gegners', () => {
  const t = setup(duel({ cur: { committed: [false, true], commitDeadline: 1012 } }));
  assert.deepEqual(t.last('deadline'), { seconds: 12, who: 'commit' });
  t.adapter.update(duel({ cur: { committed: [true, false], commitDeadline: 1030 } }));
  assert.deepEqual(t.last('deadline'), { seconds: 30, who: 'oppCommit' });
  t.adapter.update(duel({ cur: { committed: [false, false] } }));
  assert.deepEqual(t.last('deadline'), { seconds: null, who: null });
});

test('Forfeit durch Commit-Frist: Runde ohne Züge, kein Beweis, Punkt an den Wählenden', () => {
  const t = setup(duel());
  t.adapter.update(duel({ score: [0, 1], history: [{ m: [null, null], n: [null, null], h: [null, 'abc'], w: 1, f: true }] }));
  const r = t.last('roundResolved');
  assert.equal(r.forfeit, true);
  assert.equal(r.proof, null);
  assert.equal(r.myMove, null);
  assert.equal(r.outcome, -1);
  assert.equal(r.sentence, 'Zeit abgelaufen – Runde an Ben');
  assert.deepEqual(r.score, [0, 1]);
});
