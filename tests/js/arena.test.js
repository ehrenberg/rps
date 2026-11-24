import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCpuOpponent } from '../../public/assets/js/cpu-opponent.js';
import { createArenaController, PHASE } from '../../public/assets/js/arena.js';
import { moveForKey, MOVE_LETTERS } from '../../public/assets/js/move-keys.js';
import { verifyCommit } from '../../public/assets/js/crypto.js';

/** KI, die eine feste Zugfolge spielt und Beobachtungen mitschreibt. */
function scriptedAI(moves, explainText = null) {
  return (level, variant) => {
    let i = 0;
    const seen = [];
    return {
      level, name: 'Test', seen,
      pick: () => moves[i++ % moves.length],
      observe: (aiMove, playerMove) => seen.push([aiMove, playerMove]),
      explain: () => explainText,
    };
  };
}

/** Ansicht, die nur protokolliert. */
function fakeView() {
  const calls = [];
  const rec = (name) => (...args) => { calls.push([name, ...args]); };
  const view = { calls };
  for (const m of ['setup', 'setRoundOpen', 'setChosen', 'setOpponentStatus', 'playCountdown', 'reveal',
    'setScore', 'addHistory', 'setFairness', 'setInsight', 'showReaction', 'showMatchOver', 'hideMatchOver', 'showError',
    'setMovesEnabled', 'setOpponentCommit', 'setRematchStatus']) {
    view[m] = rec(m);
  }
  view.names = () => calls.map((c) => c[0]);
  view.last = (name) => [...calls].reverse().find((c) => c[0] === name);
  return view;
}

function fakeStats() {
  const s = { rounds: [], matches: [] };
  s.recordRound = (r) => s.rounds.push(r);
  s.recordMatch = (m) => s.matches.push(m);
  return s;
}

async function setup(setupOpts, aiMoves, explain) {
  const adapter = createCpuOpponent(setupOpts, { createAI: scriptedAI(aiMoves, explain) });
  const view = fakeView();
  const stats = fakeStats();
  const ctl = createArenaController({ adapter, view, stats });
  await ctl.start();
  await ctl.idle();
  return { adapter, view, stats, ctl };
}

async function play(ctl, move) {
  assert.equal(ctl.choose(move), true, `Zug ${move} sollte möglich sein`);
  // Adapter arbeitet asynchron (Hash), danach Warteschlange leeren
  for (let i = 0; i < 5; i++) { await new Promise((r) => setTimeout(r, 0)); await ctl.idle(); }
}

test('moveForKey: Ziffern und Buchstaben je Variante', () => {
  assert.equal(moveForKey('1', 'classic'), 'rock');
  assert.equal(moveForKey('3', 'classic'), 'scissors');
  assert.equal(moveForKey('4', 'classic'), null);
  assert.equal(moveForKey('5', 'lizard'), 'spock');
  assert.equal(moveForKey('P', 'classic'), 'paper');
  assert.equal(moveForKey('c', 'classic'), 'scissors');
  assert.equal(moveForKey('k', 'classic'), null);
  assert.equal(moveForKey('k', 'lizard'), 'spock');
  assert.equal(moveForKey('x', 'lizard'), null);
});

test('CPU-Adapter: Info und Features', () => {
  const a = createCpuOpponent({ level: 4, variant: 'lizard', bestOf: 5 }, { createAI: scriptedAI(['rock']) });
  assert.equal(a.info.statsMode, 'cpu-4');
  assert.equal(a.info.features.insight, true);
  assert.equal(a.info.features.status, false);
  const b = createCpuOpponent({ level: 2, variant: 'classic', bestOf: 3 }, { createAI: scriptedAI(['rock']) });
  assert.equal(b.info.features.insight, false);
});

test('Start: Setup, Gegner bereit, Runde offen mit Commit-Hash', async () => {
  const { view, ctl } = await setup({ level: 1, variant: 'classic', bestOf: 3 }, ['rock']);
  assert.equal(ctl.phase, PHASE.CHOOSING);
  const [, setupArgs] = view.last('setup');
  assert.equal(setupArgs.target, 2);
  assert.deepEqual(setupArgs.moves, ['rock', 'paper', 'scissors']);
  const [, open] = view.last('setRoundOpen');
  assert.equal(open.round, 1);
  assert.match(open.commit, /^[0-9a-f]{64}$/);
});

test('Komplettes Best of 3: Reihenfolge, Statistik, Fairness, Matchende', async () => {
  // KI spielt immer Schere; Spieler: Stein (Sieg), Schere (Unentschieden), Stein (Sieg)
  const { view, stats, ctl } = await setup({ level: 3, variant: 'classic', bestOf: 3 }, ['scissors']);
  const commit = view.last('setRoundOpen')[1].commit;
  await play(ctl, 'rock');
  const [, fair] = view.last('setFairness');
  assert.equal(fair.ok, true);
  assert.equal(fair.proof.hash, commit, 'Beweis gehört zum vorher gezeigten Hash');
  assert.equal(await verifyCommit(commit, 'scissors', fair.proof.nonce), true);
  assert.deepEqual(view.last('setScore')[1], [1, 0]);
  assert.equal(view.last('setScore')[2].scorer, 'me');

  await play(ctl, 'scissors');
  assert.deepEqual(view.last('setScore')[1], [1, 0]);
  assert.equal(view.last('setScore')[2].scorer, null);
  assert.equal(ctl.phase, PHASE.CHOOSING);

  await play(ctl, 'rock');
  assert.equal(ctl.phase, PHASE.OVER);
  assert.deepEqual(view.last('showMatchOver')[1], { won: true, score: [2, 0], reason: 'score', oppName: undefined, series: null, rematch: null });
  assert.deepEqual(stats.rounds.map((r) => r.result), ['w', 'd', 'w']);
  assert.deepEqual(stats.matches, [{ mode: 'cpu-3', result: 'w' }]);

  // Ablauf je Runde: gewählt → Countdown → Aufdecken → Punkte
  const n = view.names();
  const i = n.indexOf('setChosen');
  assert.deepEqual(n.slice(i, i + 4), ['setChosen', 'playCountdown', 'reveal', 'setScore']);
});

test('Niederlage Best of 5 in Echse & Spock', async () => {
  const { view, stats, ctl } = await setup({ level: 1, variant: 'lizard', bestOf: 5 }, ['spock']);
  for (let k = 0; k < 3; k++) await play(ctl, 'rock'); // Spock verdampft Stein
  assert.equal(view.last('reveal')[1].sentence, 'Spock verdampft Stein');
  assert.deepEqual(view.last('showMatchOver')[1].score, [0, 3]);
  assert.deepEqual(stats.matches, [{ mode: 'cpu-1', result: 'l' }]);
});

test('Wählen nur in Phase CHOOSING, ungültige Züge abgelehnt', async () => {
  const { ctl } = await setup({ level: 1, variant: 'classic', bestOf: 3 }, ['rock']);
  assert.equal(ctl.choose('spock'), false);
  assert.equal(ctl.choose('paper'), true);
  assert.equal(ctl.choose('paper'), false, 'kein Doppelklick');
});

test('Nochmal: neues Match nach Matchende', async () => {
  const { view, ctl } = await setup({ level: 1, variant: 'classic', bestOf: 3 }, ['scissors']);
  assert.equal(ctl.rematch(), false, 'nicht mitten im Match');
  await play(ctl, 'rock');
  await play(ctl, 'rock');
  assert.equal(ctl.rematch(), true);
  for (let i = 0; i < 3; i++) { await new Promise((r) => setTimeout(r, 0)); await ctl.idle(); }
  assert.equal(ctl.phase, PHASE.CHOOSING);
  assert.equal(view.names().filter((x) => x === 'setup').length, 2);
  assert.ok(view.names().includes('hideMatchOver'));
  assert.equal(view.last('setRoundOpen')[1].round, 1);
});

test('KI beobachtet jede Runde (auch Unentschieden) und erklärt sich', async () => {
  let ai;
  const factory = (...args) => (ai = scriptedAI(['rock'], 'Ich glaube, du magst Stein.')(...args));
  const adapter = createCpuOpponent({ level: 4, variant: 'classic', bestOf: 3 }, { createAI: factory });
  const view = fakeView();
  const ctl = createArenaController({ adapter, view });
  await ctl.start();
  await play(ctl, 'rock');
  await play(ctl, 'paper');
  assert.deepEqual(ai.seen, [['rock', 'rock'], ['rock', 'paper']]);
  assert.equal(view.last('setInsight')[1], 'Ich glaube, du magst Stein.');
});

test('Manipulierter Beweis wird als unfair erkannt', async () => {
  const adapter = createCpuOpponent({ level: 1, variant: 'classic', bestOf: 3 }, { createAI: scriptedAI(['rock']) });
  const view = fakeView();
  const ctl = createArenaController({ adapter, view, verify: async () => false });
  await ctl.start();
  await play(ctl, 'paper');
  assert.equal(view.last('setFairness')[1].ok, false);
});

test('dispose: keine Ansichtsaufrufe mehr', async () => {
  const { view, ctl } = await setup({ level: 1, variant: 'classic', bestOf: 3 }, ['rock']);
  ctl.dispose();
  const before = view.calls.length;
  ctl.choose('paper');
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(view.calls.length, before);
});

test('Fehler beim Adapter werden angezeigt, Wahl wieder frei', async () => {
  const { adapter, view, ctl } = await setup({ level: 1, variant: 'classic', bestOf: 3 }, ['rock']);
  adapter.submitMove = async () => { throw new Error('Verbindung weg'); };
  ctl.choose('paper');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(view.last('showError')[1], 'Verbindung weg');
  assert.equal(ctl.phase, PHASE.CHOOSING);
});

test('Sofort-Ereignisse warten nicht auf Animationen', async () => {
  const view = fakeView();
  let release;
  view.playCountdown = () => new Promise((r) => { release = r; });
  let emit;
  const adapter = {
    info: { kind: 'online', statsMode: 'duel', variant: 'classic', bestOf: 3,
      features: { status: true, reactions: true, commitBadge: false, insight: false } },
    start(h) { emit = h; }, submitMove: async () => {}, rematch() {}, sendReaction() {}, dispose() {},
  };
  const ctl = createArenaController({ adapter, view });
  ctl.start();
  emit('roundLocked', {});
  emit('roundOpen', { round: 2, commit: null });
  emit('opponentStatus', { state: 'offline' });
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(view.names().includes('setOpponentStatus'));
  assert.ok(!view.names().includes('setRoundOpen'), 'roundOpen wartet auf Countdown');
  release();
  await ctl.idle();
  assert.ok(view.names().includes('setRoundOpen'));
});

// ─── Online-ähnlicher Adapter für die Controller-Tests ───
function scriptedAdapter(overrides = {}) {
  const a = {
    info: { kind: 'online', statsMode: 'duel', variant: 'classic', bestOf: 3,
      features: { status: true, reactions: true, commitBadge: true, insight: false, claim: true } },
    emit: null,
    marked: [],
    start(h) { a.emit = h; }, submitMove: async () => {}, rematch() {}, sendReaction() {}, dispose() {},
    markRecorded(id) { a.marked.push(id); },
    ...overrides,
  };
  return a;
}

/** Ansicht, die den Freigabe-Zustand der Zug-Buttons wie die echte Ansicht abbildet. */
function statefulView() {
  const view = fakeView();
  view.movesEnabled = false;
  const wrap = (name, fn) => { const orig = view[name]; view[name] = (...args) => { fn(...args); return orig(...args); }; };
  wrap('setRoundOpen', () => { view.movesEnabled = true; });
  wrap('setChosen', () => { view.movesEnabled = false; });
  wrap('setMovesEnabled', (on) => { view.movesEnabled = on; });
  wrap('showMatchOver', () => { view.movesEnabled = false; });
  return view;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test('MOVE_LETTERS liegt im eigenen Modul (Ansicht importiert nicht vom Controller)', () => {
  assert.equal(MOVE_LETTERS.rock, 's');
});

test('Commit-Fehler: Zug-Buttons wieder frei, nicht nur die Phase', async () => {
  const view = statefulView();
  const adapter = scriptedAdapter({ submitMove: async () => { throw new Error('Keine Verbindung zum Server.'); } });
  const ctl = createArenaController({ adapter, view });
  ctl.start();
  adapter.emit('matchStart', { variant: 'classic', bestOf: 3, target: 2, oppName: 'Ben' });
  adapter.emit('roundOpen', { round: 1, commit: null });
  await ctl.idle();
  assert.equal(view.movesEnabled, true);
  ctl.choose('rock');
  assert.equal(view.movesEnabled, false);
  await tick();
  assert.equal(ctl.phase, PHASE.CHOOSING);
  assert.equal(view.movesEnabled, true, 'Spieler kann erneut wählen');
  assert.equal(ctl.choose('paper'), true);
});

test('Commit-Fehler nach moveRestored (Server hat den Zug doch) → Buttons bleiben gesperrt', async () => {
  const view = statefulView();
  let reject;
  const adapter = scriptedAdapter({ submitMove: () => new Promise((_, r) => { reject = r; }) });
  const ctl = createArenaController({ adapter, view });
  ctl.start();
  adapter.emit('matchStart', { variant: 'classic', bestOf: 3, target: 2, oppName: 'Ben' });
  adapter.emit('roundOpen', { round: 1, commit: null });
  await ctl.idle();
  ctl.choose('rock');
  adapter.emit('moveRestored', { move: 'rock' });
  adapter.emit('roundLocked', {});
  await ctl.idle();
  reject(new Error('Zeitüberschreitung'));
  await tick();
  assert.equal(view.movesEnabled, false);
  assert.notEqual(ctl.phase, PHASE.CHOOSING);
});

test('rematchStatus vor dem (animierten) Matchende geht nicht verloren', async () => {
  const view = statefulView();
  let release;
  view.playCountdown = () => new Promise((r) => { release = r; });
  const adapter = scriptedAdapter();
  const ctl = createArenaController({ adapter, view });
  ctl.start();
  adapter.emit('matchStart', { variant: 'classic', bestOf: 3, target: 2, oppName: 'Ben' });
  adapter.emit('roundLocked', {});
  adapter.emit('matchOver', { winner: 'me', score: [2, 0], reason: 'score', recordId: 'm:m1' });
  adapter.emit('rematchStatus', { me: false, opp: false, oppLeft: true }); // sofort, Overlay gibt es noch nicht
  await tick();
  release();
  await ctl.idle();
  assert.deepEqual(view.last('showMatchOver')[1].rematch, { me: false, opp: false, oppLeft: true });
  // Neues Match: alter Status gilt nicht mehr
  adapter.emit('matchStart', { variant: 'classic', bestOf: 3, target: 2, oppName: 'Ben' });
  adapter.emit('matchOver', { winner: 'opp', score: [0, 2], reason: 'score', recordId: 'm:m2' });
  await ctl.idle();
  assert.equal(view.last('showMatchOver')[1].rematch, null);
});

test('Fairness: Hash weicht vom vorher gezeigten ab bzw. eigener Hash falsch → nicht fair', async () => {
  const view = fakeView();
  const adapter = scriptedAdapter();
  const ctl = createArenaController({ adapter, view, verify: async () => true });
  ctl.start();
  adapter.emit('matchStart', { variant: 'classic', bestOf: 3, target: 2, oppName: 'Ben' });
  adapter.emit('opponentCommit', { hash: 'aaaa1111' });
  const round = { number: 1, myMove: 'rock', oppMove: 'paper', outcome: -1, result: 'l', sentence: 'x', score: [0, 1] };
  adapter.emit('roundResolved', { ...round, proof: { hash: 'bbbb', move: 'paper', nonce: 'n', shownHash: 'aaaa1111', ownHashOk: null } });
  await ctl.idle();
  assert.deepEqual(view.last('setOpponentCommit').slice(1), ['aaaa1111']);
  assert.equal(view.last('setFairness')[1].ok, false);
  assert.equal(view.last('setFairness')[1].reason, 'shown');
  adapter.emit('roundResolved', { ...round, number: 2, proof: { hash: 'bbbb', move: 'paper', nonce: 'n', shownHash: 'bbbb', ownHashOk: false } });
  await ctl.idle();
  assert.equal(view.last('setFairness')[1].ok, false);
  assert.equal(view.last('setFairness')[1].reason, 'own');
  adapter.emit('roundResolved', { ...round, number: 3, proof: { hash: 'bbbb', move: 'paper', nonce: 'n', shownHash: 'bbbb', ownHashOk: true } });
  await ctl.idle();
  assert.equal(view.last('setFairness')[1].ok, true);
  assert.equal(view.last('setFairness')[1].reason, null);
});

test('Matchende ohne Sieger (beide weg): neutral, keine Statistik', async () => {
  const view = fakeView();
  const stats = fakeStats();
  const adapter = scriptedAdapter();
  const ctl = createArenaController({ adapter, view, stats });
  ctl.start();
  adapter.emit('matchOver', { winner: null, score: [1, 1], reason: 'leave', recordId: 'm:m1' });
  await ctl.idle();
  assert.deepEqual(stats.matches, []);
  assert.equal(view.last('showMatchOver')[1].won, null);
});

test('Statistik je Match genau einmal: markRecorded nach dem Zählen, replay zählt nicht', async () => {
  const view = fakeView();
  const stats = fakeStats();
  const adapter = scriptedAdapter();
  const ctl = createArenaController({ adapter, view, stats });
  ctl.start();
  adapter.emit('matchOver', { winner: 'me', score: [2, 0], reason: 'score', recordId: 'm:m1' });
  await ctl.idle();
  assert.deepEqual(stats.matches, [{ mode: 'duel', result: 'w' }]);
  assert.deepEqual(adapter.marked, ['m:m1']);
  adapter.emit('matchOver', { winner: 'me', score: [2, 0], reason: 'score', recordId: 'm:m1', replay: true });
  await ctl.idle();
  assert.equal(stats.matches.length, 1);
  assert.deepEqual(adapter.marked, ['m:m1']);
});

test('Sieg beanspruchen: keine Doppelanfrage, Fehler nach dispose nicht mehr angezeigt', async () => {
  const view = fakeView();
  let calls = 0;
  let reject;
  const adapter = scriptedAdapter({ claim: () => { calls += 1; return new Promise((_, r) => { reject = r; }); } });
  const ctl = createArenaController({ adapter, view });
  ctl.start();
  ctl.claim();
  ctl.claim();
  assert.equal(calls, 1);
  ctl.dispose();
  reject(new Error('weg'));
  await tick();
  assert.equal(view.names().includes('showError'), false);
});

test('Sieg beanspruchen: nach Fehler erneut möglich', async () => {
  const view = fakeView();
  let calls = 0;
  const adapter = scriptedAdapter({ claim: async () => { calls += 1; throw new Error('Noch nicht möglich.'); } });
  const ctl = createArenaController({ adapter, view });
  ctl.start();
  ctl.claim();
  await tick();
  assert.equal(view.last('showError')[1], 'Noch nicht möglich.');
  ctl.claim();
  assert.equal(calls, 2);
});
