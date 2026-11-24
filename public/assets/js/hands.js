// Hände als SVG-Illustrationen + Animationen (Schütteln, Pop, Sieg/Niederlage).
// Vertrag: docs/SCHNITTSTELLEN.md. Styles: assets/css/fx.css.
//
// Aufbau:
//   1. Geometrie-Helfer (rein, testbar)
//   2. HAND_SHAPES – jede Handform als Daten (Teile-Liste), keine Zeichen-Logik
//   3. Renderer: Teile → virtueller Baum ({ tag, attrs, children }) → DOM
//   4. Animations-Rezepte (Keyframes als Daten) + Taktberechnung fürs Schütteln
//   5. Öffentliche API: createHand(), handIcon()

import { MOVES } from './rules.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/* ------------------------------------------------------------------ */
/* Konstanten                                                          */
/* ------------------------------------------------------------------ */

/** Zeichenfläche der großen Hand. Handgelenk bei x ≈ 125, Mittellinie y = 130. */
export const HAND_VIEWBOX = Object.freeze({ x: 0, y: 0, w: 400, h: 260 });

/** Quadratischer Ausschnitt für Icons (ohne Ärmel). */
const ICON_VIEWBOX_DEFAULT = Object.freeze({ x: 96, y: 6, w: 250, h: 250 });
const ICON_VIEWBOX = Object.freeze({
  spock: Object.freeze({ x: 84, y: -6, w: 250, h: 250 }),
});

/** Alle darstellbaren Formen: Spielzüge + neutrale Faust zum Schütteln. */
export const HAND_FORMS = Object.freeze(['fist', ...MOVES]);

const STROKE = Object.freeze({ hand: 5, icon: 7, crease: 2.6 });

/** CSS-Variablen mit Rückfallwerten, damit Hände auch ohne App-CSS gut aussehen. */
const COLOR = Object.freeze({
  skin: 'var(--hand-skin, #f8c8a0)',
  skinShade: 'var(--hand-skin-shade, #d98a5f)',
  outline: 'var(--hand-outline, #2a1633)',
  accent: { left: 'var(--accent-left, #3ad1ff)', right: 'var(--accent-right, #ff5d8f)' },
  iconAccent: 'var(--icon-accent, var(--accent-left, #3ad1ff))',
  mouth: '#5b1630',
  tongue: '#ff7aa2',
  eyeWhite: '#ffffff',
  pupil: '#1b0f24',
});

/** Glanzlicht auf Fingern: Lage/Größe relativ zum Fingerradius. */
const HIGHLIGHT = Object.freeze({ from: 0.18, to: 0.8, offset: 0.48, radius: 0.27, opacity: 0.42 });
/** Länge einer Fingerfalte relativ zum Radius. */
const CREASE_SPAN = 0.55;

/* ------------------------------------------------------------------ */
/* 1. Geometrie                                                        */
/* ------------------------------------------------------------------ */

const fmt = (n) => Math.round(n * 100) / 100;

/**
 * Pfad einer (verjüngten) Kapsel von Punkt a (Radius r1) zu Punkt b (Radius r2).
 * Grundbaustein für Finger und Daumen.
 */
export function capsulePath([x1, y1], [x2, y2], r1, r2 = r1) {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const nx = -(y2 - y1) / len;
  const ny = (x2 - x1) / len;
  const p = (x, y, r, s) => `${fmt(x + nx * r * s)} ${fmt(y + ny * r * s)}`;
  return (
    `M${p(x1, y1, r1, 1)} L${p(x2, y2, r2, 1)} ` +
    `A${fmt(r2)} ${fmt(r2)} 0 0 0 ${p(x2, y2, r2, -1)} ` +
    `L${p(x1, y1, r1, -1)} A${fmt(r1)} ${fmt(r1)} 0 0 0 ${p(x1, y1, r1, 1)} Z`
  );
}

/** Punkt auf der Strecke a→b bei t (0..1). */
export const lerpPoint = ([x1, y1], [x2, y2], t) => [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];

/** Einheitsnormale der Strecke a→b, die auf dem Bildschirm nach oben zeigt. */
export function upNormal([x1, y1], [x2, y2]) {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const n = [-(y2 - y1) / len, (x2 - x1) / len];
  return n[1] > 0 ? [-n[0], -n[1]] : n;
}

/* ------------------------------------------------------------------ */
/* 2. Handformen als Daten                                             */
/* ------------------------------------------------------------------ */
// Teil-Typen:
//   finger  { from, to, r: [rBasis, rSpitze], creases?: [t…], nail?: bool }
//   skin    { d }                 – Hautfläche mit Kontur (Handfläche, Handrücken)
//   line    { d, opacity? }       – Falte/Detail-Linie
//   fill    { d, color }          – Fläche ohne Verlauf (Maul, Zunge)
//   eye     { at, r }
//   gloss   { d }                 – freies Glanzlicht
//   group   { rotate: [deg, cx, cy], parts }
// Jedes Teil (auch eine Gruppe als Ganzes) kann `front: true` tragen → wird vor dem Ärmel gezeichnet.

/** Eingerollter Finger (Faust), von der Handfläche aus gesehen. */
const curled = (y, x1, x2, r, creaseAt = 0.72) => ({
  type: 'finger', from: [x1, y], to: [x2, y], r: [r, r], creases: [creaseAt],
});

/** Ausgestreckter Finger mit zwei Gelenkfalten. */
const straight = (from, to, r) => ({ type: 'finger', from, to, r, creases: [0.42, 0.7] });

/** Daumen: Wurzel liegt in der Manschette (x ≈ 120) und verschwindet dort sauber. */
const thumb = (from, to, extra = {}) => ({ type: 'finger', from, to, r: [21, 15], nail: true, ...extra });

/** Gebeugter Daumen aus zwei Gliedern (Wurzel → Gelenk → Spitze), z. B. über der Faust. */
const bentThumb = (root, joint, tip) => [
  { type: 'finger', from: root, to: joint, r: [21, 17] },
  { type: 'finger', from: joint, to: tip, r: [17, 14.5], nail: true },
];

const FIST_PALM = 'M118 100 C150 84 196 76 224 80 C248 84 252 112 250 132 L248 172 ' +
  'C244 196 214 202 188 200 C158 198 134 192 118 178 Z';

const FIST_SHAPE = [
  { type: 'skin', d: FIST_PALM },
  curled(184, 194, 252, 14),     // kleiner Finger (hinten → zuerst)
  curled(156, 192, 264, 16),
  curled(125, 194, 270, 16.5),
  curled(93, 196, 266, 16),      // Zeigefinger
  { type: 'line', d: 'M146 172 C164 182 182 186 194 186', opacity: 0.35 },
  ...bentThumb([122, 104], [198, 106], [240, 128]),
];

const PAPER_PALM = 'M118 100 C150 88 196 84 228 88 C244 100 248 150 236 184 C206 196 152 192 118 172 Z';

export const HAND_SHAPES = Object.freeze({
  fist: FIST_SHAPE,
  rock: FIST_SHAPE, // „rock“ ist die kraftvolle Faust

  paper: [
    straight([206, 176], [298, 196], [13.5, 11.5]),
    straight([212, 152], [328, 162], [15.5, 13]),
    straight([214, 126], [340, 120], [16, 13.5]),
    straight([210, 101], [322, 78], [15.5, 13]),
    { type: 'skin', d: PAPER_PALM },
    { type: 'line', d: 'M160 152 C182 142 204 142 224 148', opacity: 0.35 },
    { type: 'line', d: 'M150 126 C172 118 196 118 216 122', opacity: 0.3 },
    thumb([126, 108], [240, 56], { creases: [0.62] }),
  ],

  scissors: [
    { type: 'skin', d: FIST_PALM },
    curled(184, 194, 252, 14),
    curled(156, 192, 264, 16),
    straight([206, 126], [342, 142], [16, 13.5]),
    straight([204, 98], [334, 60], [15.5, 13]),
    ...bentThumb([124, 136], [196, 140], [236, 160]),
  ],

  lizard: [
    // Maul-Innenraum hinter den Kiefern
    { type: 'fill', d: 'M196 140 C240 124 290 120 326 118 C318 142 300 160 284 166 C252 166 220 160 196 150 Z', color: COLOR.mouth },
    { type: 'fill', d: 'M232 150 C262 146 300 142 336 150 C346 144 352 150 344 156 C352 158 350 166 340 162 C302 162 266 160 232 158 Z', color: COLOR.tongue },
    // Unterkiefer = Daumen
    { type: 'finger', from: [124, 168], to: [292, 168], r: [21, 14], creases: [0.6] },
    // Oberkiefer = Handrücken + geschlossene Finger
    { type: 'skin', d: 'M116 96 C142 78 178 62 214 62 C260 62 306 76 334 96 C350 106 350 124 334 128 ' +
      'C300 130 262 132 230 138 C200 144 170 152 150 160 C136 156 124 148 116 140 Z' },
    { type: 'line', d: 'M300 112 C312 116 324 118 336 118', opacity: 0.45 },
    { type: 'line', d: 'M292 98 C306 104 318 106 330 106', opacity: 0.3 },
    { type: 'gloss', d: 'M168 80 C196 68 236 66 270 74 C240 74 204 78 176 90 Z' },
    { type: 'fill', d: 'M318 100 a3 2.4 0 1 0 0.1 0 Z', color: COLOR.outline },
    { type: 'eye', at: [236, 82], r: 15 },
  ],

  // Vulkanischer Gruß: Zeige+Mittelfinger | Lücke | Ring+kleiner Finger, Daumen abgespreizt.
  spock: [
    {
      type: 'group', rotate: [12, 200, 170], parts: [
        straight([246, 124], [268, 50], [13.5, 11.5]),
        straight([220, 114], [242, 20], [15.5, 13]),
        straight([186, 112], [176, 14], [16, 13.5]),
        straight([158, 118], [146, 26], [15.5, 13]),
        { type: 'skin', d: 'M140 130 C146 112 168 104 202 104 C232 104 256 108 260 126 C264 152 262 178 250 192 ' +
          'C218 200 168 198 140 186 Z' },
        { type: 'line', d: 'M203 110 L203 128', opacity: 0.4 },
        { type: 'line', d: 'M166 152 C186 146 212 146 238 152', opacity: 0.3 },
      ],
    },
    { type: 'finger', from: [178, 178], to: [120, 128], r: [20, 14.5], creases: [0.6], nail: true, front: true },
  ],
});

/** Ärmel + Manschette (Akzentfarbe). Liegt über dem Handgelenk. */
const SLEEVE = Object.freeze({
  sleeve: 'M-6 78 L104 84 C110 84 112 90 112 96 L112 168 C112 174 110 180 104 180 L-6 186 Z',
  /** Ärmel blendet zum Bildrand hin aus (Arm kommt „von außen“). */
  fade: Object.freeze({ from: 0, to: 46 }),
  folds: ['M24 98 C40 110 46 126 40 146', 'M64 160 C72 150 80 146 92 146'],
  cuff: 'M98 74 C98 68 104 66 110 66 L128 68 C134 68 138 74 138 80 L138 182 C138 188 134 192 128 192 ' +
    'L110 194 C104 194 98 190 98 186 Z',
  cuffStripe: 'M106 72 L106 190',
});

/* ------------------------------------------------------------------ */
/* 3. Renderer                                                         */
/* ------------------------------------------------------------------ */

const v = (tag, attrs = {}, children = []) => ({ tag, attrs, children });

/** Gradienten je Instanz (eindeutige IDs, da mehrere Hände gleichzeitig existieren). */
function defsTree(ids) {
  const stop = (offset, color, opacity = 1) =>
    v('stop', { offset, style: `stop-color:${color};stop-opacity:${opacity}` });
  return v('defs', {}, [
    v('linearGradient', { id: ids.skin, x1: '0', y1: '0', x2: '0', y2: '1' }, [
      stop('0', COLOR.skin), stop('0.55', COLOR.skin), stop('1', COLOR.skinShade),
    ]),
    v('radialGradient', { id: ids.palm, cx: '0.42', cy: '0.32', r: '0.75' }, [
      stop('0', COLOR.skin), stop('0.6', COLOR.skin), stop('1', COLOR.skinShade),
    ]),
    v('linearGradient', { id: ids.cloth, x1: '0', y1: '0', x2: '0', y2: '1' }, [
      stop('0', '#ffffff', 0.38), stop('0.45', '#ffffff', 0), stop('1', '#000000', 0.38),
    ]),
    v('linearGradient', { id: ids.fadeGrad, gradientUnits: 'userSpaceOnUse', x1: SLEEVE.fade.from, x2: SLEEVE.fade.to, y1: 0, y2: 0 }, [
      stop('0', '#fff', 0), stop('1', '#fff', 1),
    ]),
    v('mask', { id: ids.fade, maskUnits: 'userSpaceOnUse', x: -20, y: 0, width: HAND_VIEWBOX.w + 40, height: HAND_VIEWBOX.h }, [
      v('rect', { x: -20, y: 0, width: HAND_VIEWBOX.w + 40, height: HAND_VIEWBOX.h, fill: `url(#${ids.fadeGrad})` }),
    ]),
  ]);
}

const skinStyle = (ids, stroke, grad = ids.skin) =>
  `fill:url(#${grad});stroke:${COLOR.outline};stroke-width:${stroke};stroke-linejoin:round`;

function fingerTree(part, ctx) {
  const { from, to, r: [r1, r2] } = part;
  const nodes = [v('path', { d: capsulePath(from, to, r1, r2), style: skinStyle(ctx.ids, ctx.stroke) })];
  const up = upNormal(from, to);
  const shift = (p, r, k) => [p[0] + up[0] * r * k, p[1] + up[1] * r * k];

  // Glanzlicht entlang der Oberseite
  const a = shift(lerpPoint(from, to, HIGHLIGHT.from), r1, HIGHLIGHT.offset);
  const b = shift(lerpPoint(from, to, HIGHLIGHT.to), r2, HIGHLIGHT.offset);
  nodes.push(v('path', {
    d: capsulePath(a, b, r1 * HIGHLIGHT.radius, r2 * HIGHLIGHT.radius),
    style: `fill:#fff;opacity:${HIGHLIGHT.opacity}`,
  }));

  for (const t of part.creases ?? []) {
    const c = lerpPoint(from, to, t);
    const r = r1 + (r2 - r1) * t;
    const p1 = shift(c, r, CREASE_SPAN);
    const p2 = shift(c, r, -CREASE_SPAN);
    const dir = [(to[0] - from[0]) * 0.03, (to[1] - from[1]) * 0.03];
    nodes.push(v('path', {
      d: `M${fmt(p1[0])} ${fmt(p1[1])} Q${fmt(c[0] + dir[0])} ${fmt(c[1] + dir[1])} ${fmt(p2[0])} ${fmt(p2[1])}`,
      style: lineStyle(ctx, 0.4),
    }));
  }

  if (part.nail) {
    const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const nailFrom = lerpPoint(from, to, 1 - (r2 * 1.5) / len);
    const n = shift(nailFrom, r2, 0.1);
    const tip = shift(to, r2, 0.1);
    nodes.push(v('path', {
      d: capsulePath(n, tip, r2 * 0.55),
      style: `fill:#fff;fill-opacity:0.55;stroke:${COLOR.outline};stroke-opacity:0.35;stroke-width:${STROKE.crease}`,
    }));
  }
  return v('g', {}, nodes);
}

const lineStyle = (ctx, opacity) =>
  `fill:none;stroke:${COLOR.outline};stroke-width:${ctx.stroke === STROKE.icon ? STROKE.crease * 1.3 : STROKE.crease};` +
  `stroke-linecap:round;opacity:${opacity}`;

function eyeTree({ at: [x, y], r }, ctx) {
  return v('g', { class: 'hand-eye' }, [
    v('circle', { cx: x, cy: y, r, style: `fill:${COLOR.eyeWhite};stroke:${COLOR.outline};stroke-width:${ctx.stroke}` }),
    v('circle', { cx: fmt(x + r * 0.22), cy: fmt(y + r * 0.08), r: fmt(r * 0.5), style: `fill:${COLOR.pupil}` }),
    v('circle', { cx: fmt(x + r * 0.38), cy: fmt(y - r * 0.12), r: fmt(r * 0.17), style: 'fill:#fff' }),
    // Augenlid für einen frechen Blick
    v('path', {
      d: `M${fmt(x - r * 1.05)} ${fmt(y - r * 0.2)} Q${x} ${fmt(y - r * 1.25)} ${fmt(x + r * 1.05)} ${fmt(y - r * 0.2)}`,
      style: lineStyle(ctx, 0.8),
    }),
  ]);
}

/** Wandelt ein Teil (Daten) in einen virtuellen SVG-Knoten. */
const PART_RENDERERS = {
  finger: fingerTree,
  skin: (part, ctx) => v('path', { d: part.d, style: skinStyle(ctx.ids, ctx.stroke, ctx.ids.palm) }),
  line: (part, ctx) => v('path', { d: part.d, style: lineStyle(ctx, part.opacity ?? 0.4) }),
  fill: (part, ctx) => v('path', {
    d: part.d, style: `fill:${part.color};stroke:${COLOR.outline};stroke-width:${ctx.stroke};stroke-linejoin:round`,
  }),
  gloss: (part) => v('path', { d: part.d, style: 'fill:#fff;opacity:0.35' }),
  eye: eyeTree,
  group: (part, ctx) => v('g', { transform: `rotate(${part.rotate.join(' ')})` }, renderParts(part.parts, ctx)),
};

function renderParts(parts, ctx) {
  return parts.filter((part) => Boolean(part.front) === ctx.front).map((part) => {
    const render = PART_RENDERERS[part.type];
    if (!render) throw new Error(`Unbekannter Handteil-Typ: ${part.type}`);
    return render(part, ctx);
  });
}

function sleeveTree(ids, stroke, side, { cuffOnly = false } = {}) {
  const outline = `stroke:${COLOR.outline};stroke-width:${stroke};stroke-linejoin:round`;
  const accent = `fill:${cuffOnly ? COLOR.iconAccent : COLOR.accent[side]}`;
  const arm = cuffOnly ? [] : [
    v('path', { d: SLEEVE.sleeve, style: `${accent};${outline}` }),
    v('path', { d: SLEEVE.sleeve, style: `fill:url(#${ids.cloth})` }),
    ...SLEEVE.folds.map((d) => v('path', { d, style: lineStyle({ stroke }, 0.3) })),
  ];
  return v('g', { class: 'hand-sleeve', mask: cuffOnly ? undefined : `url(#${ids.fade})` }, [
    ...arm,
    v('path', { d: SLEEVE.cuff, style: `${accent};${outline}` }),
    v('path', { d: SLEEVE.cuff, style: 'fill:#fff;opacity:0.22' }),
    v('path', { d: SLEEVE.cuff, style: `fill:url(#${ids.cloth})` }),
    v('path', { d: SLEEVE.cuffStripe, style: 'fill:none;stroke:#fff;stroke-width:4;opacity:0.45;stroke-linecap:round' }),
  ]);
}

/** Schlüssel für Instanz-IDs (Präfix pro Instanz, damit url(#…) eindeutig bleibt). */
export function gradientIds(uid) {
  return { skin: `${uid}-skin`, palm: `${uid}-palm`, cloth: `${uid}-cloth`, fade: `${uid}-fade`, fadeGrad: `${uid}-fadegrad` };
}

/**
 * Virtueller Baum der Formgruppe (ohne <svg>/<defs>).
 * @param {string} form  'fist' | Zug
 * @param {{ ids, stroke }} ctx
 */
export function shapeTree(form, ctx, layer = 'back') {
  const parts = HAND_SHAPES[form];
  if (!parts) throw new Error(`Unbekannte Handform: ${form}`);
  const front = layer === 'front';
  return v('g', { class: `hand-shape hand-shape--${layer}`, 'data-form': form }, renderParts(parts, { ...ctx, front }));
}

/** Kompletter virtueller SVG-Baum einer Hand bzw. eines Icons (Icon: nur Manschette, kein Ärmel). */
export function handTree(form, { uid, side = 'left', icon = false }) {
  const ids = gradientIds(uid);
  const ctx = { ids, stroke: icon ? STROKE.icon : STROKE.hand };
  const box = icon ? (ICON_VIEWBOX[form] ?? ICON_VIEWBOX_DEFAULT) : HAND_VIEWBOX;
  const body = v('g', { class: 'hand-body' }, [
    shapeTree(form, ctx, 'back'),
    sleeveTree(ids, ctx.stroke, side, { cuffOnly: icon }),
    shapeTree(form, ctx, 'front'),
  ]);
  return v('svg', {
    viewBox: `${box.x} ${box.y} ${box.w} ${box.h}`,
    class: icon ? 'hand-icon' : 'hand-svg',
    'aria-hidden': 'true',
    focusable: 'false',
    preserveAspectRatio: 'xMidYMid meet',
  }, [defsTree(ids), body]);
}

/** Virtueller Baum → echte SVG-Elemente. */
export function toDom(node, doc = document) {
  const el = doc.createElementNS(SVG_NS, node.tag);
  for (const [k, val] of Object.entries(node.attrs)) if (val !== undefined) el.setAttribute(k, String(val));
  for (const child of node.children) el.appendChild(toDom(child, doc));
  return el;
}

let uidCounter = 0;
const nextUid = (prefix) => `rps-${prefix}${++uidCounter}`;

/* ------------------------------------------------------------------ */
/* 4. Animations-Rezepte                                               */
/* ------------------------------------------------------------------ */

/** Posen fürs Schütteln (Rotation um den Ellbogen links außerhalb). */
export const SHAKE_POSE = Object.freeze({
  rest: 'translateY(0) rotate(0deg)',
  up: 'translateY(-7%) rotate(-11deg)',
  hit: 'translateY(1.5%) rotate(2.5deg)',
});
/** Anteil eines Takts, nach dem die Hand oben ist. */
export const SHAKE_PEAK = 0.48;
const EASE_RISE = 'cubic-bezier(.22,.8,.35,1)';
const EASE_FALL = 'cubic-bezier(.6,0,.9,.45)';
const SETTLE_MS = 260;

/**
 * Taktberechnung fürs Schütteln. Physikalisch wie beim echten Spiel:
 * Hand hebt sich, schlägt am Ende jedes Takts nach unten.
 * Aufschlag k (0-basiert) bei (k + 1) · beatMs; der letzte Aufschlag = Ende = Aufdecken.
 */
export function shakeTimeline(beats = 3, beatMs = 500) {
  const n = Math.max(1, Math.floor(beats));
  const ms = Math.max(1, beatMs);
  const keyframes = [{ offset: 0, transform: SHAKE_POSE.rest, easing: EASE_RISE }];
  const hitTimes = [];
  for (let i = 0; i < n; i++) {
    keyframes.push({ offset: (i + SHAKE_PEAK) / n, transform: SHAKE_POSE.up, easing: EASE_FALL });
    keyframes.push({ offset: (i + 1) / n, transform: SHAKE_POSE.hit, easing: EASE_RISE });
    hitTimes.push((i + 1) * ms);
  }
  return { duration: n * ms, hitTimes, keyframes };
}

/** Nachfedern nach dem letzten Aufschlag. */
const SETTLE = Object.freeze({
  keyframes: [
    { transform: SHAKE_POSE.hit },
    { transform: 'translateY(-1.2%) rotate(-1deg)', offset: 0.55 },
    { transform: SHAKE_POSE.rest },
  ],
  options: { duration: SETTLE_MS, easing: 'ease-out' },
});

/** Pop beim Formwechsel (Scale-Overshoot). */
export const POP = Object.freeze({
  keyframes: [
    { transform: 'scale(.62) rotate(-6deg)', opacity: 0.6 },
    { transform: 'scale(1.16) rotate(2deg)', opacity: 1, offset: 0.42 },
    { transform: 'scale(.95) rotate(-1deg)', offset: 0.7 },
    { transform: 'scale(1.02)', offset: 0.86 },
    { transform: 'scale(1)' },
  ],
  options: { duration: 420, easing: 'ease-out' },
});

/** Einblenden von der Seite. */
const ENTER = Object.freeze({
  keyframes: [
    { transform: 'translateX(-70%) rotate(-8deg)', opacity: 0 },
    { transform: 'translateX(4%) rotate(1deg)', opacity: 1, offset: 0.75 },
    { transform: 'translateX(0) rotate(0)' },
  ],
  options: { duration: 520, easing: 'cubic-bezier(.2,.8,.3,1)' },
});

/** Zustände nach dem Aufdecken. `cls` steuert CSS (Glühen, Entsättigung). */
export const STATES = Object.freeze({
  idle: { cls: null, keyframes: null },
  win: {
    cls: 'hand--win',
    keyframes: [
      { transform: SHAKE_POSE.rest },
      { transform: 'translateY(-9%) rotate(-4deg)', offset: 0.25, easing: 'ease-in' },
      { transform: SHAKE_POSE.rest, offset: 0.5, easing: 'ease-out' },
      { transform: 'translateY(-5%) rotate(-2deg)', offset: 0.72, easing: 'ease-in' },
      { transform: SHAKE_POSE.rest },
    ],
    options: { duration: 900, easing: 'ease-out' },
  },
  lose: {
    cls: 'hand--lose',
    keyframes: [
      { transform: SHAKE_POSE.rest },
      { transform: 'translateY(8%) rotate(9deg)', offset: 0.7 },
      { transform: 'translateY(7%) rotate(8deg)' },
    ],
    options: { duration: 700, easing: 'cubic-bezier(.3,.1,.3,1)', fill: 'forwards' },
  },
  draw: {
    cls: 'hand--draw',
    keyframes: [
      { transform: 'rotate(0deg)' },
      { transform: 'rotate(-4deg)', offset: 0.25 },
      { transform: 'rotate(3deg)', offset: 0.55 },
      { transform: 'rotate(-1deg)', offset: 0.8 },
      { transform: 'rotate(0deg)' },
    ],
    options: { duration: 600, easing: 'ease-in-out' },
  },
});

/** Reduzierte Effekte: App-Schalter oder Systemeinstellung. */
export function isReducedMotion(doc = globalThis.document, win = globalThis) {
  if (doc?.documentElement?.dataset?.reducedFx === '1') return true;
  try {
    return Boolean(win.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* 5. Öffentliche API                                                  */
/* ------------------------------------------------------------------ */

function div(cls) {
  const el = document.createElement('div');
  el.className = cls;
  return el;
}

/**
 * Große Hand für die Arena.
 * Aufbau: div.hand > div.hand__flip (Spiegelung rechts) > div.hand__rig (Schütteln/Zustand)
 *         > div.hand__pop (Pop) > [div.hand__glow, svg.hand-svg]
 */
export function createHand({ side = 'left' } = {}) {
  const s = side === 'right' ? 'right' : 'left';
  const uid = nextUid('hand');
  const el = div(`hand hand--${s}`);
  const flip = div('hand__flip');
  const rig = div('hand__rig');
  const pop = div('hand__pop');
  const glow = div('hand__glow');
  const tree = handTree('fist', { uid, side: s });
  const svg = toDom(tree);
  pop.append(glow, svg);
  rig.append(pop);
  flip.append(rig);
  el.append(flip);
  el.dataset.move = 'fist';

  const ctx = { ids: gradientIds(uid), stroke: STROKE.hand };
  const body = svg.querySelector('.hand-body');
  const layers = { back: body.querySelector('.hand-shape--back'), front: body.querySelector('.hand-shape--front') };
  let shakeAnim = null;
  let shakeDone = null;
  let timers = [];
  let stateAnim = null;

  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };
  const animate = (target, { keyframes, options }) =>
    (typeof target.animate === 'function' ? target.animate(keyframes, options) : null);

  function setMove(move, { pop: withPop = true } = {}) {
    const form = HAND_SHAPES[move] ? move : 'fist';
    for (const layer of Object.keys(layers)) {
      const next = toDom(shapeTree(form, ctx, layer));
      body.replaceChild(next, layers[layer]);
      layers[layer] = next;
    }
    el.dataset.move = form;
    if (withPop && !isReducedMotion()) animate(pop, POP);
  }

  function stopShake() {
    clearTimers();
    shakeAnim?.cancel();
    shakeAnim = null;
    shakeDone?.();
    shakeDone = null;
  }

  /**
   * Faust schüttelt im Takt. Aufschläge bei beatMs, 2·beatMs, …; resolved beim letzten.
   * Erweiterung: { onBeat(i) } wird exakt bei jedem Aufschlag aufgerufen (für Sound/Wörter).
   */
  function shake(beats = 3, beatMs = 500, { onBeat } = {}) {
    stopShake();
    setState('idle');
    const tl = shakeTimeline(beats, beatMs);
    return new Promise((resolve) => {
      shakeDone = resolve;
      tl.hitTimes.forEach((t, i) => {
        timers.push(setTimeout(() => {
          try { onBeat?.(i); } catch (err) { console.error(err); }
          if (i === tl.hitTimes.length - 1) {
            shakeDone = null;
            shakeAnim = null;
            if (!isReducedMotion()) animate(rig, SETTLE);
            resolve();
          }
        }, t));
      });
      if (!isReducedMotion()) {
        shakeAnim = animate(rig, { keyframes: tl.keyframes, options: { duration: tl.duration, fill: 'forwards' } });
      }
    });
  }

  function setState(state) {
    const spec = STATES[state] ?? STATES.idle;
    stateAnim?.cancel();
    stateAnim = null;
    for (const { cls } of Object.values(STATES)) if (cls) el.classList.remove(cls);
    if (spec.cls) el.classList.add(spec.cls);
    el.dataset.state = STATES[state] ? state : 'idle';
    if (spec.keyframes && !isReducedMotion()) stateAnim = animate(rig, spec);
  }

  /** Erweiterung: Hand gleitet von ihrer Seite ins Bild. */
  function enter() {
    if (isReducedMotion()) return Promise.resolve();
    const anim = animate(rig, ENTER);
    return anim ? anim.finished.catch(() => {}) : Promise.resolve();
  }

  /**
   * Erweiterung: alles anhalten (Screenwechsel). Shake-Timer und Animationen werden abgebrochen,
   * ein offenes shake-Promise resolved sofort, onBeat wird danach nie mehr aufgerufen.
   */
  function stop() {
    stopShake();
    stateAnim?.cancel();
    stateAnim = null;
  }

  return { el, setMove, shake, setState, enter, stop };
}

/** Kleines Icon im gleichen Stil (quadratische viewBox, ohne Ärmel). */
export function handIcon(move) {
  const form = HAND_SHAPES[move] ? move : 'fist';
  const svg = toDom(handTree(form, { uid: nextUid('icon'), icon: true }));
  svg.dataset.move = form;
  return svg;
}
