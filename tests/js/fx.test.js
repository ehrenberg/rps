import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seededRandom } from './helpers.js';
import {
  ParticlePool, PARTICLE_TYPES, PHYSICS, FX_LIMITS, CONFETTI, SPARKS, BURST, RAIN,
  integrate, fadeAlpha, confettiSpawn, sparksSpawn, burstSpawn, createRainEmitter,
  createParticleSystem, shakeKeyframes, emojiKeyframes,
  initFx, confetti, sparks, rain, burst, screenShake, floatEmoji, setReducedFx, clear,
} from '../../public/assets/js/fx.js';

const VIEW = { w: 400, h: 800 };

/** Canvas-Kontext-Attrappe: zählt Aufrufe. */
function fakeCtx() {
  const calls = {};
  const count = (name) => () => { calls[name] = (calls[name] ?? 0) + 1; };
  return new Proxy({ calls, createRadialGradient: () => ({ addColorStop() {} }), createLinearGradient: () => ({ addColorStop() {} }) }, {
    get(t, k) { return k in t ? t[k] : count(k); },
    set(t, k, v) { t[k] = v; return true; },
  });
}

/* ---------- Pool ---------- */

test('ParticlePool: Obergrenze, Wiederverwendung, saubere Objekte', () => {
  const pool = new ParticlePool(3);
  const a = pool.acquire({ x: 1, extra: 'alt' });
  pool.acquire({ x: 2 });
  pool.acquire({ x: 3 });
  assert.equal(pool.acquire({ x: 4 }), null, 'voll → verworfen');
  pool.sweep((p) => p.x === 1);
  assert.equal(pool.size, 2);
  assert.deepEqual(pool.active.map((p) => p.x), [2, 3], 'Reihenfolge stabil');
  const b = pool.acquire({ x: 5 });
  assert.equal(b, a, 'Objekt wiederverwendet');
  assert.equal(b.extra, undefined, 'alte Felder gelöscht');
  assert.equal(b.age, 0);
  pool.clear();
  assert.equal(pool.size, 0);
  assert.equal(pool.free.length, 3);
});

/* ---------- Physik ---------- */

test('integrate: Schwerkraft und Luftwiderstand zeitbasiert', () => {
  const p = { x: 0, y: 0, vx: 100, vy: 0, rot: 0, vr: 1 };
  integrate(p, 0.5, 10, 0);
  assert.equal(p.vy, 5);
  assert.equal(p.x, 50);
  assert.equal(p.rot, 0.5);
  const q = { x: 0, y: 0, vx: 100, vy: 0, rot: 0, vr: 0 };
  integrate(q, 1, 0, Math.LN2);
  assert.ok(Math.abs(q.vx - 50) < 1e-9, 'Halbierung nach ln2 Drag in 1 s');
});

test('integrate ist framerate-unabhängig (30 vs. 120 fps)', () => {
  const run = (fps) => {
    const p = { x: 0, y: 0, vx: 300, vy: -400, rot: 0, vr: 0 };
    for (let i = 0; i < fps; i++) integrate(p, 1 / fps, PHYSICS.confettiGravity, PHYSICS.confettiDrag);
    return p;
  };
  const a = run(30);
  const b = run(120);
  assert.ok(Math.abs(a.x - b.x) < 6 && Math.abs(a.y - b.y) < 12, `${a.x},${a.y} vs ${b.x},${b.y}`);
});

test('fadeAlpha blendet nur am Lebensende aus', () => {
  assert.equal(fadeAlpha({ age: 0, ttl: 2 }), 1);
  assert.ok(fadeAlpha({ age: 1.9, ttl: 2 }) < 0.5);
  assert.equal(fadeAlpha({ age: 3, ttl: 2 }), 0);
});

/* ---------- Typen ---------- */

test('alle Partikel-Typen erfüllen die gemeinsame Schnittstelle', () => {
  for (const [name, type] of Object.entries(PARTICLE_TYPES)) {
    assert.equal(typeof type.update, 'function', name);
    assert.equal(typeof type.draw, 'function', name);
    assert.match(type.blend, /^(source-over|lighter)$/, name);
  }
});

test('jeder Spawner erzeugt nur bekannte Typen mit endlichen Werten', () => {
  const r = seededRandom(1);
  const lists = [
    confettiSpawn({}, VIEW, r), confettiSpawn({ x: 10, y: 10, count: 20 }, VIEW, r),
    sparksSpawn(5, 5, {}, r), burstSpawn(5, 5, {}, r), [createRainEmitter({}, VIEW, r).cloud],
  ];
  for (const list of lists) {
    for (const p of list) {
      assert.ok(PARTICLE_TYPES[p.type], p.type);
      for (const k of ['x', 'y', 'ttl', 'size']) assert.ok(Number.isFinite(p[k]), `${p.type}.${k}`);
      assert.ok(p.ttl > 0);
    }
  }
  assert.equal(confettiSpawn({}, VIEW, r).length, CONFETTI.count);
  assert.equal(confettiSpawn({ count: -5 }, VIEW, r).length, 0);
  assert.equal(sparksSpawn(0, 0, {}, r).length, SPARKS.count + 1, 'Funken + Blitz');
  assert.equal(burstSpawn(0, 0, {}, r).length, BURST.dots + 1, 'Punkte + Ring');
  assert.ok(sparksSpawn(0, 0, { color: '#123' }, r).filter((p) => p.type === 'spark').every((p) => p.color === '#123'));
});

test('Konfetti-Kanonen schießen von unten links/rechts nach oben innen', () => {
  const list = confettiSpawn({ count: 10 }, VIEW, seededRandom(2));
  for (const p of list) {
    assert.ok(p.vy < 0, 'nach oben');
    assert.ok(p.x === 0 ? p.vx > 0 : p.vx < 0, 'nach innen');
    assert.equal(p.y, VIEW.h);
  }
});

/* ---------- System ---------- */

test('System: Partikel sterben nach ttl, busy wird false', () => {
  const sys = createParticleSystem({ random: seededRandom(3) });
  sys.add(sparksSpawn(100, 100, {}, seededRandom(3)));
  assert.ok(sys.busy);
  for (let i = 0; i < 60; i++) sys.step(1 / 60);
  assert.equal(sys.pool.size, 0);
  assert.equal(sys.busy, false);
});

test('System: Obergrenze wird nie überschritten', () => {
  const sys = createParticleSystem({ max: 100, random: seededRandom(4) });
  for (let i = 0; i < 5; i++) sys.add(confettiSpawn({}, VIEW, seededRandom(i)));
  assert.equal(sys.pool.size, 100);
  assert.ok(FX_LIMITS.maxParticles >= CONFETTI.count * 2, 'zwei Konfetti-Salven passen');
});

test('Regen: Emitter spawnt mit Rate, Tropfen erzeugen Spritzer am Boden, endet nach duration', () => {
  const r = seededRandom(5);
  const sys = createParticleSystem({ random: r });
  const em = createRainEmitter({ duration: 1000 }, VIEW, r);
  sys.add([em.cloud]);
  sys.addEmitter(em);
  let drops = 0;
  let dots = 0;
  for (let i = 0; i < 60; i++) {
    sys.step(1 / 60);
    drops = Math.max(drops, sys.pool.active.filter((p) => p.type === 'drop').length);
    dots += sys.pool.active.filter((p) => p.type === 'dot').length;
  }
  assert.ok(drops > RAIN.rate * 0.3, `Tropfen: ${drops}`);
  assert.ok(dots > 0, 'Spritzer entstanden');
  for (let i = 0; i < 200; i++) sys.step(1 / 60);
  assert.equal(sys.busy, false, 'alles vorbei');
});

test('System.draw: setzt Blend-Modus und Alpha zurück, zeichnet jeden Typ ohne Fehler', () => {
  const r = seededRandom(6);
  const sys = createParticleSystem({ random: r });
  const em = createRainEmitter({}, VIEW, r);
  sys.add([...confettiSpawn({ count: 30 }, VIEW, r), ...sparksSpawn(1, 1, {}, r), ...burstSpawn(1, 1, {}, r), em.cloud]);
  sys.addEmitter(em);
  sys.step(0.1);
  const ctx = fakeCtx();
  sys.draw(ctx, 2);
  assert.equal(ctx.globalAlpha, 1);
  assert.equal(ctx.globalCompositeOperation, 'source-over');
  assert.ok(ctx.calls.setTransform > 30);
  assert.throws(() => sys.env.spawn('banane', {}));
});

/* ---------- Keyframes ---------- */

test('shakeKeyframes klingt ab und endet in Ruhe', () => {
  const frames = shakeKeyframes(1, seededRandom(7));
  const amp = (f) => Math.max(...(f.transform.match(/-?\d+(\.\d+)?(?=px)/g) ?? ['0']).map((n) => Math.abs(Number(n))));
  assert.equal(amp(frames[0]), 0);
  assert.equal(amp(frames.at(-1)), 0);
  assert.ok(amp(frames[1]) <= 9 && amp(frames.at(-2)) <= 2);
  assert.ok(shakeKeyframes(0, seededRandom(1)).every((f) => amp(f) === 0));
});

test('emojiKeyframes: steigt auf und verblasst; reduziert ohne Bewegung', () => {
  const f = emojiKeyframes(seededRandom(8));
  assert.equal(f[0].opacity, 0);
  assert.equal(f.at(-1).opacity, 0);
  assert.match(f.at(-1).transform, /-\d+(\.\d+)?vh/);
  assert.ok(emojiKeyframes(seededRandom(8), true).every((k) => !('transform' in k)));
});

/* ---------- API ohne DOM ---------- */

test('API wirft ohne Canvas/DOM nie', () => {
  initFx(null);
  confetti();
  sparks(1, 2);
  rain();
  burst(1, 2);
  screenShake(undefined);
  screenShake({});
  floatEmoji('🔥');
  setReducedFx(true);
  setReducedFx(false);
});

/* ---------- API mit Fake-Browser (Canvas, rAF, DOM) ---------- */

function installFakeBrowser() {
  const saved = {};
  for (const k of ['document', 'requestAnimationFrame', 'cancelAnimationFrame', 'innerWidth', 'innerHeight']) saved[k] = globalThis[k];
  const raf = new Map();
  let nextId = 1;
  const cancelled = [];
  const fakeNode = (tag) => {
    const node = {
      tag, children: [], style: {}, parent: null, isConnected: true, className: '',
      setAttribute() {},
      append(...cs) { for (const c of cs) { c.parent = node; node.children.push(c); } },
      remove() { if (node.parent) node.parent.children = node.parent.children.filter((c) => c !== node); },
      replaceChildren() { node.children = []; },
      get childElementCount() { return node.children.length; },
      get firstElementChild() { return node.children[0]; },
      animate: () => ({ finished: new Promise(() => {}) }),
    };
    return node;
  };
  const body = fakeNode('body');
  Object.assign(globalThis, {
    innerWidth: 400,
    innerHeight: 800,
    requestAnimationFrame: (cb) => { const id = nextId++; raf.set(id, cb); return id; },
    cancelAnimationFrame: (id) => { cancelled.push(id); raf.delete(id); },
    document: { body, documentElement: { dataset: {} }, createElement: fakeNode },
  });
  let now = performance.now();
  /** Führt anstehende Frames aus, bis keiner mehr geplant ist (max. n). Liefert die Anzahl. */
  const runFrames = (max = 1000) => {
    let n = 0;
    while (raf.size && n < max) {
      const [id, cb] = raf.entries().next().value;
      raf.delete(id);
      now += 1000 / 60;
      cb(now);
      n++;
    }
    return n;
  };
  const ctx = fakeCtx();
  const canvas = { width: 0, height: 0, getContext: () => ctx, classList: { add() {} }, setAttribute() {} };
  const restore = () => {
    clear();
    setReducedFx(false);
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete globalThis[k]; else globalThis[k] = v;
  };
  return { raf, cancelled, runFrames, ctx, canvas, body, restore };
}

test('clear(): stoppt rAF sofort, entfernt Partikel, Regenwolke und Emojis', () => {
  const b = installFakeBrowser();
  try {
    initFx(b.canvas);
    rain({ duration: 5000 });
    confetti();
    floatEmoji('🔥');
    floatEmoji('👍');
    const layer = b.body.children[0];
    assert.equal(layer.childElementCount, 2);
    assert.equal(b.raf.size, 1, 'Schleife läuft');
    const scheduled = [...b.raf.keys()][0];
    b.runFrames(10);

    const clearsBefore = b.ctx.calls.clearRect ?? 0;
    clear();
    assert.equal(b.raf.size, 0, 'kein Frame mehr geplant');
    assert.ok(b.cancelled.length >= 1 && b.cancelled.at(-1) > scheduled - 1);
    assert.equal(layer.childElementCount, 0, 'Emojis weg');
    assert.ok(b.ctx.calls.clearRect > clearsBefore, 'Canvas geleert');
    assert.equal(b.runFrames(), 0);

    // Danach funktionieren Effekte normal; ohne Regen endet die Schleife schnell (Burst ≈ 0,5 s).
    burst(10, 10);
    assert.equal(b.raf.size, 1, 'Schleife startet neu');
    const frames = b.runFrames();
    assert.ok(frames > 0 && frames < 60, `Regen-Emitter wäre noch aktiv (${frames} Frames)`);
    clear();
    clear(); // mehrfach aufrufbar
  } finally { b.restore(); }
});

test('clear() ohne initFx/DOM wirft nicht', () => {
  clear();
});

test('setReducedFx: an → data-reduced-fx="1", aus → Attribut entfernt; an stoppt Partikel', () => {
  const b = installFakeBrowser();
  try {
    const ds = globalThis.document.documentElement.dataset;
    initFx(b.canvas);
    confetti();
    assert.equal(b.raf.size, 1);
    setReducedFx(true);
    assert.equal(ds.reducedFx, '1');
    assert.equal(b.raf.size, 0, 'Schleife gestoppt');
    confetti();
    assert.equal(b.raf.size, 0, 'reduziert: keine neuen Partikel');
    setReducedFx(false);
    assert.equal('reducedFx' in ds, false);
    confetti();
    assert.equal(b.raf.size, 1);
  } finally { b.restore(); }
});
