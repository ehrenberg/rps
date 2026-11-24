// Gemeinsame Helfer für die E2E-Tests (Playwright, läuft gegen einen laufenden Server).
// Basis-URL: RPS_BASE_URL (Standard: Docker-Service „web“ unter http://localhost:8088).
// Browser: PW_CHROMIUM_PATH, sonst Playwright-Standard, sonst neuester Chromium im Playwright-Cache.
import { chromium } from 'playwright';
import { readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const BASE_URL = (process.env.RPS_BASE_URL ?? 'http://localhost:8088').replace(/\/$/, '');
export const MOBILE = Object.freeze({ width: 375, height: 812 });
export const DESKTOP = Object.freeze({ width: 1280, height: 800 });
const MATCH_ROUND_LIMIT = 60;
const ROUND_TIMEOUT_MS = 15_000;

function cachedChromium() {
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(homedir(), '.cache', 'ms-playwright');
  if (!existsSync(cache)) return null;
  const dirs = readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse();
  for (const d of dirs) {
    const exe = join(cache, d, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
    if (existsSync(exe)) return exe;
  }
  return null;
}

export async function launchBrowser() {
  if (process.env.PW_CHROMIUM_PATH) return chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH });
  try {
    return await chromium.launch();
  } catch (err) {
    const exe = cachedChromium();
    if (!exe) throw err;
    return chromium.launch({ executablePath: exe });
  }
}

/** Neue Seite mit frischem Speicher; sammelt Konsolenfehler/-warnungen und Seitenfehler. */
export async function openPage(browser, viewport, hash = '#/') {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') problems.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  page.on('requestfailed', (req) => problems.push(`requestfailed: ${req.url()}`));
  page.on('response', (res) => { if (res.status() >= 400) problems.push(`HTTP ${res.status()}: ${res.url()}`); });
  await page.goto(`${BASE_URL}/${hash}`);
  return { page, context, problems };
}

/** Wählt im Computer-Setup Stufe/Variante/Länge und startet. */
export async function startCpuMatch(page, { level, variant, bestOf }) {
  await page.goto(`${BASE_URL}/#/cpu`);
  await page.click(`[data-name="level"] [data-value="${level}"]`);
  await page.click(`[data-name="variant"] [data-value="${variant}"]`);
  await page.click(`[data-name="bestOf"] [data-value="${bestOf}"]`);
  await page.click('.btn--start');
  await page.waitForSelector('.move-btn[aria-disabled="false"]', { timeout: ROUND_TIMEOUT_MS });
}

/** Spielt bis zum Matchende; pickMove(roundIndex, moves) wählt den Zug. Gibt Rundenzahl zurück. */
export async function playUntilOver(page, pickMove) {
  for (let round = 0; round < MATCH_ROUND_LIMIT; round++) {
    await page.waitForSelector('.move-btn[aria-disabled="false"], .overlay', { timeout: ROUND_TIMEOUT_MS });
    if (await page.$('.overlay')) return round;
    const moves = await page.$$eval('.move-btn', (els) => els.map((e) => e.dataset.move));
    await page.click(`.move-btn[data-move="${pickMove(round, moves)}"]`);
    await page.waitForSelector('.moves--locked', { timeout: ROUND_TIMEOUT_MS }).catch(() => {});
  }
  throw new Error('Match endet nicht');
}

/** Punktestand aus den Pips: [ich, Gegner]. */
export function readScore(page) {
  return page.$$eval('.scoreboard .pips', (els) => els.map((e) => e.querySelectorAll('.pip--on').length));
}

// ─── Online ───

/** Neuer Kontext + Seite, ohne Start-URL; sammelt Probleme wie openPage. */
export async function newPlayer(browser, viewport = MOBILE) {
  const { page, context, problems } = await openPage(browser, viewport, '#/');
  return { page, context, problems };
}

/** Raum anlegen (type 'duel' | 'tournament') und Raumcode zurückgeben. */
export async function createRoom(page, type, name, { variant = 'classic', bestOf = 3 } = {}) {
  await page.goto(`${BASE_URL}/#/${type}`);
  await page.fill(`#${type}-name`, name);
  await page.click(`[data-name="variant"] [data-value="${variant}"]`);
  await page.click(`[data-name="bestOf"] [data-value="${bestOf}"]`);
  await page.click('.btn--start');
  await page.waitForSelector('.screen--lobby');
  return (await page.evaluate(() => location.hash)).slice(1);
}

/** Einladungslink öffnen, Namen eingeben, beitreten. */
export async function joinRoom(page, code, name) {
  await page.goto(`${BASE_URL}/#${code}`);
  await page.waitForSelector('#invite-name');
  await page.fill('#invite-name', name);
  await page.click('.btn--start');
}

export const enabledMove = '.move-btn[aria-disabled="false"]';

/** Spielt Züge, bis eine Seite das Matchende zeigt. moves(roundIndex) → [zugA, zugB]. */
export async function playOnlineMatch(a, b, moves) {
  for (let r = 0; r < 40; r++) {
    await Promise.all([a, b].map((p) => p.waitForSelector(`${enabledMove}, .overlay`, { timeout: 20_000 })));
    if (await a.$('.overlay')) break;
    const [ma, mb] = moves(r);
    const before = await a.$$eval('.history__item', (els) => els.length);
    await a.click(`.move-btn[data-move="${ma}"]`);
    await b.click(`.move-btn[data-move="${mb}"]`);
    await a.waitForFunction((n) => document.querySelectorAll('.history__item').length > n || document.querySelector('.overlay'), before, { timeout: 20_000 });
  }
  await Promise.all([a, b].map((p) => p.waitForSelector('.overlay', { timeout: 20_000 })));
}
