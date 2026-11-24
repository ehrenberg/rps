// E2E Online: Duell (Revanche, Serie, Reload, Reaktionen), Fairness im Netzwerk, Turnier mit 5 + Zuschauer.
// Braucht den laufenden Server (npm run up). Basis-URL: RPS_BASE_URL.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_URL, MOBILE, DESKTOP, launchBrowser, newPlayer, createRoom, joinRoom, playOnlineMatch, enabledMove,
} from './helpers.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const WIN_A = () => ['rock', 'scissors'];
const WIN_B = () => ['rock', 'paper'];
const MATCH_TIMEOUT = 20_000;

test('Duell: 3 Matches mit Revanche und Serie, Reload behält Platz, Reaktionen kommen an', async () => {
  const A = await newPlayer(browser, MOBILE);
  const B = await newPlayer(browser, DESKTOP);
  const code = await createRoom(A.page, 'duel', 'Anna');
  assert.match(code, /^[23456789abcdefghjkmnpqrstuvwxyz]{6}$/);
  assert.equal(await A.page.inputValue('.share__link'), `${BASE_URL}/#${code}`);
  assert.ok(await A.page.$('.share__qr svg path'), 'QR-Code vorhanden');

  await B.page.goto(`${BASE_URL}/#${code}`);
  await B.page.waitForSelector('.invite');
  assert.equal(await B.page.textContent('#invite-title'), 'Anna fordert dich heraus!');
  await B.page.fill('#invite-name', 'Ben');
  await B.page.click('.btn--start');
  await Promise.all([A.page, B.page].map((p) => p.waitForSelector(enabledMove, { timeout: MATCH_TIMEOUT })));
  assert.equal(await A.page.textContent('.player--opp .player__name'), 'Ben');
  assert.equal(await B.page.textContent('.player--opp .player__name'), 'Anna');

  // Reaktion A → B
  await A.page.click('.reactions__btn[aria-label="Reaktion 🔥"]');
  await B.page.waitForFunction(() => [...document.querySelectorAll('.fx-emoji')].some((e) => e.textContent === '🔥'), null, { timeout: 5000 });

  // Match 1: A gewinnt; mittendrin Reload von A nach eigenem Commit
  const committed = A.page.waitForResponse((r) => r.url().endsWith('/api.php') && r.request().postData()?.includes('"commit"'));
  await A.page.click('.move-btn[data-move="rock"]');
  await committed;
  await B.page.waitForSelector('.player__status[data-state="ready"]', { timeout: MATCH_TIMEOUT });
  await A.page.reload();
  await A.page.waitForSelector('.move-btn--chosen[data-move="rock"]', { timeout: MATCH_TIMEOUT });
  assert.equal(await A.page.$('#invite-name'), null, 'keine erneute Namensabfrage');
  await B.page.click('.move-btn[data-move="scissors"]');
  await A.page.waitForSelector('.fair__summary', { timeout: MATCH_TIMEOUT });
  assert.equal(await A.page.textContent('.fair__summary'), 'fair ✓');
  await playOnlineMatch(A.page, B.page, WIN_A);
  assert.equal(await A.page.textContent('.overlay__title'), 'Sieg!');
  assert.equal(await B.page.textContent('.overlay__title'), 'Niederlage');
  assert.equal(await A.page.textContent('.overlay__series'), 'Serie 1 : 0');

  // Revanche: A will, B sieht Hinweis, B nimmt an
  for (const [i, winner] of [[2, WIN_B], [3, WIN_A]]) {
    await A.page.click('.overlay .btn--primary');
    await B.page.waitForFunction(() => document.querySelector('.overlay__status')?.textContent.includes('will Revanche'), null, { timeout: MATCH_TIMEOUT });
    assert.match(await A.page.textContent('.overlay__status'), /Warte auf Ben/);
    await B.page.click('.overlay .btn--primary');
    await Promise.all([A.page, B.page].map((p) => p.waitForSelector('.overlay', { state: 'detached', timeout: MATCH_TIMEOUT })));
    await playOnlineMatch(A.page, B.page, winner);
    assert.ok(i);
  }
  assert.equal(await A.page.textContent('.overlay__series'), 'Serie 2 : 1');
  assert.equal(await B.page.textContent('.overlay__series'), 'Serie 1 : 2');

  // Statistik zählt Duelle
  const stats = JSON.parse(await A.page.evaluate(() => localStorage.getItem('rps.stats.v1')));
  assert.deepEqual([stats.games.duel.w, stats.games.duel.l], [2, 1]);

  // B verlässt → A bekommt verständliche Meldung
  await A.page.click('.overlay .btn--primary');
  await B.page.click('.overlay .btn--primary');
  await Promise.all([A.page, B.page].map((p) => p.waitForSelector('.overlay', { state: 'detached', timeout: MATCH_TIMEOUT })));
  await B.page.waitForSelector(enabledMove, { timeout: MATCH_TIMEOUT });
  await B.page.click('.arena__leave');
  await B.page.click('dialog .btn--danger');
  await B.page.waitForSelector('.screen--home');
  await A.page.waitForSelector('.overlay', { timeout: MATCH_TIMEOUT });
  assert.match(await A.page.textContent('.overlay__text'), /Ben hat das Spiel verlassen/);

  assert.deepEqual(A.problems, []);
  assert.deepEqual(B.problems, []);
  await A.context.close();
  await B.context.close();
});

test('Fairness: Netzwerkantworten verraten den Gegnerzug nie vor dessen Reveal', async () => {
  const A = await newPlayer(browser, MOBILE);
  const B = await newPlayer(browser, MOBILE);
  const code = await createRoom(A.page, 'duel', 'Anna');
  await joinRoom(B.page, code, 'Ben');
  await Promise.all([A.page, B.page].map((p) => p.waitForSelector(enabledMove, { timeout: MATCH_TIMEOUT })));

  const reveals = []; // A's Reveals: { t, move, nonce }
  A.page.on('request', (req) => {
    if (!req.url().endsWith('/api.php')) return;
    const body = JSON.parse(req.postData() ?? '{}');
    if (body.action === 'reveal') reveals.push({ t: Date.now(), move: body.move, nonce: body.nonce });
  });
  const seenByB = []; // { t, text }
  B.page.on('response', async (res) => {
    if (!res.url().endsWith('/api.php')) return;
    const t = Date.now();
    try { seenByB.push({ t, text: await res.text() }); } catch { /* Seite zu */ }
  });

  for (let round = 0; round < 3; round++) {
    await Promise.all([A.page, B.page].map((p) => p.waitForSelector(`${enabledMove}, .overlay`, { timeout: MATCH_TIMEOUT })));
    if (await A.page.$('.overlay')) break;
    const before = await A.page.$$eval('.history__item', (els) => els.length);
    await A.page.click('.move-btn[data-move="paper"]');
    await B.page.waitForTimeout(1500); // B pollt mehrfach, während A schon committed hat
    await B.page.click('.move-btn[data-move="rock"]');
    await A.page.waitForFunction((n) => document.querySelectorAll('.history__item').length > n || document.querySelector('.overlay'), before, { timeout: MATCH_TIMEOUT });
  }
  assert.ok(reveals.length >= 1);
  for (const r of reveals) {
    const early = seenByB.filter((s) => s.t < r.t);
    assert.ok(early.length > 0, 'B hat vor dem Reveal gepollt');
    for (const s of early) assert.equal(s.text.includes(r.nonce), false, 'Nonce von A vor Reveal sichtbar');
  }
  // Nach dem Reveal steht der Zug in history (prüfbar)
  assert.ok(seenByB.some((s) => s.text.includes(reveals[0].nonce)));
  await A.context.close();
  await B.context.close();
});

/** Bot für das Turnier: wählt Züge, kehrt nach Matchende zum Baum zurück, bis die Siegerehrung kommt. */
async function tournamentBot(page) {
  const moves = ['rock', 'paper', 'scissors'];
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    if (await page.$('.champion:not([hidden])')) return;
    const back = await page.$('.overlay .btn--primary:not([disabled])');
    if (back) { await back.click().catch(() => {}); continue; }
    // Zufällige Züge: feste Folgen könnten bei zwei Bots ewig unentschieden spielen
    const btn = await page.$(`.move-btn[aria-disabled="false"][data-move="${moves[Math.floor(Math.random() * moves.length)]}"]`);
    if (btn) await btn.click().catch(() => {});
    await page.waitForTimeout(250);
  }
  throw new Error('Turnier endet nicht');
}

test('Turnier: 5 Spieler mit Freilos bis zum Champion, dazu ein Zuschauer', async () => {
  const names = ['Anna', 'Ben', 'Cem', 'Dora', 'Eli'];
  const players = [];
  for (let i = 0; i < names.length; i++) players.push(await newPlayer(browser, i === 0 ? DESKTOP : MOBILE));
  const host = players[0].page;
  const code = await createRoom(host, 'tournament', names[0]);
  for (let i = 1; i < names.length; i++) await joinRoom(players[i].page, code, names[i]);
  await host.waitForFunction(() => document.querySelectorAll('.player-row').length === 5, null, { timeout: MATCH_TIMEOUT });
  assert.equal(await players[1].page.$('.lobby__status .btn--primary'), null, 'nur der Host darf starten');
  await host.click('.lobby__status .btn--primary');

  // Zuschauer kommt nach dem Start
  const spectator = await newPlayer(browser, MOBILE);
  await spectator.page.goto(`${BASE_URL}/#${code}`);
  await spectator.page.waitForSelector('.invite');
  await spectator.page.fill('#invite-name', 'Zoe');
  await spectator.page.click('.btn--start');
  await spectator.page.waitForSelector('.screen--bracket', { timeout: MATCH_TIMEOUT });
  assert.match(await spectator.page.textContent('.bracket__role'), /schaust zu/);
  assert.ok(await spectator.page.$('.slot--empty'), 'Freilos/Platzhalter sichtbar');
  assert.ok((await spectator.page.$$('.bround')).length >= 3);

  await Promise.all(players.map((p) => tournamentBot(p.page)));
  await spectator.page.waitForSelector('.champion:not([hidden])', { timeout: MATCH_TIMEOUT });
  const champ = await spectator.page.textContent('.champion__name');
  assert.ok(names.includes(champ), `Champion ${champ}`);
  for (const p of players) assert.equal(await p.page.textContent('.champion__name'), champ);
  assert.ok(await host.$('.champion .btn--primary'), 'Host kann neues Turnier starten');

  // Statistik: jedes Turnier genau einmal
  const winnerIdx = names.indexOf(champ);
  const st = JSON.parse(await players[winnerIdx].page.evaluate(() => localStorage.getItem('rps.stats.v1')));
  assert.equal(st.games.tournament.played, 1);
  assert.equal(st.games.tournament.won, 1);

  for (const p of [...players, spectator]) {
    assert.deepEqual(p.problems.filter((x) => !x.includes('429')), []);
    await p.context.close();
  }
});
