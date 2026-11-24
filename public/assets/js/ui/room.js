// Online-Raum (#code): Einladung → Lobby → Arena (Duell) bzw. Turnierbaum ↔ Arena (Turnier).
// Hält den Poller; die Unteransichten bekommen nur Zustände und melden Aktionen zurück.
import { h, replaceChildren } from './dom.js';
import { confirmDialog } from './components.js';
import { showError, showToast } from './toast.js';
import { inviteView } from './invite.js';
import { lobbyView } from './lobby.js';
import { bracketView } from './bracket-view.js';
import { mountArena } from './arena-screen.js';
import { api, createPoller, createRoomSession, RECONNECT_TEXT, HTTP, StateHandlerError } from '../net.js';
import { createOnlineOpponent, newReactions, maxReactionId } from '../online-opponent.js';
import { tournamentRole, roundTitle, tournamentKey } from '../bracket.js';
import { decideRoute, leaveClearsSession } from '../room-flow.js';
import { VARIANT_NAMES } from '../rules.js';
import { recordTournament } from '../stats.js';
import { hrefFor } from '../router.js';
import * as fx from '../fx.js';
import * as audio from '../audio.js';

export const title = 'Online-Raum';

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
  let stateErrorToast = null; // Anzeige-Fehler (onState warf) – einmal zeigen bis zur Erholung
  let leaving = false;

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
    if (!ok || leaving || !creds) return;
    leaving = true;
    let failure = null;
    try { await api('leave', { code, token: creds.token }); } catch (err) { failure = err; }
    leaving = false;
    // Bei Netz-/Serverfehler bleibt der Platz (sonst wäre man ausgesperrt, obwohl man noch drin ist)
    if (!leaveClearsSession(failure)) { showError(failure); return; }
    session.clear(code);
    navigate(hrefFor('home'));
  }

  const act = (action, params = {}) => api(action, { code, token: creds.token, ...params })
    .then(() => poller?.poke())
    .catch((err) => { if (err.status !== HTTP.TOO_MANY) showError(err); });

  /** Konfetti beim Turniersieg nur einmal je Turnier (auch über Reloads). */
  const celebration = {
    done: (key) => session.wasRecorded(code, `confetti:${key}`),
    mark: (key) => session.markRecorded(code, `confetti:${key}`),
  };

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
    const v = lobbyView({ state, me: creds.me, code, onStart: () => act('start'), onLeave: leaveRoom });
    show({ kind: 'lobby', ...v });
  }

  function showBracket(state) {
    const v = bracketView({
      state, me: creds.me,
      onReact: (emoji) => act('react', { emoji }),
      onRestart: () => act('start'),
      onPlay: () => { dismissedMatch = null; route(lastState); },
      onLeave: leaveRoom,
      celebration,
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
    const key = tournamentKey(state);
    const role = tournamentRole(state, creds.me);
    if (role === 'spectator' || session.wasRecorded(code, key)) return;
    session.markRecorded(code, key);
    recordTournament({ won: state.champion === creds.me });
  }

  function route(state) {
    if (!state || disposed) return;
    if (state.type === 'tournament' && state.status !== 'lobby') recordTournamentEnd(state);
    const next = decideRoute(state, { me: creds.me, shown: sub, dismissedMatch });
    if (!next.fresh) sub.update(state);
    else if (next.view === 'lobby') showLobby(state);
    else if (next.view === 'bracket') showBracket(state);
    else {
      if (next.toast) showToast(next.toast, { kind: 'success' });
      if (state.type === 'duel') audio.play('join');
      showArena(state, next.matchId);
    }
    poller.setMode(next.mode);
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
        stateErrorToast?.close();
        stateErrorToast = null;
      },
      onOnline: (map) => sub?.online?.(map),
      onError: (err, { fatal }) => {
        if (err instanceof StateHandlerError) {
          stateErrorToast ??= showToast(err.message, { kind: 'error', duration: 0 });
          return;
        }
        if (!fatal) return;
        // 403: Platz ungültig → neu beitreten; 404: Raum weg → Einladungsseite zeigt „nicht gefunden“
        session.clear(code);
        creds = null;
        if (err.status === HTTP.FORBIDDEN) showToast('Dein Platz in diesem Raum gilt nicht mehr – bitte neu beitreten.', { kind: 'error' });
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
      code, settings,
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
      stateErrorToast?.close();
    },
  };
}
