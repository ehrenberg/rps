// Arena-Screen für „Gegen Computer“: verbindet CPU-Adapter, Controller und Ansicht.
// Für Online später: nur der Adapter (und modeLabel) ändert sich.
import { createArenaView } from './arena-view.js';
import { createArenaController, moveForKey } from '../arena.js';
import { createCpuOpponent } from '../cpu-opponent.js';
import { AI_LEVELS } from '../ai.js';
import { VARIANT_NAMES } from '../rules.js';
import * as stats from '../stats.js';

export const title = 'Arena';
const DEFAULT_PLAYER_NAME = 'Du';

function isTypingTarget(target) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

export function render({ settings, announce }) {
  const setup = settings.getCpuSetup();
  const levelName = AI_LEVELS.find((l) => l.level === setup.level)?.name ?? '';
  const adapter = createCpuOpponent(setup);
  let controller = null;

  const view = createArenaView({
    myName: settings.getName() || DEFAULT_PLAYER_NAME,
    modeLabel: `${levelName} · ${VARIANT_NAMES[setup.variant]} · Best of ${setup.bestOf}`,
    announce,
    insightOn: settings.getInsight(),
    onInsightToggle: (on) => settings.setInsight(on),
    onChoose: (move) => controller.choose(move),
    onAgain: () => controller.rematch(),
    onReact: (emoji) => controller.react(emoji),
  });
  controller = createArenaController({ adapter, view, stats });

  const onKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || isTypingTarget(e.target)) return;
    const move = moveForKey(e.key, setup.variant);
    if (move && controller.choose(move)) e.preventDefault();
  };
  document.addEventListener('keydown', onKey);
  controller.start();

  return {
    el: view.el,
    focus: view.focus,
    dispose() {
      document.removeEventListener('keydown', onKey);
      controller.dispose();
    },
  };
}
