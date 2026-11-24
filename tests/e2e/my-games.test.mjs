// E2E „Meine Spiele“: Warten außerhalb der Lobby, Benachrichtigung beim Beitritt, mehrere offene Spiele,
// Liste übersteht Reload/neuen Tab, Entfernen verlässt den Raum. Braucht den laufenden Server (RPS_BASE_URL).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_URL, MOBILE, DESKTOP, launchBrowser, newPlayer, createRoom, joinRoom, enabledMove, reloadPage,
} from './helpers.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const TIMEOUT = 20_000;

test('Wartender Host in den Einstellungen: Toast „Zum Spiel“ + Badge, Klick führt ins laufende Match', async () => {
  const A = await newPlayer(browser, MOBILE);
  const B = await newPlayer(browser, DESKTOP);
  const code = await createRoom(A.page, 'duel', 'Anna');
  assert.match(await A.page.textContent('.lobby__away'), /Du kannst die Seite verlassen/);

  await A.page.click('.app-header a[href="#/settings"]');
  await A.page.waitForSelector('.screen--settings');
  assert.ok(await A.page.isVisible('.header__games'), 'Header zeigt „Meine Spiele“');

  await joinRoom(B.page, code, 'Ben');
  const toast = A.page.locator('.toast--action');
  await toast.waitFor({ timeout: TIMEOUT });
  assert.match(await toast.textContent(), /Ben ist da – euer Duell startet!/);
  await A.page.waitForSelector('.header__games .badge', { timeout: TIMEOUT });
  assert.equal(await A.page.textContent('.header__games .badge'), '1');
  assert.match(await A.page.textContent('.header__games'), /1 Spiel mit Neuigkeiten/);

  await toast.locator('.toast__action').click();
  await A.page.waitForFunction((c) => location.hash === `#${c}`, code);
  await Promise.all([A.page, B.page].map((p) => p.waitForSelector(enabledMove, { timeout: TIMEOUT })));
  assert.equal(await A.page.textContent('.player--opp .player__name'), 'Ben');
  await A.page.waitForSelector('.header__games .badge', { state: 'detached', timeout: TIMEOUT });

  assert.deepEqual(A.problems, []);
  assert.deepEqual(B.problems, []);
  await A.context.close();
  await B.context.close();
});

test('Zwei offene Duelle gleichzeitig: Liste, Reload, neuer Tab, Entfernen verlässt den Raum', async () => {
  const A = await newPlayer(browser, MOBILE);
  const first = await createRoom(A.page, 'duel', 'Anna');
  const second = await createRoom(A.page, 'duel', 'Anna', { variant: 'lizard', bestOf: 5 });
  assert.notEqual(first, second);

  await A.page.goto(`${BASE_URL}/#/`);
  await A.page.waitForSelector('.card--games:not([hidden])');
  assert.match(await A.page.textContent('.card--games .card__title'), /Meine Spiele \(2\)/);
  await A.page.click('.card--games');
  await A.page.waitForSelector('.screen--games');
  const codes = () => A.page.$$eval('.game', (els) => els.map((e) => e.dataset.code));
  assert.deepEqual((await codes()).sort(), [first, second].sort());
  assert.match(await A.page.textContent(`.game[data-code="${second}"] .game__meta`), /Best of 5/);
  assert.match(await A.page.textContent(`.game[data-code="${first}"] .game__status`), /Wartet auf Gegner/);

  await reloadPage(A);
  await A.page.waitForSelector('.game');
  assert.equal((await codes()).length, 2, 'Reload behält die Liste');

  const tab = await A.context.newPage();
  await tab.goto(`${BASE_URL}/#/games`);
  await tab.waitForSelector('.game');
  assert.equal((await tab.$$('.game')).length, 2, 'neuer Tab im selben Browser sieht die Spiele');
  // Gleicher Link im zweiten Tab = derselbe Spieler (keine Namensabfrage)
  await tab.goto(`${BASE_URL}/#${first}`);
  await tab.waitForSelector('.screen--lobby');
  assert.equal(await tab.$('#invite-name'), null);
  await tab.close();

  // Entfernen: Bestätigung → leave → Karte weg, Raum ist geschlossen
  const leave = A.page.waitForResponse((r) => r.url().endsWith('/api.php') && r.request().postData()?.includes('"leave"'));
  await A.page.click(`.game[data-code="${first}"] .game__remove`);
  await A.page.click('dialog .btn--danger');
  assert.equal((await leave).status(), 200);
  await A.page.waitForFunction((c) => !document.querySelector(`.game[data-code="${c}"]`), first);
  assert.deepEqual(await codes(), [second]);
  const stored = JSON.parse(await A.page.evaluate(() => localStorage.getItem('rps.rooms.v1')));
  assert.deepEqual(Object.keys(stored), [second]);
  const res = await A.page.evaluate(async (c) => (await fetch('api.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'info', code: c }) })).status, first);
  assert.ok([200, 404].includes(res));

  // Letztes entfernen → schöner leerer Zustand
  await A.page.click(`.game[data-code="${second}"] .game__remove`);
  await A.page.click('dialog .btn--danger');
  await A.page.waitForSelector('.games-empty:not([hidden])');
  assert.ok(await A.page.isVisible('.games-empty a[href="#/duel"]'));
  assert.equal(await A.page.isVisible('.header__games'), false, 'ohne offene Spiele kein Header-Icon');

  assert.deepEqual(A.problems, []);
  await A.context.close();
});

test('Alte Sitzung aus sessionStorage wird übernommen (Migration)', async () => {
  const A = await newPlayer(browser, MOBILE);
  const B = await newPlayer(browser, MOBILE);
  const code = await createRoom(A.page, 'duel', 'Anna');
  const entry = await A.page.evaluate((c) => JSON.parse(localStorage.getItem('rps.rooms.v1'))[c], code);
  // B simuliert den alten Stand: Token nur in sessionStorage
  await B.page.evaluate(({ c, t, m }) => {
    sessionStorage.setItem(`rps.token.${c}`, t);
    sessionStorage.setItem(`rps.me.${c}`, m);
  }, { c: code, t: entry.token, m: entry.me });
  await reloadPage(B);
  await B.page.goto(`${BASE_URL}/#/games`);
  await B.page.waitForSelector(`.game[data-code="${code}"]`);
  assert.equal(await B.page.evaluate(() => sessionStorage.length), 0);
  assert.deepEqual(B.problems, []);
  await A.context.close();
  await B.context.close();
});
