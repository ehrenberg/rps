#!/usr/bin/env node
// Prüft eine laufende Installation gegen die Checkliste aus docs/DEPLOYMENT.md.
// Aufruf: npm run check:deploy -- https://rps.bastianswelt.de   (oder http://localhost:8088)
// Ohne Abhängigkeiten (nur Node-Bordmittel). Exit-Code 1, sobald ein Punkt fehlschlägt.
import http from 'node:http';
import https from 'node:https';
import { pathToFileURL } from 'node:url';

// --- Erwartungen (müssen zu public/.htaccess passen; Test: tests/js/check-deploy.test.js) ---

export const EXPECTED_CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
  + "connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; "
  + "frame-ancestors 'none'";

/** Header, die auf JEDER Antwort exakt so gesetzt sein müssen. */
export const REQUIRED_HEADERS = {
  'content-security-policy': EXPECTED_CSP,
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
};

/** Diese Features müssen in der Permissions-Policy abgeschaltet sein. */
export const PERMISSIONS_OFF = ['camera', 'microphone', 'geolocation', 'payment', 'usb'];

export const HSTS_MIN_SECONDS = 15552000; // 180 Tage

/** Müssen 403 liefern. */
export const FORBIDDEN_PATHS = [
  'data/rps.sqlite', 'data/', 'data/.htaccess', 'src/', 'src/db.php', 'src/rules.php', '.htaccess',
];

/** Erwarteter MIME-Typ je Dateiendung. */
export const CONTENT_TYPES = {
  html: 'text/html',
  js: 'text/javascript',
  css: 'text/css',
  woff2: 'font/woff2',
  webmanifest: 'application/manifest+json',
  svg: 'image/svg+xml',
  png: 'image/png',
  txt: 'text/plain',
};

/** Erlaubte absolute URLs: XML-Namespaces (werden nie geladen) und die Footer-Links. */
const NAMESPACE_URLS = new Set([
  'http://www.w3.org/2000/svg', 'http://www.w3.org/1999/xlink', 'http://www.w3.org/1999/xhtml',
]);
const FOOTER_URLS = new Set(['https://bastianswelt.de/impressum', 'https://bastianswelt.de/datenschutz']);

export const ROOM_CODE_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';

// --- reine Hilfsfunktionen -----------------------------------------------------------------

/** Basis-URL normalisieren (immer mit abschließendem Slash). Wirft bei ungültiger Eingabe. */
export function normalizeBase(input) {
  if (!input) throw new Error('Basis-URL fehlt. Aufruf: npm run check:deploy -- https://rps.bastianswelt.de');
  const url = new URL(input);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`Nur http(s) wird unterstützt: ${input}`);
  url.hash = '';
  url.search = '';
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}

/** Header-Wert (Node liefert Namen klein; set-cookie als Array). */
export function headerValue(headers, name) {
  const v = headers[name.toLowerCase()];
  return Array.isArray(v) ? v.join(', ') : (v ?? null);
}

/** MIME-Typ ohne Parameter, klein geschrieben. */
export function mimeOf(contentType) {
  return (contentType ?? '').split(';')[0].trim().toLowerCase();
}

export function extensionOf(path) {
  const clean = path.split(/[?#]/)[0];
  const m = /\.([a-z0-9]+)$/i.exec(clean);
  return m ? m[1].toLowerCase() : '';
}

/** Liste der Abweichungen bei den Pflicht-Headern (leer = alles gut). */
export function checkSecurityHeaders(headers) {
  const problems = [];
  for (const [name, expected] of Object.entries(REQUIRED_HEADERS)) {
    const actual = headerValue(headers, name);
    if (actual === null) problems.push(`${name} fehlt`);
    else if (actual !== expected) problems.push(`${name} = "${actual}" (erwartet "${expected}")`);
  }
  const pp = headerValue(headers, 'permissions-policy');
  if (pp === null) {
    problems.push('permissions-policy fehlt');
  } else {
    const off = new Set(pp.split(',').map((s) => s.trim().replace(/\s+/g, '')));
    for (const f of PERMISSIONS_OFF) if (!off.has(`${f}=()`)) problems.push(`permissions-policy: ${f}=() fehlt`);
  }
  return problems;
}

/** null wenn HSTS ausreichend, sonst Problembeschreibung. */
export function checkHsts(value) {
  if (!value) return 'Strict-Transport-Security fehlt';
  const m = /max-age\s*=\s*"?(\d+)/i.exec(value);
  if (!m) return `Strict-Transport-Security ohne max-age: "${value}"`;
  if (Number(m[1]) < HSTS_MIN_SECONDS) return `max-age=${m[1]} ist kürzer als ${HSTS_MIN_SECONDS}`;
  return null;
}

/** max-age aus Cache-Control (null, wenn nicht vorhanden). */
export function maxAge(cacheControl) {
  const m = /(?:^|[,\s])max-age\s*=\s*(\d+)/i.exec(cacheControl ?? '');
  return m ? Number(m[1]) : null;
}

/** Alle absoluten bzw. protokoll-relativen URLs in einem Text. */
export function findExternalUrls(text) {
  const found = [];
  for (const m of text.matchAll(/\b(?:https?|wss?):\/\/[^\s'"`)<>\\]+/gi)) found.push(m[0]);
  // protokoll-relativ nur direkt nach Anführungszeichen/Klammer/=, sonst wären "// Kommentare" Treffer
  for (const m of text.matchAll(/(?<=['"`(=]\s*)\/\/(?:[a-z0-9-]+\.)+[a-z]{2,}[^\s'"`)<>\\]*/gi)) found.push(m[0]);
  return found;
}

/** Ist diese externe URL in dieser Datei erlaubt? */
export function isAllowedUrl(url, file) {
  const clean = url.replace(/[.,;]+$/, '');
  if (NAMESPACE_URLS.has(clean)) return true;
  return FOOTER_URLS.has(clean) && /(^|\/)index\.html$/.test(file);
}

function isLocalRef(ref) {
  return ref !== '' && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref);
}

/** Lokale src/href-Verweise aus HTML (ohne externe Links, Anker, data:). */
export function extractHtmlRefs(html) {
  const refs = [];
  for (const m of html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) if (isLocalRef(m[1])) refs.push(m[1]);
  return refs;
}

/** Statische und dynamische Imports aus einem ES-Modul. */
export function extractJsImports(source) {
  const refs = new Set();
  const patterns = [
    /\b(?:import|export)\s[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
  ];
  for (const re of patterns) for (const m of source.matchAll(re)) if (isLocalRef(m[1])) refs.add(m[1]);
  return [...refs];
}

/** url(...) und @import aus CSS. */
export function extractCssUrls(source) {
  const refs = new Set();
  for (const m of source.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) if (isLocalRef(m[1])) refs.add(m[1]);
  for (const m of source.matchAll(/@import\s+['"]([^'"]+)['"]/g)) if (isLocalRef(m[1])) refs.add(m[1]);
  return [...refs];
}

/** Verweis relativ zur Datei auflösen → Pfad relativ zur Basis (ohne führenden Slash). */
export function resolveRef(fromPath, ref) {
  const base = new URL(fromPath, 'http://x/');
  const url = new URL(ref, base);
  return url.pathname.replace(/^\//, '');
}

/** Formal gültiger, zufälliger Raumcode (für den 404-Test). */
export function randomRoomCode(rand = Math.random) {
  let s = '';
  for (let i = 0; i < 6; i++) s += ROOM_CODE_ALPHABET[Math.floor(rand() * ROOM_CODE_ALPHABET.length)];
  return s;
}

/** Lange Detailtexte für die Ausgabe kürzen. */
export function shorten(text, max = 400) {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Grobe Prüfung, dass eine Fehlermeldung deutsch und anzeigbar ist. */
export function isGermanError(text) {
  return typeof text === 'string' && text.trim().length > 0
    && /[äöüÄÖÜß]|\b(nicht|kein|keine|gibt|bitte|Raum|ungültig)\b/i.test(text);
}

// --- HTTP ---------------------------------------------------------------------------------

/** Rohe Anfrage ohne automatisches Dekomprimieren und ohne Redirect-Folgen. */
function request(url, { method = 'GET', headers = {}, body = null, timeout = 15000 } = {}) {
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(url, { method, headers: { 'user-agent': 'rps-check-deploy', ...headers }, timeout }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ url, status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error(`Zeitüberschreitung nach ${timeout} ms`)));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// --- Ablauf -------------------------------------------------------------------------------

export async function run(baseInput, out = console.log) {
  const base = normalizeBase(baseInput);
  const isHttps = base.protocol === 'https:';
  const results = [];
  const responses = [];
  const section = (title) => out(`\n${title}`);
  const report = (state, name, detail = '') => {
    results.push(state);
    const sign = { ok: '✔', fail: '✘', skip: '○' }[state];
    out(`  ${sign} ${name}${detail ? ` – ${shorten(String(detail))}` : ''}`);
  };
  const check = (cond, name, detail) => report(cond ? 'ok' : 'fail', name, cond ? '' : detail);

  const get = async (path, opts = {}) => {
    const res = await request(new URL(path, base), opts);
    responses.push({ path: path || '/', res });
    return res;
  };

  out(`Prüfe ${base.href}`);

  // 1. Startseite
  section('Startseite');
  let index;
  try {
    index = await get('');
  } catch (e) {
    report('fail', 'Startseite erreichbar', e.message || e.code || String(e));
    return finish();
  }
  check(index.status === 200, 'Startseite liefert 200', `HTTP ${index.status}`);
  check(mimeOf(index.headers['content-type']) === 'text/html'
    && /charset=utf-8/i.test(index.headers['content-type'] ?? ''),
  'Content-Type text/html; charset=utf-8', index.headers['content-type']);
  const indexHtml = index.body.toString('utf8');

  // 2. Sicherheitsheader
  section('Sicherheitsheader');
  const headerProblems = checkSecurityHeaders(index.headers);
  check(headerProblems.length === 0, 'CSP exakt, Referrer-Policy, nosniff, X-Frame-Options, Permissions-Policy, COOP, CORP',
    headerProblems.join('; '));
  check(!index.headers['x-powered-by'], 'kein X-Powered-By', index.headers['x-powered-by']);
  if (isHttps) {
    const p = checkHsts(headerValue(index.headers, 'strict-transport-security'));
    check(p === null, 'HSTS gesetzt', p);
    try {
      const plain = new URL(base.href);
      plain.protocol = 'http:';
      const r = await request(plain);
      responses.push({ path: plain.href, res: r });
      const loc = r.headers.location ?? '';
      check([301, 308].includes(r.status) && loc.startsWith('https://'), 'HTTP leitet dauerhaft auf HTTPS um',
        `HTTP ${r.status} ${loc}`);
    } catch (e) {
      report('fail', 'HTTP leitet dauerhaft auf HTTPS um', e.message);
    }
  } else {
    report('skip', 'HSTS', 'übersprungen (kein HTTPS)');
    report('skip', 'HTTP → HTTPS-Umleitung', 'übersprungen (kein HTTPS)');
  }

  // 3. Gesperrte Pfade
  section('Gesperrte Pfade');
  for (const path of FORBIDDEN_PATHS) {
    const r = await get(path);
    check(r.status === 403, `/${path} → 403`, `HTTP ${r.status}`);
  }

  // 4. API
  section('API');
  const apiGet = await get('api.php');
  check(apiGet.status === 405, 'GET /api.php → 405', `HTTP ${apiGet.status}`);
  check(/\bPOST\b/.test(apiGet.headers.allow ?? ''), 'Allow: POST', apiGet.headers.allow ?? 'fehlt');
  const code = randomRoomCode();
  const info = await get('api.php', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'info', code }),
  });
  let infoJson = null;
  try { infoJson = JSON.parse(info.body.toString('utf8')); } catch { /* unten gemeldet */ }
  check(info.status === 404, `info mit unbekanntem Code (${code}) → 404`, `HTTP ${info.status}`);
  check(mimeOf(info.headers['content-type']) === 'application/json' && infoJson !== null,
    'Antwort ist JSON', info.headers['content-type']);
  check(isGermanError(infoJson?.error), 'Fehlertext deutsch', JSON.stringify(infoJson));
  check(/no-store/.test(info.headers['cache-control'] ?? ''), 'API: Cache-Control no-store',
    info.headers['cache-control'] ?? 'fehlt');

  // 5. Assets einsammeln (HTML → CSS/JS/Manifest → Imports, Fonts, Icons)
  section('Assets & Content-Types');
  const texts = new Map([['index.html', indexHtml]]);
  const assets = new Map(); // Pfad → Antwort (unkomprimiert angefordert)
  const queue = extractHtmlRefs(indexHtml).map((r) => resolveRef('index.html', r));
  queue.push('robots.txt', 'favicon.ico');
  while (queue.length) {
    const path = queue.shift();
    if (assets.has(path)) continue;
    const r = await get(path, { headers: { 'accept-encoding': 'identity' } });
    assets.set(path, r);
    const ext = extensionOf(path);
    if (r.status !== 200) continue;
    if (['js', 'css', 'webmanifest', 'svg', 'html', 'txt'].includes(ext)) texts.set(path, r.body.toString('utf8'));
    if (ext === 'js') queue.push(...extractJsImports(texts.get(path)).map((x) => resolveRef(path, x)));
    if (ext === 'css') queue.push(...extractCssUrls(texts.get(path)).map((x) => resolveRef(path, x)));
    if (ext === 'webmanifest') {
      try {
        const manifest = JSON.parse(texts.get(path));
        for (const icon of manifest.icons ?? []) queue.push(resolveRef(path, icon.src));
        const need = ['name', 'short_name', 'start_url', 'display', 'icons'];
        const missing = need.filter((k) => !manifest[k]);
        const sizes = new Set((manifest.icons ?? []).map((i) => i.sizes));
        check(missing.length === 0 && sizes.has('192x192') && sizes.has('512x512'),
          'Manifest vollständig (Name, Start-URL, Icons 192/512)', `fehlt: ${missing.join(', ') || 'PNG 192/512'}`);
      } catch {
        report('fail', 'Manifest ist gültiges JSON', path);
      }
    }
  }
  const missing = [...assets].filter(([, r]) => r.status !== 200).map(([p, r]) => `${p} (${r.status})`);
  check(missing.length === 0, `alle ${assets.size} verlinkten Dateien liefern 200`, missing.join(', '));

  const byExt = new Map();
  for (const [path, r] of assets) {
    const ext = extensionOf(path);
    if (!CONTENT_TYPES[ext] || r.status !== 200) continue;
    if (!byExt.has(ext)) byExt.set(ext, []);
    byExt.get(ext).push([path, mimeOf(r.headers['content-type'])]);
  }
  for (const ext of ['js', 'css', 'woff2', 'webmanifest', 'svg', 'png']) {
    const list = byExt.get(ext) ?? [];
    const wrong = list.filter(([, t]) => t !== CONTENT_TYPES[ext]).map(([p, t]) => `${p}: ${t || 'fehlt'}`);
    check(list.length > 0 && wrong.length === 0, `.${ext} als ${CONTENT_TYPES[ext]} (${list.length})`,
      list.length ? wrong.join(', ') : 'keine Datei gefunden');
  }

  // 6. Externe URLs
  section('Externe Ressourcen');
  const external = [];
  for (const [file, text] of texts) {
    for (const url of findExternalUrls(text)) if (!isAllowedUrl(url, file)) external.push(`${file}: ${url}`);
  }
  check(external.length === 0, `keine fremden URLs in ${texts.size} Dateien (HTML/CSS/JS/Manifest)`,
    external.join('; '));

  // 7. Kompression
  section('Kompression');
  for (const path of ['assets/js/main.js', 'assets/css/app.css']) {
    const r = await get(path, { headers: { 'accept-encoding': 'gzip, deflate' } });
    const enc = r.headers['content-encoding'] ?? '';
    check(/^(gzip|deflate|br)$/i.test(enc), `${path} komprimiert`, enc || 'keine Content-Encoding');
  }

  // 8. Caching
  section('Cache-Header');
  check(/no-store/.test(index.headers['cache-control'] ?? ''), 'index.html: no-store',
    index.headers['cache-control'] ?? 'fehlt');
  const cacheRule = (exts, min, label) => {
    const list = [...assets].filter(([p, r]) => exts.includes(extensionOf(p)) && r.status === 200);
    const bad = list.filter(([, r]) => (maxAge(r.headers['cache-control']) ?? 0) < min)
      .map(([p, r]) => `${p}: ${r.headers['cache-control'] ?? 'fehlt'}`);
    check(list.length > 0 && bad.length === 0, label, bad.join(', ') || 'keine Datei gefunden');
  };
  cacheRule(['js', 'css'], 60, 'JS/CSS: max-age gesetzt');
  cacheRule(['woff2', 'png'], 86400, 'Fonts/PNG: max-age ≥ 1 Tag');

  // 9. Querschnitt über alle Antworten
  section('Alle Antworten');
  const cookies = responses.filter(({ res }) => res.headers['set-cookie']).map(({ path }) => path);
  check(cookies.length === 0, `kein Set-Cookie (${responses.length} Antworten)`, cookies.join(', '));
  const noHeaders = responses
    .filter(({ res }) => res.status < 300 || res.status >= 400) // Umleitungen zählen nicht
    .filter(({ res }) => checkSecurityHeaders(res.headers).length > 0)
    .map(({ path, res }) => `${path} (${res.status})`);
  check(noHeaders.length === 0, 'Sicherheitsheader auf jeder Antwort (auch 403/404/405)', noHeaders.join(', '));

  return finish();

  function finish() {
    const failed = results.filter((s) => s === 'fail').length;
    const skipped = results.filter((s) => s === 'skip').length;
    const passed = results.filter((s) => s === 'ok').length;
    out(`\n${failed ? '✘' : '✔'} ${passed} ok, ${failed} fehlgeschlagen, ${skipped} übersprungen`);
    if (!isHttps) out('  Hinweis: HTTPS-Prüfungen nur gegen https://… möglich.');
    out('  Von Hand: Konsole ohne Fehler, Netzwerk-Tab ohne fremde Domains, Duell mit zwei Geräten.');
    return failed === 0;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const ok = await run(process.argv[2]);
    process.exitCode = ok ? 0 : 1;
  } catch (e) {
    console.error(`✘ ${e.message}`);
    process.exitCode = 2;
  }
}
