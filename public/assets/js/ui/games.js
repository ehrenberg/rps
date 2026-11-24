// „Meine Spiele“ (#/games): alle offenen Online-Räume als Karten, live über den Hintergrund-Wächter.
import { h, replaceChildren } from './dom.js';
import { icon } from './icons.js';
import { screenLayout, confirmDialog } from './components.js';
import { showToast, showError } from './toast.js';
import { roomUrl } from './share.js';
import { describeRoom, ageText, sharedRoomStore } from '../rooms.js';
import { api } from '../net.js';
import { leaveClearsSession } from '../room-flow.js';
import { VARIANT_NAMES } from '../rules.js';
import { hrefFor } from '../router.js';

export const title = 'Meine Spiele';
const AGE_REFRESH_MS = 30_000;
const TYPE_LABEL = Object.freeze({ duel: 'Online-Duell', tournament: 'Turnier' });

function cardTitle(entry) {
  const type = entry.summary?.type ?? entry.type;
  const opp = entry.summary?.opponent ?? entry.opponent;
  if (type === 'duel') return opp ? `Duell gegen ${opp}` : 'Online-Duell';
  if (type === 'tournament') return entry.host && entry.role !== 'host' ? `Turnier von ${entry.host}` : 'Turnier';
  return `Raum ${entry.code}`;
}

function metaText(entry, now) {
  const variant = entry.summary?.variant ?? entry.variant;
  const bestOf = entry.summary?.bestOf ?? entry.bestOf;
  return [
    TYPE_LABEL[entry.summary?.type ?? entry.type] ?? null,
    variant ? VARIANT_NAMES[variant] ?? variant : null,
    bestOf ? `Best of ${bestOf}` : null,
    `erstellt ${ageText(now - entry.created)}`,
  ].filter(Boolean).join(' · ');
}

async function shareLink(code) {
  const url = roomUrl(code);
  if (typeof navigator.share === 'function') {
    try { await navigator.share({ title: 'Schere Stein Papier', text: 'Spiel mit mir Schere, Stein, Papier!', url }); return; } catch (err) {
      if (err?.name === 'AbortError') return; // Nutzer hat abgebrochen
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    showToast('Link kopiert – jetzt verschicken!', { kind: 'success' });
  } catch {
    showToast(`Kopieren ging nicht – Link: ${url}`, { kind: 'error' });
  }
}

export function render({ rooms = sharedRoomStore(), watcher = null, announce = () => {} }) {
  const { el, body, heading } = screenLayout({
    id: 'games', title: 'Meine Spiele', subtitle: 'Deine offenen Duelle und Turniere (24 Stunden lang)',
  });
  const list = h('ul', { class: 'games', 'aria-labelledby': heading.id });
  const empty = h('div', { class: 'games-empty glass', hidden: true },
    h('div', { class: 'games-empty__icon', 'aria-hidden': 'true' }, icon('games', { size: 44 })),
    h('h2', { class: 'games-empty__title' }, 'Gerade keine offenen Spiele'),
    h('p', { class: 'muted' }, 'Erstell ein Duell oder Turnier und schick den Link. Während du wartest, kannst du die Seite verlassen – hier findest du deine Spiele wieder.'),
    h('div', { class: 'games-empty__actions' },
      h('a', { class: 'btn btn--primary btn--lg', href: hrefFor('duel') }, icon('duel'), 'Online-Duell'),
      h('a', { class: 'btn btn--lg', href: hrefFor('tournament') }, icon('trophy'), 'Turnier')));
  const note = h('p', { class: 'muted games__note' }, 'Wir sagen Bescheid, sobald sich in einem Spiel etwas tut – auch wenn du gerade woanders in der App bist.');
  body.append(list, empty, note);
  const busy = new Set();

  async function remove(entry) {
    const running = entry.summary?.status === 'running' && !entry.summary?.spectator;
    const ok = await confirmDialog({
      title: 'Spiel entfernen?',
      text: running
        ? 'Du verlässt den Raum – ein laufendes Match zählt dann als verloren.'
        : 'Du verlässt den Raum. Über den Link kannst du später wieder beitreten, solange er existiert.',
      confirmLabel: 'Entfernen', danger: true,
    });
    if (!ok || busy.has(entry.code)) return;
    busy.add(entry.code);
    let failure = null;
    try { await api('leave', { code: entry.code, token: entry.token }); } catch (err) { failure = err; }
    busy.delete(entry.code);
    // Beendete Räume dürfen auch ohne erfolgreiches leave aus der Liste; sonst Platz behalten
    if (!leaveClearsSession(failure) && entry.summary?.status !== 'finished') { showError(failure); return; }
    const items = [...list.children];
    const idx = items.findIndex((li) => li.dataset.code === entry.code);
    rooms.remove(entry.code);
    announce(`${cardTitle(entry)} entfernt.`);
    // Fokus auf die nächste Karte (oder die Überschrift), statt ihn an <body> zu verlieren
    const next = list.children[Math.min(idx, list.children.length - 1)];
    (next?.querySelector('.game__open') ?? heading).focus({ preventScroll: true });
  }

  function card(entry, now) {
    const st = describeRoom(entry);
    const name = cardTitle(entry);
    const type = entry.summary?.type ?? entry.type;
    const isNew = entry.alerts.length > 0;
    return h('li', { class: ['game', 'glass', `game--${st.tone}`, isNew && 'game--new'], dataset: { code: entry.code } },
      h('div', { class: 'game__head' },
        h('span', { class: 'game__icon', 'aria-hidden': 'true' }, icon(type === 'tournament' ? 'trophy' : 'duel', { size: 24 })),
        h('div', { class: 'game__titles' },
          h('h2', { class: 'game__title' }, name, isNew ? h('span', { class: 'game__new' }, 'Neu') : null),
          h('p', { class: 'game__meta' }, metaText(entry, now)))),
      h('p', { class: 'game__status' },
        h('span', { class: 'game__dot', 'aria-hidden': 'true' }),
        st.text,
        st.who && type === 'tournament' ? h('span', { class: 'game__who' }, ` · ${st.who}`) : null),
      isNew ? h('p', { class: 'game__alert' }, entry.alerts[entry.alerts.length - 1].text) : null,
      h('div', { class: 'game__actions' },
        h('a', { class: 'btn btn--primary game__open', href: hrefFor('room', { code: entry.code }) },
          'Öffnen', h('span', { class: 'visually-hidden' }, `: ${name}`)),
        h('button', { type: 'button', class: 'btn game__share', onclick: () => shareLink(entry.code) },
          icon('share'), 'Link teilen', h('span', { class: 'visually-hidden' }, `: ${name}`)),
        h('button', { type: 'button', class: 'btn btn--ghost game__remove', onclick: () => remove(entry) },
          icon('trash'), 'Entfernen', h('span', { class: 'visually-hidden' }, `: ${name}`))));
  }

  function update() {
    const entries = rooms.list();
    // Fokus über den Neuaufbau retten (gleiche Karte, gleicher Knopf)
    const active = document.activeElement;
    const li = active && list.contains(active) ? active.closest('.game') : null;
    const focusKey = li ? [li.dataset.code, [...active.classList].find((c) => c.startsWith('game__'))] : null;
    const now = Date.now();
    replaceChildren(list, entries.map((e) => card(e, now)));
    list.hidden = entries.length === 0;
    empty.hidden = entries.length > 0;
    note.hidden = entries.length === 0;
    if (focusKey) {
      const target = list.querySelector(`.game[data-code="${focusKey[0]}"] .${focusKey[1]}`);
      target?.focus({ preventScroll: true });
    }
  }

  update();
  const unsubscribe = rooms.subscribe(update);
  const ages = setInterval(update, AGE_REFRESH_MS);
  watcher?.poke();

  return {
    el,
    focus: () => heading.focus({ preventScroll: true }),
    dispose() {
      unsubscribe();
      clearInterval(ages);
    },
  };
}
