import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EXPECTED_CSP, REQUIRED_HEADERS, normalizeBase, headerValue, mimeOf, extensionOf, checkSecurityHeaders,
  checkHsts, maxAge, findExternalUrls, isAllowedUrl, extractHtmlRefs, extractJsImports, extractCssUrls,
  resolveRef, randomRoomCode, isGermanError, shorten, ROOM_CODE_ALPHABET,
} from '../../scripts/check-deploy.mjs';

const htaccess = readFileSync(new URL('../../public/.htaccess', import.meta.url), 'utf8');

function goodHeaders() {
  const h = {};
  for (const [k, v] of Object.entries(REQUIRED_HEADERS)) h[k] = v;
  h['permissions-policy'] = 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()';
  return h;
}

test('erwartete Header stimmen mit public/.htaccess überein', () => {
  const csp = /Content-Security-Policy "([^"]+)"/.exec(htaccess)[1];
  assert.equal(csp, EXPECTED_CSP);
  for (const [name, value] of Object.entries(REQUIRED_HEADERS)) {
    if (name === 'content-security-policy') continue;
    const re = new RegExp(`Header always set ${name} "([^"]+)"`, 'i');
    assert.equal(re.exec(htaccess)?.[1], value, name);
  }
  const pp = /Permissions-Policy "([^"]+)"/.exec(htaccess)[1];
  assert.deepEqual(checkSecurityHeaders({ ...goodHeaders(), 'permissions-policy': pp }), []);
});

test('normalizeBase: Slash ergänzen, nur http(s), Fehlermeldung ohne Argument', () => {
  assert.equal(normalizeBase('https://rps.bastianswelt.de').href, 'https://rps.bastianswelt.de/');
  assert.equal(normalizeBase('http://localhost:8093/sub#/x?y').href, 'http://localhost:8093/sub/');
  assert.throws(() => normalizeBase('ftp://x'), /http/);
  assert.throws(() => normalizeBase(undefined), /Basis-URL fehlt/);
});

test('headerValue, mimeOf, extensionOf, maxAge', () => {
  assert.equal(headerValue({ 'set-cookie': ['a=1', 'b=2'] }, 'Set-Cookie'), 'a=1, b=2');
  assert.equal(headerValue({}, 'x'), null);
  assert.equal(mimeOf('Text/JavaScript; charset=utf-8'), 'text/javascript');
  assert.equal(mimeOf(undefined), '');
  assert.equal(extensionOf('assets/js/main.js?v=1'), 'js');
  assert.equal(extensionOf('data/'), '');
  assert.equal(maxAge('public, max-age=3600, must-revalidate'), 3600);
  assert.equal(maxAge('no-store'), null);
});

test('checkSecurityHeaders: vollständige Header sind ok, Abweichungen werden benannt', () => {
  assert.deepEqual(checkSecurityHeaders(goodHeaders()), []);
  const h = goodHeaders();
  delete h['referrer-policy'];
  h['content-security-policy'] = "default-src *";
  h['x-content-type-options'] = 'nosniff, nosniff'; // doppelt gesetzt
  h['permissions-policy'] = 'camera=()';
  const p = checkSecurityHeaders(h).join('\n');
  assert.match(p, /referrer-policy fehlt/);
  assert.match(p, /content-security-policy = "default-src \*"/);
  assert.match(p, /x-content-type-options/);
  assert.match(p, /microphone=\(\) fehlt/);
});

test('checkHsts', () => {
  assert.equal(checkHsts('max-age=31536000'), null);
  assert.equal(checkHsts('max-age=31536000; includeSubDomains'), null);
  assert.match(checkHsts(null), /fehlt/);
  assert.match(checkHsts('max-age=60'), /kürzer/);
  assert.match(checkHsts('includeSubDomains'), /ohne max-age/);
});

test('findExternalUrls findet absolute und protokoll-relative URLs, keine Kommentare', () => {
  const js = `// Start, Routing\nconst a = 'https://cdn.example.com/x.js';\nimport x from "//evil.example.org/y.js";\n`
    + 'fetch(`http://api.example.net/v1`);\nconst ns = \'http://www.w3.org/2000/svg\';';
  const urls = findExternalUrls(js);
  assert.deepEqual(urls.sort(), [
    '//evil.example.org/y.js', 'http://api.example.net/v1', 'http://www.w3.org/2000/svg',
    'https://cdn.example.com/x.js',
  ]);
  assert.deepEqual(findExternalUrls("src: url('../fonts/a.woff2'); // nichts"), []);
  assert.deepEqual(findExternalUrls('@import url(https://fonts.googleapis.com/css2?family=X);'),
    ['https://fonts.googleapis.com/css2?family=X']);
});

test('isAllowedUrl: Namespaces überall, Footer-Links nur in index.html', () => {
  assert.equal(isAllowedUrl('http://www.w3.org/2000/svg', 'assets/js/hands.js'), true);
  assert.equal(isAllowedUrl('https://bastianswelt.de/impressum', 'index.html'), true);
  assert.equal(isAllowedUrl('https://bastianswelt.de/datenschutz', 'index.html'), true);
  assert.equal(isAllowedUrl('https://bastianswelt.de/impressum', 'assets/js/main.js'), false);
  assert.equal(isAllowedUrl('https://bastianswelt.de/tracker.js', 'index.html'), false);
  assert.equal(isAllowedUrl('https://cdn.example.com/x.js', 'index.html'), false);
});

test('echte index.html enthält nur erlaubte externe URLs', () => {
  const html = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');
  const bad = findExternalUrls(html).filter((u) => !isAllowedUrl(u, 'index.html'));
  assert.deepEqual(bad, []);
});

test('extractHtmlRefs: nur lokale Verweise', () => {
  const html = '<link rel="icon" href="favicon.ico"><script src="assets/js/main.js"></script>'
    + '<a href="https://bastianswelt.de/impressum">x</a><a href="#app">y</a><img src="data:image/png;base64,AA">'
    + '<a href="mailto:a@b.c">m</a>';
  assert.deepEqual(extractHtmlRefs(html), ['favicon.ico', 'assets/js/main.js']);
});

test('extractJsImports: statisch, dynamisch, Re-Exports, Side-Effect-Imports', () => {
  const src = `import { a } from './a.js';\nimport * as b from "../b.js";\nexport { c } from './c.js';\n`
    + `import './d.js';\nconst e = await import('./e.js');\nimport x from 'node:fs';\n`
    + 'import {\n  f,\n  g,\n} from \'./fg.js\';';
  assert.deepEqual(extractJsImports(src).sort(), ['../b.js', './a.js', './c.js', './d.js', './e.js', './fg.js']);
});

test('extractCssUrls und resolveRef', () => {
  const css = "src: url('../fonts/a.woff2') format('woff2'); background: url(data:image/png;base64,AA); @import 'fx.css';";
  assert.deepEqual(extractCssUrls(css), ['../fonts/a.woff2', 'fx.css']);
  assert.equal(resolveRef('assets/css/app.css', '../fonts/a.woff2'), 'assets/fonts/a.woff2');
  assert.equal(resolveRef('assets/js/ui/home.js', '../rules.js'), 'assets/js/rules.js');
  assert.equal(resolveRef('index.html', 'assets/js/main.js'), 'assets/js/main.js');
});

test('randomRoomCode: 6 Zeichen aus dem Server-Alphabet', () => {
  const validate = readFileSync(new URL('../../public/src/validate.php', import.meta.url), 'utf8');
  assert.equal(/RPS_CODE_ALPHABET = '([^']+)'/.exec(validate)[1], ROOM_CODE_ALPHABET);
  let i = 0;
  const seq = [0, 0.5, 0.999, 0.1, 0.2, 0.3];
  const code = randomRoomCode(() => seq[i++]);
  assert.equal(code.length, 6);
  assert.ok([...code].every((c) => ROOM_CODE_ALPHABET.includes(c)));
  assert.equal(code[0], '2');
  assert.equal(code[2], 'z');
});

test('isGermanError und shorten', () => {
  assert.equal(isGermanError('Diesen Raum gibt es nicht (mehr).'), true);
  assert.equal(isGermanError('Room not found'), false);
  assert.equal(isGermanError(''), false);
  assert.equal(isGermanError(undefined), false);
  assert.equal(shorten('abc', 10), 'abc');
  assert.equal(shorten('abcdefghijkl', 5), 'abcd…');
});
