// Reaktionsleiste (Arena und Turnierbaum): Emoji-Buttons mit Sperre, eigenes Emoji schwebt sofort hoch.
import { h, centerOf } from './dom.js';
import { createCooldown } from '../throttle.js';
import { REACTIONS } from '../rules.js';
import * as fx from '../fx.js';
import * as audio from '../audio.js';

/** Server erlaubt 1 Reaktion pro Sekunde. */
export const REACTION_COOLDOWN_MS = 1000;

/**
 * @param {{ onReact:(emoji:string)=>void, hidden?:boolean }} o
 * @returns {{ el: HTMLElement }}
 */
export function reactionBar({ onReact, hidden = false }) {
  const el = h('div', { class: 'reactions', role: 'group', 'aria-label': 'Reaktion senden', hidden });
  const cooldown = createCooldown(REACTION_COOLDOWN_MS, {
    onChange: (on) => el.classList.toggle('reactions--cooldown', on),
  });
  const send = (emoji, btn) => {
    if (!cooldown.take()) return;
    fx.floatEmoji(emoji, { x: centerOf(btn).x });
    audio.play('pop');
    onReact(emoji);
  };
  el.append(...REACTIONS.map((emoji) => h('button', {
    type: 'button', class: 'reactions__btn', 'aria-label': `Reaktion ${emoji}`,
    onclick: (e) => send(emoji, e.currentTarget),
  }, emoji)));
  return { el };
}
