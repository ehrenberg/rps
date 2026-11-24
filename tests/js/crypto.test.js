import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sha256Hex, sha256Fallback, commitHash, randomHex, randomInt } from '../../public/assets/js/crypto.js';

const enc = new TextEncoder();

test('SHA-256 bekannte Werte (subtle + Fallback)', async () => {
  const cases = {
    '': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    abc: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  };
  for (const [s, h] of Object.entries(cases)) {
    assert.equal(await sha256Hex(s), h);
    assert.equal(sha256Fallback(enc.encode(s)), h);
  }
  const long = 'ä€'.repeat(100);
  assert.equal(sha256Fallback(enc.encode(long)), await sha256Hex(long));
});

test('commitHash Format', async () => {
  assert.equal(await commitHash('rock', 'ab'), await sha256Hex('rock:ab'));
  assert.match(randomHex(), /^[0-9a-f]{32}$/);
  for (let i = 0; i < 100; i++) { const r = randomInt(3); assert.ok(r >= 0 && r < 3); }
});
