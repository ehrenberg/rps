import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createAI, AI_LEVELS, HISTORY_KEY, HISTORY_MAX, loadHistory, constantStep,
} from '../../public/assets/js/ai.js';
import { movesFor, outcome, countersOf, MOVE_NAMES } from '../../public/assets/js/rules.js';
import { seededRandom, memoryStorage, throwingStorage } from './helpers.js';

const SEEDS = 100;
const CYCLE = ['rock', 'paper', 'scissors'];

/**
 * Lässt eine KI gegen eine Spielerstrategie spielen.
 * strategy(round, lastAi, lastPlayer, rnd) → Spielerzug.
 * Liefert die KI-Ergebnisse (1/0/-1) je Runde.
 */
function play(ai, strategy, rounds, rnd = seededRandom(4242)) {
  const results = [];
  let lastAi = null;
  let lastPlayer = null;
  for (let i = 0; i < rounds; i++) {
    const a = ai.pick(); // vor der Spielerwahl
    const p = strategy(i, lastAi, lastPlayer, rnd);
    ai.observe(a, p);
    results.push(outcome(a, p));
    lastAi = a;
    lastPlayer = p;
  }
  return results;
}

/** Siegquote der KI in Runden [from, to) über viele Seeds. */
function aiWinRate(level, variant, strategy, { from = 0, to = 60, seeds = SEEDS } = {}) {
  let wins = 0;
  let total = 0;
  for (let s = 1; s <= seeds; s++) {
    const ai = createAI(level, variant, { storage: null, random: seededRandom(s) });
    const r = play(ai, strategy, to, seededRandom(s + 10_000)).slice(from);
    wins += r.filter((x) => x === 1).length;
    total += r.length;
  }
  return wins / total;
}

/** Siegquote des Spielers (Siege / alle Runden) in Runden [from, to). */
function playerWinRate(level, variant, strategy, opts = {}) {
  let wins = 0;
  let total = 0;
  for (let s = 1; s <= SEEDS; s++) {
    const ai = createAI(level, variant, { storage: null, random: seededRandom(s) });
    const r = play(ai, strategy, opts.to ?? 60, seededRandom(s + 10_000)).slice(opts.from ?? 0);
    wins += r.filter((x) => x === -1).length;
    total += r.length;
  }
  return wins / total;
}

const cycle = (i) => CYCLE[i % 3];
const alwaysRock = () => 'rock';
const counterLastAi = (i, lastAi) => (lastAi ? countersOf(lastAi, 'classic')[0] : 'rock');
const randomPlayer = (variant) => (i, a, p, rnd) => {
  const m = movesFor(variant);
  return m[Math.floor(rnd() * m.length)];
};

describe('AI_LEVELS und createAI', () => {
  test('vier Stufen mit Name und Beschreibung', () => {
    assert.deepEqual(AI_LEVELS.map((l) => l.level), [1, 2, 3, 4]);
    assert.deepEqual(AI_LEVELS.map((l) => l.name), ['Zufall', 'Gewohnheitstier', 'Taktiker', 'Gedankenleser']);
    for (const l of AI_LEVELS) assert.ok(l.description.length > 0);
  });

  test('Objekt hat level, name, pick, observe, explain', () => {
    for (const { level, name } of AI_LEVELS) {
      const ai = createAI(level, 'classic', { storage: null });
      assert.equal(ai.level, level);
      assert.equal(ai.name, name);
      assert.ok(CYCLE.includes(ai.pick()));
    }
  });

  test('unbekannte Stufe oder Variante wirft', () => {
    assert.throws(() => createAI(5, 'classic', { storage: null }));
    assert.throws(() => createAI(0, 'classic', { storage: null }));
    assert.throws(() => createAI(1, 'chess', { storage: null }));
  });

  test('ohne Optionen: nutzt globalThis.localStorage, falls vorhanden (hier keiner)', () => {
    const ai = createAI(4, 'classic');
    ai.observe('rock', 'paper');
    assert.ok(CYCLE.includes(ai.pick()));
  });

  test('ohne random: crypto-Zufall liefert gültige Züge', () => {
    for (const level of [1, 2, 3, 4]) {
      const ai = createAI(level, 'lizard', { storage: null });
      for (let i = 0; i < 30; i++) {
        const m = ai.pick();
        assert.ok(movesFor('lizard').includes(m));
        ai.observe(m, 'spock');
      }
    }
  });

  test('ungültige Züge in observe werden ignoriert', () => {
    const storage = memoryStorage();
    const ai = createAI(4, 'classic', { storage });
    ai.observe('lizard', 'rock'); // Echse gibt es klassisch nicht
    ai.observe('rock', undefined);
    ai.observe('__proto__', 'rock');
    ai.observe('rock', 'toString');
    ai.observe(1, 'rock');
    assert.equal(storage.getItem(HISTORY_KEY), null);
    assert.ok(CYCLE.includes(ai.pick()));
  });

  test('explain: Stufe 1–3 liefern null', () => {
    for (const level of [1, 2, 3]) {
      const ai = createAI(level, 'classic', { storage: null });
      ai.observe('rock', 'paper');
      assert.equal(ai.explain(), null);
    }
  });
});

describe('Stufe 1: Zufall', () => {
  test('gleichverteilt, auch Echse/Spock', () => {
    for (const variant of ['classic', 'lizard']) {
      const ai = createAI(1, variant, { storage: null, random: seededRandom(7) });
      const counts = {};
      const N = 5000;
      for (let i = 0; i < N; i++) {
        const m = ai.pick();
        counts[m] = (counts[m] || 0) + 1;
      }
      const k = movesFor(variant).length;
      for (const m of movesFor(variant)) assert.ok(Math.abs(counts[m] / N - 1 / k) < 0.03, `${variant} ${m}`);
    }
  });
});

describe('Stufe 2: Gewohnheitstier', () => {
  // Wer die Gewohnheit kennt, kontert: nach KI-Sieg/Unentschieden den letzten KI-Zug,
  // nach KI-Niederlage den Konter des eigenen letzten Zugs.
  const exploit = (i, lastAi, lastPlayer) => {
    if (!lastAi) return 'rock';
    const aiWon = outcome(lastAi, lastPlayer) >= 0;
    const expected = aiWon ? lastAi : countersOf(lastPlayer, 'classic')[0];
    return countersOf(expected, 'classic')[0];
  };

  test('ist schlagbar: Spieler gewinnt mit passender Strategie > 55 % der Runden', () => {
    const rate = playerWinRate(2, 'classic', exploit);
    assert.ok(rate > 0.55, `Spieler-Siegquote ${rate}`);
  });

  test('Gewinner bleibt: nach KI-Sieg wird der Zug oft wiederholt', () => {
    let stays = 0;
    const N = 2000;
    const rnd = seededRandom(3);
    for (let i = 0; i < N; i++) {
      const ai = createAI(2, 'classic', { storage: null, random: rnd });
      ai.observe('paper', 'rock'); // KI gewinnt
      if (ai.pick() === 'paper') stays++;
    }
    // 60 % Gewohnheit + 40 % × 1/3 Zufall ≈ 73 %
    assert.ok(Math.abs(stays / N - 0.733) < 0.04, `${stays / N}`);
  });

  test('Verlierer wechselt zum Konter des Spielerzugs', () => {
    let counters = 0;
    const N = 2000;
    const rnd = seededRandom(5);
    for (let i = 0; i < N; i++) {
      const ai = createAI(2, 'classic', { storage: null, random: rnd });
      ai.observe('scissors', 'rock'); // KI verliert gegen Stein → Papier
      if (ai.pick() === 'paper') counters++;
    }
    assert.ok(Math.abs(counters / N - 0.733) < 0.04, `${counters / N}`);
  });

  test('erster Zug ohne Historie ist zufällig gültig (Echse/Spock)', () => {
    const ai = createAI(2, 'lizard', { storage: null, random: seededRandom(1) });
    ai.observe('lizard', 'spock');
    assert.ok(movesFor('lizard').includes(ai.pick()));
  });
});

describe('Stufe 3: Taktiker', () => {
  test('constantStep erkennt gleiche Abstände', () => {
    assert.equal(constantStep([0, 0, 0], 3), 0);
    assert.equal(constantStep([0, 1, 2], 3), 1);
    assert.equal(constantStep([2, 1, 0], 3), 2);
    assert.equal(constantStep([4, 0, 1], 5), 1);
    assert.equal(constantStep([0, 1, 1], 3), null);
    assert.equal(constantStep([0, 1], 3), null);
    assert.equal(constantStep([], 3), null);
  });

  test('schlägt „immer Stein“ und den Kreis', () => {
    assert.ok(aiWinRate(3, 'classic', alwaysRock, { from: 5 }) > 0.8);
    assert.ok(aiWinRate(3, 'classic', cycle, { from: 5 }) > 0.8);
  });

  test('kontert den häufigsten Zug der letzten 10 Runden', () => {
    const ai = createAI(3, 'classic', { storage: null, random: seededRandom(9) });
    // kein konstanter Abstand am Ende, aber Papier am häufigsten
    for (const p of ['paper', 'paper', 'rock', 'paper', 'scissors', 'paper', 'rock', 'rock']) ai.observe('rock', p);
    let scissors = 0;
    for (let i = 0; i < 200; i++) if (ai.pick() === 'scissors') scissors++;
    assert.ok(scissors / 200 > 0.85, `${scissors}`);
  });

  test('gegen Zufall ≈ 1/3', () => {
    const rate = aiWinRate(3, 'classic', randomPlayer('classic'));
    assert.ok(Math.abs(rate - 1 / 3) < 0.04, `${rate}`);
  });
});

describe('Stufe 4: Gedankenleser', () => {
  test('ABNAHME: Kreis Stein→Papier→Schere – Runden 15–60 Siegquote > 80 % (100 Seeds)', () => {
    const rate = aiWinRate(4, 'classic', cycle, { from: 15, to: 60 });
    assert.ok(rate > 0.8, `KI-Siegquote ${rate}`);
  });

  test('ABNAHME: in fast jedem Seed gewinnt die KI ab Runde 15 klar (> 70 % pro Seed in ≥ 95 %)', () => {
    let good = 0;
    for (let s = 1; s <= SEEDS; s++) {
      const ai = createAI(4, 'classic', { storage: null, random: seededRandom(s) });
      const r = play(ai, cycle, 60).slice(15);
      if (r.filter((x) => x === 1).length / r.length > 0.7) good++;
    }
    assert.ok(good >= 95, `${good} von ${SEEDS}`);
  });

  test('gegen „immer Stein“ > 85 % ab Runde 10', () => {
    assert.ok(aiWinRate(4, 'classic', alwaysRock, { from: 10 }) > 0.85);
  });

  test('gegen Konter-Strategie (Spieler kontert letzten KI-Zug) > 80 % ab Runde 15', () => {
    const rate = aiWinRate(4, 'classic', counterLastAi, { from: 15 });
    assert.ok(rate > 0.8, `${rate}`);
  });

  test('gegen Zufall ≈ 1/3 Siege und ≈ 1/3 Niederlagen (kein Bias, kein Absturz)', () => {
    for (const variant of ['classic', 'lizard']) {
      const win = aiWinRate(4, variant, randomPlayer(variant), { to: 200, seeds: 30 });
      const loss = playerWinRate(4, variant, randomPlayer(variant), { to: 200 });
      const expected = variant === 'classic' ? 1 / 3 : 2 / 5;
      assert.ok(Math.abs(win - expected) < 0.04, `${variant} Sieg ${win}`);
      assert.ok(Math.abs(loss - expected) < 0.04, `${variant} Niederlage ${loss}`);
    }
  });

  test('Echse/Spock: Kreis über 5 Züge > 80 % ab Runde 20', () => {
    const five = (i) => movesFor('lizard')[i % 5];
    assert.ok(aiWinRate(4, 'lizard', five, { from: 20 }) > 0.8);
  });

  test('Echse/Spock: Konter-Strategie wird erkannt', () => {
    const counter5 = (i, lastAi) => (lastAi ? countersOf(lastAi, 'lizard')[1] : 'spock');
    assert.ok(aiWinRate(4, 'lizard', counter5, { from: 20 }) > 0.8);
  });

  test('Win-Stay/Lose-Shift-Spieler wird geschlagen', () => {
    // Spieler bleibt nach Sieg, wechselt nach Niederlage/Unentschieden zum Konter des KI-Zugs
    const wsls = (i, lastAi, lastPlayer) => {
      if (!lastAi) return 'rock';
      return outcome(lastPlayer, lastAi) === 1 ? lastPlayer : countersOf(lastAi, 'classic')[0];
    };
    assert.ok(aiWinRate(4, 'classic', wsls, { from: 15 }) > 0.75);
  });

  test('passt sich an Strategiewechsel an', () => {
    const switcher = (i) => (i < 40 ? 'rock' : 'paper');
    const rate = aiWinRate(4, 'classic', switcher, { from: 50, to: 80 });
    assert.ok(rate > 0.8, `${rate}`);
  });

  test('pick ist deterministisch bei gleichem Seed und gleicher Vergangenheit', () => {
    const mk = () => createAI(4, 'classic', { storage: null, random: seededRandom(11) });
    const a = mk();
    const b = mk();
    for (let i = 0; i < 20; i++) {
      const ma = a.pick();
      const mb = b.pick();
      assert.equal(ma, mb);
      a.observe(ma, cycle(i));
      b.observe(mb, cycle(i));
    }
  });

  describe('explain', () => {
    const explainAfter = (moves, variant = 'classic') => {
      const ai = createAI(4, variant, { storage: null, random: seededRandom(1) });
      for (const [a, p] of moves) ai.observe(a, p);
      return ai.explain();
    };

    test('ohne Daten: beobachtet noch', () => {
      assert.equal(explainAfter([]), 'Ich beobachte dich noch …');
    });

    test('immer Stein → nennt Stein', () => {
      const text = explainAfter(Array.from({ length: 12 }, (_, i) => [CYCLE[i % 3], 'rock']));
      assert.match(text, /Stein/);
    });

    test('Konter-Spieler → Konter-Erklärung', () => {
      const ai = createAI(4, 'classic', { storage: null, random: seededRandom(2) });
      play(ai, counterLastAi, 30);
      assert.match(ai.explain(), /kontern|Konter/);
    });

    test('liefert immer einen deutschen Satz bei vielen Mustern', () => {
      const strategies = [cycle, alwaysRock, counterLastAi, randomPlayer('classic')];
      for (const s of strategies) {
        for (let seed = 1; seed <= 10; seed++) {
          const ai = createAI(4, 'classic', { storage: null, random: seededRandom(seed) });
          for (let i = 0; i < 25; i++) {
            play(ai, s, 1, seededRandom(seed * 100 + i));
            const text = ai.explain();
            assert.equal(typeof text, 'string');
            assert.ok(/[.…]$/.test(text), text);
            assert.ok(!/undefined|null|NaN/.test(text), text);
          }
        }
      }
    });

    test('nennt nur Zugnamen der Variante', () => {
      const ai = createAI(4, 'lizard', { storage: null, random: seededRandom(3) });
      play(ai, () => 'spock', 15);
      const text = ai.explain();
      assert.match(text, new RegExp(MOVE_NAMES.spock));
    });
  });
});

describe('Historie (rps.ai.history.v1)', () => {
  test('wird je Variante gespeichert und auf HISTORY_MAX begrenzt', () => {
    const storage = memoryStorage();
    const ai = createAI(4, 'classic', { storage, random: seededRandom(1) });
    play(ai, cycle, HISTORY_MAX + 50);
    const data = JSON.parse(storage.getItem(HISTORY_KEY));
    assert.equal(data.classic.length, HISTORY_MAX);
    assert.deepEqual(data.classic.at(-1)[0], cycle(HISTORY_MAX + 49));
    const liz = createAI(4, 'lizard', { storage, random: seededRandom(1) });
    liz.observe('spock', 'lizard');
    const both = JSON.parse(storage.getItem(HISTORY_KEY));
    assert.equal(both.classic.length, HISTORY_MAX);
    assert.deepEqual(both.lizard, [['lizard', 'spock']]);
  });

  test('Stufen 1–3 schreiben keine Historie', () => {
    const storage = memoryStorage();
    for (const level of [1, 2, 3]) createAI(level, 'classic', { storage }).observe('rock', 'paper');
    assert.equal(storage.getItem(HISTORY_KEY), null);
  });

  test('Vorwärmen: neue KI kennt das Muster sofort', () => {
    const storage = memoryStorage();
    play(createAI(4, 'classic', { storage, random: seededRandom(1) }), alwaysRock, 40);
    const warm = createAI(4, 'classic', { storage, random: seededRandom(2) });
    const r = play(warm, alwaysRock, 10);
    assert.ok(r.filter((x) => x === 1).length >= 8, `${r}`);
    assert.match(warm.explain(), /Stein/);
  });

  test('loadHistory filtert ungültige Einträge und fremde Varianten', () => {
    const storage = memoryStorage({
      [HISTORY_KEY]: JSON.stringify({
        classic: [['rock', 'paper'], ['lizard', 'rock'], 'kaputt', null, ['paper'], ['scissors', 'rock', 'x']],
      }),
    });
    assert.deepEqual(loadHistory(storage, 'classic'), [['rock', 'paper'], ['scissors', 'rock']]);
    assert.deepEqual(loadHistory(storage, 'lizard'), []);
  });

  test('loadHistory begrenzt zu lange Listen', () => {
    const list = Array.from({ length: HISTORY_MAX + 100 }, () => ['rock', 'rock']);
    const storage = memoryStorage({ [HISTORY_KEY]: JSON.stringify({ classic: list }) });
    assert.equal(loadHistory(storage, 'classic').length, HISTORY_MAX);
  });

  for (const [label, raw] of [
    ['kein JSON', '{kaputt'],
    ['Array statt Objekt', '[1,2,3]'],
    ['null', 'null'],
    ['Zahl', '42'],
    ['Variante kein Array', '{"classic":"rock"}'],
  ]) {
    test(`kaputte Daten (${label}) → leere Historie, KI läuft, Speicher wird repariert`, () => {
      const storage = memoryStorage({ [HISTORY_KEY]: raw });
      assert.deepEqual(loadHistory(storage, 'classic'), []);
      const ai = createAI(4, 'classic', { storage, random: seededRandom(1) });
      play(ai, cycle, 5);
      assert.equal(JSON.parse(storage.getItem(HISTORY_KEY)).classic.length, 5);
    });
  }

  test('storage null oder werfend → KI läuft ohne Persistenz', () => {
    assert.deepEqual(loadHistory(null, 'classic'), []);
    assert.deepEqual(loadHistory(throwingStorage, 'classic'), []);
    for (const storage of [null, throwingStorage]) {
      const ai = createAI(4, 'classic', { storage, random: seededRandom(1) });
      const r = play(ai, alwaysRock, 30).slice(10);
      assert.ok(r.filter((x) => x === 1).length > 15);
    }
  });

  test('fremde Schlüssel im Historien-Objekt bleiben erhalten', () => {
    const storage = memoryStorage({ [HISTORY_KEY]: JSON.stringify({ lizard: [['spock', 'rock']] }) });
    createAI(4, 'classic', { storage, random: seededRandom(1) }).observe('rock', 'paper');
    const data = JSON.parse(storage.getItem(HISTORY_KEY));
    assert.deepEqual(data.lizard, [['spock', 'rock']]);
    assert.deepEqual(data.classic, [['paper', 'rock']]);
  });
});
