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

/** Sitzung mit eigenem Platz in CODE (Pending/Recorded hängen am Raum-Eintrag). */
function seated() {
  const s = createRoomSession(memory());
  s.set(CODE, { token: 'tok', me: A });
  return s;
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

/** Manuelle Timer für Wiederholungen (run() führt alle fälligen aus). */
function fakeTimers() {
  const t = {
    queue: [],
    setTimeout(fn, ms) { t.queue.push({ fn, ms }); return t.queue.length; },
    clearTimeout() {},
    async run() { const q = t.queue.splice(0); for (const x of q) await x.fn(); await settle(); },
  };
  return t;
}

function setup(state, { me = A, now = () => 0, session = seated(), timers = fakeTimers() } = {}) {
  const calls = [];
  const events = [];
  let pokes = 0;
  const apiFn = async (action, params) => {
    calls.push({ action, ...params });
    if (apiFn.hook) await apiFn.hook(action, params);
    if (apiFn.fail?.[action]) throw apiFn.fail[action];
    return { ok: true, version: 2 };
  };
  const adapter = createOnlineOpponent({
    code: CODE, token: 'tok', me, kind: state.type, state, apiFn, session, poke: () => { pokes += 1; }, now, timers,
    makeNonce: () => 'n'.repeat(32),
  });
  adapter.start((type, payload) => events.push([type, payload]));
  return {
    adapter, apiFn, calls, events, session, timers,
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
  const myHash = await commitHash('rock', 'n'.repeat(32));
  assert.equal(commit.hash, myHash);
  assert.equal(t.session.getPending(CODE).move, 'rock');
  assert.ok(t.pokes >= 1);

  const bNonce = 'b'.repeat(32);
  const bHash = await commitHash('scissors', bNonce);
  t.clear();
  t.adapter.update(duel({ version: 2, cur: { committed: [true, false], commit: [myHash, null] } }));
  assert.equal(t.types().includes('roundLocked'), false, 'Gegner noch nicht bereit');
  assert.equal(t.types().includes('moveRestored'), false, 'eigener Zug ist schon angezeigt');
  t.adapter.update(duel({ version: 3, cur: { committed: [true, true], commit: [myHash, bHash], lockedAt: 990, deadline: 1010 } }));
  assert.ok(t.types().includes('roundLocked'));
  assert.deepEqual(t.last('opponentCommit'), { hash: bHash }, 'Gegner-Hash wird vorab gezeigt');
  assert.equal(t.last('opponentStatus').state, 'ready');
  await settle();
  const reveal = t.calls.find((c) => c.action === 'reveal');
  assert.deepEqual([reveal.move, reveal.nonce], ['rock', 'n'.repeat(32)]);

  // Ich habe aufgedeckt, Gegner noch nicht → Frist
  t.adapter.update(duel({ version: 4, cur: { committed: [true, true], commit: [myHash, bHash], revealed: [true, false], lockedAt: 990, deadline: 1010 } }));
  assert.deepEqual(t.last('deadline'), { seconds: 10, who: 'reveal' });
  assert.equal(t.events.filter((e) => e[0] === 'opponentCommit').length, 1, 'Hash nur einmal je Runde');

  t.clear();
  t.adapter.update(duel({ version: 5, score: [1, 0], history: [{ m: ['rock', 'scissors'], n: ['n'.repeat(32), bNonce], h: [myHash, bHash], w: 0, f: false }] }));
  const resolved = t.last('roundResolved');
  assert.equal(resolved.myMove, 'rock');
  assert.equal(resolved.oppMove, 'scissors');
  assert.equal(resolved.outcome, 1);
  assert.equal(resolved.sentence, 'Stein schleift Schere');
  assert.deepEqual(resolved.score, [1, 0]);
  assert.equal(await verifyCommit(resolved.proof.hash, resolved.proof.move, resolved.proof.nonce), true);
  assert.equal(resolved.proof.shownHash, bHash, 'vorher gezeigter Hash zum Vergleich');
  assert.equal(resolved.proof.ownHashOk, true, 'eigener Hash passt zum gemerkten Zug');
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
  const session = seated();
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

test('Schon gezähltes Match beim Start → replay (keine doppelte Statistik)', () => {
  const session = seated();
  session.markRecorded(CODE, 'm:m1');
  const t = setup(duel({ score: [0, 2], winner: 1, end: 'score' }), { session });
  assert.equal(t.last('matchOver').replay, true);
  assert.equal(t.last('matchOver').winner, 'opp');
});

test('Reload mitten in der Matchende-Animation: noch nicht gezähltes Match wird gezählt, danach nie wieder', () => {
  const session = seated();
  const t = setup(duel({ score: [0, 2], winner: 1, end: 'score' }), { session });
  const over = t.last('matchOver');
  assert.equal(over.replay, false, 'noch nicht gezählt → zählen');
  assert.equal(over.recordId, 'm:m1');
  t.adapter.markRecorded(over.recordId);
  const again = setup(duel({ score: [0, 2], winner: 1, end: 'score' }), { session });
  assert.equal(again.last('matchOver').replay, true);
});

test('Commit-Fehler ohne Antwort (Status 0): Pending bleibt, poke, Zug gilt als abgegeben, sobald der Server ihn zeigt', async () => {
  const t = setup(duel());
  t.apiFn.fail = { commit: new ApiError('Keine Verbindung zum Server.', 0) };
  const pokesBefore = t.pokes;
  await assert.rejects(t.adapter.submitMove('rock'), /Keine Verbindung/);
  assert.equal(t.session.getPending(CODE)?.move, 'rock', 'Server hat den Commit evtl. gespeichert');
  assert.ok(t.pokes > pokesBefore, 'Zustand sofort neu laden');
  t.apiFn.fail = {};
  t.clear();
  const myHash = await commitHash('rock', 'n'.repeat(32));
  t.adapter.update(duel({ version: 2, cur: { committed: [true, false], commit: [myHash, null] } }));
  assert.deepEqual(t.last('moveRestored'), { move: 'rock' });
  t.adapter.update(duel({ version: 3, cur: { committed: [true, true], commit: [myHash, 'x'], lockedAt: 990 } }));
  await settle();
  assert.equal(t.calls.find((c) => c.action === 'reveal')?.move, 'rock', 'Runde nicht verloren');
});

test('Commit-Fehler 5xx, während der Server den Zug schon zeigt → gilt als abgegeben (kein Fehler)', async () => {
  const t = setup(duel());
  const myHash = await commitHash('rock', 'n'.repeat(32));
  t.apiFn.hook = async (action) => {
    if (action !== 'commit') return;
    // Während der Request hängt, kommt ein Poll mit meinem Commit an
    t.adapter.update(duel({ version: 2, cur: { committed: [true, false], commit: [myHash, null] } }));
    throw new ApiError('Serverfehler (502).', 502);
  };
  await t.adapter.submitMove('rock');
  assert.equal(t.types().includes('moveRestored'), false, 'Wahl war schon angezeigt');
  assert.equal(t.session.getPending(CODE).move, 'rock');
});

test('409 nach Netzfehler: alter Pending bleibt, wenn er zum Server-Commit passt', async () => {
  const t = setup(duel());
  const rockHash = await commitHash('rock', 'n'.repeat(32));
  t.apiFn.fail = { commit: new ApiError('Keine Verbindung zum Server.', 0) };
  await assert.rejects(t.adapter.submitMove('rock'));
  // Server hatte „rock“ doch gespeichert; Spieler wählt erneut
  t.apiFn.fail = { commit: new ApiError('Du hast schon gewählt.', 409) };
  await assert.rejects(t.adapter.submitMove('paper'), /schon gewählt/);
  assert.equal(t.session.getPending(CODE).move, 'rock', 'Zug zum gespeicherten Hash bleibt aufdeckbar');
  t.clear();
  t.adapter.update(duel({ version: 2, cur: { committed: [true, false], commit: [rockHash, null] } }));
  assert.deepEqual(t.last('moveRestored'), { move: 'rock' });
});

test('409 mit bekanntem, anderem Server-Hash: alter Pending wird verworfen', async () => {
  const t = setup(duel());
  t.apiFn.fail = { commit: new ApiError('Keine Verbindung zum Server.', 0) };
  await assert.rejects(t.adapter.submitMove('rock'));
  t.adapter.update(duel({ version: 2, cur: { committed: [false, false], commit: [null, null] } }));
  t.adapter.update(duel({ version: 3, cur: { committed: [true, false], commit: ['fremd', null] } }));
  t.apiFn.fail = { commit: new ApiError('Du hast schon gewählt.', 409) };
  await assert.rejects(t.adapter.submitMove('paper'));
  assert.equal(t.session.getPending(CODE), null);
});

test('Reveal schlägt fehl (Netz) → eigener Retry mit Backoff, ohne neue Server-Version', async () => {
  const session = seated();
  session.setPending(CODE, { matchId: 'm1', round: 0, move: 'paper', nonce: 'p'.repeat(32), hash: 'h' });
  const t = setup(duel({ cur: { committed: [true, false] } }), { session });
  t.apiFn.fail = { reveal: new ApiError('Keine Verbindung zum Server.', 0) };
  t.adapter.update(duel({ version: 2, cur: { committed: [true, true], lockedAt: 990, deadline: 1010 } }));
  await settle();
  assert.equal(t.calls.filter((c) => c.action === 'reveal').length, 1);
  assert.equal(t.timers.queue.length, 1, 'Wiederholung geplant');
  const firstDelay = t.timers.queue[0].ms;
  await t.timers.run();
  assert.equal(t.calls.filter((c) => c.action === 'reveal').length, 2);
  assert.ok(t.timers.queue[0].ms > firstDelay, 'Backoff wächst');
  t.apiFn.fail = {};
  await t.timers.run();
  assert.equal(t.calls.filter((c) => c.action === 'reveal').length, 3);
  assert.equal(t.timers.queue.length, 0, 'nach Erfolg keine weitere Wiederholung');
});

test('Reveal-Retry endet, wenn die Runde vorbei ist oder der Adapter entsorgt wurde', async () => {
  const session = seated();
  session.setPending(CODE, { matchId: 'm1', round: 0, move: 'paper', nonce: 'p'.repeat(32), hash: 'h' });
  const locked = (version) => duel({ version, cur: { committed: [true, true], lockedAt: 990, deadline: 1010 } });
  const t = setup(duel({ cur: { committed: [true, false] } }), { session });
  t.apiFn.fail = { reveal: new ApiError('Keine Verbindung zum Server.', 0) };
  t.adapter.update(locked(2));
  await settle();
  assert.equal(t.timers.queue.length, 1);
  t.adapter.update(duel({ version: 3, cur: { committed: [true, true], revealed: [true, false], lockedAt: 990, deadline: 1010 } }));
  await t.timers.run();
  assert.equal(t.calls.filter((c) => c.action === 'reveal').length, 1, 'Server meldet schon aufgedeckt');

  const u = setup(duel({ cur: { committed: [true, false] } }), { session });
  u.apiFn.fail = { reveal: new ApiError('Keine Verbindung zum Server.', 0) };
  u.adapter.update(locked(2));
  await settle();
  assert.equal(u.timers.queue.length, 1);
  u.adapter.dispose();
  await u.timers.run();
  assert.equal(u.calls.filter((c) => c.action === 'reveal').length, 1);
});

test('Fairness: abweichender Gegner-Hash und abweichender eigener Hash werden gemeldet', async () => {
  const t = setup(duel());
  await t.adapter.submitMove('rock');
  t.adapter.update(duel({ version: 2, cur: { committed: [true, true], commit: ['meinhash', 'gezeigt'], lockedAt: 990 } }));
  await settle();
  const bHash = await commitHash('scissors', 'b'.repeat(32));
  t.adapter.update(duel({ version: 3, score: [1, 0], history: [{ m: ['rock', 'scissors'], n: ['n'.repeat(32), 'b'.repeat(32)], h: ['anders', bHash], w: 0 }] }));
  const { proof } = t.last('roundResolved');
  assert.equal(proof.hash, bHash);
  assert.equal(proof.shownHash, 'gezeigt', 'Controller vergleicht mit dem vorab gezeigten Hash');
  assert.equal(proof.ownHashOk, false, 'Server hat für meinen Zug einen anderen Hash');
});

test('Forfeit-Runde ohne Lock (Commit-Frist) startet keinen Countdown', () => {
  const t = setup(duel());
  t.clear();
  t.adapter.update(duel({ score: [0, 1], history: [{ m: [null, null], n: [null, null], h: [null, 'abc'], w: 1, f: true }] }));
  assert.equal(t.types().includes('roundLocked'), false);
  assert.ok(t.types().includes('roundResolved'));
  // Normale Runde, deren Lock zwischen zwei Polls lag → Countdown trotzdem
  t.clear();
  t.adapter.update(duel({ score: [1, 1], history: [{ m: [null, null], n: [null, null], h: [null, 'abc'], w: 1, f: true }, { m: ['rock', 'scissors'], n: ['a', 'b'], h: ['c', 'd'], w: 0 }] }));
  assert.ok(t.types().includes('roundLocked'));
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

test('Endgültiger Commit-Fehler (4xx): Pending wird verworfen und Fehler weitergereicht', async () => {
  const t = setup(duel());
  t.apiFn.fail = { commit: new ApiError('Passt nicht', 409) };
  await assert.rejects(t.adapter.submitMove('rock'), /Passt nicht/);
  assert.equal(t.session.getPending(CODE), null);
  t.apiFn.fail = { commit: new ApiError('Ungültig', 400) };
  await assert.rejects(t.adapter.submitMove('rock'), /Ungültig/);
  assert.equal(t.session.getPending(CODE), null);
});

test('Adapter hat kein ungenutztes leave()', () => {
  const t = setup(duel());
  assert.equal(t.adapter.leave, undefined);
});

test('Turnier: verfolgt festes Match, statsMode tournament', () => {
  const state = { ...duel(), type: 'tournament', current: null, myMatch: 'm1', bracket: [['m1']], round: 1 };
  const t = setup(state);
  assert.equal(t.adapter.info.statsMode, 'tournament');
  assert.equal(t.adapter.matchId, 'm1');
  assert.equal(t.last('matchStart').oppDetail, '', 'Turnierrunde steht schon oben (kein doppeltes „Runde“)');
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

test('Reload direkt nach dem Klick: gespeicherter Zug passt zum Server-Hash → weiter als abgegeben', async () => {
  const session = seated();
  const hash = await commitHash('rock', 'r'.repeat(32));
  session.setPending(CODE, { matchId: 'm1', round: 0, move: 'rock', nonce: 'r'.repeat(32), hash });
  const t = setup(duel({ cur: { committed: [true, false], commit: [hash, null] } }), { session });
  assert.deepEqual(t.last('moveRestored'), { move: 'rock' });
  t.adapter.update(duel({ version: 2, cur: { committed: [true, true], commit: [hash, 'x'], lockedAt: 990 } }));
  await settle();
  assert.equal(t.calls.find((c) => c.action === 'reveal')?.move, 'rock');
});

test('Reload: gespeicherter Zug passt NICHT zum Server-Hash → nicht aufdecken, verständlicher Hinweis', () => {
  const session = seated();
  session.setPending(CODE, { matchId: 'm1', round: 0, move: 'rock', nonce: 'r'.repeat(32), hash: 'anders' });
  const t = setup(duel({ cur: { committed: [true, true], commit: ['server', 'x'], lockedAt: 990 } }), { session });
  assert.deepEqual(t.last('moveRestored'), { move: null });
  assert.match(t.last('error').message, /nicht mehr bekannt/);
  assert.equal(t.calls.some((c) => c.action === 'reveal'), false);
});

test('Pending liegt schon vor dem commit-Request im Speicher (Reload während des Requests)', async () => {
  const t = setup(duel());
  let seen = null;
  t.apiFn.hook = async (action) => { if (action === 'commit') seen = t.session.getPending(CODE); };
  await t.adapter.submitMove('paper');
  assert.equal(seen?.move, 'paper');
  assert.equal(seen.hash, await commitHash('paper', 'n'.repeat(32)));
});

test('Revanche nach beanspruchtem Sieg: Gegner offline → keine Revanche möglich, zurück online → wieder möglich', () => {
  const t = setup(duel());
  t.adapter.updateOnline({ [A]: true, [B]: false });
  t.adapter.update(duel({ version: 2, winner: 0, end: 'claim', score: [0, 0] }));
  assert.equal(t.last('rematchStatus').oppLeft, true);
  t.adapter.updateOnline({ [A]: true, [B]: true });
  assert.equal(t.last('rematchStatus').oppLeft, false);
});
