// Browser-Test für hands.js / fx.js / audio.js über die Demo-Seite tests/demo/visuals.html.
//
// Start:
//   php -S localhost:8003 -t .                       # Repo-Wurzel ausliefern
//   PLAYWRIGHT_MODULE=/pfad/zu/node_modules/playwright/index.mjs \
//   BASE_URL=http://localhost:8003 SHOT_DIR=/tmp/shots node tests/e2e/visuals.e2e.mjs
// Optional: CHROMIUM=/usr/bin/chromium (eigene Browser-Binary).
// Playwright gehört nicht ins Repo; Modulpfad per PLAYWRIGHT_MODULE (Standard: 'playwright').

import assert from 'node:assert/strict';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const BASE = process.env.BASE_URL ?? 'http://localhost:8003';
const SHOTS = process.env.SHOT_DIR ?? null;
const URL = `${BASE}/tests/demo/visuals.html`;
const FORMS = ['fist', 'rock', 'paper', 'scissors', 'lizard', 'spock'];

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push(`✔ ${name}`);
  } catch (err) {
    results.push(`✘ ${name}: ${err.message}`);
    process.exitCode = 1;
  }
}

async function openPage(viewport, { reducedMotion = 'no-preference' } = {}) {
  const page = await browser.newPage({ viewport, reducedMotion });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('requestfailed', (r) => errors.push(`request failed: ${r.url()}`));
  await page.goto(URL);
  await page.waitForTimeout(300);
  return { page, errors };
}

const { page, errors } = await openPage({ width: 1200, height: 900 });

await check('keine Konsolenfehler beim Laden', () => assert.deepEqual(errors, []));

await check('keine externen Requests', async () => {
  const { hosts, own } = await page.evaluate(() => ({
    hosts: performance.getEntriesByType('resource').map((r) => new URL(r.name).host),
    own: location.host,
  }));
  assert.ok(hosts.every((h) => h === own), hosts.join(', '));
});

await check('alle Hände (links/rechts) und Icons als SVG ohne Emoji/Text', async () => {
  const info = await page.evaluate(() => ({
    hands: document.querySelectorAll('#gallery .hand svg.hand-svg').length,
    icons: document.querySelectorAll('#icons svg.hand-icon').length,
    text: document.querySelectorAll('.hand svg text, .hand-icon text').length,
    rightFlipped: getComputedStyle(document.querySelector('#gallery .hand--right .hand__flip')).transform,
  }));
  assert.equal(info.hands, FORMS.length * 2);
  assert.equal(info.icons, FORMS.length);
  assert.equal(info.text, 0);
  assert.match(info.rightFlipped, /^matrix\(-1/);
});

await check('Gradient-IDs sind seitenweit eindeutig und alle Verweise auflösbar', async () => {
  const r = await page.evaluate(() => {
    const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
    const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
    const refs = [...document.querySelectorAll('[style*="url(#"], [mask]')]
      .flatMap((e) => [...(e.getAttribute('style') + ' ' + (e.getAttribute('mask') ?? '')).matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]));
    const missing = refs.filter((id) => !document.getElementById(id));
    return { dup, missing };
  });
  assert.deepEqual(r.dup, []);
  assert.deepEqual(r.missing, []);
});

await check('shake: Aufschläge im Takt (±40 ms), resolved nach beats·beatMs', async () => {
  const r = await page.evaluate(async () => {
    const { createHand } = await import('../../public/assets/js/hands.js');
    const h = createHand({ side: 'left' });
    document.body.append(h.el);
    const t0 = performance.now();
    const beats = [];
    await h.shake(3, 300, { onBeat: () => beats.push(performance.now() - t0) });
    const total = performance.now() - t0;
    h.el.remove();
    return { beats, total };
  });
  [300, 600, 900].forEach((t, i) => assert.ok(Math.abs(r.beats[i] - t) < 40, `Takt ${i}: ${r.beats[i]}`));
  assert.ok(Math.abs(r.total - 900) < 40, `gesamt ${r.total}`);
});

await check('Runde spielen: Form wechselt, Zustände gesetzt', async () => {
  await page.click('[data-act="round"]');
  await page.waitForTimeout(2000);
  const st = await page.evaluate(() => [...document.querySelectorAll('#arena .hand')].map((h) => [h.dataset.move, h.dataset.state]));
  assert.ok(st.every(([m]) => m !== 'fist'), JSON.stringify(st));
  assert.ok(st.every(([, s]) => ['win', 'lose', 'draw'].includes(s)), JSON.stringify(st));
  if (SHOTS) await page.locator('#arena').screenshot({ path: `${SHOTS}/arena-after-round.png` });
});

await check('Konfetti: ≥ 50 fps im Schnitt, Schleife stoppt danach', async () => {
  const r = await page.evaluate(async () => {
    const fx = await import('../../public/assets/js/fx.js');
    fx.confetti();
    fx.confetti({ x: innerWidth / 2, y: innerHeight / 2 });
    let frames = 0;
    const t0 = performance.now();
    await new Promise((res) => {
      const f = () => { frames++; if (performance.now() - t0 < 1500) requestAnimationFrame(f); else res(); };
      requestAnimationFrame(f);
    });
    const fps = (frames * 1000) / (performance.now() - t0);
    await new Promise((res) => setTimeout(res, 3500));
    const c = document.getElementById('fx');
    const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let painted = 0;
    for (let i = 3; i < px.length; i += 4 * 97) if (px[i]) painted++;
    return { fps, painted };
  });
  results.push(`  ↳ Konfetti-FPS: ${r.fps.toFixed(1)}`);
  assert.ok(r.fps >= 50, `fps ${r.fps}`);
  assert.equal(r.painted, 0, 'Canvas nach Ende leer');
});

await check('Effekte: Funken/Regen/Burst/Shake ohne Fehler', async () => {
  for (const label of ['Funken', 'Regen', 'Burst', 'Screen-Shake']) await page.getByRole('button', { name: label, exact: true }).click();
  await page.waitForTimeout(500);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/effects.png` });
  assert.deepEqual(errors, []);
});

await check('floatEmoji: per textContent, entfernt sich selbst', async () => {
  const r = await page.evaluate(async () => {
    const fx = await import('../../public/assets/js/fx.js');
    fx.floatEmoji('<b>x</b>', { x: 100 });
    const el = document.querySelector('.fx-emoji-layer').lastElementChild;
    const html = el.innerHTML;
    await new Promise((res) => setTimeout(res, 3000));
    return { html, left: document.querySelectorAll('.fx-emoji').length };
  });
  assert.equal(r.html, '&lt;b&gt;x&lt;/b&gt;');
  assert.equal(r.left, 0);
});

await check('Sounds: alle abspielbar ohne Fehler', async () => {
  await page.click('#sound-buttons button'); // Nutzeraktion → unlock
  const n = await page.evaluate(async () => {
    const audio = await import('../../public/assets/js/audio.js');
    for (const name of audio.SOUND_NAMES) audio.play(name);
    return audio.SOUND_NAMES.length;
  });
  assert.equal(n, 12);
  assert.deepEqual(errors, []);
});

await page.close();

// Reduzierte Bewegung (Systemeinstellung) + Handy-Breite
const mobile = await openPage({ width: 375, height: 800 }, { reducedMotion: 'reduce' });
await check('375 px: kein horizontales Scrollen, Hände sichtbar', async () => {
  const r = await mobile.page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - innerWidth,
    w: document.querySelector('#arena .hand').getBoundingClientRect().width,
  }));
  assert.ok(r.overflow <= 0, `overflow ${r.overflow}`);
  assert.ok(r.w > 100);
  if (SHOTS) await mobile.page.screenshot({ path: `${SHOTS}/mobile.png`, fullPage: false });
});
await check('reduziert: keine Partikel, keine Hand-Animationen, Ablauf gleich', async () => {
  const r = await mobile.page.evaluate(async () => {
    const fx = await import('../../public/assets/js/fx.js');
    const { createHand } = await import('../../public/assets/js/hands.js');
    fx.confetti();
    const h = createHand();
    document.body.append(h.el);
    const t0 = performance.now();
    await h.shake(2, 200);
    const dt = performance.now() - t0;
    h.setMove('paper');
    h.setState('win');
    // Bewegung = WAAPI- oder CSS-Keyframe-Animation; reine Überblendungen (Transitions) sind erlaubt.
    const anims = h.el.getAnimations({ subtree: true }).filter((a) => !(a instanceof CSSTransition)).length;
    const c = document.getElementById('fx');
    const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    return { dt, anims, painted: px.some((v, i) => i % 4 === 3 && v) };
  });
  assert.ok(Math.abs(r.dt - 400) < 40, `dt ${r.dt}`);
  assert.equal(r.anims, 0);
  assert.equal(r.painted, false);
});
await check('375 px: keine Konsolenfehler', () => assert.deepEqual(mobile.errors, []));

await browser.close();
console.log(results.join('\n'));
