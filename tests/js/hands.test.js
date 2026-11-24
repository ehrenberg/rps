import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { MOVES } from '../../public/assets/js/rules.js';
import {
  HAND_FORMS, HAND_SHAPES, HAND_VIEWBOX, capsulePath, upNormal, lerpPoint, shakeTimeline, SHAKE_PEAK,
  handTree, shapeTree, gradientIds, toDom, isReducedMotion, STATES, POP, createHand, handIcon,
} from '../../public/assets/js/hands.js';

/* ---------- Minimaler Fake-DOM (nur was hands.js braucht) ---------- */
class FakeEl {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.attrs = {};
    this.dataset = {};
    this.className = '';
    this.animations = [];
    const self = this;
    this.classList = {
      add: (c) => { if (!self.classes.includes(c)) self.className = [...self.classes, c].join(' '); },
      remove: (c) => { self.className = self.classes.filter((x) => x !== c).join(' '); },
      contains: (c) => self.classes.includes(c),
    };
  }
  get classes() { return (this.className || this.attrs.class || '').split(/\s+/).filter(Boolean); }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  appendChild(c) { this.children.push(c); return c; }
  append(...cs) { cs.forEach((c) => this.appendChild(c)); }
  replaceChild(n, o) { this.children[this.children.indexOf(o)] = n; }
  *walk() { for (const c of this.children) { yield c; yield* c.walk(); } }
  querySelector(sel) { const cls = sel.slice(1); for (const e of this.walk()) if (e.classes.includes(cls)) return e; return null; }
  animate(keyframes, options) {
    const a = { keyframes, options, cancelled: false, cancel() { this.cancelled = true; }, finished: Promise.resolve() };
    this.animations.push(a);
    return a;
  }
}
function installFakeDom({ reduced = false } = {}) {
  const documentElement = { dataset: { reducedFx: reduced ? '1' : '0' } };
  globalThis.document = {
    documentElement,
    createElement: (t) => new FakeEl(t),
    createElementNS: (_ns, t) => new FakeEl(t),
  };
  return () => { delete globalThis.document; };
}

/* ---------- Geometrie ---------- */

test('capsulePath: geschlossener Pfad mit zwei Bögen, Radien korrekt', () => {
  const d = capsulePath([0, 0], [100, 0], 10, 6);
  assert.match(d, /^M0 10 L100 6 A6 6 0 0 0 100 -6 L0 -10 A10 10 0 0 0 0 10 Z$/);
  assert.doesNotMatch(capsulePath([5, 5], [5, 5], 4), /NaN/, 'Länge 0 erzeugt keine NaN');
});

test('upNormal zeigt immer nach oben (negatives y), lerpPoint interpoliert', () => {
  for (const [a, b] of [[[0, 0], [10, 0]], [[10, 0], [0, 0]], [[0, 0], [10, 5]]]) {
    const [, ny] = upNormal(a, b);
    assert.ok(ny <= 0);
  }
  assert.deepEqual(lerpPoint([0, 0], [10, 20], 0.5), [5, 10]);
});

/* ---------- Formen als Daten ---------- */

test('jeder Spielzug + Faust hat eine Handform', () => {
  for (const m of MOVES) assert.ok(HAND_SHAPES[m], m);
  assert.deepEqual(HAND_FORMS, ['fist', ...MOVES]);
});

test('Finger-Teile haben gültige Geometrie innerhalb der Zeichenfläche', () => {
  const check = (parts) => {
    for (const p of parts) {
      if (p.type === 'group') { check(p.parts); continue; }
      if (p.type !== 'finger') continue;
      assert.equal(p.r.length, 2);
      for (const [x, y] of [p.from, p.to]) {
        assert.ok(x > 0 && x < HAND_VIEWBOX.w, `x ${x}`);
        assert.ok(y > 0 && y < HAND_VIEWBOX.h, `y ${y}`);
      }
    }
  };
  for (const f of HAND_FORMS) check(HAND_SHAPES[f]);
});

/* ---------- Renderer ---------- */

function collect(node, pred, out = []) {
  if (pred(node)) out.push(node);
  node.children.forEach((c) => collect(c, pred, out));
  return out;
}

test('handTree: alle url(#…)-Verweise zeigen auf IDs derselben Instanz', () => {
  for (const icon of [false, true]) {
    for (const form of HAND_FORMS) {
      const tree = handTree(form, { uid: 'u1', icon });
      const ids = new Set(collect(tree, (n) => n.attrs.id).map((n) => n.attrs.id));
      const json = JSON.stringify(tree);
      const refs = [...json.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]);
      assert.ok(refs.length > 0);
      for (const r of refs) assert.ok(ids.has(r), `${form}: ${r} fehlt`);
      for (const id of ids) assert.ok(id.startsWith('u1-'), id);
    }
  }
});

test('zwei Instanzen teilen keine IDs', () => {
  const ids = (uid) => Object.values(gradientIds(uid));
  const a = new Set(ids('rps-hand1'));
  for (const id of ids('rps-hand2')) assert.ok(!a.has(id));
});

test('Icons: quadratische viewBox, kein Ärmel; Hand: Ärmel mit Ausblend-Maske', () => {
  for (const form of HAND_FORMS) {
    const [,, w, h] = handTree(form, { uid: 'i', icon: true }).attrs.viewBox.split(' ').map(Number);
    assert.equal(w, h);
  }
  const hand = JSON.stringify(handTree('paper', { uid: 'h', side: 'right' }));
  assert.match(hand, /accent-right/);
  assert.match(hand, /mask/);
  assert.doesNotMatch(JSON.stringify(handTree('paper', { uid: 'i', icon: true })), /accent-right/);
});

test('front-Teile landen nur in der vorderen Ebene', () => {
  const ctx = { ids: gradientIds('x'), stroke: 5 };
  const front = shapeTree('spock', ctx, 'front');
  const back = shapeTree('spock', ctx, 'back');
  assert.equal(front.children.length, 1);
  assert.ok(back.children.length >= 1);
  assert.equal(shapeTree('fist', ctx, 'front').children.length, 0);
  assert.throws(() => shapeTree('banana', ctx));
});

/* ---------- Animations-Rezepte ---------- */

test('shakeTimeline: Aufschläge exakt auf dem Takt, Keyframes aufsteigend', () => {
  const tl = shakeTimeline(3, 500);
  assert.equal(tl.duration, 1500);
  assert.deepEqual(tl.hitTimes, [500, 1000, 1500]);
  const offsets = tl.keyframes.map((k) => k.offset);
  assert.deepEqual(offsets, [...offsets].sort((a, b) => a - b));
  assert.equal(offsets.at(-1), 1);
  // jeder Aufschlag-Keyframe liegt genau auf hitTime / duration
  tl.hitTimes.forEach((t, i) => assert.equal(tl.keyframes[2 + i * 2].offset, t / tl.duration));
  assert.ok(Math.abs(tl.keyframes[1].offset - SHAKE_PEAK / 3) < 1e-9);
  assert.deepEqual(shakeTimeline(0, 0).hitTimes, [1], 'robust gegen Unsinn');
});

test('Zustands- und Pop-Rezepte sind vollständig', () => {
  for (const s of ['idle', 'win', 'lose', 'draw']) assert.ok(STATES[s]);
  for (const s of ['win', 'lose', 'draw']) assert.ok(STATES[s].cls && STATES[s].keyframes.length >= 2);
  assert.equal(POP.keyframes.at(-1).transform, 'scale(1)');
});

test('isReducedMotion: App-Schalter und Systemeinstellung', () => {
  const doc = (v) => ({ documentElement: { dataset: { reducedFx: v } } });
  const win = (m) => ({ matchMedia: () => ({ matches: m }) });
  assert.equal(isReducedMotion(doc('1'), win(false)), true);
  assert.equal(isReducedMotion(doc('0'), win(true)), true);
  assert.equal(isReducedMotion(doc('0'), win(false)), false);
  assert.equal(isReducedMotion(undefined, {}), false);
  assert.equal(isReducedMotion(doc('0'), { matchMedia() { throw new Error('x'); } }), false);
});

/* ---------- API mit Fake-DOM ---------- */

test('createHand: Aufbau, setMove ersetzt Form und poppt', () => {
  const restore = installFakeDom();
  try {
    const h = createHand({ side: 'right' });
    assert.match(h.el.className, /hand--right/);
    assert.equal(h.el.dataset.move, 'fist');
    h.setMove('scissors');
    assert.equal(h.el.dataset.move, 'scissors');
    const pop = h.el.querySelector('.hand__pop');
    assert.equal(pop.animations.length, 1);
    h.setMove('paper', { pop: false });
    assert.equal(pop.animations.length, 1);
    h.setMove('unbekannt', { pop: false });
    assert.equal(h.el.dataset.move, 'fist');
    const svg = handIcon('lizard');
    assert.equal(svg.tagName, 'svg');
    assert.equal(svg.dataset.move, 'lizard');
  } finally { restore(); }
});

test('createHand: shake ruft onBeat im Takt und resolved beim letzten Aufschlag', async () => {
  const restore = installFakeDom();
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const h = createHand({ side: 'left' });
    const beats = [];
    let done = false;
    const p = h.shake(3, 500, { onBeat: (i) => beats.push(i) }).then(() => { done = true; });
    mock.timers.tick(499);
    assert.deepEqual(beats, []);
    mock.timers.tick(1);
    assert.deepEqual(beats, [0]);
    mock.timers.tick(999);
    assert.deepEqual(beats, [0, 1]);
    await Promise.resolve();
    assert.equal(done, false);
    mock.timers.tick(1);
    await p;
    assert.deepEqual(beats, [0, 1, 2]);
    assert.equal(done, true);
  } finally { mock.timers.reset(); restore(); }
});

test('createHand: reduziert → keine Animationen, Zeitablauf bleibt gleich', async () => {
  const restore = installFakeDom({ reduced: true });
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const h = createHand();
    const p = h.shake(2, 300);
    mock.timers.tick(600);
    await p;
    h.setMove('rock');
    h.setState('win');
    for (const cls of ['.hand__rig', '.hand__pop']) assert.equal(h.el.querySelector(cls).animations.length, 0);
    assert.match(h.el.className, /hand--win/);
  } finally { mock.timers.reset(); restore(); }
});

test('createHand: neuer shake beendet laufenden sofort; setState wechselt Klassen', async () => {
  const restore = installFakeDom();
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const h = createHand();
    const first = h.shake(3, 500);
    h.shake(1, 100);
    await first; // resolved, ohne dass Zeit vergeht
    h.setState('lose');
    assert.match(h.el.className, /hand--lose/);
    h.setState('win');
    assert.doesNotMatch(h.el.className, /hand--lose/);
    h.setState('idle');
    assert.doesNotMatch(h.el.className, /hand--win/);
    assert.equal(h.el.dataset.state, 'idle');
  } finally { mock.timers.reset(); restore(); }
});

test('createHand: stop() bricht shake ab – Promise resolved, onBeat nie mehr', async () => {
  const restore = installFakeDom();
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const h = createHand();
    const beats = [];
    const p = h.shake(3, 500, { onBeat: (i) => beats.push(i) });
    mock.timers.tick(500);
    assert.deepEqual(beats, [0]);
    const rig = h.el.querySelector('.hand__rig');
    h.stop();
    await p; // resolved, ohne dass weitere Zeit vergeht
    mock.timers.tick(5000);
    assert.deepEqual(beats, [0], 'nach stop() kein onBeat mehr');
    assert.ok(rig.animations.every((a) => a.cancelled), 'Shake-Animation abgebrochen');
    h.setState('win');
    h.stop();
    assert.ok(rig.animations.every((a) => a.cancelled), 'Zustandsanimation abgebrochen');
    h.stop(); // mehrfach aufrufbar
  } finally { mock.timers.reset(); restore(); }
});

test('toDom setzt Attribute und Kinder, lässt undefined weg', () => {
  const restore = installFakeDom();
  try {
    const el = toDom({ tag: 'g', attrs: { a: 1, b: undefined }, children: [{ tag: 'path', attrs: {}, children: [] }] });
    assert.deepEqual(el.attrs, { a: '1' });
    assert.equal(el.children[0].tagName, 'path');
  } finally { restore(); }
});
