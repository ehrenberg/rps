import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, playRound, isOver, nextRoundNumber, ME, OPP } from '../../public/assets/js/match.js';

test('createMatch: Ziel aus Best of, Startzustand', () => {
  const m = createMatch({ variant: 'classic', bestOf: 3 });
  assert.equal(m.target, 2);
  assert.deepEqual([...m.score], [0, 0]);
  assert.equal(isOver(m), false);
  assert.equal(nextRoundNumber(m), 1);
  assert.equal(createMatch({ variant: 'lizard', bestOf: 5 }).target, 3);
});

test('createMatch: ungültige Parameter werfen', () => {
  assert.throws(() => createMatch({ variant: 'x', bestOf: 3 }));
  assert.throws(() => createMatch({ variant: 'classic', bestOf: 4 }));
});

test('playRound: Sieg, Niederlage, Unentschieden', () => {
  let m = createMatch({ variant: 'classic', bestOf: 3 });
  let r;
  ({ match: m, round: r } = playRound(m, 'rock', 'scissors'));
  assert.equal(r.outcome, 1);
  assert.equal(r.result, 'w');
  assert.equal(r.sentence, 'Stein schleift Schere');
  assert.deepEqual([...m.score], [1, 0]);
  ({ match: m, round: r } = playRound(m, 'rock', 'rock'));
  assert.equal(r.result, 'd');
  assert.deepEqual([...m.score], [1, 0], 'Unentschieden zählt nicht');
  ({ match: m, round: r } = playRound(m, 'rock', 'paper'));
  assert.equal(r.result, 'l');
  assert.equal(r.number, 3);
  assert.deepEqual([...m.score], [1, 1]);
  assert.equal(isOver(m), false);
});

test('playRound: Matchende bei Ziel erreicht, danach keine Runden mehr', () => {
  let m = createMatch({ variant: 'classic', bestOf: 3 });
  m = playRound(m, 'paper', 'scissors').match;
  m = playRound(m, 'paper', 'scissors').match;
  assert.equal(m.winner, OPP);
  assert.throws(() => playRound(m, 'rock', 'rock'));
});

test('playRound: Best of 5 braucht drei Siege', () => {
  let m = createMatch({ variant: 'lizard', bestOf: 5 });
  m = playRound(m, 'spock', 'rock').match;
  m = playRound(m, 'lizard', 'spock').match;
  assert.equal(isOver(m), false);
  m = playRound(m, 'rock', 'lizard').match;
  assert.equal(m.winner, ME);
  assert.equal(m.rounds.length, 3);
});

test('playRound: Zug muss zur Variante passen', () => {
  const m = createMatch({ variant: 'classic', bestOf: 3 });
  assert.throws(() => playRound(m, 'spock', 'rock'));
});

test('Zustand ist unveränderlich', () => {
  const m = createMatch({ variant: 'classic', bestOf: 3 });
  const { match: next } = playRound(m, 'rock', 'scissors');
  assert.deepEqual([...m.score], [0, 0]);
  assert.ok(Object.isFrozen(next) && Object.isFrozen(next.score));
});
