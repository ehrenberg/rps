// Einladungsseite (#code ohne eigenes Token): info laden → „Anna fordert dich heraus“ → Name → join.
import { h, replaceChildren } from './dom.js';
import { icon } from './icons.js';
import { screenLayout, nameInput } from './components.js';
import { showError, showToast } from './toast.js';
import { VARIANTS, VARIANT_NAMES } from '../rules.js';
import { handIcon } from '../hands.js';
import { api } from '../net.js';
import { hrefFor } from '../router.js';
import { inviteErrorKind } from '../room-flow.js';

function headline(info) {
  const host = info.hostName ?? 'Jemand';
  if (info.type === 'duel') return `${host} fordert dich heraus!`;
  if (info.spectate) return `Turnier von ${host}`;
  return `${host} lädt dich zum Turnier ein!`;
}

function facts(info) {
  const items = [
    [VARIANT_NAMES[info.variant] ?? info.variant, h('span', { class: 'invite__icons', 'aria-hidden': 'true' }, (VARIANTS[info.variant] ?? []).map((m) => handIcon(m)))],
    [`Best of ${info.bestOf}`, null],
  ];
  if (info.type === 'tournament') items.push([`${info.players} / ${info.maxPlayers} Spieler`, null]);
  return h('ul', { class: 'invite__facts' }, items.map(([text, extra]) => h('li', {}, extra, text)));
}

/**
 * @param {{ code, settings, onJoined:(creds:{token,me,spectator})=>void, announce?:(text:string)=>void }} o
 * @returns {{ el, focus, dispose }}
 */
export function inviteView({ code, settings, onJoined, announce = null }) {
  const { el, body, heading } = screenLayout({ id: 'invite', title: 'Einladung', subtitle: `Raum ${code}` });
  let disposed = false;

  async function join(info, nameField, btn) {
    const name = settings.setName(nameField.input.value);
    if (!name) {
      showToast('Bitte gib deinen Namen ein.', { kind: 'error' });
      nameField.input.focus();
      return;
    }
    btn.disabled = true;
    try {
      const res = await api('join', { code, name });
      if (!disposed) onJoined({ token: res.token, me: res.me, spectator: Boolean(res.spectator) });
    } catch (err) {
      showError(err);
      btn.disabled = false;
    }
  }

  function renderInfo(info) {
    const canJoin = info.joinable || info.spectate;
    heading.textContent = headline(info);
    announce?.(headline(info)); // Überschrift hat schon den Fokus – neuer Text wird sonst nicht vorgelesen
    const nameField = nameInput({ settings, id: 'invite-name' });
    const btn = h('button', { type: 'button', class: 'btn btn--primary btn--lg btn--start', onclick: () => join(info, nameField, btn) },
      info.joinable ? (info.type === 'duel' ? 'Duell annehmen' : 'Mitmachen') : 'Zuschauen',
      icon(info.joinable ? 'sparkle' : 'eye'));
    nameField.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') btn.click(); });
    replaceChildren(body,
      h('div', { class: 'invite glass' },
        h('div', { class: 'invite__badge', 'aria-hidden': 'true' }, icon(info.type === 'duel' ? 'duel' : 'trophy', { size: 44 })),
        facts(info),
        info.names?.length ? h('p', { class: 'invite__names' }, `Dabei: ${info.names.join(', ')}`) : null,
        info.spectate && !info.joinable ? h('p', { class: 'muted' }, 'Das Turnier läuft schon – du kannst zuschauen und mitfiebern.') : null,
        canJoin ? nameField.el : h('p', { class: 'invite__closed' }, info.type === 'duel' ? 'Dieses Duell ist schon voll.' : 'Hier ist kein Platz mehr frei.')),
      canJoin ? h('div', { class: 'sticky-action' }, btn) : h('a', { class: 'btn btn--lg', href: hrefFor('home') }, icon('home'), 'Zum Start'));
  }

  function renderMissing(message) {
    heading.textContent = 'Raum nicht gefunden';
    announce?.(`Raum nicht gefunden. ${message}`);
    replaceChildren(body, h('div', { class: 'invite glass' },
      h('div', { class: 'invite__badge invite__badge--sad', 'aria-hidden': 'true' }, icon('link', { size: 44 })),
      h('p', {}, message),
      h('p', { class: 'muted' }, 'Räume werden nach 24 Stunden gelöscht.'),
      h('a', { class: 'btn btn--primary btn--lg', href: hrefFor('duel') }, icon('duel'), 'Neues Duell erstellen')));
  }

  /** Netz-/Serverproblem: nicht „Raum nicht gefunden“ behaupten, sondern erneut versuchen lassen. */
  function renderRetry(message) {
    heading.textContent = 'Einladung';
    const retry = h('button', { type: 'button', class: 'btn btn--primary btn--lg', onclick: load }, icon('replay'), 'Erneut versuchen');
    replaceChildren(body, h('div', { class: 'invite glass' },
      h('p', {}, message),
      h('p', { class: 'muted' }, 'Die Einladung konnte gerade nicht geladen werden.'),
      retry));
    announce?.(`Einladung konnte nicht geladen werden. ${message}`);
    retry.focus();
  }

  function load() {
    replaceChildren(body, h('div', { class: 'invite glass invite--loading' }, h('div', { class: 'spinner', 'aria-hidden': 'true' }), h('p', {}, 'Einladung wird geladen …')));
    api('info', { code })
      .then((info) => { if (!disposed) renderInfo(info); })
      .catch((err) => {
        if (disposed) return;
        if (inviteErrorKind(err) === 'missing') renderMissing(err.message);
        else renderRetry(err.message);
      });
  }
  load();

  return { el, focus: () => heading.focus({ preventScroll: true }), dispose() { disposed = true; } };
}
