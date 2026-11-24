// Effekte: Canvas-Partikel (Konfetti, Funken, Regen, Burst), Screen-Shake, Emoji-Reaktionen.
// Vertrag: docs/SCHNITTSTELLEN.md. Styles: assets/css/fx.css.
//
// Aufbau:
//   1. Konstanten
//   2. ParticlePool – feste Obergrenze, Objekte werden wiederverwendet
//   3. PARTICLE_TYPES – jeder Typ hat dieselbe Schnittstelle { blend, update(p, dt, env), draw(ctx, p) }
//   4. Spawner (reine Funktionen: Optionen + Zufall → Partikel-Startwerte)
//   5. Engine (Canvas, rAF-Schleife nur bei aktiven Partikeln)
//   6. DOM-Effekte (Screen-Shake, Emoji) + öffentliche API

/* ------------------------------------------------------------------ */
/* 1. Konstanten                                                       */
/* ------------------------------------------------------------------ */

export const FX_LIMITS = Object.freeze({
  maxParticles: 700,
  maxDpr: 2,
  maxDt: 0.05,          // s – nach Tab-Wechsel keine Riesensprünge
  maxEmojis: 24,
});

export const PHYSICS = Object.freeze({
  gravity: 1300,        // px/s²
  confettiGravity: 520,
  confettiDrag: 1.4,    // 1/s
  confettiFlutter: 42,  // px/s seitliches Flattern
  sparkGravity: 700,
  sparkDrag: 3.2,
  sparkTrail: 0.035,    // s – Länge der Leuchtspur
  dropSpeed: 900,
  dropLength: 16,
});

const FADE_OUT = 0.45;  // s – Ausblenden am Lebensende

export const PALETTE = Object.freeze({
  confetti: [
    ['#ffd84a', '#d9a915'], ['#ff5d8f', '#c93564'], ['#3ad1ff', '#1593bd'],
    ['#8b5cff', '#5f33c9'], ['#4dff9a', '#22b866'], ['#ffffff', '#c9c4e6'],
  ],
  spark: ['#fff6c8', '#ffd84a', '#ffab3d', '#ffffff'],
  rain: 'rgba(150, 200, 255, 0.85)',
  cloud: ['#a7acd0', '#5a5f86'],
  burst: '#ffd84a',
});

export const CONFETTI = Object.freeze({ count: 140, cannonSpeed: [700, 1150], spread: 0.5, ttl: [2.4, 3.6], size: [7, 13] });
export const SPARKS = Object.freeze({ count: 34, speed: [260, 820], ttl: [0.3, 0.62], width: [1.6, 3.2] });
export const BURST = Object.freeze({ dots: 12, ring: 46, speed: [120, 300], ttl: 0.5 });
export const RAIN = Object.freeze({ duration: 2500, rate: 70, cloudWidth: 320, cloudTop: 0.16, fallHeight: 0.42, fade: 0.5 });

const TAU = Math.PI * 2;

/* ------------------------------------------------------------------ */
/* 2. Pool                                                             */
/* ------------------------------------------------------------------ */

/** Feste Menge wiederverwendbarer Partikel-Objekte; über der Obergrenze werden neue verworfen. */
export class ParticlePool {
  constructor(max = FX_LIMITS.maxParticles) {
    this.max = max;
    this.active = [];
    this.free = [];
  }

  get size() { return this.active.length; }

  /** Liefert ein zurückgesetztes Partikel mit den Startwerten oder null (Pool voll). */
  acquire(props) {
    if (this.active.length >= this.max) return null;
    const p = this.free.pop() ?? {};
    for (const k of Object.keys(p)) delete p[k];
    Object.assign(p, { age: 0, alpha: 1, rot: 0, vr: 0, vx: 0, vy: 0 }, props);
    this.active.push(p);
    return p;
  }

  /** Entfernt alle Partikel, für die `dead(p)` true liefert (Reihenfolge bleibt stabil). */
  sweep(dead) {
    let w = 0;
    for (const p of this.active) {
      if (dead(p)) this.free.push(p);
      else this.active[w++] = p;
    }
    this.active.length = w;
  }

  clear() {
    this.free.push(...this.active);
    this.active.length = 0;
  }
}

/* ------------------------------------------------------------------ */
/* 3. Partikel-Typen                                                   */
/* ------------------------------------------------------------------ */

/** Gemeinsame Bewegung: Schwerkraft + Luftwiderstand (zeitbasiert, framerate-unabhängig). */
export function integrate(p, dt, gravity = 0, drag = 0) {
  const k = drag ? Math.exp(-drag * dt) : 1;
  p.vx *= k;
  p.vy = p.vy * k + gravity * dt;
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.rot += p.vr * dt;
}

/** Deckkraft: am Ende über FADE_OUT ausblenden. */
export const fadeAlpha = (p, fade = FADE_OUT) => Math.max(0, Math.min(1, (p.ttl - p.age) / fade));
const progress = (p) => Math.min(1, p.age / p.ttl);

export const PARTICLE_TYPES = {
  confetti: {
    blend: 'source-over',
    update(p, dt) {
      integrate(p, dt, PHYSICS.confettiGravity, PHYSICS.confettiDrag);
      p.phase += p.spin * dt;
      p.x += Math.sin(p.phase) * PHYSICS.confettiFlutter * dt;
      p.alpha = fadeAlpha(p);
    },
    draw(ctx, p, dpr) {
      const c = Math.cos(p.rot);
      const s = Math.sin(p.rot);
      const flip = Math.cos(p.phase); // 3D-Drehung um die Längsachse
      ctx.setTransform(dpr * c, dpr * s, -dpr * s * flip, dpr * c * flip, dpr * p.x, dpr * p.y);
      ctx.fillStyle = flip >= 0 ? p.color : p.color2;
      if (p.round) {
        ctx.beginPath();
        ctx.arc(0, 0, p.size * 0.45, 0, TAU);
        ctx.fill();
      } else {
        ctx.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.6);
      }
    },
  },

  spark: {
    blend: 'lighter',
    update(p, dt) {
      integrate(p, dt, PHYSICS.sparkGravity, PHYSICS.sparkDrag);
      p.alpha = 1 - progress(p);
    },
    draw(ctx, p, dpr) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.size * (0.4 + p.alpha * 0.6);
      ctx.beginPath();
      ctx.moveTo(p.x - p.vx * PHYSICS.sparkTrail, p.y - p.vy * PHYSICS.sparkTrail);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    },
  },

  flash: {
    blend: 'lighter',
    update(p) { p.alpha = 1 - progress(p); },
    draw(ctx, p, dpr) {
      const r = p.size * (0.6 + progress(p) * 0.8);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      g.addColorStop(0, p.color);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, TAU);
      ctx.fill();
    },
  },

  ring: {
    blend: 'lighter',
    update(p) { p.alpha = 1 - progress(p); },
    draw(ctx, p, dpr) {
      const t = progress(p);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 1 + 5 * (1 - t);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.2 + 0.8 * Math.sqrt(t)), 0, TAU);
      ctx.stroke();
    },
  },

  dot: {
    blend: 'source-over',
    update(p, dt) {
      integrate(p, dt, p.gravity ?? PHYSICS.gravity * 0.3, p.drag ?? 2.5);
      p.alpha = fadeAlpha(p, p.ttl * 0.6);
    },
    draw(ctx, p, dpr) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, TAU);
      ctx.fill();
    },
  },

  drop: {
    blend: 'source-over',
    update(p, dt, env) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.y >= p.floor) {
        p.age = p.ttl; // Tropfen stirbt, Spritzer entstehen
        for (let i = 0; i < 2; i++) {
          env.spawn('dot', {
            x: p.x, y: p.floor, vx: (env.random() - 0.5) * 160, vy: -80 - env.random() * 90,
            size: 1.6, ttl: 0.35, color: PALETTE.rain, gravity: PHYSICS.gravity * 0.6, drag: 0,
          });
        }
      }
    },
    draw(ctx, p, dpr) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.strokeStyle = PALETTE.rain;
      ctx.lineWidth = p.size;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - PHYSICS.dropLength);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    },
  },

  cloud: {
    blend: 'source-over',
    update(p) {
      const fadeIn = Math.min(1, p.age / RAIN.fade);
      p.alpha = Math.min(fadeIn, fadeAlpha(p, RAIN.fade));
    },
    draw(ctx, p, dpr) {
      const bob = Math.sin(p.age * 2.2) * 4;
      ctx.setTransform(dpr, 0, 0, dpr, dpr * p.x, dpr * (p.y + bob));
      const w = p.size;
      const g = ctx.createLinearGradient(0, -w * 0.3, 0, w * 0.2);
      g.addColorStop(0, PALETTE.cloud[0]);
      g.addColorStop(1, PALETTE.cloud[1]);
      ctx.fillStyle = g;
      ctx.beginPath();
      for (const [cx, cy, r] of CLOUD_PUFFS) {
        ctx.moveTo(cx * w + r * w, cy * w);
        ctx.arc(cx * w, cy * w, r * w, 0, TAU);
      }
      // flache Unterseite
      ctx.rect(-CLOUD_BASE.half * w, CLOUD_BASE.top * w, CLOUD_BASE.half * 2 * w, CLOUD_BASE.height * w);
      ctx.fill();
      // Glanz oben
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      ctx.ellipse(0.04 * w, -0.2 * w, 0.18 * w, 0.07 * w, -0.15, 0, TAU);
      ctx.fill();
    },
  },
};

/** Wolke als Kreise (relativ zur Wolkenbreite). */
const CLOUD_PUFFS = Object.freeze([
  [-0.32, 0.05, 0.14], [-0.14, -0.06, 0.2], [0.08, -0.12, 0.24], [0.3, 0.0, 0.16],
]);
const CLOUD_BASE = Object.freeze({ half: 0.32, top: 0.0, height: 0.19 });

/* ------------------------------------------------------------------ */
/* 4. Spawner (rein)                                                   */
/* ------------------------------------------------------------------ */

const range = (random, [a, b]) => a + random() * (b - a);
const pick = (random, list) => list[Math.floor(random() * list.length)];

function confettiPiece(random, x, y, angle, speed) {
  const [color, color2] = pick(random, PALETTE.confetti);
  return {
    type: 'confetti', x, y,
    vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
    rot: random() * TAU, vr: (random() - 0.5) * 12,
    phase: random() * TAU, spin: 6 + random() * 10,
    size: range(random, CONFETTI.size), round: random() < 0.25,
    color, color2, ttl: range(random, CONFETTI.ttl),
  };
}

/**
 * Konfetti: mit x/y als Explosion an einem Punkt, sonst aus zwei Kanonen unten links/rechts.
 * @returns {object[]} Partikel-Startwerte
 */
export function confettiSpawn({ x, y, count = CONFETTI.count } = {}, view, random = Math.random) {
  const out = [];
  const n = Math.max(0, Math.floor(count));
  for (let i = 0; i < n; i++) {
    const speed = range(random, CONFETTI.cannonSpeed);
    if (x !== undefined && y !== undefined) {
      const angle = -Math.PI / 2 + (random() - 0.5) * Math.PI * 1.1;
      out.push(confettiPiece(random, x, y, angle, speed * 0.75));
    } else {
      const fromLeft = i % 2 === 0;
      const base = fromLeft ? -Math.PI / 2 + 0.42 : -Math.PI / 2 - 0.42;
      const angle = base + (random() - 0.5) * CONFETTI.spread;
      out.push(confettiPiece(random, fromLeft ? 0 : view.w, view.h, angle, speed * Math.min(1.2, view.h / 760 + 0.35)));
    }
  }
  return out;
}

export function sparksSpawn(x, y, { color } = {}, random = Math.random) {
  const out = [{ type: 'flash', x, y, size: 90, ttl: 0.18, color: 'rgba(255,245,210,0.9)' }];
  for (let i = 0; i < SPARKS.count; i++) {
    const a = random() * TAU;
    const v = range(random, SPARKS.speed);
    out.push({
      type: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      size: range(random, SPARKS.width), ttl: range(random, SPARKS.ttl),
      color: color ?? pick(random, PALETTE.spark),
    });
  }
  return out;
}

export function burstSpawn(x, y, { color = PALETTE.burst } = {}, random = Math.random) {
  const out = [{ type: 'ring', x, y, size: BURST.ring, ttl: BURST.ttl, color }];
  for (let i = 0; i < BURST.dots; i++) {
    const a = (i / BURST.dots) * TAU + random() * 0.3;
    const v = range(random, BURST.speed);
    out.push({ type: 'dot', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, size: 2.5, ttl: BURST.ttl, color, gravity: 0, drag: 4 });
  }
  return out;
}

/** Regen-Emitter: Wolke + Tropfen mit fester Rate, solange `duration` läuft. */
export function createRainEmitter({ duration = RAIN.duration, x, y, width } = {}, view, random = Math.random) {
  const w = width ?? Math.min(view.w * 0.6, RAIN.cloudWidth);
  const cx = x ?? view.w / 2;
  const cy = y ?? view.h * RAIN.cloudTop;
  const secs = duration / 1000;
  let elapsed = 0;
  let debt = 0;
  return {
    cloud: { type: 'cloud', x: cx, y: cy, size: w, ttl: secs + RAIN.fade },
    /** @returns {boolean} noch aktiv */
    update(dt, env) {
      elapsed += dt;
      if (elapsed > secs) return false;
      debt += RAIN.rate * dt;
      while (debt >= 1) {
        debt -= 1;
        env.spawn('drop', {
          x: cx + (random() - 0.5) * w * 0.7, y: cy + w * 0.12,
          vx: -20, vy: PHYSICS.dropSpeed * (0.85 + random() * 0.3),
          size: 1.6 + random(), ttl: 5, floor: cy + view.h * RAIN.fallHeight,
        });
      }
      return true;
    },
  };
}

/** Keyframes für einen abklingenden Screen-Shake. */
export function shakeKeyframes(intensity = 1, random = Math.random, steps = 9) {
  const amp = 9 * Math.max(0, intensity);
  const frames = [{ transform: 'translate(0px, 0px) rotate(0deg)' }];
  for (let i = 1; i < steps; i++) {
    const decay = 1 - i / steps;
    const dx = (random() - 0.5) * 2 * amp * decay;
    const dy = (random() - 0.5) * 2 * amp * decay;
    const rot = (random() - 0.5) * 1.2 * intensity * decay;
    frames.push({ transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) rotate(${rot.toFixed(2)}deg)` });
  }
  frames.push({ transform: 'translate(0px, 0px) rotate(0deg)' });
  return frames;
}
export const SHAKE_MS = 380;

/** Keyframes für ein hochschwebendes Emoji (reduziert: nur ein- und ausblenden). */
export function emojiKeyframes(random = Math.random, reduced = false) {
  if (reduced) {
    return [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.75 }, { opacity: 0 }];
  }
  const sway = 14 + random() * 14;
  const dir = random() < 0.5 ? -1 : 1;
  const rise = 38 + random() * 14; // vh
  return [
    { transform: 'translate(0, 0) scale(.3) rotate(0deg)', opacity: 0 },
    { transform: `translate(${dir * sway * 0.3}px, -4vh) scale(1.25) rotate(${dir * -8}deg)`, opacity: 1, offset: 0.12 },
    { transform: `translate(${dir * -sway}px, -${rise * 0.4}vh) scale(1) rotate(${dir * 10}deg)`, offset: 0.4 },
    { transform: `translate(${dir * sway}px, -${rise * 0.7}vh) scale(1) rotate(${dir * -8}deg)`, opacity: 0.9, offset: 0.7 },
    { transform: `translate(0, -${rise}vh) scale(.9) rotate(0deg)`, opacity: 0 },
  ];
}
export const EMOJI_MS = 2600;

/* ------------------------------------------------------------------ */
/* 5. Engine                                                           */
/* ------------------------------------------------------------------ */

/**
 * Partikelsystem ohne DOM-Abhängigkeit (Tests nutzen es direkt).
 * `step(dt)` bewegt alles, `draw(ctx, dpr)` zeichnet, `busy` sagt, ob die Schleife laufen muss.
 */
export function createParticleSystem({ max = FX_LIMITS.maxParticles, random = Math.random } = {}) {
  const pool = new ParticlePool(max);
  const emitters = [];
  const env = {
    random,
    spawn(type, props) {
      if (!PARTICLE_TYPES[type]) throw new Error(`Unbekannter Partikel-Typ: ${type}`);
      return pool.acquire({ ...props, type });
    },
  };
  return {
    pool,
    env,
    get busy() { return pool.size > 0 || emitters.length > 0; },
    add(list) { for (const p of list) env.spawn(p.type, p); },
    addEmitter(em) { emitters.push(em); },
    step(dt) {
      for (let i = emitters.length - 1; i >= 0; i--) if (!emitters[i].update(dt, env)) emitters.splice(i, 1);
      for (const p of pool.active) {
        p.age += dt;
        PARTICLE_TYPES[p.type].update(p, dt, env);
      }
      pool.sweep((p) => p.age >= p.ttl);
    },
    draw(ctx, dpr) {
      for (const p of pool.active) {
        const type = PARTICLE_TYPES[p.type];
        ctx.globalCompositeOperation = type.blend;
        ctx.globalAlpha = p.alpha;
        type.draw(ctx, p, dpr);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    },
    clear() { pool.clear(); emitters.length = 0; },
  };
}

const state = {
  canvas: null,
  ctx: null,
  dpr: 1,
  view: { w: 0, h: 0 },
  system: createParticleSystem(),
  raf: 0,
  last: 0,
  reducedFlag: false,
};

function prefersReducedMotion() {
  try {
    return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}

/** true, wenn Effekte reduziert werden sollen (Schalter oder Systemeinstellung). */
export const isReducedFx = () => state.reducedFlag || prefersReducedMotion();

function resize() {
  if (!state.canvas) return;
  state.dpr = Math.min(FX_LIMITS.maxDpr, globalThis.devicePixelRatio || 1);
  state.view = { w: globalThis.innerWidth, h: globalThis.innerHeight };
  state.canvas.width = Math.round(state.view.w * state.dpr);
  state.canvas.height = Math.round(state.view.h * state.dpr);
}

function frame(now) {
  const { ctx, system, canvas } = state;
  const dt = Math.min(FX_LIMITS.maxDt, Math.max(0, (now - state.last) / 1000));
  state.last = now;
  system.step(dt);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  system.draw(ctx, state.dpr);
  state.raf = system.busy ? requestAnimationFrame(frame) : 0;
}

function ensureRunning() {
  if (state.raf || !state.ctx) return;
  state.last = performance.now();
  state.raf = requestAnimationFrame(frame);
}

/** Spawnt nur, wenn Canvas bereit und Effekte nicht reduziert sind. */
function emit(build) {
  if (!state.ctx || isReducedFx()) return;
  state.system.add(build());
  ensureRunning();
}

/* ------------------------------------------------------------------ */
/* 6. Öffentliche API                                                  */
/* ------------------------------------------------------------------ */

/** Vollbild-Canvas registrieren (position: fixed; pointer-events: none – siehe .fx-canvas). */
export function initFx(canvas) {
  const ctx = canvas?.getContext?.('2d');
  if (!ctx) return;
  state.canvas = canvas;
  state.ctx = ctx;
  canvas.classList?.add('fx-canvas');
  canvas.setAttribute?.('aria-hidden', 'true');
  resize();
  globalThis.addEventListener?.('resize', resize, { passive: true });
}

export function confetti(opts = {}) {
  emit(() => confettiSpawn(opts, state.view));
}

export function sparks(x, y, opts = {}) {
  emit(() => sparksSpawn(x, y, opts));
}

export function burst(x, y, opts = {}) {
  emit(() => burstSpawn(x, y, opts));
}

/** Regenwolke (Erweiterung: optional x, y, width der Wolke). */
export function rain(opts = {}) {
  emit(() => {
    const em = createRainEmitter(opts, state.view);
    state.system.addEmitter(em);
    return [em.cloud];
  });
}

/** Kurzes Wackeln eines Elements (Standard: body; besser den Arena-Container übergeben). */
export function screenShake(el = globalThis.document?.body, intensity = 1) {
  if (!el?.animate || isReducedFx()) return;
  const opts = { duration: SHAKE_MS, easing: 'linear', composite: 'add' };
  try {
    el.animate(shakeKeyframes(intensity), opts);
  } catch {
    el.animate(shakeKeyframes(intensity), { duration: SHAKE_MS });
  }
}

let emojiLayer = null;
function getEmojiLayer() {
  if (!emojiLayer?.isConnected) {
    emojiLayer = document.createElement('div');
    emojiLayer.className = 'fx-emoji-layer';
    emojiLayer.setAttribute('aria-hidden', 'true');
    document.body.append(emojiLayer);
  }
  return emojiLayer;
}

/** Emoji schwebt hoch (DOM). x/y in Viewport-Pixeln; Standard: Bildmitte, unteres Drittel. */
export function floatEmoji(emoji, { x, y } = {}) {
  if (!globalThis.document?.body) return;
  const layer = getEmojiLayer();
  while (layer.childElementCount >= FX_LIMITS.maxEmojis) layer.firstElementChild.remove();
  const el = document.createElement('span');
  el.className = 'fx-emoji';
  el.textContent = String(emoji);
  el.style.left = `${x ?? globalThis.innerWidth * (0.4 + Math.random() * 0.2)}px`;
  el.style.top = `${y ?? globalThis.innerHeight * 0.72}px`;
  layer.append(el);
  const remove = () => el.remove();
  if (typeof el.animate !== 'function') {
    setTimeout(remove, EMOJI_MS);
    return;
  }
  const anim = el.animate(emojiKeyframes(Math.random, isReducedFx()), {
    duration: EMOJI_MS, easing: 'cubic-bezier(.2,.6,.35,1)', fill: 'forwards',
  });
  anim.finished.then(remove, remove);
}

/** Alle Partikel + Emitter weg, rAF-Schleife stoppen, Canvas leeren. */
function clearParticles() {
  if (state.raf) globalThis.cancelAnimationFrame?.(state.raf);
  state.raf = 0;
  state.system.clear();
  if (state.ctx) {
    state.ctx.setTransform(1, 0, 0, 1, 0, 0);
    state.ctx.clearRect(0, 0, state.canvas.width, state.canvas.height);
  }
}

/**
 * Sofort alles beenden: Partikel, Regenwolke, schwebende Emojis; rAF-Schleife stoppt.
 * Für Screenwechsel gedacht. Neue Effekte funktionieren danach ganz normal.
 */
export function clear() {
  clearParticles();
  emojiLayer?.replaceChildren();
}

/**
 * Reduziert: keine Partikel, kein Shake; Emojis nur ein-/ausblenden.
 * Synchronisiert data-reduced-fx: an → "1", aus → Attribut entfernt.
 */
export function setReducedFx(on) {
  state.reducedFlag = Boolean(on);
  const root = globalThis.document?.documentElement;
  if (root?.dataset) {
    if (state.reducedFlag) root.dataset.reducedFx = '1';
    else delete root.dataset.reducedFx;
  }
  if (state.reducedFlag) clearParticles();
}
