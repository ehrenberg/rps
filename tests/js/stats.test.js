import { test, describe, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  STATS_KEY, MATCH_MODES, TOURNAMENT_MODE, NOT_ENOUGH_DATA, MIN_MOVES_FOR_PREDICTABILITY,
  setStorage, emptyStats, normalizeStats, loadStats, recordRound, recordMatch, recordTournament,
  resetStats, summary, normalizedEntropy, predictabilityText,
} from '../../public/assets/js/stats.js';
import { MOVES } from '../../public/assets/js/rules.js';
import { memoryStorage, throwingStorage } from './helpers.js';

let storage;
beforeEach(() => {
  storage = memoryStorage();
  setStorage(storage);
});
after(() => setStorage());

const stored = () => JSON.parse(storage.getItem(STATS_KEY));
const repeat = (n, fn) => {
  for (let i = 0; i < n; i++) fn(i);
};

describe('Struktur', () => {
  test('emptyStats enthält alle Modi, Züge und heutiges Datum', () => {
    const s = emptyStats();
    for (const m of MATCH_MODES) assert.deepEqual(s.games[m], { w: 0, l: 0, d: 0 });
    assert.deepEqual(s.games[TOURNAMENT_MODE], { played: 0, won: 0, w: 0, l: 0 });
    assert.deepEqual(s.rounds, { w: 0, l: 0, d: 0 });
    assert.deepEqual(Object.keys(s.moves), [...MOVES]);
    assert.deepEqual(s.streak, { current: 0, best: 0 });
    assert.equal(s.since, new Date().toISOString().slice(0, 10));
  });

  test('loadStats ohne Daten → leere Statistik', () => {
    assert.deepEqual(loadStats(), emptyStats());
  });
});

describe('normalizeStats (kaputte/alte Daten)', () => {
  for (const [label, raw] of [
    ['null', null], ['Zahl', 5], ['String', 'x'], ['Array', [1, 2]], ['leeres Objekt', {}],
  ]) {
    test(`${label} → Defaults`, () => assert.deepEqual(normalizeStats(raw), emptyStats()));
  }

  test('übernimmt gültige Zähler, verwirft Müll, ergänzt Fehlendes', () => {
    const s = normalizeStats({
      games: { 'cpu-4': { w: 3, l: '2', d: -1 }, duel: 'kaputt', fremd: { w: 9 } },
      rounds: { w: 4.7, l: NaN, d: Infinity },
      moves: { rock: 5, banana: 3 },
      streak: { current: 4, best: 2 },
      since: '2026-01-02',
      extra: true,
    });
    assert.deepEqual(s.games['cpu-4'], { w: 3, l: 0, d: 0 });
    assert.deepEqual(s.games.duel, { w: 0, l: 0, d: 0 });
    assert.equal(s.games.fremd, undefined);
    assert.deepEqual(s.rounds, { w: 4, l: 0, d: 0 });
    assert.equal(s.moves.rock, 5);
    assert.equal(s.moves.banana, undefined);
    assert.deepEqual(s.streak, { current: 4, best: 4 }); // best ≥ current
    assert.equal(s.since, '2026-01-02');
    assert.equal(s.extra, undefined);
  });

  test('ungültiges since → heute', () => {
    assert.equal(normalizeStats({ since: 'gestern' }).since, emptyStats().since);
    assert.equal(normalizeStats({ since: 20260101 }).since, emptyStats().since);
  });

  test('loadStats mit kaputtem JSON im Speicher', () => {
    storage.setItem(STATS_KEY, '{kaputt');
    assert.deepEqual(loadStats(), emptyStats());
    recordRound({ result: 'w', move: 'rock' }); // repariert den Speicher
    assert.equal(stored().rounds.w, 1);
  });
});

describe('recordRound', () => {
  test('zählt Ergebnis und Zug und speichert', () => {
    recordRound({ result: 'w', move: 'rock' });
    recordRound({ result: 'l', move: 'spock' });
    const s = recordRound({ result: 'd', move: 'rock' });
    assert.deepEqual(s.rounds, { w: 1, l: 1, d: 1 });
    assert.equal(s.moves.rock, 2);
    assert.equal(s.moves.spock, 1);
    assert.deepEqual(stored(), s);
  });

  test('ungültige Werte werden ignoriert', () => {
    recordRound({ result: 'x', move: 'banana' });
    recordRound({ result: '__proto__', move: 'toString' });
    recordRound();
    assert.deepEqual(loadStats().rounds, { w: 0, l: 0, d: 0 });
    assert.equal(Object.values(loadStats().moves).reduce((a, b) => a + b), 0);
  });

  test('Ergebnis ohne Zug und Zug ohne Ergebnis', () => {
    recordRound({ result: 'w' });
    recordRound({ move: 'paper' });
    const s = loadStats();
    assert.equal(s.rounds.w, 1);
    assert.equal(s.moves.paper, 1);
  });
});

describe('recordMatch und Siegesserie', () => {
  test('zählt je Modus', () => {
    for (const mode of [...MATCH_MODES, TOURNAMENT_MODE]) recordMatch({ mode, result: 'w' });
    const s = loadStats();
    for (const mode of [...MATCH_MODES, TOURNAMENT_MODE]) assert.equal(s.games[mode].w, 1, mode);
  });

  test('Serie zählt Matchsiege in Folge über alle Modi, Niederlage setzt zurück', () => {
    recordMatch({ mode: 'cpu-1', result: 'w' });
    recordMatch({ mode: 'duel', result: 'w' });
    recordMatch({ mode: 'tournament', result: 'w' });
    assert.deepEqual(loadStats().streak, { current: 3, best: 3 });
    recordMatch({ mode: 'cpu-4', result: 'l' });
    assert.deepEqual(loadStats().streak, { current: 0, best: 3 });
    recordMatch({ mode: 'cpu-2', result: 'w' });
    assert.deepEqual(loadStats().streak, { current: 1, best: 3 });
  });

  test('unbekannter Modus oder Ergebnis ändert nichts', () => {
    recordMatch({ mode: 'cpu-9', result: 'w' });
    recordMatch({ mode: 'duel', result: 'd' });
    recordMatch({ mode: '__proto__', result: 'w' });
    recordMatch();
    assert.deepEqual(loadStats(), emptyStats());
    assert.equal(storage.getItem(STATS_KEY), null);
  });
});

describe('recordTournament', () => {
  test('zählt gespielt und gewonnen', () => {
    recordTournament({ won: true });
    recordTournament({ won: false });
    recordTournament({ won: 'ja' }); // nur echtes true zählt als Sieg
    recordTournament();
    assert.deepEqual(loadStats().games.tournament, { played: 4, won: 1, w: 0, l: 0 });
  });
});

describe('resetStats', () => {
  test('setzt alles zurück und speichert', () => {
    recordRound({ result: 'w', move: 'rock' });
    recordMatch({ mode: 'duel', result: 'w' });
    const fresh = resetStats();
    assert.deepEqual(fresh, emptyStats());
    assert.deepEqual(loadStats(), emptyStats());
    assert.deepEqual(stored(), emptyStats());
  });
});

describe('Storage-Fehler', () => {
  test('werfender Storage: alles läuft, nichts wird gespeichert', () => {
    setStorage(throwingStorage);
    assert.deepEqual(loadStats(), emptyStats());
    assert.equal(recordRound({ result: 'w', move: 'rock' }).rounds.w, 1);
    assert.equal(recordMatch({ mode: 'duel', result: 'w' }).streak.current, 1);
    assert.equal(recordTournament({ won: true }).games.tournament.won, 1);
    assert.deepEqual(resetStats(), emptyStats());
  });

  test('Storage null', () => {
    setStorage(null);
    assert.deepEqual(loadStats(), emptyStats());
    assert.equal(recordRound({ result: 'l' }).rounds.l, 1);
  });

  test('setStorage() ohne Argument nutzt globalThis.localStorage (in Node ggf. nicht vorhanden)', () => {
    setStorage();
    assert.doesNotThrow(() => loadStats());
  });
});

describe('Entropie und Vorhersehbarkeit', () => {
  test('normalizedEntropy', () => {
    assert.equal(normalizedEntropy([]), 0);
    assert.equal(normalizedEntropy([0, 0, 0]), 0);
    assert.equal(normalizedEntropy([5, 0, 0]), 0);
    assert.equal(normalizedEntropy([4, 4, 4]), 1);
    assert.equal(normalizedEntropy([7]), 0);
    assert.ok(Math.abs(normalizedEntropy([1, 1, 0], 3) - Math.log2(2) / Math.log2(3)) < 1e-12);
    assert.equal(normalizedEntropy([2, 2, 2, 0, 0], 3), 1); // Nullen außerhalb der Variante egal
    assert.ok(normalizedEntropy([2, 2, 2, 0, 0], 5) < 1);
  });

  test('predictabilityText: Stufen und zu wenig Daten', () => {
    const n = MIN_MOVES_FOR_PREDICTABILITY;
    assert.equal(predictabilityText(1, n - 1), NOT_ENOUGH_DATA);
    assert.equal(predictabilityText(1, n), 'Unberechenbar');
    assert.equal(predictabilityText(0.9, n), 'Schwer zu durchschauen');
    assert.equal(predictabilityText(0.75, n), 'Etwas vorhersehbar');
    assert.equal(predictabilityText(0.6, n), 'Ziemlich vorhersehbar');
    assert.equal(predictabilityText(0, n), 'Sehr vorhersehbar');
  });
});

describe('summary', () => {
  test('leere Statistik', () => {
    assert.deepEqual(summary(emptyStats()), {
      favoriteMove: null, totalGames: 0, winRate: 0, entropy: 0, predictability: NOT_ENOUGH_DATA,
      totalRounds: 0, roundWinRate: 0, bestStreak: 0, currentStreak: 0,
    });
  });

  test('ohne Argument: liest gespeicherte Statistik', () => {
    recordMatch({ mode: 'duel', result: 'w' });
    assert.equal(summary().totalGames, 1);
  });

  test('Kennzahlen aus aufgezeichneten Daten', () => {
    repeat(10, () => recordRound({ result: 'w', move: 'rock' }));
    repeat(2, () => recordRound({ result: 'l', move: 'paper' }));
    recordMatch({ mode: 'cpu-4', result: 'w' });
    recordMatch({ mode: 'duel', result: 'l' });
    recordMatch({ mode: 'tournament', result: 'w' });
    recordMatch({ mode: 'cpu-1', result: 'w' });
    const s = summary(loadStats());
    assert.equal(s.favoriteMove, 'rock');
    assert.equal(s.totalGames, 4);
    assert.equal(s.winRate, 0.75);
    assert.equal(s.totalRounds, 12);
    assert.ok(Math.abs(s.roundWinRate - 10 / 12) < 1e-12);
    assert.equal(s.bestStreak, 2);
    assert.equal(s.currentStreak, 2);
    assert.ok(s.entropy > 0 && s.entropy < 0.5);
    assert.equal(s.predictability, 'Sehr vorhersehbar');
  });

  test('gleichmäßig klassisch → unberechenbar; mit Echse/Spock auf 5 normalisiert', () => {
    for (const m of ['rock', 'paper', 'scissors']) repeat(5, () => recordRound({ result: 'd', move: m }));
    assert.equal(summary(loadStats()).entropy, 1);
    assert.equal(summary(loadStats()).predictability, 'Unberechenbar');
    recordRound({ result: 'd', move: 'spock' });
    assert.ok(summary(loadStats()).entropy < 0.85);
  });

  test('Unentschieden-Matches zählen zu den Spielen', () => {
    const s = emptyStats();
    s.games['cpu-2'].d = 2;
    s.games['cpu-2'].w = 2;
    assert.equal(summary(s).totalGames, 4);
    assert.equal(summary(s).winRate, 0.5);
  });

  test('kaputte Eingabe → wie leer', () => {
    assert.equal(summary(null).totalGames, 0);
    assert.equal(summary({ moves: 'x' }).favoriteMove, null);
  });
});
