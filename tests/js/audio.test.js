import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { memoryStorage, throwingStorage } from './helpers.js';
import {
  SOUND_NAMES, SOUND_RECIPES, VOICE_DEFAULTS, SILENCE, MIN_REPEAT_MS, noteFreq, arpeggio, chord,
  recipeDuration, peakGain, renderRecipe, createMaster,
  unlock, play, setEnabled, isEnabled, _configureForTests,
} from '../../public/assets/js/audio.js';

/* ---------- Fake-AudioContext: protokolliert Knoten und Automationen ---------- */
class Param {
  constructor(log) { this.log = log; this.value = 0; }
  setValueAtTime(v, t) { this.log.push(['set', v, t]); }
  linearRampToValueAtTime(v, t) { this.log.push(['lin', v, t]); }
  exponentialRampToValueAtTime(v, t) {
    if (v <= 0) throw new RangeError('exponentialRamp braucht > 0');
    this.log.push(['exp', v, t]);
  }
}
class Node {
  constructor(ctx, kind) { this.ctx = ctx; this.kind = kind; this.out = []; ctx.nodes.push(this); }
  connect(n) { this.out.push(n); return n; }
}
function fakeContext({ state = 'running' } = {}) {
  const ctx = { nodes: [], currentTime: 10, sampleRate: 8000, state, resumed: 0 };
  const withParams = (n, ...names) => { for (const k of names) n[k] = new Param((n.log ??= [])); return n; };
  Object.assign(ctx, {
    destination: { kind: 'destination' },
    resume() { ctx.resumed++; ctx.state = 'running'; return Promise.resolve(); },
    createOscillator() {
      const n = withParams(new Node(ctx, 'osc'), 'frequency');
      n.start = (t) => { n.startAt = t; };
      n.stop = (t) => { n.stopAt = t; };
      return n;
    },
    createBufferSource() {
      const n = new Node(ctx, 'noise');
      n.start = (t) => { n.startAt = t; };
      n.stop = (t) => { n.stopAt = t; };
      return n;
    },
    createBuffer: (_c, len) => ({ getChannelData: () => new Float32Array(len) }),
    createGain: () => withParams(new Node(ctx, 'gain'), 'gain'),
    createBiquadFilter: () => withParams(new Node(ctx, 'filter'), 'frequency', 'Q'),
    createDynamicsCompressor: () => withParams(new Node(ctx, 'comp'), 'threshold', 'knee', 'ratio', 'attack', 'release'),
  });
  return ctx;
}

let savedStorage;
beforeEach(() => {
  savedStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true, writable: true });
});
afterEach(() => {
  if (savedStorage) Object.defineProperty(globalThis, 'localStorage', savedStorage);
  else delete globalThis.localStorage;
});

/* ---------- Noten & Helfer ---------- */

test('noteFreq: Kammerton und Halbtöne', () => {
  assert.equal(noteFreq('A4'), 440);
  assert.equal(noteFreq('A5'), 880);
  assert.ok(Math.abs(noteFreq('C4') - 261.63) < 0.01);
  assert.ok(Math.abs(noteFreq('C#5') - 554.37) < 0.01);
  assert.equal(noteFreq('Eb4'), noteFreq('D#4'));
  assert.throws(() => noteFreq('H4'));
});

test('peakGain zählt nur gleichzeitig klingende Stimmen', () => {
  assert.equal(peakGain([{ gain: 0.2, dur: 0.1 }, { gain: 0.2, at: 0.2, dur: 0.1 }]), 0.2);
  assert.ok(Math.abs(peakGain([{ gain: 0.2, dur: 0.3 }, { gain: 0.3, at: 0.1, dur: 0.1 }]) - 0.5) < 1e-9);
});

test('arpeggio und chord', () => {
  const a = arpeggio(['C5', 'E5'], 0.1, { at: 0.2, gain: 0.1 });
  assert.deepEqual(a.map((v) => v.at), [0.2, 0.30000000000000004]);
  const c = chord(['C5', 'E5', 'G5', 'C6'], { gain: 0.2 });
  assert.equal(c.length, 4);
  assert.ok(c.every((v) => Math.abs(v.gain - 0.1) < 1e-9));
});

/* ---------- Rezepte ---------- */

test('alle geforderten Sounds existieren', () => {
  const required = ['click', 'tick', 'shake', 'clash', 'win', 'lose', 'draw', 'matchWin', 'matchLose', 'pop', 'join', 'countdown'];
  assert.deepEqual([...SOUND_NAMES].sort(), [...required].sort());
});

test('Rezepte: angenehme Grenzen (Lautstärke, Länge, Frequenzen)', () => {
  for (const name of SOUND_NAMES) {
    const recipe = SOUND_RECIPES[name];
    assert.ok(recipe.length > 0, name);
    assert.ok(recipeDuration(recipe) <= 1.8, `${name} zu lang`);
    const peak = peakGain(recipe);
    assert.ok(peak > 0 && peak <= 0.9, `${name} zu laut (${peak})`);
    for (const v of recipe) {
      assert.ok((v.dur ?? VOICE_DEFAULTS.dur) > 0);
      if ((v.kind ?? 'tone') === 'tone') {
        assert.ok(v.freq >= 30 && v.freq <= 4500, `${name}: freq ${v.freq}`);
        if (v.to) assert.ok(v.to > 0);
        assert.match(v.wave ?? VOICE_DEFAULTS.wave, /^(sine|triangle|square|sawtooth)$/);
      }
    }
  }
  for (const short of ['click', 'tick', 'pop', 'shake']) assert.ok(recipeDuration(SOUND_RECIPES[short]) <= 0.16, short);
});

/* ---------- Renderer ---------- */

test('renderRecipe: plant jede Stimme mit Hüllkurve, kein exponentieller Ramp auf 0', () => {
  for (const name of SOUND_NAMES) {
    const ctx = fakeContext();
    const dest = ctx.createGain();
    const sources = renderRecipe(ctx, dest, SOUND_RECIPES[name], 1);
    assert.equal(sources.length, SOUND_RECIPES[name].length);
    for (const [i, src] of sources.entries()) {
      const v = { ...VOICE_DEFAULTS, ...SOUND_RECIPES[name][i] };
      assert.ok(Math.abs(src.startAt - (1 + v.at)) < 1e-9, `${name}[${i}] Start`);
      assert.ok(src.stopAt > src.startAt + v.dur - 1e-9, `${name}[${i}] Stop`);
    }
    const gains = ctx.nodes.filter((n) => n.kind === 'gain' && n !== dest);
    for (const g of gains.filter((n) => n.out.includes(dest))) {
      const kinds = g.gain.log.map((e) => e[0]);
      assert.deepEqual(kinds, ['set', 'lin', 'exp'], `${name} Hüllkurve`);
      assert.equal(g.gain.log[0][1], SILENCE);
    }
  }
});

test('renderRecipe: Filter, Glide und Vibrato werden verdrahtet', () => {
  const ctx = fakeContext();
  renderRecipe(ctx, ctx.createGain(), [
    { freq: 400, to: 200, filter: { type: 'lowpass', freq: 1000, to: 500 }, vibrato: { rate: 5, depth: 4 } },
  ], 0);
  const oscs = ctx.nodes.filter((n) => n.kind === 'osc');
  assert.equal(oscs.length, 2, 'Ton + LFO');
  const [tone, lfo] = oscs;
  assert.ok(tone.frequency.log.some((e) => e[0] === 'exp' && e[1] === 200));
  assert.ok(lfo.out[0].out.includes(tone.frequency), 'LFO → Tiefe → Frequenz');
  const filter = ctx.nodes.find((n) => n.kind === 'filter');
  assert.equal(filter.type, 'lowpass');
  assert.ok(tone.out.includes(filter));
});

test('createMaster: Gain → Kompressor → Ausgang', () => {
  const ctx = fakeContext();
  const master = createMaster(ctx);
  const comp = master.out[0];
  assert.equal(comp.kind, 'comp');
  assert.equal(comp.out[0], ctx.destination);
  assert.ok(comp.ratio.value > 1);
});

/* ---------- API ---------- */

test('setEnabled/isEnabled persistiert in rps.sound, Standard an', () => {
  _configureForTests({});
  assert.equal(isEnabled(), true);
  setEnabled(false);
  assert.equal(localStorage.getItem('rps.sound'), '0');
  _configureForTests({});
  assert.equal(isEnabled(), false, 'wird gelesen');
  setEnabled(true);
  assert.equal(localStorage.getItem('rps.sound'), '1');
});

test('gesperrter Speicher: kein Fehler, Standard an', () => {
  globalThis.localStorage = throwingStorage;
  _configureForTests({});
  assert.equal(isEnabled(), true);
  setEnabled(false);
  assert.equal(isEnabled(), false);
});

test('play vor unlock bleibt still; nach unlock werden Knoten erzeugt', () => {
  let ctx;
  _configureForTests({ createContext: () => (ctx = fakeContext({ state: 'suspended' })), enabled: true });
  play('click');
  assert.equal(ctx, undefined, 'AudioContext erst bei unlock');
  unlock();
  assert.equal(ctx.resumed, 1);
  const before = ctx.nodes.length;
  play('click');
  assert.ok(ctx.nodes.length > before);
});

test('play: aus, unbekannt, Drosselung', () => {
  let ctx;
  _configureForTests({ createContext: () => (ctx = fakeContext()), enabled: false });
  unlock();
  const n0 = ctx.nodes.length;
  play('win');
  assert.equal(ctx.nodes.length, n0, 'aus → still');
  setEnabled(true);
  play('nicht-da');
  assert.equal(ctx.nodes.length, n0);
  play('pop');
  const n1 = ctx.nodes.length;
  play('pop');
  assert.equal(ctx.nodes.length, n1, `gedrosselt (<${MIN_REPEAT_MS} ms)`);
  ctx.currentTime += 1;
  play('pop');
  assert.ok(ctx.nodes.length > n1);
});

test('nie werfen: kein AudioContext, kaputter Context', () => {
  _configureForTests({ createContext: () => null, enabled: true });
  unlock();
  play('win');
  _configureForTests({ createContext: () => { throw new Error('verboten'); }, enabled: true });
  unlock();
  play('win');
  const broken = fakeContext();
  broken.createOscillator = () => { throw new Error('kaputt'); };
  _configureForTests({ createContext: () => broken, enabled: true });
  unlock();
  play('win');
});
