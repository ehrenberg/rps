// Platzhalter für Online-Duell, Turnier und Raum-Links (Phase 4/5).
import { h } from './dom.js';
import { icon } from './icons.js';
import { screenLayout } from './components.js';
import { hrefFor } from '../router.js';

const VARIANTS = Object.freeze({
  duel: { icon: 'duel', title: 'Online-Duell', text: 'Bald erstellst du hier einen Raum und schickst den Link an deine Gegnerin oder deinen Gegner.' },
  tournament: { icon: 'trophy', title: 'Turnier', text: 'Bald trittst du hier mit bis zu 16 Leuten im K.-o.-System an.' },
  room: { icon: 'link', title: 'Online-Raum', text: 'Online-Spiele per Einladungslink kommen bald. Bis dahin: üb schon mal gegen den Computer!' },
});

export function comingSoon(kind) {
  const v = VARIANTS[kind];
  return {
    title: v.title,
    render({ params }) {
      const { el, body } = screenLayout({ id: `soon-${kind}`, title: v.title, subtitle: 'Online kommt bald' });
      body.append(h('div', { class: 'soon glass' },
        h('div', { class: 'soon__icon' }, icon(v.icon, { size: 56 })),
        params?.code ? h('p', { class: 'soon__code' }, 'Raum ', h('code', {}, params.code)) : null,
        h('p', { class: 'soon__text' }, v.text),
        h('a', { class: 'btn btn--primary btn--lg', href: hrefFor('cpu') }, icon('cpu'), 'Gegen Computer üben')));
      return { el };
    },
  };
}
