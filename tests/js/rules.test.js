import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MOVES, VARIANTS, beats, outcome, verb, resultSentence, countersOf, targetWins, isValidMove,
} from '../../public/assets/js/rules.js';

test('klassisch: jeder Zug schlägt genau einen und verliert gegen genau einen', () => {
  for (const m of VARIANTS.classic) {
    const others = VARIANTS.classic.filter((o) => o !== m);
    assert.equal(others.filter((o) => beats(m, o)).length, 1);
    assert.equal(others.filter((o) => beats(o, m)).length, 1);
  }
});

test('Echse & Spock: jeder Zug schlägt genau zwei', () => {
  for (const m of MOVES) {
    const others = MOVES.filter((o) => o !== m);
    assert.equal(others.filter((o) => beats(m, o)).length, 2, m);
    assert.equal(others.filter((o) => beats(o, m)).length, 2, m);
  }
});

test('outcome ist antisymmetrisch', () => {
  for (const a of MOVES) for (const b of MOVES) assert.equal(outcome(a, b), -outcome(b, a) || 0);
});

test('Ergebnissätze', () => {
  assert.equal(resultSentence('spock', 'rock'), 'Spock verdampft Stein');
  assert.equal(resultSentence('rock', 'spock'), 'Spock verdampft Stein');
  assert.equal(resultSentence('rock', 'scissors'), 'Stein schleift Schere');
  assert.equal(resultSentence('paper', 'paper'), 'Unentschieden – beide Papier');
  assert.equal(verb('lizard', 'paper'), 'frisst');
  assert.equal(verb('paper', 'lizard'), null);
});

test('countersOf / targetWins / isValidMove', () => {
  assert.deepEqual(countersOf('rock', 'classic'), ['paper']);
  assert.deepEqual(countersOf('rock', 'lizard').sort(), ['paper', 'spock']);
  assert.equal(targetWins(3), 2);
  assert.equal(targetWins(5), 3);
  assert.ok(isValidMove('lizard', 'spock'));
  assert.ok(!isValidMove('classic', 'spock'));
  assert.ok(!isValidMove('foo', 'rock'));
});
