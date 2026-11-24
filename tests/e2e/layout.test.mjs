// E2E Layout: Handy quer ohne Scrollen spielbar, kein horizontaler Überlauf ab 320 px,
// Reaktionsleiste ohne Einzelgänger-Umbruch, Meldungen verdecken die Leiste nicht, Namensfeld grapheme-sicher.
// Braucht den laufenden Server (npm run up). Basis-URL: RPS_BASE_URL.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_URL, MOBILE, launchBrowser, openPage, startCpuMatch, playUntilOver, createRoom, joinRoom,
} from './helpers.mjs';

const LANDSCAPE = [
  { width: 812, height: 375 },
  { width: 740, height: 360 },
  { width: 667, height: 375 },
];
const NARROW = [
  { width: 360, height: 640 },
  { width: 320, height: 568 },
];
const MIN_TARGET_PX = 44;
const WAIT_MS = 20_000;

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const label = (vp) => `${vp.width}×${vp.height}`;

/** Bounding-Boxen (ohne Scrollen, Seite steht oben) und Seitenmaße. */
function boxes(page, selector) {
  return page.evaluate((sel) => {
    window.scrollTo(0, 0);
    return [...document.querySelectorAll(sel)].map((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
    });
  }, selector);
}

function assertInViewport(list, vp, what) {
  assert.ok(list.length > 0, `${what}: nichts gefunden`);
  for (const [i, b] of list.entries()) {
    const ok = b.top >= 0 && b.left >= 0 && b.bottom <= vp.height + 0.5 && b.right <= vp.width + 0.5;
    assert.ok(ok, `${what} #${i + 1} bei ${label(vp)} nicht vollständig sichtbar: ${JSON.stringify(b)}`);
  }
}

async function assertNoHorizontalOverflow(page, where) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  assert.ok(sw <= iw, `${where}: horizontaler Überlauf (${sw} > ${iw})`);
}

for (const vp of LANDSCAPE) {
  for (const variant of ['classic', 'lizard']) {
    test(`Querformat ${label(vp)} ${variant}: alle Zugknöpfe ohne Scrollen sichtbar, kein Überlauf`, async () => {
      const { page, context, problems } = await openPage(browser, vp);
      await startCpuMatch(page, { level: 1, variant, bestOf: 3 });
      assertInViewport(await boxes(page, '.move-btn'), vp, 'Zugknopf');
      await assertNoHorizontalOverflow(page, `Arena ${label(vp)}`);

      // Nach einer Runde (Ergebnis + Fairness-Chip) weiterhin alles im Bild
      await page.click('.move-btn[data-move="rock"]');
      await page.waitForSelector('.result__sentence', { timeout: WAIT_MS });
      await page.waitForSelector('.move-btn[aria-disabled="false"], .overlay', { timeout: WAIT_MS });
      if (!(await page.$('.overlay'))) {
        assertInViewport(await boxes(page, '.move-btn'), vp, 'Zugknopf nach Runde 1');
        assertInViewport(await boxes(page, '.result__sentence'), vp, 'Ergebnis-Satz');
      }

      if (variant === 'classic') {
        await playUntilOver(page, () => 'rock');
        await page.waitForSelector('.overlay__actions');
        assertInViewport(await boxes(page, '.overlay__actions .btn'), vp, 'Matchende-Knopf');
        await assertNoHorizontalOverflow(page, `Matchende ${label(vp)}`);
      }
      assert.deepEqual(problems, []);
      await context.close();
    });
  }
}

test('Querformat online 812×375: Zugknöpfe und Reaktionsleiste ohne Scrollen sichtbar', async () => {
  const vp = LANDSCAPE[0];
  const A = await openPage(browser, vp);
  const B = await openPage(browser, MOBILE);
  const code = await createRoom(A.page, 'duel', 'Anna');
  await joinRoom(B.page, code, 'Ben');
  await A.page.waitForSelector('.reactions:not([hidden])', { timeout: WAIT_MS });
  assertInViewport(await boxes(A.page, '.move-btn'), vp, 'Zugknopf');
  assertInViewport(await boxes(A.page, '.reactions__btn'), vp, 'Reaktion');
  await assertNoHorizontalOverflow(A.page, 'Online-Arena quer');
  assert.deepEqual(A.problems, []);
  await A.context.close();
  await B.context.close();
});

for (const vp of NARROW) {
  test(`Hochformat ${label(vp)}: kein horizontaler Überlauf auf den Haupt-Screens`, async () => {
    const { page, context, problems } = await openPage(browser, vp);
    for (const hash of ['#/', '#/cpu', '#/duel', '#/tournament', '#/stats', '#/settings']) {
      await page.goto(`${BASE_URL}/${hash}`);
      await page.waitForSelector('.screen');
      await assertNoHorizontalOverflow(page, `${hash} bei ${label(vp)}`);
    }
    await startCpuMatch(page, { level: 1, variant: 'lizard', bestOf: 3 });
    await assertNoHorizontalOverflow(page, `Arena bei ${label(vp)}`);
    assert.deepEqual(problems, []);
    await context.close();
  });
}

for (const vp of [MOBILE, ...NARROW]) {
  test(`Reaktionsleiste ${label(vp)}: kein einzelner Umbruch, Touch-Ziele ≥ 44 px, Meldung verdeckt sie nicht`, async () => {
    const A = await openPage(browser, vp);
    const B = await openPage(browser, MOBILE);
    const code = await createRoom(A.page, 'duel', 'Anna');
    await joinRoom(B.page, code, 'Ben');
    await A.page.waitForSelector('.reactions:not([hidden])', { timeout: WAIT_MS });
    await assertNoHorizontalOverflow(A.page, `Online-Arena ${label(vp)}`);

    const btns = await boxes(A.page, '.reactions__btn');
    const rows = new Map();
    for (const b of btns) {
      assert.ok(b.width >= MIN_TARGET_PX && b.height >= MIN_TARGET_PX, `Reaktion zu klein: ${b.width}×${b.height}`);
      const key = Math.round(b.top);
      rows.set(key, (rows.get(key) ?? 0) + 1);
    }
    const counts = [...rows.values()];
    assert.ok(counts.length <= 2 && counts.every((n) => n === counts[0]), `Reaktionen ungleich verteilt: ${counts}`);

    // Meldung einblenden: darf die Leiste nicht überdecken
    await A.page.evaluate(async () => {
      const m = await import('./assets/js/ui/toast.js');
      m.showToast('Ein etwas längerer Hinweis, der zwei Zeilen braucht.', { duration: 0 });
    });
    await A.page.waitForSelector('.toast');
    const [toast] = await boxes(A.page, '.toast');
    const bar = await boxes(A.page, '.reactions');
    const overlaps = bar.some((r) => toast.left < r.right && toast.right > r.left && toast.top < r.bottom && toast.bottom > r.top);
    assert.ok(!overlaps, `Meldung verdeckt die Reaktionsleiste bei ${label(vp)}`);
    assert.deepEqual(A.problems, []);
    await A.context.close();
    await B.context.close();
  });
}

test('Namensfeld: kürzt grapheme-sicher, zerschneidet keine Emoji', async () => {
  const { page, context, problems } = await openPage(browser, MOBILE, '#/duel');
  const flag = '🏳️‍🌈';
  await page.fill('#duel-name', `${'x'.repeat(19)}${flag}${flag}`);
  assert.equal(await page.inputValue('#duel-name'), `${'x'.repeat(19)}${flag}`);
  assert.equal(await page.evaluate(() => localStorage.getItem('rps.name')), `${'x'.repeat(19)}${flag}`);
  assert.equal(await page.getAttribute('#duel-name', 'maxlength'), null);
  await page.fill('#duel-name', `‮Anna‬ ${flag}`);
  assert.equal(await page.evaluate(() => localStorage.getItem('rps.name')), `Anna ${flag}`);
  assert.deepEqual(problems, []);
  await context.close();
});
