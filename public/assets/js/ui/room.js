// Online-Raum (#code): Einladung → Lobby → Arena (Duell) bzw. Turnierbaum ↔ Arena (Turnier).
// Hält den Poller; die Unteransichten bekommen nur Zustände und melden Aktionen zurück.
import { h, replaceChildren } from './dom.js';
import { confirmDialog } from './components.js';
import { showError, showToast } from './toast.js';
import { inviteView } from './invite.js';
import { lobbyView } from './lobby.js';
import { bracketView } from './bracket-view.js';
import { mountArena } from './arena-screen.js';
import { api, createPoller, createRoomSession, RECONNECT_TEXT } from '../net.js';
import { createOnlineOpponent, newReactions, maxReactionId } from '../online-opponent.js';
import { tournamentRole, roundTitle } from '../bracket.js';
import { VARIANT_NAMES } from '../rules.js';
import { recordTournament } from '../stats.js';
import { hrefFor } from '../router.js';
import * as fx from '../fx.js';
import * as audio from '../audio.js';

export const title = 'Online-Raum';
const HTTP_FORBIDDEN = 403;
const HTTP_TOO_MANY = 429;

export function render({ params, settings, announce, navigate }) {
  const { code } = params;
  const session = createRoomSession();
  const root = h('div', { class: 'room' });
  let sub = null;        // { kind, el, focus, update?, dispose, matchId? }
  let poller = null;
  let creds = session.get(code);
  let lastState = null;
  let reconnectToast = null;
  let lastReactionId = null;
  let dismissedMatch = null; // Turnier: Arena dieses Matches wurde Richtung Baum verlassen
  let disposed = false;

  function show(next) {
    sub?.dispose?.();
    sub = next;
    fx.clear?.();
    replaceChildren(root, next.el);
    window.scrollTo(0, 0);
    next.focus?.();
  }

  // ─── Aktionen ───
  async function leaveRoom() {
    const ok = await confirmDialog({
      title: 'Raum verlassen?',
      text: lastState?.status === 'running' ? 'Ein laufendes Match zählt dann als verloren.' : 'Du kannst später über den Link wieder beitreten.',
      confirmLabel: 'Verlassen', danger: true,
    });
    if (!ok) return;
    try { await api('leave', { code, token: creds.token }); } catch (err) { if (err.status !== HTTP_FORBIDDEN) showError(err); }
    session.clear(code);
    navigate(hrefFor('home'));
  }

  const act = (action, params = {}) => api(action, { code, token: creds.token, ...params })
    .then(() => poller?.poke())
    .catch((err) => { if (err.status !== HTTP_TOO_MANY) showError(err); });

  // ─── Unteransichten ───
  function showArena(state, matchId) {
    const kind = state.type;
    const adapter = createOnlineOpponent({
      code, token: creds.token, me: creds.me, kind, state, matchId,
      apiFn: api, session, poke: () => poller?.poke(),
    });
    const roundIdx = (state.bracket ?? []).findIndex((r) => r.includes(matchId));
    const modeLabel = kind === 'duel'
      ? `Online · ${VARIANT_NAMES[state.variant]} · Best of ${state.bestOf}`
      : `Turnier · ${roundTitle(roundIdx, state.bracket.length)} · Best of ${state.bestOf}`;
    const arena = mountArena({
      adapter, settings, announce, modeLabel,
      myName: state.players.find((p) => p.id === creds.me)?.name,
      againLabel: kind === 'duel' ? 'Revanche' : 'Zum Turnierbaum',
      onAgain: kind === 'duel' ? undefined : () => { dismissedMatch = adapter.matchId; route(lastState); },
      onLeave: leaveRoom,
    });
    show({
      kind: 'arena', matchId: adapter.matchId, el: arena.el, focus: arena.focus,
      update: (s) => adapter.update(s),
      online: (map) => adapter.updateOnline(map),
      dispose: () => arena.dispose(),
    });
  }

  function showLobby(state) {
    const v = lobbyView({ state, me: creds.me, code, onStart: () => act('start'), onLeave: leaveRoom, announce });
    show({ kind: 'lobby', ...v });
  }

  function showBracket(state) {
    const v = bracketView({
      state, me: creds.me,
      onReact: (emoji) => act('react', { emoji }),
      onRestart: () => act('start'),
      onPlay: () => { dismissedMatch = null; route(lastState); },
      onLeave: leaveRoom,
      announce,
    });
    show({ kind: 'bracket', ...v });
  }

  /** Reaktionen außerhalb der Arena (Baum/Lobby) schweben über den Bildschirm. */
  function floatReactions(state) {
    const fresh = lastReactionId === null ? [] : newReactions(state.reactions, lastReactionId);
    lastReactionId = Math.max(lastReactionId ?? 0, maxReactionId(state.reactions));
    if (sub?.kind === 'arena') return; // Arena-Adapter zeigt selbst
    for (const r of fresh) {
      if (r.from === creds.me) continue;
      fx.floatEmoji(r.emoji, {});
      audio.play('pop');
    }
  }

  function recordTournamentEnd(state) {
    if (state.type !== 'tournament' || state.status !== 'finished') return;
    const key = `t:${(state.bracket ?? []).flat().join(',')}`;
    const role = tournamentRole(state, creds.me);
    if (role === 'spectator' || session.wasRecorded(code, key)) return;
    session.markRecorded(code, key);
    recordTournament({ won: state.champion === creds.me });
  }

  function route(state) {
    if (!state || disposed) return;
    const me = creds.me;
    if (state.type === 'duel') {
      const cur = state.current ? state.matches?.[state.current] : null;
      if (state.status === 'lobby' || !cur || !cur.p.includes(me)) {
        if (sub?.kind !== 'lobby') showLobby(state); else sub.update(state);
        poller.setMode('idle');
        return;
      }
      if (sub?.kind !== 'arena') { audio.play('join'); showArena(state, state.current); } else sub.update(state);
      poller.setMode(cur.winner !== null || cur.end ? 'end' : 'match');
      return;
    }
    // Turnier
    if (state.status === 'lobby') {
      if (sub?.kind !== 'lobby') showLobby(state); else sub.update(state);
      poller.setMode('idle');
      return;
    }
    recordTournamentEnd(state);
    // Eigenes, gerade gezeigtes Match bleibt (mit Matchende-Overlay), bis man zum Baum wechselt.
    const shown = sub?.kind === 'arena' ? sub.matchId : null;
    let target = null;
    if (shown && shown !== dismissedMatch && state.matches?.[shown]) target = shown;
    else if (state.myMatch && state.myMatch !== dismissedMatch) target = state.myMatch;
    if (target) {
      if (shown !== target) {
        if (shown === null) showToast('Dein Match beginnt!', { kind: 'success' });
        showArena(state, target);
      } else sub.update(state);
      const m = state.matches[target];
      poller.setMode(m.winner !== null || m.end ? 'end' : 'match');
      return;
    }
    if (sub?.kind !== 'bracket') showBracket(state); else sub.update(state);
    poller.setMode(state.status === 'finished' ? 'end' : 'idle');
  }

  // ─── Verbindung ───
  function connect() {
    replaceChildren(root, h('div', { class: 'room__loading' }, h('div', { class: 'spinner', 'aria-hidden': 'true' }), h('p', {}, 'Verbinde mit dem Raum …')));
    poller = createPoller({
      code, token: creds.token,
      onState: (state) => {
        lastState = state;
        route(state);
        floatReactions(state);
      },
      onOnline: (map) => sub?.online?.(map),
      onError: (err, { fatal }) => {
        if (!fatal) return;
        // 403: Platz ungültig → neu beitreten; 404: Raum weg → Einladungsseite zeigt „nicht gefunden“
        session.clear(code);
        creds = null;
        if (err.status === HTTP_FORBIDDEN) showToast('Dein Platz in diesem Raum gilt nicht mehr – bitte neu beitreten.', { kind: 'error' });
        showInvite();
      },
      onConnection: (ok) => {
        reconnectToast?.close();
        reconnectToast = ok ? null : showToast(RECONNECT_TEXT, { kind: 'error', duration: 0 });
      },
    });
    poller.start();
  }

  function showInvite() {
    const v = inviteView({
      code, settings, announce,
      onJoined: ({ token, me }) => {
        session.set(code, { token, me });
        creds = { token, me };
        connect();
      },
    });
    show({ kind: 'invite', ...v });
  }

  const onVisible = () => { if (document.visibilityState === 'visible') poller?.poke(); };
  document.addEventListener('visibilitychange', onVisible);

  if (creds) connect();
  else showInvite();

  return {
    el: root,
    focus: () => sub?.focus?.(),
    dispose() {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisible);
      poller?.stop();
      sub?.dispose?.();
      reconnectToast?.close();
    },
  };
}
