// E2E: komplette Matches gegen den Computer, Statistik, Einstellungen, Routing.
// Start: Server laufen lassen (npm run up), dann npm run test:e2e
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_URL, MOBILE, DESKTOP, launchBrowser, openPage, startCpuMatch, playUntilOver, readScore,
} from './helpers.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const MATCHES = [
  { viewport: MOBILE, label: 'mobil', level: 1, variant: 'classic', bestOf: 3 },
  { viewport: MOBILE, label: 'mobil', level: 4, variant: 'lizard', bestOf: 5 },
  { viewport: DESKTOP, label: 'Desktop', level: 2, variant: 'lizard', bestOf: 3 },
  { viewport: DESKTOP, label: 'Desktop', level: 3, variant: 'classic', bestOf: 5 },
];

for (const m of MATCHES) {
  test(`komplettes Match ${m.label}: Stufe ${m.level}, ${m.variant}, Best of ${m.bestOf}`, async () => {
    const { page, context, problems } = await openPage(browser, m.viewport);
    await startCpuMatch(page, m);
    const moveCount = await page.$$eval('.move-btn', (els) => els.length);
    assert.equal(moveCount, m.variant === 'classic' ? 3 : 5);
    assert.match(await page.textContent('.commit'), /^🔒 [0-9a-f]{4}…$/);
    const insight = page.locator('.insight .toggle');
    assert.equal(await insight.isVisible(), m.level === 4, '„Was denkt der Computer?“ nur auf Stufe 4');
    if (m.level === 4 && (await insight.getAttribute('aria-pressed')) !== 'true') await insight.click();

    const rounds = await playUntilOver(page, (i, moves) => moves[i % moves.length]);
    const target = Math.floor(m.bestOf / 2) + 1;
    const score = await readScore(page);
    assert.ok(score.includes(target), `einer hat ${target} Siege: ${score}`);
    assert.ok(rounds >= target);
    assert.equal(await page.$$eval('.history__item', (els) => els.length), Math.min(rounds, 12));
    assert.equal(await page.textContent('.fair__summary'), 'fair ✓');
    if (m.level === 4) assert.ok((await page.textContent('.insight__text')).length > 0);
    const title = await page.textContent('.overlay__title');
    assert.ok(['Sieg!', 'Niederlage'].includes(title));
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Nochmal', 'Fokus im Overlay');

    // Nochmal → neues Match mit leeren Pips
    await page.click('.overlay .btn--primary');
    await page.waitForSelector('.move-btn[aria-disabled="false"]');
    assert.equal(await page.$('.overlay'), null);
    assert.deepEqual(await readScore(page), [0, 0]);
    assert.equal(await page.textContent('.scoreboard__round'), 'Runde 1');

    // Statistik hat das Match gezählt
    const stats = JSON.parse(await page.evaluate(() => localStorage.getItem('rps.stats.v1')));
    const g = stats.games[`cpu-${m.level}`];
    assert.equal(g.w + g.l, 1);
    assert.equal(g.w, title === 'Sieg!' ? 1 : 0);
    assert.equal(stats.rounds.w + stats.rounds.l + stats.rounds.d, rounds);
    assert.deepEqual(problems, []);
    await context.close();
  });
}

test('Tastaturkürzel, Fairness-Details, Zurück-Button des Browsers', async () => {
  const { page, context, problems } = await openPage(browser, DESKTOP);
  await startCpuMatch(page, { level: 1, variant: 'classic', bestOf: 3 });
  const commit = (await page.getAttribute('.commit', 'aria-label')).match(/([0-9a-f]{4})…/)[1];
  await page.keyboard.press('2');
  await page.waitForSelector('.move-btn--chosen[data-move="paper"]');
  await page.waitForSelector('.fair__summary');
  await page.click('.fair__summary');
  const hash = await page.textContent('.fair__hash');
  assert.ok(hash.startsWith(commit), 'aufgedeckter Hash = vorher gezeigter Hash');
  assert.match(await page.textContent('.result__sentence'), /Papier|Unentschieden/);
  await page.goBack();
  await page.waitForSelector('.screen--cpu');
  await page.goBack();
  await page.waitForSelector('.screen--home');
  assert.deepEqual(problems, []);
  await context.close();
});

test('Name wird gemerkt und in der Arena angezeigt (als Text, nicht HTML)', async () => {
  const { page, context, problems } = await openPage(browser, MOBILE);
  await page.fill('#player-name', '  <b>Anna</b>  ');
  await page.click('a[href="#/cpu"]');
  await page.waitForSelector('.screen--cpu');
  assert.equal(await page.inputValue('#cpu-name'), '<b>Anna</b>');
  await page.click('.btn--start');
  await page.waitForSelector('.player--me .player__name');
  assert.equal(await page.textContent('.player--me .player__name'), '<b>Anna</b>');
  assert.equal(await page.$('.player--me b'), null);
  assert.deepEqual(problems, []);
  await context.close();
});

test('Computer-Setup merkt sich die letzte Wahl', async () => {
  const { page, context } = await openPage(browser, MOBILE, '#/cpu');
  await page.click('[data-name="level"] [data-value="3"]');
  await page.click('[data-name="variant"] [data-value="lizard"]');
  await page.click('[data-name="bestOf"] [data-value="5"]');
  await page.reload();
  await page.waitForSelector('.screen--cpu');
  for (const [name, value] of [['level', '3'], ['variant', 'lizard'], ['bestOf', '5']]) {
    assert.equal(await page.getAttribute(`[data-name="${name}"] [data-value="${value}"]`, 'aria-checked'), 'true');
  }
  await context.close();
});

test('Einstellungen: Ton und Effekte reduzieren wirken und bleiben gespeichert', async () => {
  const { page, context, problems } = await openPage(browser, MOBILE, '#/settings');
  const fxToggle = page.locator('.setting', { hasText: 'Effekte reduzieren' }).locator('button');
  const soundToggle = page.locator('.setting', { hasText: 'Ton' }).first().locator('button');
  await fxToggle.click();
  assert.equal(await fxToggle.getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getAttribute('html', 'data-reduced-fx'), '1');
  assert.equal(await page.evaluate(() => localStorage.getItem('rps.reducedFx')), '1');
  await soundToggle.click();
  assert.equal(await soundToggle.getAttribute('aria-pressed'), 'false');
  assert.equal(await page.evaluate(() => localStorage.getItem('rps.sound')), '0');
  // Header-Schalter spiegelt den Zustand
  assert.equal(await page.getAttribute('.app-header .toggle[title="Ton an/aus"]', 'aria-pressed'), 'false');
  await page.reload();
  await page.waitForSelector('.screen--settings');
  assert.equal(await page.getAttribute('html', 'data-reduced-fx'), '1');
  assert.equal(await fxToggle.getAttribute('aria-pressed'), 'true');
  assert.deepEqual(problems, []);
  await context.close();
});

test('Statistik: leerer Zustand, nach Match gefüllt, Zurücksetzen mit Bestätigung', async () => {
  const { page, context, problems } = await openPage(browser, MOBILE, '#/stats');
  await page.waitForSelector('.empty');
  await startCpuMatch(page, { level: 1, variant: 'classic', bestOf: 3 });
  await playUntilOver(page, () => 'rock');
  await page.click('.overlay a');
  await page.waitForSelector('.screen--home');
  await page.goto(`${BASE_URL}/#/stats`);
  await page.waitForSelector('.screen--stats');
  await page.waitForSelector('.kpis');
  assert.equal(await page.textContent('.kpi:first-child .kpi__value'), '1', 'ein Match gezählt');
  assert.equal(await page.$$eval('.bar', (els) => els.length), 5);
  assert.match(await page.textContent('.kpi:nth-child(4)'), /Stein/, 'Lieblingszug');
  await page.click('.btn--danger');
  await page.click('dialog .btn--ghost'); // Abbrechen
  assert.ok(await page.$('.kpis'), 'Abbrechen löscht nichts');
  await page.click('.btn--danger');
  await page.click('dialog .btn--danger');
  await page.waitForSelector('.empty');
  assert.deepEqual(problems, []);
  await context.close();
});

test('Routing: unbekannter Raum → freundliche Meldung, unbekannt → Start, Duell/Turnier erstellen', async () => {
  const { page, context, problems } = await openPage(browser, MOBILE, '#k7f3qa');
  await page.waitForFunction(() => document.querySelector('#invite-title')?.textContent === 'Raum nicht gefunden');
  assert.match(await page.textContent('.invite'), /gibt es nicht/);
  await page.goto(`${BASE_URL}/#/gibtsnicht`);
  await page.waitForSelector('.screen--home');
  assert.equal(await page.evaluate(() => location.hash), '#/');
  for (const [href, cls] of [['#/duel', 'create-duel'], ['#/tournament', 'create-tournament']]) {
    await page.goto(`${BASE_URL}/#/`);
    await page.click(`a[href="${href}"]`);
    await page.waitForSelector(`.screen--${cls}`);
    await page.waitForFunction(() => document.activeElement?.tagName === 'H1'); // Fokus auf Überschrift
  }
  // erwartet: 404 der info-Abfrage für den unbekannten Raum
  assert.deepEqual(problems.filter((p) => !p.includes('404')), []);
  await context.close();
});

test('Keine Seite scrollt horizontal (375 px) und Footer verlinkt Impressum/Datenschutz', async () => {
  const { page, context } = await openPage(browser, MOBILE);
  for (const hash of ['#/', '#/cpu', '#/play', '#/stats', '#/settings', '#k7f3qa', '#/duel', '#/tournament']) {
    await page.goto(`${BASE_URL}/${hash}`);
    await page.waitForSelector('.screen');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `${hash} hat ${overflow}px horizontalen Überlauf`);
  }
  const links = await page.$$eval('.app-footer a', (as) => as.map((a) => [a.href, a.rel]));
  assert.deepEqual(links, [['https://bastianswelt.de/impressum', 'noopener'], ['https://bastianswelt.de/datenschutz', 'noopener']]);
  await context.close();
});

test('Weniger Bewegung (prefers-reduced-motion): Match läuft durch, keine Fehler', async () => {
  const context = await browser.newContext({ viewport: MOBILE, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('console', (msg) => { if (msg.type() === 'error') problems.push(msg.text()); });
  await startCpuMatch(page, { level: 2, variant: 'classic', bestOf: 3 });
  await playUntilOver(page, (i, moves) => moves[(i * 2) % moves.length]);
  assert.ok(await page.$('.overlay'));
  assert.deepEqual(problems, []);
  await context.close();
});
