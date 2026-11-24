// Synthetisierte Sounds per Web Audio API (keine Dateien).
// Vertrag: docs/SCHNITTSTELLEN.md.
//
// Aufbau:
//   1. Noten + Stimmen-Helfer (rein)
//   2. SOUND_RECIPES – jeder Sound ist eine Tabelle von Stimmen (Daten, keine Logik)
//   3. Renderer: Stimme → Web-Audio-Knoten (gegen jedes AudioContext-artige Objekt testbar)
//   4. Öffentliche API: unlock, setEnabled, isEnabled, play

const STORAGE_KEY = 'rps.sound';

export const MASTER = Object.freeze({
  gain: 0.7,
  compressor: { threshold: -18, knee: 12, ratio: 4, attack: 0.003, release: 0.2 },
});

/** Standardwerte einer Stimme (Sekunden, lineare Lautstärke). */
export const VOICE_DEFAULTS = Object.freeze({
  kind: 'tone', wave: 'sine', at: 0, dur: 0.12, gain: 0.15, attack: 0.005,
});

/** Untergrenze für exponentielle Rampen (Web Audio erlaubt keine 0). */
export const SILENCE = 0.0001;
/** Gleicher Sound nicht öfter als alle … ms (verhindert Lautstärke-Spitzen). */
export const MIN_REPEAT_MS = 30;
const NOISE_SECONDS = 1;

/* ------------------------------------------------------------------ */
/* 1. Noten                                                            */
/* ------------------------------------------------------------------ */

const SEMITONES = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };

/** 'A4' → 440, 'C#5' → 554.37, 'Eb4' → 311.13 */
export function noteFreq(name) {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`Ungültige Note: ${name}`);
  const [, letter, acc, oct] = m;
  const semis = SEMITONES[letter] + (acc === '#' ? 1 : acc === 'b' ? -1 : 0) + (Number(oct) - 4) * 12;
  return 440 * 2 ** (semis / 12);
}

/** Tonfolge: gleiche Stimme auf mehreren Noten im Abstand `step`. */
export const arpeggio = (notes, step, voice) =>
  notes.map((n, i) => ({ ...voice, freq: noteFreq(n), at: (voice.at ?? 0) + i * step }));

/** Akkord: mehrere Noten gleichzeitig, Lautstärke aufgeteilt. */
export const chord = (notes, voice) =>
  notes.map((n) => ({ ...voice, freq: noteFreq(n), gain: (voice.gain ?? VOICE_DEFAULTS.gain) / Math.sqrt(notes.length) }));

/* ------------------------------------------------------------------ */
/* 2. Rezepte                                                          */
/* ------------------------------------------------------------------ */
// Stimme: { kind: 'tone'|'noise', wave, freq, to (Glide-Ziel), at, dur, gain, attack,
//           filter: { type, freq, to?, q? }, vibrato: { rate, depth (Hz) } }

const soft = (freq) => ({ type: 'lowpass', freq, q: 0.7 });

export const SOUND_RECIPES = Object.freeze({
  click: [
    { wave: 'triangle', freq: 1800, to: 1100, dur: 0.04, gain: 0.14 },
    { kind: 'noise', dur: 0.015, gain: 0.04, filter: { type: 'highpass', freq: 4000 } },
  ],
  tick: [
    { wave: 'sine', freq: 2100, dur: 0.03, gain: 0.1 },
    { wave: 'triangle', freq: 1050, dur: 0.045, gain: 0.07 },
  ],
  shake: [
    { wave: 'sine', freq: 170, to: 65, dur: 0.15, gain: 0.38, attack: 0.003 },
    { kind: 'noise', dur: 0.12, gain: 0.1, filter: { type: 'lowpass', freq: 1100, to: 300 } },
  ],
  clash: [
    { kind: 'noise', dur: 0.3, gain: 0.32, attack: 0.002, filter: { type: 'bandpass', freq: 2400, to: 500, q: 0.8 } },
    { wave: 'sine', freq: 130, to: 42, dur: 0.28, gain: 0.45, attack: 0.002 },
    { wave: 'triangle', freq: 660, to: 540, dur: 0.22, gain: 0.07, at: 0.01 },
  ],
  win: [
    ...arpeggio(['C5', 'E5', 'G5'], 0.07, { wave: 'triangle', dur: 0.16, gain: 0.15 }),
    { wave: 'sine', freq: noteFreq('C6'), at: 0.21, dur: 0.32, gain: 0.12, vibrato: { rate: 7, depth: 6 } },
  ],
  lose: [
    { wave: 'triangle', freq: noteFreq('G4'), dur: 0.17, gain: 0.15, filter: soft(1800) },
    { wave: 'triangle', freq: noteFreq('Eb4'), to: noteFreq('D4'), at: 0.16, dur: 0.38, gain: 0.15,
      filter: soft(1600), vibrato: { rate: 5.5, depth: 5 } },
  ],
  draw: [
    { wave: 'sine', freq: noteFreq('A4'), dur: 0.13, gain: 0.12 },
    { wave: 'sine', freq: noteFreq('A4'), at: 0.15, dur: 0.18, gain: 0.12 },
    { wave: 'square', freq: noteFreq('A3'), dur: 0.33, gain: 0.03, filter: soft(900) },
  ],
  matchWin: [
    ...arpeggio(['G4', 'C5', 'E5', 'G5'], 0.1, { wave: 'triangle', dur: 0.14, gain: 0.16 }),
    ...arpeggio(['G4', 'C5', 'E5', 'G5'], 0.1, { wave: 'square', dur: 0.12, gain: 0.03, filter: soft(2200) }),
    ...chord(['C5', 'E5', 'G5', 'C6'], { wave: 'triangle', at: 0.42, dur: 0.7, gain: 0.26, vibrato: { rate: 6, depth: 4 } }),
    { wave: 'sine', freq: noteFreq('C7'), at: 0.46, dur: 0.4, gain: 0.04 },
  ],
  matchLose: [
    ...arpeggio(['G4', 'F#4', 'F4'], 0.28, { wave: 'sawtooth', dur: 0.26, gain: 0.08, filter: soft(1100) }),
    { wave: 'sawtooth', freq: noteFreq('E4'), to: noteFreq('D4'), at: 0.84, dur: 0.75, gain: 0.09,
      filter: soft(1000), vibrato: { rate: 6, depth: 7 } },
  ],
  pop: [
    { wave: 'sine', freq: 380, to: 1050, dur: 0.09, gain: 0.2, attack: 0.002 },
  ],
  join: [
    { wave: 'sine', freq: noteFreq('E5'), dur: 0.25, gain: 0.13 },
    { wave: 'sine', freq: noteFreq('A5'), at: 0.12, dur: 0.42, gain: 0.13 },
    { wave: 'triangle', freq: noteFreq('A6'), at: 0.12, dur: 0.2, gain: 0.025 },
  ],
  countdown: [
    { wave: 'triangle', freq: 880, dur: 0.12, gain: 0.13 },
    { wave: 'sine', freq: 1760, dur: 0.07, gain: 0.035 },
  ],
});

export const SOUND_NAMES = Object.freeze(Object.keys(SOUND_RECIPES));

/** Gesamtlänge eines Rezepts in Sekunden. */
export const recipeDuration = (recipe) =>
  Math.max(...recipe.map((v) => (v.at ?? 0) + (v.dur ?? VOICE_DEFAULTS.dur)));

/** Höchste gleichzeitig klingende Summe der Stimm-Lautstärken (grobe Lautheits-Obergrenze). */
export function peakGain(recipe) {
  const voices = recipe.map((v) => ({ ...VOICE_DEFAULTS, ...v }));
  return Math.max(...voices.map(({ at }) =>
    voices.filter((v) => v.at <= at && at < v.at + v.dur).reduce((s, v) => s + v.gain, 0)));
}

/* ------------------------------------------------------------------ */
/* 3. Renderer                                                         */
/* ------------------------------------------------------------------ */

/** Hüllkurve: schneller Anstieg, exponentielles Ausklingen. */
function envelope(param, t, { attack, dur, gain }) {
  param.setValueAtTime(SILENCE, t);
  param.linearRampToValueAtTime(gain, t + attack);
  param.exponentialRampToValueAtTime(SILENCE, t + dur);
}

function createNoiseBuffer(ctx) {
  const len = Math.floor(ctx.sampleRate * NOISE_SECONDS);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

const noiseBuffers = new WeakMap();
function noiseBuffer(ctx) {
  if (!noiseBuffers.has(ctx)) noiseBuffers.set(ctx, createNoiseBuffer(ctx));
  return noiseBuffers.get(ctx);
}

/** Erzeugt die Knoten einer Stimme und plant sie ab Zeit t0. Liefert die Quelle. */
export function renderVoice(ctx, dest, voiceSpec, t0) {
  const voice = { ...VOICE_DEFAULTS, ...voiceSpec };
  const t = t0 + voice.at;
  const end = t + voice.dur;

  let src;
  if (voice.kind === 'noise') {
    src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
  } else {
    src = ctx.createOscillator();
    src.type = voice.wave;
    src.frequency.setValueAtTime(voice.freq, t);
    if (voice.to) src.frequency.exponentialRampToValueAtTime(voice.to, end);
    if (voice.vibrato) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.setValueAtTime(voice.vibrato.rate, t);
      depth.gain.setValueAtTime(voice.vibrato.depth, t);
      lfo.connect(depth).connect(src.frequency);
      lfo.start(t);
      lfo.stop(end);
    }
  }

  let node = src;
  if (voice.filter) {
    const f = ctx.createBiquadFilter();
    f.type = voice.filter.type;
    f.Q.setValueAtTime(voice.filter.q ?? 1, t);
    f.frequency.setValueAtTime(voice.filter.freq, t);
    if (voice.filter.to) f.frequency.exponentialRampToValueAtTime(voice.filter.to, end);
    node = node.connect(f);
  }
  const amp = ctx.createGain();
  envelope(amp.gain, t, voice);
  node.connect(amp).connect(dest);
  src.start(t);
  src.stop(end + 0.02);
  return src;
}

export function renderRecipe(ctx, dest, recipe, t0 = ctx.currentTime) {
  return recipe.map((voice) => renderVoice(ctx, dest, voice, t0));
}

/** Master-Kette: Gain → sanfter Kompressor → Ausgang. */
export function createMaster(ctx) {
  const comp = ctx.createDynamicsCompressor();
  const c = MASTER.compressor;
  comp.threshold.value = c.threshold;
  comp.knee.value = c.knee;
  comp.ratio.value = c.ratio;
  comp.attack.value = c.attack;
  comp.release.value = c.release;
  const gain = ctx.createGain();
  gain.gain.value = MASTER.gain;
  gain.connect(comp).connect(ctx.destination);
  return gain;
}

/* ------------------------------------------------------------------ */
/* 4. Öffentliche API                                                  */
/* ------------------------------------------------------------------ */

const state = {
  ctx: null,
  master: null,
  enabled: readEnabled(),
  lastPlayed: new Map(),
  createContext: () => {
    const Ctor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    return Ctor ? new Ctor({ latencyHint: 'interactive' }) : null;
  },
};

function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readEnabled() {
  try {
    return storage()?.getItem(STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

/** Nur für Tests: AudioContext-Fabrik + Zustand austauschen. */
export function _configureForTests({ createContext, enabled } = {}) {
  if (createContext) state.createContext = createContext;
  state.ctx = null;
  state.master = null;
  state.lastPlayed.clear();
  state.enabled = enabled ?? readEnabled();
}

/** Bei erster Nutzeraktion aufrufen. Erzeugt/weckt den AudioContext. Wirft nie. */
export function unlock() {
  try {
    if (!state.ctx) {
      state.ctx = state.createContext();
      if (!state.ctx) return;
      state.master = createMaster(state.ctx);
    }
    if (state.ctx.state === 'suspended') state.ctx.resume?.()?.catch?.(() => {});
  } catch {
    state.ctx = null;
    state.master = null;
  }
}

export function setEnabled(on) {
  state.enabled = Boolean(on);
  try {
    storage()?.setItem(STORAGE_KEY, state.enabled ? '1' : '0');
  } catch {
    /* Speicher gesperrt – Einstellung gilt nur für diese Sitzung */
  }
}

export function isEnabled() {
  return state.enabled;
}

/** Spielt einen Sound aus SOUND_NAMES. Ohne unlock() oder bei Fehlern: still. */
export function play(name) {
  const recipe = SOUND_RECIPES[name];
  if (!recipe || !state.enabled || !state.ctx || !state.master) return;
  try {
    const nowMs = state.ctx.currentTime * 1000;
    const last = state.lastPlayed.get(name);
    if (last !== undefined && nowMs - last < MIN_REPEAT_MS) return;
    state.lastPlayed.set(name, nowMs);
    if (state.ctx.state === 'suspended') state.ctx.resume?.()?.catch?.(() => {});
    renderRecipe(state.ctx, state.master, recipe, state.ctx.currentTime + 0.005);
  } catch {
    /* Audio ist Kür – nie den Spielablauf stören */
  }
}

// Komfort: automatisch bei der ersten Nutzeraktion entsperren (falls die App es vergisst).
if (typeof globalThis.addEventListener === 'function' && typeof globalThis.document !== 'undefined') {
  for (const type of ['pointerdown', 'keydown']) {
    globalThis.addEventListener(type, unlock, { once: true, passive: true, capture: true });
  }
}
