// Computer-Setup: Stufe, Variante, Best of. Letzte Wahl wird gemerkt.
import { h } from './dom.js';
import { icon } from './icons.js';
import { screenLayout, choiceGroup, nameInput } from './components.js';
import { AI_LEVELS } from '../ai.js';
import { BEST_OF, VARIANTS, VARIANT_NAMES, targetWins } from '../rules.js';
import { handIcon } from '../hands.js';
import { hrefFor } from '../router.js';

export const title = 'Gegen Computer';

const LEVEL_COLUMNS = 2;

function variantIcons(variant) {
  return h('span', { class: 'choice__icons', 'aria-hidden': 'true' }, VARIANTS[variant].map((m) => handIcon(m)));
}

export function render({ settings, navigate }) {
  const setup = { ...settings.getCpuSetup() };
  const save = (patch) => Object.assign(setup, settings.setCpuSetup({ ...setup, ...patch }));
  const { el, body } = screenLayout({ id: 'cpu', title: 'Gegen Computer', subtitle: 'Wähle deinen Gegner' });

  const level = choiceGroup({
    label: 'Stufe', name: 'level', value: setup.level, columns: LEVEL_COLUMNS,
    options: AI_LEVELS.map((l) => ({
      value: l.level, label: l.name, description: l.description,
      extra: h('span', { class: 'choice__level', 'aria-hidden': 'true' }, String(l.level)),
    })),
    onChange: (v) => save({ level: Number(v) }),
  });
  const variant = choiceGroup({
    label: 'Variante', name: 'variant', value: setup.variant,
    options: Object.keys(VARIANTS).map((v) => ({ value: v, label: VARIANT_NAMES[v], extra: variantIcons(v) })),
    onChange: (v) => save({ variant: v }),
  });
  const bestOf = choiceGroup({
    label: 'Länge', name: 'bestOf', value: setup.bestOf,
    options: BEST_OF.map((n) => ({ value: n, label: `Best of ${n}`, description: `${targetWins(n)} Siege nötig` })),
    onChange: (v) => save({ bestOf: Number(v) }),
  });

  const start = h('button', {
    type: 'button', class: 'btn btn--primary btn--lg btn--start',
    onclick: () => { settings.setCpuSetup(setup); navigate(hrefFor('play')); },
  }, 'Los geht’s!', icon('sparkle'));

  body.append(
    h('div', { class: 'setup glass' }, level.el, variant.el, bestOf.el, nameInput({ settings, id: 'cpu-name' }).el),
    h('div', { class: 'sticky-action' }, start));
  return { el };
}
