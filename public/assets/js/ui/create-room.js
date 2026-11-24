// Raum erstellen (Online-Duell oder Turnier): Name, Variante, Best of → create → #code.
import { h } from './dom.js';
import { icon } from './icons.js';
import { screenLayout, choiceGroup, nameInput } from './components.js';
import { showError, showToast } from './toast.js';
import { BEST_OF, VARIANTS, VARIANT_NAMES, targetWins } from '../rules.js';
import { handIcon } from '../hands.js';
import { api, createRoomSession } from '../net.js';
import { hrefFor } from '../router.js';

const KINDS = Object.freeze({
  duel: { title: 'Online-Duell', subtitle: 'Raum erstellen, Link schicken, losspielen', button: 'Duell erstellen', icon: 'duel' },
  tournament: { title: 'Turnier', subtitle: '3 bis 16 Leute, K.-o.-System', button: 'Turnier erstellen', icon: 'trophy' },
});

export function createRoomScreen(type) {
  const k = KINDS[type];
  return {
    title: k.title,
    render({ settings, navigate }) {
      const cpu = settings.getCpuSetup();
      const setup = { variant: cpu.variant, bestOf: cpu.bestOf };
      const { el, body } = screenLayout({ id: `create-${type}`, title: k.title, subtitle: k.subtitle });
      const name = nameInput({ settings, id: `${type}-name` });
      const variant = choiceGroup({
        label: 'Variante', name: 'variant', value: setup.variant,
        options: Object.keys(VARIANTS).map((v) => ({
          value: v, label: VARIANT_NAMES[v],
          extra: h('span', { class: 'choice__icons', 'aria-hidden': 'true' }, VARIANTS[v].map((m) => handIcon(m))),
        })),
        onChange: (v) => { setup.variant = v; },
      });
      const bestOf = choiceGroup({
        label: 'Länge', name: 'bestOf', value: setup.bestOf,
        options: BEST_OF.map((n) => ({ value: n, label: `Best of ${n}`, description: `${targetWins(n)} Siege nötig` })),
        onChange: (v) => { setup.bestOf = Number(v); },
      });
      let busy = false;
      const submit = h('button', {
        type: 'button', class: 'btn btn--primary btn--lg btn--start',
        onclick: async () => {
          if (busy) return;
          const playerName = settings.setName(name.input.value);
          if (!playerName) {
            showToast('Bitte gib zuerst deinen Namen ein.', { kind: 'error' });
            name.input.focus();
            return;
          }
          busy = true;
          submit.setAttribute('aria-busy', 'true');
          try {
            const res = await api('create', { type, name: playerName, variant: setup.variant, bestOf: setup.bestOf });
            // Ausgangslage für „Meine Spiele“: Lobby ohne Gegner (der Wächter meldet dann den Beitritt)
            createRoomSession().set(res.code, {
              token: res.token, me: res.me, type, role: 'host', variant: setup.variant, bestOf: setup.bestOf, host: playerName,
              summary: { version: null, type, variant: setup.variant, bestOf: setup.bestOf, status: 'lobby', me: res.me, isHost: true,
                players: 1, spectator: false, left: false, opponent: null, myMatch: null, needsMove: false, rematchWanted: false, champion: null },
            });
            navigate(hrefFor('room', { code: res.code }));
          } catch (err) {
            showError(err);
          } finally {
            busy = false;
            submit.removeAttribute('aria-busy');
          }
        },
      }, k.button, icon(k.icon));
      body.append(
        h('div', { class: 'setup glass' }, name.el, variant.el, bestOf.el),
        h('div', { class: 'sticky-action' }, submit));
      return { el };
    },
  };
}
