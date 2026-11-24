import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyStyle } from '../../public/assets/js/ui/dom.js';

test('applyStyle: Custom Properties (--x) per setProperty, normale Eigenschaften direkt', () => {
  const set = [];
  const style = { setProperty: (k, v) => set.push([k, v]) };
  applyStyle({ style }, { '--cols': '3', flexGrow: '2', width: '50%' });
  assert.deepEqual(set, [['--cols', '3']]);
  assert.equal(style.flexGrow, '2');
  assert.equal(style.width, '50%');
  assert.equal(style['--cols'], undefined, 'nicht als (wirkungslose) Eigenschaft gesetzt');
});
