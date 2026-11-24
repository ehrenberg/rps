// Computer-Gegner in vier Stufen. Vertrag: docs/SCHNITTSTELLEN.md
//
// Fairness: pick() wird VOR der Spielerwahl aufgerufen und kennt nur vergangene Runden.
// observe(aiMove, playerMove) wird nach jeder Runde aufgerufen (auch bei Unentschieden).

import { movesFor, outcome, countersOf, MOVE_NAMES } from './rules.js';
import { randomInt } from './crypto.js';

export const AI_LEVELS = [
  { level: 1, name: 'Zufall', description: 'Spielt völlig zufällig.' },
  { level: 2, name: 'Gewohnheitstier', description: 'Leicht vorhersehbar – gut zum Üben.' },
  { level: 3, name: 'Taktiker', description: 'Kontert deinen Lieblingszug und einfache Muster.' },
  { level: 4, name: 'Gedankenleser', description: 'Lernt deine Muster – auch über Spiele hinweg.' },
];

export const HISTORY_KEY = 'rps.ai.history.v1';
export const HISTORY_MAX = 300;

const SCORE_DECAY = 0.9; // Verfall der Prädiktor-Punkte
const COUNT_DECAY = 0.97; // Verfall der Zählungen (passt sich an Strategiewechsel an)
const EXPLORE = 0.1; // Anteil reiner Zufallszüge (Stufe 3 und 4)
const HABIT = 0.6; // Anteil „Gewohnheit“ bei Stufe 2
const RECENT_WINDOW = 10; // „letzte 10 Runden“ (Stufe 3, Prädiktor freq10)
const PATTERN_LENGTH = 3; // so viele Züge mit gleichem Abstand = Muster (Stufe 3)
const MIN_EVIDENCE = 0.5; // Mindest-Zählmasse, bevor ein Tabellen-Prädiktor etwas vorhersagt

const defaultRandom = () => randomInt(0x100000000) / 0x100000000;

// --- Historie in storage --------------------------------------------------

/** Liest die gespeicherte Historie einer Variante als [[playerMove, aiMove], …]. */
export function loadHistory(storage, variant) {
  if (!storage) return [];
  try {
    const raw = storage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    const list = data && typeof data === 'object' ? data[variant] : null;
    if (!Array.isArray(list)) return [];
    const moves = movesFor(variant);
    return list
      .filter((e) => Array.isArray(e) && moves.includes(e[0]) && moves.includes(e[1]))
      .map((e) => [e[0], e[1]])
      .slice(-HISTORY_MAX);
  } catch {
    return [];
  }
}

function saveHistory(storage, variant, list) {
  if (!storage) return;
  try {
    let data = {};
    try {
      const parsed = JSON.parse(storage.getItem(HISTORY_KEY) || '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed;
    } catch {
      /* kaputte Daten werden überschrieben */
    }
    data[variant] = list.slice(-HISTORY_MAX);
    storage.setItem(HISTORY_KEY, JSON.stringify(data));
  } catch {
    /* Speicher voll oder gesperrt – KI funktioniert trotzdem */
  }
}

// --- Hilfsfunktionen ---------------------------------------------------------

function makeHelpers(variant, random) {
  const moves = movesFor(variant);
  const n = moves.length;
  const idx = Object.freeze(Object.assign(Object.create(null), Object.fromEntries(moves.map((m, i) => [m, i]))));
  const isMove = (m) => typeof m === 'string' && Object.hasOwn(idx, m);
  // pay[a][b] = Ergebnis von Zug a gegen Zug b (1/0/-1)
  const pay = moves.map((a) => moves.map((b) => outcome(a, b)));
  const rnd = (k) => Math.min(k - 1, Math.floor(random() * k));
  const randomMove = () => rnd(n);
  /** Zufälliger Konter (Index) gegen Zug-Index p. */
  const counter = (p) => {
    const c = countersOf(moves[p], variant);
    return idx[c[rnd(c.length)]];
  };
  /** Beste Antwort (deterministisch, erster bester) auf eine Verteilung über Spielerzüge. */
  const bestResponse = (dist) => {
    let best = 0;
    let bestVal = -Infinity;
    for (let a = 0; a < n; a++) {
      let v = 0;
      for (let b = 0; b < n; b++) v += pay[a][b] * dist[b];
      if (v > bestVal + 1e-12) {
        bestVal = v;
        best = a;
      }
    }
    return best;
  };
  /** Gleichverteilung über die Konter von Zug-Index m. */
  const counterDist = (m) => {
    const d = new Array(n).fill(0);
    for (let b = 0; b < n; b++) if (pay[b][m] === 1) d[b] = 1;
    return d;
  };
  return { moves, n, idx, isMove, pay, rnd, randomMove, counter, bestResponse, counterDist };
}

// --- Stufe 1: Zufall -------------------------------------------------------

function randomBrain(h) {
  return { pick: () => h.randomMove(), observe() {}, explain: () => null };
}

// --- Stufe 2: Gewohnheitstier -----------------------------------------------
// Mit 60 %: Hat die KI gewonnen (oder Unentschieden), bleibt sie beim Zug;
// hat sie verloren, wechselt sie zum Konter des Spielerzugs. Sonst Zufall.

function habitBrain(h, random) {
  let last = null; // { a, p }
  return {
    pick() {
      if (!last || random() >= HABIT) return h.randomMove();
      const r = h.pay[last.a][last.p];
      return r >= 0 ? last.a : h.counter(last.p);
    },
    observe(a, p) {
      last = { a, p };
    },
    explain: () => null,
  };
}

// --- Stufe 3: Taktiker ------------------------------------------------------
// Erkennt „immer gleich“ und Kreis-Rotation (konstanter Abstand), sonst kontert
// sie den häufigsten Zug der letzten 10 Runden.

/**
 * Gleicher Abstand zwischen allen aufeinanderfolgenden Zügen (0 = immer gleich,
 * sonst Kreis-Rotation)? Liefert den Abstand oder null. Braucht PATTERN_LENGTH Züge.
 */
export function constantStep(seq, n) {
  if (seq.length < PATTERN_LENGTH) return null;
  const step = (seq[1] - seq[0] + n) % n;
  for (let i = 2; i < seq.length; i++) if ((seq[i] - seq[i - 1] + n) % n !== step) return null;
  return step;
}

function tacticianBrain(h, random) {
  const hist = []; // Spielerzüge (Index)
  const predict = () => {
    const k = hist.length;
    if (k === 0) return null;
    const pattern = constantStep(hist.slice(-PATTERN_LENGTH), h.n);
    if (pattern !== null) return (hist[k - 1] + pattern) % h.n;
    const counts = new Array(h.n).fill(0);
    for (const p of hist.slice(-RECENT_WINDOW)) counts[p]++;
    const max = Math.max(...counts);
    const top = counts.map((c, i) => (c === max ? i : -1)).filter((i) => i >= 0);
    return top[h.rnd(top.length)];
  };
  return {
    pick() {
      const p = predict();
      if (p === null || random() < EXPLORE) return h.randomMove();
      return h.counter(p);
    },
    observe(a, p) {
      hist.push(p);
      if (hist.length > RECENT_WINDOW) hist.shift();
    },
    explain: () => null,
  };
}

// --- Stufe 4: Gedankenleser -------------------------------------------------

/** Tabelle Kontext → abklingende Zählung über n Werte. */
function countTable(n) {
  const map = new Map();
  return {
    get: (ctx) => map.get(ctx) || null,
    add(ctx, v) {
      let row = map.get(ctx);
      if (!row) map.set(ctx, (row = new Array(n).fill(0)));
      for (let i = 0; i < n; i++) row[i] *= COUNT_DECAY;
      row[v] += 1;
    },
  };
}

const sum = (arr) => arr.reduce((s, x) => s + x, 0);

/**
 * Prädiktoren: predict(hist) → Verteilung über den nächsten Spielerzug (Array) oder null.
 * hist = [{ p, a, r }] mit r = Ergebnis aus Spielersicht (1/0/-1).
 */
function makePredictors(n) {
  const resKey = (r) => (r > 0 ? 'w' : r < 0 ? 'l' : 'd');
  const rotate = (row, base) => {
    const d = new Array(n).fill(0);
    for (let k = 0; k < n; k++) d[(base + k) % n] = row[k];
    return d;
  };
  const tableModel = (key, ctxOf, valueOf, toDist = (row) => row) => {
    const t = countTable(n);
    return {
      key,
      predict(hist) {
        const ctx = ctxOf(hist, hist.length);
        if (ctx === null) return null;
        const row = t.get(ctx);
        if (!row || sum(row) < MIN_EVIDENCE) return null;
        return toDist(row, hist);
      },
      update(hist, next) {
        const ctx = ctxOf(hist, hist.length);
        if (ctx !== null) t.add(ctx, valueOf(hist, next));
      },
    };
  };
  const last = (hist) => hist[hist.length - 1];

  return [
    tableModel('freqAll', () => '', (_h, x) => x.p),
    {
      key: 'freq10',
      predict(hist) {
        if (hist.length === 0) return null;
        const d = new Array(n).fill(0);
        for (const e of hist.slice(-RECENT_WINDOW)) d[e.p]++;
        return d;
      },
      update() {},
    },
    tableModel('markov1', (h, k) => (k >= 1 ? `${h[k - 1].p}` : null), (_h, x) => x.p),
    tableModel('markov2', (h, k) => (k >= 2 ? `${h[k - 2].p},${h[k - 1].p}` : null), (_h, x) => x.p),
    tableModel('pair', (h, k) => (k >= 1 ? `${h[k - 1].p},${h[k - 1].a}` : null), (_h, x) => x.p),
    // Win-Stay/Lose-Shift: Abstand des nächsten Zugs zum eigenen letzten Zug je Ergebnis
    tableModel(
      'wsls',
      (h, k) => (k >= 1 ? resKey(h[k - 1].r) : null),
      (h, x) => (x.p - last(h).p + n) % n,
      (row, h) => rotate(row, last(h).p),
    ),
    // Reaktion auf meinen letzten Zug (z. B. „Spieler kontert meinen letzten Zug“)
    tableModel(
      'react',
      (h, k) => (k >= 1 ? resKey(h[k - 1].r) : null),
      (h, x) => (x.p - last(h).a + n) % n,
      (row, h) => rotate(row, last(h).a),
    ),
  ];
}

const VARIANT_COUNT = 3; // 0 = direkt kontern, 1 = Gegner kontert mich, 2 = doppelt um die Ecke

function mindReaderBrain(h, random, initial) {
  const predictors = makePredictors(h.n);
  const scores = predictors.map(() => new Array(VARIANT_COUNT).fill(0));
  const hist = []; // { p, a, r }

  /** Empfehlungen aller Prädiktoren/Meta-Varianten für die nächste Runde. */
  const recommendations = () =>
    predictors.map((pr) => {
      const dist = pr.predict(hist);
      if (!dist) return null;
      const m0 = h.bestResponse(dist);
      const m1 = h.bestResponse(h.counterDist(m0));
      const m2 = h.bestResponse(h.counterDist(m1));
      return { dist, recs: [m0, m1, m2] };
    });

  const best = () => {
    const recs = recommendations();
    let bi = -1;
    let bv = 0;
    let bs = 0; // nur Strategien mit positiven Punkten werden gespielt
    for (let i = 0; i < predictors.length; i++) {
      if (!recs[i]) continue;
      for (let v = 0; v < VARIANT_COUNT; v++) {
        if (scores[i][v] > bs + 1e-9) {
          bs = scores[i][v];
          bi = i;
          bv = v;
        }
      }
    }
    if (bi < 0) return null;
    return { index: bi, key: predictors[bi].key, variant: bv, score: bs, ...recs[bi], move: recs[bi].recs[bv] };
  };

  const learn = (a, p) => {
    const recs = recommendations();
    for (let i = 0; i < predictors.length; i++) {
      for (let v = 0; v < VARIANT_COUNT; v++) {
        scores[i][v] *= SCORE_DECAY;
        if (recs[i]) scores[i][v] += h.pay[recs[i].recs[v]][p];
      }
    }
    const entry = { p, a, r: h.pay[p][a] };
    for (const pr of predictors) pr.update(hist, entry);
    hist.push(entry);
    if (hist.length > HISTORY_MAX) hist.shift();
  };

  for (const [p, a] of initial) learn(a, p);

  const explain = () => {
    const b = best();
    if (!b) return 'Ich beobachte dich noch …';
    const name = (i) => MOVE_NAMES[h.moves[i]];
    if (b.variant === 1) return 'Ich vermute, du versuchst mich zu kontern – also kontere ich deinen Konter.';
    if (b.variant === 2) return 'Ich denke um zwei Ecken: Du erwartest, dass ich deinen Konter kontere.';
    const pred = b.dist.indexOf(Math.max(...b.dist));
    const lp = hist.length ? hist[hist.length - 1] : null;
    switch (b.key) {
      case 'freqAll':
        return `Du spielst gern ${name(pred)}.`;
      case 'freq10':
        return `In letzter Zeit spielst du oft ${name(pred)}.`;
      case 'markov1':
        return `Nach ${name(lp.p)} spielst du gern ${name(pred)}.`;
      case 'markov2': {
        const pp = hist[hist.length - 2];
        return `Ich kenne deine Zugfolge: Nach ${name(pp.p)} und ${name(lp.p)} kommt oft ${name(pred)}.`;
      }
      case 'pair':
        return `Wenn du ${name(lp.p)} und ich ${name(lp.a)} gespielt habe, nimmst du gern ${name(pred)}.`;
      case 'wsls': {
        const after = lp.r > 0 ? 'einem Sieg' : lp.r < 0 ? 'einer Niederlage' : 'einem Unentschieden';
        if (pred === lp.p) return `Ich glaube, nach ${after} bleibst du gern bei ${name(pred)}.`;
        if (h.pay[pred][lp.a] === 1) return `Ich glaube, du wechselst nach ${after} zum Konter – also ${name(pred)}.`;
        return `Ich glaube, du wechselst nach ${after} zu ${name(pred)}.`;
      }
      case 'react':
        if (h.pay[pred][lp.a] === 1) return 'Ich glaube, du versuchst meinen letzten Zug zu kontern.';
        if (pred === lp.a) return 'Ich glaube, du spielst gern meinen letzten Zug nach.';
        return `Auf mein ${name(lp.a)} antwortest du gern mit ${name(pred)}.`;
      default:
        return 'Ich habe ein Muster bei dir entdeckt.';
    }
  };

  return {
    pick() {
      if (random() < EXPLORE) return h.randomMove();
      const b = best();
      return b ? b.move : h.randomMove();
    },
    observe: learn,
    explain,
  };
}

// --- Fabrik -----------------------------------------------------------------

/**
 * @param {1|2|3|4} level
 * @param {'classic'|'lizard'} variant
 * @param {{ storage?: Storage|null, random?: () => number }} [opts]
 *   random: Zufallsquelle in [0,1) (für deterministische Tests), Standard crypto-basiert.
 */
export function createAI(level, variant, opts = {}) {
  const info = AI_LEVELS.find((l) => l.level === level);
  if (!info) throw new Error(`Unbekannte Stufe: ${level}`);
  let storage = null;
  try {
    storage = 'storage' in opts ? opts.storage : globalThis.localStorage ?? null;
  } catch {
    storage = null;
  }
  const random = typeof opts.random === 'function' ? opts.random : defaultRandom;
  const h = makeHelpers(variant, random);

  let brain;
  let history = null; // nur Stufe 4 liest/schreibt die Historie
  if (level === 1) brain = randomBrain(h);
  else if (level === 2) brain = habitBrain(h, random);
  else if (level === 3) brain = tacticianBrain(h, random);
  else {
    history = loadHistory(storage, variant);
    brain = mindReaderBrain(
      h,
      random,
      history.map(([p, a]) => [h.idx[p], h.idx[a]]),
    );
  }

  return {
    level,
    name: info.name,
    pick: () => h.moves[brain.pick()],
    observe(aiMove, playerMove) {
      if (!h.isMove(aiMove) || !h.isMove(playerMove)) return;
      brain.observe(h.idx[aiMove], h.idx[playerMove]);
      if (history) {
        history.push([playerMove, aiMove]);
        if (history.length > HISTORY_MAX) history.splice(0, history.length - HISTORY_MAX);
        saveHistory(storage, variant, history);
      }
    },
    explain: () => brain.explain(),
  };
}
