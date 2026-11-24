// Arena-Screen: verbindet einen Gegner-Adapter (Computer oder Online) mit Controller und Ansicht.
import { createArenaView } from './arena-view.js';
import { createArenaController } from '../arena.js';
import { moveForKey } from '../move-keys.js';
import { createCpuOpponent } from '../cpu-opponent.js';
import { AI_LEVELS } from '../ai.js';
import { VARIANT_NAMES } from '../rules.js';
import * as stats from '../stats.js';

export const title = 'Arena';
export const DEFAULT_PLAYER_NAME = 'Du';

function isTypingTarget(target) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

/**
 * Arena für beliebigen Adapter aufbauen.
 * @param {{ adapter, settings, announce, modeLabel:string, myName?:string, againLabel?:string,
 *           onAgain?:(controller)=>void, onLeave?:()=>void }} o
 *   onAgain: Standard = controller.rematch() (Nochmal/Revanche); Turnier: zurück zum Baum.
 */
export function mountArena({ adapter, settings, announce, modeLabel, myName, againLabel, onAgain, onLeave }) {
  let controller = null;
  const { variant } = adapter.info;
  const view = createArenaView({
    myName: myName || settings.getName() || DEFAULT_PLAYER_NAME,
    modeLabel,
    announce,
    againLabel,
    insightOn: settings.getInsight(),
    onInsightToggle: (on) => settings.setInsight(on),
    onChoose: (move) => controller.choose(move),
    onAgain: () => (onAgain ? onAgain(controller) : controller.rematch()),
    onReact: (emoji) => controller.react(emoji),
    onClaim: () => controller.claim(),
    onLeave,
  });
  controller = createArenaController({ adapter, view, stats });

  const onKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || isTypingTarget(e.target)) return;
    const move = moveForKey(e.key, variant);
    if (move && controller.choose(move)) e.preventDefault();
  };
  document.addEventListener('keydown', onKey);
  controller.start();

  return {
    el: view.el,
    focus: view.focus,
    controller,
    dispose() {
      document.removeEventListener('keydown', onKey);
      controller.dispose();
      view.dispose();
    },
  };
}

/** Route #/play: Spiel gegen den Computer mit dem gespeicherten Setup. */
export function render({ settings, announce }) {
  const setup = settings.getCpuSetup();
  const levelName = AI_LEVELS.find((l) => l.level === setup.level)?.name ?? '';
  return mountArena({
    adapter: createCpuOpponent(setup),
    settings,
    announce,
    modeLabel: `${levelName} · ${VARIANT_NAMES[setup.variant]} · Best of ${setup.bestOf}`,
  });
}
