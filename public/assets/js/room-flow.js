// Ablauf im Online-Raum (DOM-frei): welche Unteransicht zu einem Server-Zustand gehört,
// und wie Fehler beim Beitreten/Verlassen zu behandeln sind. Genutzt von ui/room.js und ui/invite.js.
import { HTTP, FATAL_STATUS } from './net.js';
import { matchRecordId } from './online-opponent.js';

export const MATCH_TOAST = 'Dein Match beginnt!';

const isOver = (m) => m.winner !== null || Boolean(m.end);

/**
 * @param {object} state  Server-Zustand
 * @param {{ me:string, shown:{kind:string, matchId?:string}|null, dismissedMatch?:string|null }} o
 *   shown: gerade gezeigte Unteransicht; dismissedMatch: Turnier-Match, dessen Arena verlassen wurde
 * @returns {{ view:'lobby'|'arena'|'bracket', matchId?:string, mode:'idle'|'match'|'end', fresh:boolean, toast?:string|null }}
 *   fresh: Unteransicht neu aufbauen (sonst nur aktualisieren)
 */
export function decideRoute(state, { me, shown, dismissedMatch = null }) {
  const lobby = () => ({ view: 'lobby', mode: 'idle', fresh: shown?.kind !== 'lobby' });
  if (state.type === 'duel') {
    const cur = state.current ? state.matches?.[state.current] : null;
    if (state.status === 'lobby' || !cur || !cur.p.includes(me)) return lobby();
    // Revanche (neues current) läuft in derselben Arena weiter – der Adapter beginnt das neue Match
    return { view: 'arena', matchId: state.current, mode: isOver(cur) ? 'end' : 'match', fresh: shown?.kind !== 'arena', toast: null };
  }
  if (state.status === 'lobby') return lobby();
  // Eigenes, gerade gezeigtes Match bleibt (mit Matchende-Overlay), bis man zum Baum wechselt.
  const shownId = shown?.kind === 'arena' ? shown.matchId : null;
  let target = null;
  if (shownId && shownId !== dismissedMatch && state.matches?.[shownId]) target = shownId;
  else if (state.myMatch && state.myMatch !== dismissedMatch) target = state.myMatch;
  if (target) {
    const fresh = shownId !== target;
    return {
      view: 'arena', matchId: target, mode: isOver(state.matches[target]) ? 'end' : 'match',
      fresh, toast: fresh && shownId === null ? MATCH_TOAST : null,
    };
  }
  return { view: 'bracket', mode: state.status === 'finished' ? 'end' : 'idle', fresh: shown?.kind !== 'bracket' };
}

/** Einladung laden fehlgeschlagen: nur 404 heißt „Raum gibt es nicht“, sonst erneut versuchen. */
export function inviteErrorKind(err) {
  return err?.status === HTTP.NOT_FOUND ? 'missing' : 'retry';
}

/** Nach „Verlassen“ die Sitzung löschen? Nur bei Erfolg (err null) oder wenn der Platz ohnehin weg ist. */
export function leaveClearsSession(err) {
  return !err || FATAL_STATUS.includes(err.status);
}

/**
 * Mein laufendes Match (Duell: current, Turnier: myMatch) oder null.
 * Für „Verlassen zählt als Niederlage“ und die Rückfrage beim Wegnavigieren.
 * @returns {{ id:string, mode:'duel'|'tournament', recordId:string }|null}
 */
export function myRunningMatch(state, me) {
  if (!state || state.status === 'lobby') return null;
  const id = state.type === 'duel' ? state.current : state.myMatch;
  const m = id ? state.matches?.[id] : null;
  if (!m || !m.p?.includes(me) || isOver(m)) return null;
  return { id, mode: state.type === 'duel' ? 'duel' : 'tournament', recordId: matchRecordId(id) };
}

/** Text, wenn man einem Raum nicht (mehr) beitreten kann. */
export function closedInviteText(info) {
  if (info.type !== 'duel') return 'Hier ist kein Platz mehr frei.';
  if (info.status === 'finished') return 'Dieses Duell ist schon beendet.';
  return 'Dieses Duell ist schon voll. Spielst du schon in einem anderen Tab? Dann geht es dort weiter – '
    + 'sonst ist dein Platz leider verloren gegangen.';
}
