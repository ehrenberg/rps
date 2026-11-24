import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeName, normalizeCpuSetup, createSettings, safeStorage, KEYS, DEFAULT_CPU_SETUP, NAME_MAX_LENGTH,
} from '../../public/assets/js/settings.js';

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    map,
  };
}

test('sanitizeName: trimmt, entfernt Steuerzeichen, fasst Leerraum zusammen', () => {
  assert.equal(sanitizeName('  Anna  '), 'Anna');
  assert.equal(sanitizeName('An\u0000na\n\tB'), 'Anna B');
  assert.equal(sanitizeName(null), '');
  assert.equal(sanitizeName('<b>x</b>'), '<b>x</b>'); // Escaping macht die Ausgabe (textContent)
});

test('sanitizeName: max. 20 Zeichen, Emojis zählen als ein Zeichen', () => {
  assert.equal(sanitizeName('x'.repeat(30)).length, NAME_MAX_LENGTH);
  assert.equal(Array.from(sanitizeName('😀'.repeat(25))).length, NAME_MAX_LENGTH);
});

test('normalizeCpuSetup: gültige Werte bleiben, ungültige → Standard', () => {
  assert.deepEqual(normalizeCpuSetup({ level: 4, variant: 'lizard', bestOf: 5 }), { level: 4, variant: 'lizard', bestOf: 5 });
  assert.deepEqual(normalizeCpuSetup({ level: 9, variant: 'x', bestOf: 7 }), { ...DEFAULT_CPU_SETUP });
  assert.deepEqual(normalizeCpuSetup(null), { ...DEFAULT_CPU_SETUP });
  assert.deepEqual(normalizeCpuSetup({ level: '3', bestOf: '5' }), { level: 3, variant: 'classic', bestOf: 5 });
});

test('createSettings: Name speichern, löschen', () => {
  const st = memoryStorage();
  const s = createSettings(st);
  assert.equal(s.getName(), '');
  assert.equal(s.setName('  Bo  '), 'Bo');
  assert.equal(st.getItem(KEYS.name), 'Bo');
  assert.equal(s.getName(), 'Bo');
  s.setName('   ');
  assert.equal(st.getItem(KEYS.name), null);
});

test('createSettings: Flags als "1"/"0"', () => {
  const st = memoryStorage();
  const s = createSettings(st);
  assert.equal(s.getReducedFx(), false);
  s.setReducedFx(true);
  assert.equal(st.getItem(KEYS.reducedFx), '1');
  assert.equal(s.getReducedFx(), true);
  s.setInsight(false);
  assert.equal(st.getItem(KEYS.insight), '0');
  assert.equal(s.getInsight(), false);
});

test('createSettings: CPU-Setup merken, kaputtes JSON verkraften', () => {
  const st = memoryStorage();
  const s = createSettings(st);
  assert.deepEqual(s.getCpuSetup(), { ...DEFAULT_CPU_SETUP });
  s.setCpuSetup({ level: 2, variant: 'lizard', bestOf: 5 });
  assert.deepEqual(s.getCpuSetup(), { level: 2, variant: 'lizard', bestOf: 5 });
  st.setItem(KEYS.cpuSetup, '{kaputt');
  assert.deepEqual(s.getCpuSetup(), { ...DEFAULT_CPU_SETUP });
});

test('alle Schlüssel haben das Präfix rps.', () => {
  for (const key of Object.values(KEYS)) assert.match(key, /^rps\./);
});

test('safeStorage: wirft nie, auch ohne Backend', () => {
  const throwing = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } };
  for (const backend of [throwing, undefined]) {
    const s = safeStorage(backend);
    assert.equal(s.getItem('a'), null);
    s.setItem('a', '1');
    s.removeItem('a');
  }
});
