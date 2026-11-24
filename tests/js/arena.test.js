import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCpuOpponent } from '../../public/assets/js/cpu-opponent.js';
import { createArenaController, moveForKey, PHASE } from '../../public/assets/js/arena.js';
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
    'setScore', 'addHistory', 'setFairness', 'setInsight', 'showReaction', 'showMatchOver', 'hideMatchOver', 'showError']) {
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
  assert.deepEqual(view.last('showMatchOver')[1], { won: true, score: [2, 0], reason: 'score', oppName: undefined, series: null });
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
