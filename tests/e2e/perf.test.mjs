// Perf-Smoke-Test: „Mittelklasse-Handy“ = 375×812, DPR 3, CPU 4× gedrosselt (CDP).
// Budgets bewusst mit Abstand zu den Messwerten (siehe Kommentare), damit der Test stabil bleibt.
// Start: Server laufen lassen, dann RPS_BASE_URL=… node --test tests/e2e/perf.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BASE_URL, launchBrowser } from './helpers.mjs';

const CPU_THROTTLE = 4;
const BUDGET = Object.freeze({
  startRequests: 25,       // gemessen: 20 (HTML, 2× CSS, 2 Fonts, 15 Module)
  startKb: 300,            // gemessen: ~110 KB (alle Screens zusammen: ~171 KB)
  longTaskMs: 200,         // gemessen: max. ~75 ms
  frameP95Ms: 34,          // 2 Frames bei 60 Hz; gemessen: 16,7 ms
  // Startseite im Leerlauf; gemessen ~0,2 %. Headless-Chromium lässt Aurora-Animationen sporadisch
  // einige Sekunden auf dem Hauptthread laufen (~8 %). Eine dauerhafte rAF-Schleife kostet ~30 %.
  idleCpuPct: 15,
  pollLayouts: 2,          // Layouts in 4 s Polling ohne Änderung; gemessen: 0
});

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

/** Kontext mit Handy-Emulation, CPU-Drossel, Long-Task-Observer und rAF-Sampler. */
async function phone({ noPrefetch = false } = {}) {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  });
  // Vorladen der übrigen Screens im Leerlauf abschalten, damit nur die Startseite gezählt wird.
  if (noPrefetch) await context.addInitScript(() => { window.requestIdleCallback = () => 0; });
  await context.addInitScript(() => {
    window.__perf = { longTasks: [], frames: [], sampling: false };
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__perf.longTasks.push(Math.round(e.duration));
      }).observe({ type: 'longtask', buffered: true });
    } catch { /* ohne Long-Task-API */ }
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Network.enable');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });
  const problems = [];
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
  return { context, page, cdp, problems };
}

async function metrics(cdp) {
  const { metrics: list } = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(list.map((m) => [m.name, m.value]));
}

/** Misst rAF-Abstände während fn(); liefert p95 und Long Tasks im Zeitraum. */
async function sampleFrames(page, fn) {
  await page.evaluate(() => {
    const p = window.__perf;
    p.frames = []; p.longTasks = []; p.sampling = true;
    let last = 0;
    const tick = (t) => {
      if (last) p.frames.push(t - last);
      last = t;
      if (p.sampling) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await fn();
  const { frames, longTasks } = await page.evaluate(() => {
    window.__perf.sampling = false;
    return { frames: window.__perf.frames, longTasks: window.__perf.longTasks };
  });
  const sorted = [...frames].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  return { n: frames.length, p95, longTasks };
}

const maxOf = (list) => Math.max(0, ...list);

test('Startseite: Requests, Bytes, Long Tasks, Leerlauf-CPU', async () => {
  const { context, page, cdp, problems } = await phone({ noPrefetch: true });
  let bytes = 0;
  let requests = 0;
  cdp.on('Network.requestWillBeSent', () => { requests++; });
  cdp.on('Network.loadingFinished', (e) => { bytes += e.encodedDataLength; });
  await page.goto(`${BASE_URL}/#/`);
  await page.waitForSelector('.screen--home');
  await page.waitForTimeout(1000);
  const kb = bytes / 1024;
  assert.ok(requests < BUDGET.startRequests, `${requests} Requests für die Startseite (Budget < ${BUDGET.startRequests})`);
  assert.ok(kb < BUDGET.startKb, `${kb.toFixed(0)} KB übertragen (Budget < ${BUDGET.startKb})`);
  const longTasks = await page.evaluate(() => window.__perf.longTasks);
  assert.ok(maxOf(longTasks) < BUDGET.longTaskMs, `Long Tasks beim Laden: ${longTasks.join(', ')} ms`);

  // Leerlauf: Aurora + Logo laufen auf dem Compositor, Hauptthread bleibt ruhig.
  const a = await metrics(cdp);
  await page.waitForTimeout(3000);
  const b = await metrics(cdp);
  const idlePct = ((b.TaskDuration - a.TaskDuration) / 3) * 100;
  assert.ok(idlePct < BUDGET.idleCpuPct, `Leerlauf-CPU ${idlePct.toFixed(1)} % (Budget < ${BUDGET.idleCpuPct} %)`);
  assert.deepEqual(problems, []);
  await context.close();
});

test('Computer-Match: Countdown + Reveal + Funken + Shake, danach Konfetti und Regen', async () => {
  const { context, page, problems } = await phone();
  await page.goto(`${BASE_URL}/#/cpu`);
  await page.click('.btn--start');
  await page.waitForSelector('.move-btn[aria-disabled="false"]');
  await page.waitForTimeout(600);

  const reveal = await sampleFrames(page, async () => {
    await page.click('.move-btn[data-move="rock"]');
    await page.waitForSelector('.move-btn[aria-disabled="false"], .overlay', { timeout: 20_000 });
  });
  assert.ok(reveal.n > 60, `genug Frames gemessen (${reveal.n})`);
  assert.ok(reveal.p95 < BUDGET.frameP95Ms, `Reveal p95 ${reveal.p95.toFixed(1)} ms (Budget < ${BUDGET.frameP95Ms})`);
  assert.ok(maxOf(reveal.longTasks) < BUDGET.longTaskMs, `Long Tasks beim Reveal: ${reveal.longTasks.join(', ')} ms`);

  // Konfetti (Matchsieg) und Regen (Niederlage) über dieselbe fx.js-Instanz wie die App.
  for (const effect of ['confetti', 'rain']) {
    const r = await sampleFrames(page, async () => {
      await page.evaluate(async (name) => { (await import('./assets/js/fx.js'))[name](); }, effect);
      await page.waitForTimeout(2000);
    });
    assert.ok(r.p95 < BUDGET.frameP95Ms, `${effect} p95 ${r.p95.toFixed(1)} ms (Budget < ${BUDGET.frameP95Ms})`);
    assert.ok(maxOf(r.longTasks) < BUDGET.longTaskMs, `Long Tasks bei ${effect}: ${r.longTasks.join(', ')} ms`);
  }
  assert.deepEqual(problems, []);
  await context.close();
});

test('Turnierbaum mit 16 Spielern: Scrollen flüssig, Polling ohne Neu-Layout', async () => {
  const api = async (body) => (await fetch(`${BASE_URL}/api.php`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })).json();
  const host = await api({ action: 'create', type: 'tournament', name: 'Host' });
  for (let i = 1; i < 16; i++) await api({ action: 'join', code: host.code, name: `Spieler ${i}` });
  await api({ action: 'start', code: host.code, token: host.token });

  const { context, page, cdp, problems } = await phone();
  await page.goto(`${BASE_URL}/#${host.code}`);
  await page.fill('#invite-name', 'Zuschauer');
  await page.click('.btn--start');
  await page.waitForSelector('.bracket .bmatch');
  assert.equal(await page.$$eval('.bmatch', (els) => els.length), 15);
  await page.waitForTimeout(500);

  const box = await page.locator('.bracket').boundingBox();
  const scroll = await sampleFrames(page, async () => {
    await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 200));
    for (const [dx, dy] of [[60, 0], [-60, 0], [0, 80], [0, -80]]) {
      for (let i = 0; i < 10; i++) { await page.mouse.wheel(dx, dy); await page.waitForTimeout(16); }
    }
  });
  assert.ok(scroll.p95 < BUDGET.frameP95Ms, `Scroll p95 ${scroll.p95.toFixed(1)} ms (Budget < ${BUDGET.frameP95Ms})`);

  let polls = 0;
  page.on('request', (r) => { if (r.url().endsWith('/api.php')) polls++; });
  const a = await metrics(cdp);
  await page.waitForTimeout(4000);
  const b = await metrics(cdp);
  assert.ok(polls >= 2, `Polling läuft (${polls} Requests)`);
  const layouts = b.LayoutCount - a.LayoutCount;
  assert.ok(layouts <= BUDGET.pollLayouts, `${layouts} Layouts bei unverändertem Stand (Budget ≤ ${BUDGET.pollLayouts})`);
  assert.deepEqual(problems, []);
  await context.close();
});
