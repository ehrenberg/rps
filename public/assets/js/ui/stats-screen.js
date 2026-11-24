// Statistik-Screen: liest stats.js, zeigt Kennzahlen, Modi, Zugverteilung, Vorhersehbarkeit.
import { h, replaceChildren } from './dom.js';
import { icon } from './icons.js';
import { screenLayout, confirmDialog } from './components.js';
import { loadStats, resetStats, summary } from '../stats.js';
import { AI_LEVELS } from '../ai.js';
import { MOVES, MOVE_NAMES } from '../rules.js';
import { handIcon } from '../hands.js';
import { hrefFor } from '../router.js';

export const title = 'Statistik';

const PERCENT = 100;
const MODE_ROWS = Object.freeze([
  ...AI_LEVELS.map((l) => ({ key: `cpu-${l.level}`, label: `Computer · ${l.name}` })),
  { key: 'duel', label: 'Online-Duell' },
  { key: 'tournament', label: 'Turnier-Matches' },
]);

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const pct = (part, total) => (total > 0 ? Math.round((part / total) * PERCENT) : 0);
/** winRate darf 0..1 oder 0..100 sein – auf Prozent normieren. */
const asPercent = (rate) => Math.round(num(rate) <= 1 ? num(rate) * PERCENT : num(rate));

function kpi(label, value, extra = null) {
  return h('div', { class: 'kpi glass' }, extra, h('span', { class: 'kpi__value' }, value), h('span', { class: 'kpi__label' }, label));
}

function wldBar({ w, l, d }) {
  const total = w + l + d;
  return h('div', { class: 'wld', role: 'img', 'aria-label': `${w} Siege, ${l} Niederlagen, ${d} Unentschieden` },
    [['w', w], ['d', d], ['l', l]].map(([k, v]) => (v > 0 ? h('span', { class: `wld__seg wld__seg--${k}`, style: { flexGrow: String(v) } }) : null)),
    total === 0 ? h('span', { class: 'wld__seg wld__seg--empty' }) : null);
}

function section(titleText, ...children) {
  return h('section', { class: 'panel glass' }, h('h2', { class: 'panel__title' }, titleText), ...children);
}

function emptyState() {
  return h('div', { class: 'empty glass' },
    h('div', { class: 'empty__hands', 'aria-hidden': 'true' }, ['scissors', 'rock', 'paper'].map((m) => h('span', { class: 'empty__hand' }, handIcon(m)))),
    h('h2', { class: 'empty__title' }, 'Noch ganz frisch hier'),
    h('p', { class: 'empty__text' }, 'Spiel ein paar Runden – dann siehst du hier deine Siege, Serien und wie gut man dich durchschaut.'),
    h('a', { class: 'btn btn--primary btn--lg', href: hrefFor('cpu') }, icon('cpu'), 'Erste Runde spielen'));
}

function content(onReset) {
  const stats = loadStats();
  const sum = summary(stats);
  const rounds = { w: num(stats.rounds?.w), l: num(stats.rounds?.l), d: num(stats.rounds?.d) };
  const totalRounds = rounds.w + rounds.l + rounds.d;
  if (totalRounds === 0 && num(sum.totalGames) === 0) return [emptyState()];

  const fav = sum.favoriteMove && MOVE_NAMES[sum.favoriteMove] ? sum.favoriteMove : null;
  const moveCounts = MOVES.map((m) => [m, num(stats.moves?.[m])]);
  const maxMove = Math.max(1, ...moveCounts.map(([, n]) => n));
  const totalMoves = moveCounts.reduce((a, [, n]) => a + n, 0);
  const entropy = Math.min(1, Math.max(0, num(sum.entropy)));
  const tournament = stats.games?.tournament ?? {};

  return [
    h('div', { class: 'kpis' },
      kpi('Matches', String(num(sum.totalGames))),
      kpi('Siegquote', `${asPercent(sum.winRate)} %`),
      kpi('Beste Serie', String(num(stats.streak?.best))),
      kpi('Lieblingszug', fav ? MOVE_NAMES[fav] : '–', fav ? h('span', { class: 'kpi__icon', 'aria-hidden': 'true' }, handIcon(fav)) : null)),

    section('Je Modus',
      h('ul', { class: 'modes' },
        MODE_ROWS.map(({ key, label }) => {
          const g = stats.games?.[key] ?? {};
          const v = { w: num(g.w), l: num(g.l), d: num(g.d) };
          return h('li', { class: ['mode-row', v.w + v.l + v.d === 0 && 'mode-row--empty'] },
            h('span', { class: 'mode-row__label' }, label),
            h('span', { class: 'mode-row__nums', 'aria-label': `${v.w} Siege, ${v.l} Niederlagen` },
              h('b', { class: 'c-win' }, String(v.w)), ' : ', h('b', { class: 'c-lose' }, String(v.l))),
            wldBar(v));
        }),
        h('li', { class: 'mode-row' },
          h('span', { class: 'mode-row__label' }, 'Turniere'),
          h('span', { class: 'mode-row__nums' }, `${num(tournament.won)} von ${num(tournament.played)} gewonnen`))),
      h('p', { class: 'panel__note' }, `Runden gesamt: ${rounds.w} gewonnen, ${rounds.l} verloren, ${rounds.d} unentschieden`),
      wldBar(rounds)),

    section('Zugverteilung',
      h('ul', { class: 'bars' }, moveCounts.map(([m, n]) => h('li', { class: 'bar' },
        h('span', { class: 'bar__icon', 'aria-hidden': 'true' }, handIcon(m)),
        h('span', { class: 'bar__label' }, MOVE_NAMES[m]),
        h('span', { class: 'bar__track' }, h('span', { class: 'bar__fill', style: { width: `${pct(n, maxMove)}%` } })),
        h('span', { class: 'bar__value' }, `${n} · ${pct(n, totalMoves)} %`))))),

    section('Wie vorhersehbar bist du?',
      h('div', { class: 'meter', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(entropy * PERCENT)), 'aria-label': 'Zufälligkeit deiner Züge' },
        h('span', { class: 'meter__fill', style: { width: `${Math.round(entropy * PERCENT)}%` } })),
      h('div', { class: 'meter__scale', 'aria-hidden': 'true' }, h('span', {}, 'berechenbar'), h('span', {}, 'zufällig')),
      h('p', { class: 'panel__lead' }, String(sum.predictability ?? '–'))),

    h('div', { class: 'stats__footer' },
      stats.since ? h('p', { class: 'muted' }, `Gezählt seit ${new Date(stats.since).toLocaleDateString('de-DE')}. Alles bleibt auf diesem Gerät.`) : null,
      h('button', { type: 'button', class: 'btn btn--danger', onclick: onReset }, icon('trash'), 'Statistik zurücksetzen')),
  ];
}

export function render({ announce }) {
  const { el, body, heading } = screenLayout({ id: 'stats', title: 'Statistik', subtitle: 'Nur auf diesem Gerät gespeichert' });
  const refresh = () => replaceChildren(body, content(onReset));
  async function onReset() {
    const ok = await confirmDialog({
      title: 'Statistik zurücksetzen?',
      text: 'Alle Siege, Serien und die Zugverteilung werden gelöscht. Das lässt sich nicht rückgängig machen.',
      confirmLabel: 'Ja, zurücksetzen', danger: true,
    });
    if (!ok) return;
    resetStats();
    refresh();
    announce('Statistik zurückgesetzt.');
    heading.focus();
  }
  refresh();
  return { el };
}
