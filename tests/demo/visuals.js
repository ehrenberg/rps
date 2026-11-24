// Demo für hands.js, fx.js, audio.js – nur Entwicklung, nicht in public/.
import { MOVES, MOVE_NAMES, outcome } from '../../public/assets/js/rules.js';
import { createHand, handIcon, HAND_FORMS } from '../../public/assets/js/hands.js';
import * as fx from '../../public/assets/js/fx.js';
import * as audio from '../../public/assets/js/audio.js';

const $ = (sel) => document.querySelector(sel);

function button(label, onClick, icon) {
  const b = document.createElement('button');
  if (icon) b.append(icon);
  b.append(document.createTextNode(label));
  b.addEventListener('click', () => {
    audio.unlock();
    onClick(b);
  });
  return b;
}

const centerOf = (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

// ---------- Arena ----------
const left = createHand({ side: 'left' });
const right = createHand({ side: 'right' });
$('#slot-left').append(left.el);
$('#slot-right').append(right.el);
let selected = 'rock';

async function playRound() {
  const cpu = MOVES[Math.floor(Math.random() * 3)];
  left.setMove('fist', { pop: false });
  right.setMove('fist', { pop: false });
  audio.play('countdown');
  await Promise.all([
    left.shake(3, 500, { onBeat: () => audio.play('shake') }),
    right.shake(3, 500),
  ]);
  left.setMove(selected);
  right.setMove(cpu);
  audio.play('clash');
  const c = centerOf($('#arena'));
  fx.sparks(c.x, c.y);
  fx.screenShake($('#arena'), 1);
  const o = outcome(selected, cpu);
  setTimeout(() => {
    if (o === 1) { left.setState('win'); right.setState('lose'); audio.play('win'); fx.burst(c.x - 120, c.y - 60); }
    else if (o === -1) { left.setState('lose'); right.setState('win'); audio.play('lose'); }
    else { left.setState('draw'); right.setState('draw'); audio.play('draw'); }
  }, 250);
}

const actions = {
  round: playRound,
  shake: () => Promise.all([left.shake(3, 500, { onBeat: () => audio.play('shake') }), right.shake()]),
  win: () => { left.setState('win'); right.setState('lose'); },
  lose: () => { left.setState('lose'); right.setState('win'); },
  draw: () => { left.setState('draw'); right.setState('draw'); },
  idle: () => { left.setState('idle'); right.setState('idle'); },
  enter: () => { left.enter(); right.enter(); },
};
for (const b of document.querySelectorAll('#arena-controls button')) {
  b.addEventListener('click', () => { audio.unlock(); actions[b.dataset.act](); });
}
for (const form of HAND_FORMS) {
  $('#move-buttons').append(button(form === 'fist' ? 'Faust' : MOVE_NAMES[form], () => {
    if (form !== 'fist') selected = form;
    left.setMove(form);
    right.setMove(form);
    audio.play('pop');
  }, handIcon(form)));
}

// ---------- Galerie ----------
for (const form of HAND_FORMS) {
  const fig = document.createElement('figure');
  const pair = document.createElement('div');
  pair.className = 'pair';
  for (const side of ['left', 'right']) {
    const h = createHand({ side });
    h.setMove(form, { pop: false });
    pair.append(h.el);
  }
  const cap = document.createElement('figcaption');
  cap.textContent = form === 'fist' ? 'Faust' : MOVE_NAMES[form];
  fig.append(pair, cap);
  $('#gallery').append(fig);
}

// ---------- Icons ----------
for (const form of HAND_FORMS) {
  $('#icons').append(handIcon(form));
  $('#icons-small').append(handIcon(form));
}

// ---------- Effekte ----------
fx.initFx($('#fx'));
const effects = {
  'Konfetti': () => fx.confetti(),
  'Konfetti (Punkt)': () => { const c = centerOf($('#arena')); fx.confetti({ x: c.x, y: c.y }); },
  'Funken': () => { const c = centerOf($('#arena')); fx.sparks(c.x, c.y); },
  'Regen': () => fx.rain(),
  'Burst': () => { const c = centerOf($('#arena')); fx.burst(c.x, c.y, { color: '#ffd84a' }); },
  'Screen-Shake': () => fx.screenShake($('#stage'), 1.5),
};
for (const [label, fn] of Object.entries(effects)) $('#fx-buttons').append(button(label, fn));
for (const e of ['👍', '😂', '😱', '🔥', '😭', '🤝', '👏', '😈']) {
  $('#emoji-buttons').append(button(e, (b) => { fx.floatEmoji(e, { x: centerOf(b).x }); audio.play('pop'); }));
}

// FPS-Messung (rAF-Zähler)
let frames = 0;
let last = performance.now();
(function count(now) {
  frames++;
  if (now - last >= 1000) {
    $('#fps').textContent = String(Math.round((frames * 1000) / (now - last)));
    window.__fps = frames;
    frames = 0;
    last = now;
  }
  requestAnimationFrame(count);
})(last);

// ---------- Sounds ----------
for (const name of audio.SOUND_NAMES ?? []) $('#sound-buttons').append(button(name, () => audio.play(name)));

// ---------- Schalter ----------
$('#reduced').addEventListener('change', (e) => {
  document.documentElement.dataset.reducedFx = e.target.checked ? '1' : '0';
  fx.setReducedFx(e.target.checked);
});
$('#sound').checked = audio.isEnabled();
$('#sound').addEventListener('change', (e) => audio.setEnabled(e.target.checked));
