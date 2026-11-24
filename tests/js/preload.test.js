// index.html lädt genau den statischen Import-Graphen von main.js per modulepreload vor.
// Dynamisch nachgeladene Screens (import(...) in main.js) dürfen dort nicht stehen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
const JS = join(PUBLIC, 'assets', 'js');
const STATIC_IMPORT = /^import[^'"]*['"](\.[^'"]+)['"]/gm;

function staticGraph(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const src = readFileSync(join(JS, file), 'utf8');
    for (const [, spec] of src.matchAll(STATIC_IMPORT)) queue.push(normalize(join(dirname(file), spec)));
  }
  return seen;
}

test('modulepreload-Liste in index.html = statischer Import-Graph von main.js', () => {
  const html = readFileSync(join(PUBLIC, 'index.html'), 'utf8');
  const preloaded = [...html.matchAll(/<link rel="modulepreload" href="assets\/js\/([^"]+)">/g)].map((m) => m[1]);
  assert.equal(new Set(preloaded).size, preloaded.length, 'keine doppelten Einträge');
  assert.deepEqual(new Set(preloaded), staticGraph('main.js'));
});

test('main.js lädt die übrigen Screens dynamisch (Startseite bleibt schlank)', () => {
  const graph = staticGraph('main.js');
  for (const lazy of ['ui/arena-screen.js', 'ui/room.js', 'qr.js', 'online-opponent.js']) {
    assert.ok(!graph.has(lazy), `${lazy} gehört nicht in den Start-Graphen`);
  }
});
