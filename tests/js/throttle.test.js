import { test } from 'node:test';
import assert from 'node:assert/strict';
import { singleFlight, createCooldown } from '../../public/assets/js/throttle.js';

const tick = () => new Promise((r) => setImmediate(r));

test('singleFlight: zweiter Aufruf während laufender Anfrage wird ignoriert', async () => {
  let calls = 0;
  let resolve;
  const changes = [];
  const run = singleFlight(() => { calls += 1; return new Promise((r) => { resolve = r; }); }, { onChange: (busy) => changes.push(busy) });
  const first = run();
  assert.equal(run(), null, 'Doppelklick ignoriert');
  assert.equal(run.busy, true);
  assert.equal(calls, 1);
  resolve('ok');
  assert.equal(await first, 'ok');
  assert.equal(run.busy, false);
  assert.deepEqual(changes, [true, false]);
  run();
  assert.equal(calls, 2, 'danach wieder möglich');
});

test('singleFlight: Fehler gibt die Sperre frei und wird weitergereicht', async () => {
  const run = singleFlight(async () => { throw new Error('kaputt'); });
  await assert.rejects(run(), /kaputt/);
  assert.equal(run.busy, false);
  await tick();
  const again = run();
  assert.notEqual(again, null, 'nach Fehler wieder möglich');
  await assert.rejects(again, /kaputt/);
});

test('createCooldown: erlaubt einmal je Intervall, meldet Zustand', () => {
  const pending = [];
  const timers = { setTimeout: (fn, ms) => { pending.push({ fn, ms }); return pending.length; }, clearTimeout() {} };
  const changes = [];
  const cd = createCooldown(1000, { timers, onChange: (on) => changes.push(on) });
  assert.equal(cd.take(), true);
  assert.equal(cd.take(), false);
  assert.equal(cd.active, true);
  assert.equal(pending[0].ms, 1000);
  pending.shift().fn();
  assert.equal(cd.active, false);
  assert.equal(cd.take(), true);
  assert.deepEqual(changes, [true, false, true]);
});
