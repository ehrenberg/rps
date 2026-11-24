// E2E Barrierefreiheit: axe-core auf allen Haupt-Screens (WCAG 2.1 A/AA + Best Practices),
// Touch-Ziele ≥ 44 px bei 375 px Breite und ein CPU-Match nur mit der Tastatur.
// axe-core liegt NICHT im Repo: AXE_PATH=/pfad/zu/axe.min.js setzen, sonst werden die axe-Tests übersprungen.
//   npm i --prefix /tmp/a11y axe-core && AXE_PATH=/tmp/a11y/node_modules/axe-core/axe.min.js node --test tests/e2e/a11y.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import {
  BASE_URL, MOBILE, DESKTOP, launchBrowser, startCpuMatch, playUntilOver,
  createRoom, joinRoom, playOnlineMatch,
} from './helpers.mjs';

const AXE_PATH = process.env.AXE_PATH ?? '';
const SKIP_AXE = AXE_PATH && existsSync(AXE_PATH) ? false : 'AXE_PATH nicht gesetzt (axe-core wird nur im Test injiziert)';
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];
const MIN_TARGET_PX = 44;
const WAIT_MS = 20_000;
const MAX_TABS = 60;

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

/** Kontext mit reduzierter Bewegung: axe misst Kontraste sonst mitten in Einblend-Animationen. */
async function open(viewport, hash = '#/') {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce', bypassCSP: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(`${BASE_URL}/${hash}`);
  await page.waitForSelector('.screen');
  return { page, context, errors };
}

/** axe auf der aktuellen Seite; gibt lesbare Verstöße zurück. */
async function axe(page) {
  if (!(await page.evaluate(() => typeof window.axe === 'object'))) await page.addScriptTag({ path: AXE_PATH });
  const violations = await page.evaluate(async (tags) => {
    const res = await window.axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] });
    return res.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => `${n.target.join(' ')} – ${n.failureSummary?.split('\n')[1]?.trim() ?? ''}`) }));
  }, AXE_TAGS);
  return violations;
}

/** Gesammelte Befunde je Test; am Testende wird einmal geprüft (so sieht man alle auf einmal). */
let findings = [];
const AXE_COUNT = new Map();

async function expectClean(page, label) {
  const v = await axe(page);
  AXE_COUNT.set(label, v.reduce((n, x) => n + x.nodes.length, 0));
  for (const x of v) findings.push(`[${label}] ${x.id} (${x.impact}):\n    ${x.nodes.slice(0, 5).join('\n    ')}`);
}

/** Sichtbare Bedienelemente kleiner als 44×44 px. */
function smallTargets(page) {
  return page.evaluate((min) => {
    const sel = 'a[href], button, input, summary, [role="radio"], [tabindex="0"]';
    return [...document.querySelectorAll(sel)]
      .filter((el) => el.checkVisibility?.({ visibilityProperty: true }) ?? el.offsetParent !== null)
      .filter((el) => !el.closest('[inert], [hidden]'))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && (r.width < min - 0.5 || r.height < min - 0.5))
      .map(({ el, r }) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')} „${(el.getAttribute('aria-label') ?? el.textContent).trim().slice(0, 30)}“ ${Math.round(r.width)}×${Math.round(r.height)}`);
  }, MIN_TARGET_PX);
}

async function expectTargets(page, label) {
  for (const t of await smallTargets(page)) findings.push(`[${label}] Touch-Ziel < ${MIN_TARGET_PX} px: ${t}`);
}

/** Prüft axe + Touch-Ziele (nur mobil). */
async function check(page, label, viewport) {
  await expectClean(page, `${label} ${viewport === MOBILE ? 'mobil' : 'Desktop'}`);
  if (viewport === MOBILE) await expectTargets(page, label);
}

function assertNoFindings() {
  const list = findings;
  findings = [];
  assert.equal(list.length, 0, `Barrierefreiheits-Befunde:\n${[...new Set(list)].join('\n')}`);
}

after(() => {
  if (AXE_COUNT.size && process.env.A11Y_SUMMARY) {
    console.log('axe-Verstöße (Knoten) je Screen:');
    for (const [k, n] of AXE_COUNT) console.log(`  ${String(n).padStart(3)}  ${k}`);
  }
});

for (const viewport of [MOBILE, DESKTOP]) {
  const vp = viewport === MOBILE ? 'mobil' : 'Desktop';

  test(`axe: Einzelspieler-Screens ${vp}`, { skip: SKIP_AXE, timeout: 120_000 }, async () => {
    const { page, context, errors } = await open(viewport);
    await check(page, 'Start', viewport);

    for (const [hash, sel, label] of [
      ['#/cpu', '.screen--cpu', 'Computer-Setup'],
      ['#/settings', '.screen--settings', 'Einstellungen'],
      ['#/stats', '.screen--stats', 'Statistik leer'],
      ['#/duel', '.screen--create-duel', 'Duell erstellen'],
      ['#/tournament', '.screen--create-tournament', 'Turnier erstellen'],
    ]) {
      await page.goto(`${BASE_URL}/${hash}`);
      await page.waitForSelector(sel);
      await check(page, label, viewport);
    }

    // Toast: Duell ohne Namen erstellen
    await page.goto(`${BASE_URL}/#/duel`);
    await page.waitForSelector('.screen--create-duel');
    await page.fill('#duel-name', '');
    await page.click('.btn--start');
    await page.waitForSelector('.toast');
    await check(page, 'Toast', viewport);

    // Arena (Stufe 4 mit „Was denkt der Computer?“), mitten im Match und Matchende
    await startCpuMatch(page, { level: 4, variant: 'lizard', bestOf: 3 });
    await check(page, 'Arena CPU', viewport);
    await page.keyboard.press('1');
    await page.waitForSelector('.fair__summary', { timeout: WAIT_MS });
    await page.click('.fair__summary');
    await check(page, 'Arena CPU nach Runde', viewport);
    await playUntilOver(page, (i, moves) => moves[i % moves.length]);
    await check(page, 'Matchende', viewport);

    // Statistik mit Daten + Bestätigungsdialog
    await page.goto(`${BASE_URL}/#/stats`);
    await page.waitForSelector('.kpis');
    await check(page, 'Statistik', viewport);
    await page.click('.stats__footer .btn--danger');
    await page.waitForSelector('dialog[open]');
    await expectClean(page, `Bestätigungsdialog ${vp}`);
    await page.keyboard.press('Escape');
    await page.waitForSelector('dialog', { state: 'detached' });
    assert.ok(await page.$('.kpis'), 'Escape bricht ab, Statistik bleibt');

    // Fehlerseite: unbekannter Raum
    await page.goto(`${BASE_URL}/#zzzzzz`);
    await page.waitForSelector('.invite__badge--sad', { timeout: WAIT_MS });
    await check(page, 'Raum nicht gefunden', viewport);
    assert.deepEqual(errors, []);
    await context.close();
    assertNoFindings();
  });
}

test('axe: Online-Duell (Lobby, Einladung, Arena, Revanche)', { skip: SKIP_AXE, timeout: 120_000 }, async () => {
  const A = await open(MOBILE);
  const B = await open(DESKTOP);
  const code = await createRoom(A.page, 'duel', 'Anna');
  await check(A.page, 'Lobby Duell', MOBILE);
  await B.page.goto(`${BASE_URL}/#${code}`);
  await B.page.waitForSelector('#invite-name');
  await check(B.page, 'Einladung', DESKTOP);
  await B.page.fill('#invite-name', 'Ben');
  await B.page.click('.btn--start');
  await Promise.all([A, B].map((p) => p.page.waitForSelector('.move-btn[aria-disabled="false"]', { timeout: WAIT_MS })));
  await check(A.page, 'Arena online', MOBILE);
  await check(B.page, 'Arena online', DESKTOP);
  await playOnlineMatch(A.page, B.page, () => ['rock', 'scissors']);
  await check(A.page, 'Matchende online', MOBILE);
  await A.context.close();
  await B.context.close();
  assertNoFindings();
});

test('axe: Meine Spiele (leer, Liste, Toast mit Badge, Startseite)', { skip: SKIP_AXE, timeout: 120_000 }, async () => {
  for (const viewport of [MOBILE, DESKTOP]) {
    const A = await open(viewport, '#/games');
    await A.page.waitForSelector('.games-empty:not([hidden])');
    await check(A.page, 'Meine Spiele leer', viewport);
    const code = await createRoom(A.page, 'duel', 'Anna');
    await A.page.goto(`${BASE_URL}/#/settings`);
    await A.page.waitForSelector('.screen--settings');
    const B = await open(viewport);
    await joinRoom(B.page, code, 'Ben');
    await A.page.waitForSelector('.toast--action', { timeout: WAIT_MS });
    await A.page.waitForSelector('.header__games .badge');
    await check(A.page, 'Einstellungen mit Toast', viewport);
    await A.page.goto(`${BASE_URL}/#/`);
    await A.page.waitForSelector('.card--games:not([hidden])');
    await check(A.page, 'Startseite mit Meine Spiele', viewport);
    await A.page.goto(`${BASE_URL}/#/games`);
    await A.page.waitForSelector('.game--new');
    await check(A.page, 'Meine Spiele Liste', viewport);
    await A.context.close();
    await B.context.close();
  }
  assertNoFindings();
});

/** Spielt zufällig, bis die Siegerehrung kommt (wie im Online-Test). */
async function tournamentBot(page) {
  const moves = ['rock', 'paper', 'scissors'];
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (await page.$('.champion:not([hidden])')) return;
    const back = await page.$('.overlay .btn--primary:not([disabled])');
    if (back) { await back.click().catch(() => {}); continue; }
    const btn = await page.$(`.move-btn[aria-disabled="false"][data-move="${moves[Math.floor(Math.random() * moves.length)]}"]`);
    if (btn) await btn.click().catch(() => {});
    await page.waitForTimeout(250);
  }
  throw new Error('Turnier endet nicht');
}

test('axe: Turnier (Lobby, Baum, Siegerehrung)', { skip: SKIP_AXE, timeout: 240_000 }, async () => {
  const players = [await open(DESKTOP), await open(MOBILE), await open(MOBILE)];
  const host = players[0].page;
  const code = await createRoom(host, 'tournament', 'Anna');
  await joinRoom(players[1].page, code, 'Ben');
  await joinRoom(players[2].page, code, 'Cem');
  await host.waitForFunction(() => document.querySelectorAll('.player-row').length === 3, null, { timeout: WAIT_MS });
  await check(host, 'Lobby Turnier (Host)', DESKTOP);
  await check(players[1].page, 'Lobby Turnier (Gast)', MOBILE);
  await host.click('.lobby__status .btn--primary');
  // Bei 3 Spielern hat einer ein Freilos und sieht den Baum
  const withTree = await Promise.any(players.map((p) => p.page.waitForSelector('.screen--bracket', { timeout: WAIT_MS }).then(() => p)));
  await check(withTree.page, 'Turnierbaum', withTree === players[0] ? DESKTOP : MOBILE);
  await Promise.all(players.map((p) => tournamentBot(p.page)));
  await check(host, 'Siegerehrung', DESKTOP);
  await check(players[1].page, 'Siegerehrung', MOBILE);
  for (const p of players) await p.context.close();
  assertNoFindings();
});

// ─── Tastatur ───

/** Tab drücken, bis predicate(activeElement) wahr ist. */
async function tabTo(page, predicate, arg, { shift = false } = {}) {
  for (let i = 0; i < MAX_TABS; i++) {
    await page.keyboard.press(shift ? 'Shift+Tab' : 'Tab');
    if (await page.evaluate(predicate, arg)) return;
  }
  throw new Error(`Ziel per Tab nicht erreicht: ${predicate}`);
}

/** Fokus ist sichtbar: Fokusring (outline) vorhanden und Element im Viewport. */
async function focusVisible(page) {
  // reduzierte Bewegung = 1-ms-Transitions auf allem: einen Moment warten, bis der Fokusring steht
  await page.waitForTimeout(50);
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return false;
    const cs = getComputedStyle(el);
    // Fokusring = outline ≥ 2 px (kein box-shadow: der würde von Element-Schatten überschrieben)
    const ring = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2;
    const r = el.getBoundingClientRect();
    return Boolean(ring) && r.bottom > 0 && r.top < innerHeight;
  });
}

test('Tastatur: CPU-Match komplett ohne Maus', { timeout: 120_000 }, async () => {
  const { page, context, errors } = await open(MOBILE);

  // Start → „Gegen Computer“ nur per Tab + Enter
  await tabTo(page, () => document.activeElement?.getAttribute('href') === '#/cpu');
  assert.ok(await focusVisible(page), 'Fokusring auf der Karte sichtbar');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.screen--cpu');
  await page.waitForFunction(() => document.activeElement?.id === 'cpu-title');

  // Stufe per Pfeiltaste wählen (Radiogruppe), dann zum Start-Button tabben
  await tabTo(page, () => document.activeElement?.getAttribute('role') === 'radio');
  await page.keyboard.press('ArrowRight');
  assert.ok(await focusVisible(page), 'Fokusring auch auf der gewählten Option (eigener box-shadow)');
  const level = await page.evaluate(() => document.activeElement.dataset.value);
  assert.equal(await page.getAttribute(`[data-name="level"] [data-value="${level}"]`, 'aria-checked'), 'true');
  await tabTo(page, () => document.activeElement?.classList.contains('btn--start'));
  assert.ok(await focusVisible(page), 'Fokusring auf „Los geht’s!“ sichtbar');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.screen--arena');
  await page.waitForFunction(() => document.activeElement?.id === 'arena-title', null, { timeout: WAIT_MS });

  // Züge: Tab zum ersten Zug-Button, Enter; danach per Pfeil-/Tab-Navigation weiter
  let overlay = false;
  for (let round = 0; round < 30 && !overlay; round++) {
    await page.waitForSelector('.move-btn[aria-disabled="false"], .overlay', { timeout: WAIT_MS });
    if (await page.$('.overlay')) break;
    if (!(await page.evaluate(() => document.activeElement?.classList.contains('move-btn')))) {
      await tabTo(page, () => document.activeElement?.classList.contains('move-btn'));
    }
    assert.ok(await focusVisible(page), 'Fokusring auf Zug-Button sichtbar');
    await page.keyboard.press(round % 2 ? ' ' : 'Enter');
    await page.waitForSelector('.moves--locked', { timeout: WAIT_MS });
    // Fokus bleibt während der Runde auf dem Zug-Button (kein Fokusverlust an body)
    assert.ok(await page.evaluate(() => document.activeElement?.classList.contains('move-btn')), 'Fokus bleibt auf dem Zug');
    await page.waitForSelector('.move-btn[aria-disabled="false"], .overlay', { timeout: WAIT_MS });
    overlay = Boolean(await page.$('.overlay'));
  }
  assert.ok(overlay, 'Matchende erreicht');

  // Overlay: Fokus auf „Nochmal“, Tab bleibt im Dialog
  await page.waitForFunction(() => document.activeElement?.closest('.overlay'));
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab');
    assert.ok(await page.evaluate(() => Boolean(document.activeElement?.closest('.overlay'))), 'Fokusfalle im Matchende');
  }
  await tabTo(page, () => document.activeElement?.textContent?.includes('Nochmal'));
  await page.keyboard.press('Enter');
  await page.waitForSelector('.move-btn[aria-disabled="false"]', { timeout: WAIT_MS });
  assert.ok(await page.evaluate(() => document.activeElement?.classList.contains('move-btn')), 'nach „Nochmal“ Fokus auf den Zügen');

  // Zahlentaste spielt ebenfalls
  await page.keyboard.press('3');
  await page.waitForSelector('.moves--locked', { timeout: WAIT_MS });
  assert.deepEqual(errors, []);
  await context.close();
});

test('Tastatur: Bestätigungsdialog hält den Fokus, Escape bricht ab, Fokus kehrt zurück', { timeout: 60_000 }, async () => {
  const { page, context } = await open(DESKTOP);
  await page.evaluate(() => localStorage.setItem('rps.stats.v1', JSON.stringify({ v: 1, rounds: { w: 1, l: 0, d: 0 }, games: {}, moves: {}, streak: {} })));
  await page.goto(`${BASE_URL}/#/stats`);
  await page.waitForSelector('.stats__footer .btn--danger');
  await page.focus('.stats__footer .btn--danger');
  await page.keyboard.press('Enter');
  await page.waitForSelector('dialog[open]');
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Tab');
    assert.ok(await page.evaluate(() => Boolean(document.activeElement?.closest('dialog'))), 'Fokus bleibt im Dialog');
  }
  await page.keyboard.press('Escape');
  await page.waitForSelector('dialog', { state: 'detached' });
  assert.ok(await page.evaluate(() => document.activeElement?.classList.contains('btn--danger')), 'Fokus zurück auf dem Auslöser');
  await context.close();
});

test('Skip-Link springt zum Inhalt, ohne den laufenden Screen zu verlassen', { timeout: 60_000 }, async () => {
  const { page, context, errors } = await open(DESKTOP);
  await startCpuMatch(page, { level: 1, variant: 'classic', bestOf: 3 });
  await page.keyboard.press('1');
  await page.waitForSelector('.history__item', { timeout: WAIT_MS });
  await page.focus('.skip-link'); // Tab-Reihenfolge prüft der Start-Screen-Test
  assert.ok(await focusVisible(page), 'Skip-Link sichtbar fokussiert');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'app', 'Fokus auf dem Inhalt');
  assert.equal(await page.evaluate(() => location.hash), '#/play', 'Route unverändert');
  assert.equal(await page.$$eval('.history__item', (els) => els.length), 1, 'Match läuft weiter');

  // Auch ein direkt gesetzter Anker (#app) baut den Screen nicht neu auf
  await page.evaluate(() => { location.hash = '#app'; });
  await page.waitForFunction(() => location.hash === '#/play');
  assert.ok(await page.$('.screen--arena'));
  assert.equal(await page.$$eval('.history__item', (els) => els.length), 1, 'Match läuft weiter');
  assert.deepEqual(errors, []);
  await context.close();
});

test('Start-Screen: Skip-Link zuerst, unsichtbare Marke im Header nicht fokussierbar', { timeout: 30_000 }, async () => {
  const { page, context } = await open(MOBILE);
  await page.keyboard.press('Tab');
  assert.ok(await page.evaluate(() => document.activeElement?.classList.contains('skip-link')), 'Skip-Link ist erstes Tab-Ziel');
  await page.keyboard.press('Tab');
  assert.ok(!(await page.evaluate(() => document.activeElement?.classList.contains('brand'))), 'Marke wird übersprungen');
  await context.close();
});
