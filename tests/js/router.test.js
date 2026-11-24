import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHash, hrefFor, isRoomCode, ROUTES } from '../../public/assets/js/router.js';

test('leerer Hash und "#/" → Startseite', () => {
  assert.deepEqual(parseHash(''), { name: 'home', params: {} });
  assert.deepEqual(parseHash('#'), { name: 'home', params: {} });
  assert.deepEqual(parseHash('#/'), { name: 'home', params: {} });
  assert.deepEqual(parseHash(undefined), { name: 'home', params: {} });
});

test('bekannte Pfade, auch mit abschließendem Slash', () => {
  for (const [name, path] of Object.entries(ROUTES)) {
    assert.equal(parseHash(`#${path}`).name, name);
  }
  assert.equal(parseHash('#/stats/').name, 'stats');
});

test('Raumcode wird erkannt', () => {
  assert.deepEqual(parseHash('#k7f3qa'), { name: 'room', params: { code: 'k7f3qa' } });
});

test('ungültige Raumcodes (verbotene Zeichen, falsche Länge, Großbuchstaben)', () => {
  for (const bad of ['k7f3q', 'k7f3qaa', 'k7f3q1', 'k7f3qo', 'K7F3QA', 'k7f3ql', 'k7f3qi']) {
    assert.equal(isRoomCode(bad), false, bad);
    assert.equal(parseHash(`#${bad}`).name, 'notFound', bad);
  }
});

test('unbekannter Pfad → notFound mit Pfad', () => {
  assert.deepEqual(parseHash('#/gibtsnicht'), { name: 'notFound', params: { path: '/gibtsnicht' } });
});

test('hrefFor ist die Umkehrung von parseHash', () => {
  for (const name of Object.keys(ROUTES)) assert.equal(parseHash(hrefFor(name)).name, name);
  assert.equal(hrefFor('room', { code: 'abc234' }), '#abc234');
  assert.throws(() => hrefFor('room', { code: 'nope' }));
  assert.throws(() => hrefFor('unbekannt'));
});
