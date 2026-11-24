// Gegner-Adapter „Online“ (DOM-frei) für den Arena-Controller (arena.js).
// Bekommt Server-Zustände vom Raum (update/updateOnline) und übersetzt sie in Arena-Ereignisse.
//
// Fairness: Der Gegnerzug kommt ausschließlich aus `history` (also erst nachdem beide aufgedeckt
// haben). Eigener Zug: Nonce + commitHash → `commit`; Zug/Nonce bleiben bis zum Aufdecken in
// sessionStorage (Reload mitten in der Runde kann noch aufdecken). Bei `lockedAt` deckt der
// Adapter automatisch auf; der Countdown läuft parallel, das Ergebnis kommt erst danach.
// Den Gegner-Hash (cur.commit) merkt sich der Adapter je Runde und zeigt ihn vorab an
// (`opponentCommit`); beim Aufdecken vergleicht der Controller ihn mit dem Hash aus `history`.

import { commitHash as defaultCommitHash, randomHex } from './crypto.js';
import { RESULT_CODE } from './match.js';
import { resultSentence } from './rules.js';
import { HTTP, backoffDelay } from './net.js';

/** Ab so langer Abwesenheit des Gegners darf man den Sieg beanspruchen (Server prüft selbst). */
export const CLAIM_AFTER_MS = 45_000;
const NONCE_BYTES = 16;

/** Schlüssel für wasRecorded/markRecorded: Match schon in der Statistik gezählt. */
export const matchRecordId = (matchId) => `m:${matchId}`;

/** Neue Reaktionen seit lastId (aufsteigend). */
export function newReactions(list, lastId) {
  return (list ?? []).filter((r) => r.id > lastId).sort((a, b) => a.id - b.id);
}

export function maxReactionId(list) {
  return (list ?? []).reduce((max, r) => Math.max(max, r.id), 0);
}

/** Gesamtzahl gespielter Runden (der Server verdichtet alte Unentschieden in `dropped`). */
export function roundCount(match) {
  return (match.dropped ?? 0) + match.history.length;
}

/** Satz für eine Runde aus meiner Sicht (auch für Forfeit-Runden ohne aufgedeckte Züge). */
export function roundSentence(myMove, oppMove, oppName, outcome = 0) {
  if (myMove && oppMove) return resultSentence(myMove, oppMove);
  if (!myMove && !oppMove) {
    // Commit-Frist abgelaufen (Sieger hat gewählt) oder beide nicht aufgedeckt
    if (outcome === 1) return 'Zeit abgelaufen – Runde an dich';
    if (outcome === -1) return `Zeit abgelaufen – Runde an ${oppName}`;
    return 'Keiner hat rechtzeitig aufgedeckt';
  }
  return myMove ? `${oppName} hat nicht rechtzeitig aufgedeckt` : 'Du hast nicht rechtzeitig aufgedeckt';
}

/**
 * @param {{ code:string, token:string, me:string, kind:'duel'|'tournament', state:object,
 *           matchId?:string, apiFn:Function, session:object, poke?:Function,
 *           now?:()=>number, commitHash?:Function, makeNonce?:()=>string,
 *           timers?:{setTimeout:Function, clearTimeout:Function} }} o
 */
export function createOnlineOpponent({
  code, token, me, kind, state: initialState, matchId: fixedMatchId = null,
  apiFn, session, poke = () => {},
  now = Date.now, commitHash = defaultCommitHash, makeNonce = () => randomHex(NONCE_BYTES),
  timers = globalThis,
}) {
  let emit = () => {};
  let disposed = false;
  let state = initialState;
  let online = {};

  // Zustand des verfolgten Matches
  let matchId = null;
  let seenRounds = 0;
  let score = [0, 0];
  let openedRound = -1;
  let lockedRound = -1;
  let revealedRound = -1;
  let lostMoveRound = -1;
  let submittedRound = -1;   // Server zeigt meinen Commit für diese Runde (oder er wurde angenommen)
  let localSubmitRound = -1; // Runde, deren Wahl gerade hier abgegeben wird/wurde (schon angezeigt)
  let revealAttempt = 0;
  let revealTimer = null;
  const oppCommits = new Map(); // Runde → vorab gezeigter Gegner-Hash
  let overEmitted = false;
  // zuletzt gemeldete Werte (Ereignisse nur bei Änderung)
  let lastStatus = null;
  let lastDeadline;
  let lastClaim = false;
  let lastRematch = '';
  let lastReactionId = maxReactionId(initialState?.reactions);
  let offlineSince = null;

  const targetId = () => (kind === 'duel' ? state.current : fixedMatchId ?? state.myMatch);
  const playerName = (id) => state.players?.find((p) => p.id === id)?.name ?? 'Gegner';

  function view() {
    const match = state.matches?.[matchId];
    if (!match) return null;
    const idx = match.p.indexOf(me);
    if (idx < 0) return null;
    const opp = 1 - idx;
    const oppId = match.p[opp];
    return { match, idx, opp, oppId, oppPlayer: state.players?.find((p) => p.id === oppId) ?? null };
  }

  function toRound(entry, number, v) {
    const myMove = entry.m?.[v.idx] ?? null;
    const oppMove = entry.m?.[v.opp] ?? null;
    const outcome = entry.w === v.idx ? 1 : entry.w === v.opp ? -1 : 0;
    const hasProof = oppMove && entry.n?.[v.opp] && entry.h?.[v.opp];
    return {
      number,
      myMove,
      oppMove,
      outcome,
      result: RESULT_CODE[outcome],
      sentence: roundSentence(myMove, oppMove, playerName(v.oppId), outcome),
      forfeit: Boolean(entry.f),
      proof: hasProof
        ? { hash: entry.h[v.opp], move: oppMove, nonce: entry.n[v.opp], shownHash: null, ownHashOk: null }
        : null,
    };
  }

  /** Passt der Hash zu meinem Commit auf dem Server (unbekannt zählt als passend)? */
  function hashMatchesServer(hash) {
    const v = view();
    const shown = v?.match.cur?.commit?.[v.idx];
    return !shown || shown === hash;
  }

  /** Gemerkter Zug, falls er zur Runde passt und (soweit bekannt) zum Server-Hash. */
  function pendingFor(round, serverHash) {
    const p = session.getPending(code);
    if (p?.matchId !== matchId || p.round !== round) return null;
    return !serverHash || !p.hash || p.hash === serverHash ? p : null;
  }

  function scoreFromHistory(history, v) {
    const s = [0, 0];
    for (const e of history) {
      if (e.w === v.idx) s[0] += 1;
      else if (e.w === v.opp) s[1] += 1;
    }
    return s;
  }

  function series(v) {
    if (kind !== 'duel' || !state.series) return null;
    return { me: state.series[me] ?? 0, opp: state.series[v.oppId] ?? 0 };
  }

  function beginMatch(id) {
    matchId = id;
    const v = view();
    if (!v) return false;
    seenRounds = roundCount(v.match);
    score = scoreFromHistory(v.match.history, v);
    openedRound = lockedRound = revealedRound = lostMoveRound = submittedRound = localSubmitRound = -1;
    oppCommits.clear();
    timers.clearTimeout(revealTimer);
    overEmitted = false;
    lastStatus = null;
    lastDeadline = undefined;
    lastRematch = '';
    const pending = session.getPending(code);
    if (pending && pending.matchId !== id) session.clearPending(code);
    emit('matchStart', {
      variant: state.variant,
      bestOf: state.bestOf,
      target: v.match.target,
      oppName: playerName(v.oppId),
      oppDetail: kind === 'duel' ? '' : `Runde ${roundOf(id)}`,
      score: [...score],
      history: v.match.history.map((e, i) => toRound(e, (v.match.dropped ?? 0) + i + 1, v)),
      series: series(v),
    });
    return true;
  }

  function roundOf(id) {
    const i = (state.bracket ?? []).findIndex((r) => r.includes(id));
    return i >= 0 ? i + 1 : state.round ?? 1;
  }

  function opponentState(v) {
    if (!v.oppPlayer || v.oppPlayer.left) return 'left';
    const isOnline = online[v.oppId] ?? v.oppPlayer.online;
    if (!isOnline) return 'offline';
    return v.match.cur?.committed?.[v.opp] ? 'ready' : 'choosing';
  }

  function refreshPresence() {
    const v = view();
    if (!v) return;
    const running = v.match.winner === null && v.match.end === null;
    const status = opponentState(v);
    if (status !== lastStatus) {
      lastStatus = status;
      emit('opponentStatus', { state: status });
    }
    if (status === 'offline') offlineSince ??= now();
    else offlineSince = null;
    const claim = running && status === 'offline' && now() - offlineSince >= CLAIM_AFTER_MS;
    if (claim !== lastClaim) {
      lastClaim = claim;
      emit('claimAvailable', { available: claim });
    }
  }

  function processReactions() {
    for (const r of newReactions(state.reactions, lastReactionId)) {
      emit('reaction', { emoji: r.emoji, fromMe: r.from === me, name: playerName(r.from) });
    }
    lastReactionId = Math.max(lastReactionId, maxReactionId(state.reactions));
  }

  function processHistory(v) {
    const { history } = v.match;
    const total = roundCount(v.match);
    const fresh = Math.min(history.length, total - seenRounds);
    for (let k = history.length - fresh; k < history.length; k++) {
      const i = total - history.length + k; // 0-basierter Rundenindex
      const entry = history[k];
      // Countdown nachholen, wenn der Lock zwischen zwei Polls lag – nicht bei Forfeit-Runden
      // (Commit-Frist abgelaufen: es gab keinen Lock, also auch keinen Countdown).
      if (lockedRound < i && !entry.f) emit('roundLocked', {});
      lockedRound = Math.max(lockedRound, i);
      const round = toRound(entry, i + 1, v);
      if (round.outcome === 1) score[0] += 1;
      if (round.outcome === -1) score[1] += 1;
      const pending = session.getPending(code);
      if (round.proof) {
        round.proof.shownHash = oppCommits.get(i) ?? null;
        const mine = pending?.matchId === matchId && pending.round === i ? pending.hash : null;
        round.proof.ownHashOk = mine && entry.h?.[v.idx] ? mine === entry.h[v.idx] : null;
      }
      if (pending?.matchId === matchId && pending.round <= i) session.clearPending(code);
      emit('roundResolved', { ...round, score: [...score] });
    }
    seenRounds = Math.max(seenRounds, total);
  }

  function processRunningRound(v) {
    const r = roundCount(v.match);
    const cur = v.match.cur ?? {};
    const myPending = pendingFor(r, cur.commit?.[v.idx]);

    if (openedRound < r) {
      openedRound = r;
      emit('roundOpen', { round: r + 1, commit: null });
    }
    // Server zeigt meinen Commit: nach Reload oder nach unklarem Commit-Fehler als abgegeben anzeigen
    if (cur.committed?.[v.idx] && submittedRound < r) {
      submittedRound = r;
      if (localSubmitRound !== r) emit('moveRestored', { move: myPending?.move ?? null });
    }
    const oppHash = cur.commit?.[v.opp];
    if (oppHash && !oppCommits.has(r)) {
      oppCommits.set(r, oppHash);
      emit('opponentCommit', { hash: oppHash });
    }
    if (cur.lockedAt && lockedRound < r) {
      lockedRound = r;
      emit('roundLocked', {});
    }
    if (cur.lockedAt && !cur.revealed?.[v.idx] && revealedRound < r) {
      if (myPending) {
        revealedRound = r;
        revealAttempt = 0;
        sendReveal(r, myPending);
      } else if (lostMoveRound < r) {
        lostMoveRound = r;
        emit('error', { message: 'Dein Zug ist in diesem Tab nicht mehr bekannt – die Runde geht leider an den Gegner.' });
      }
    }
    emitDeadline(deadlineInfo(cur, v));
  }

  /** Muss in Runde r (dieses Matches) noch aufgedeckt werden? */
  function revealNeeded(id, r) {
    const v = !disposed && id === matchId ? view() : null;
    if (!v || v.match.winner !== null || v.match.end !== null || roundCount(v.match) !== r) return false;
    return Boolean(v.match.cur?.lockedAt) && !v.match.cur?.revealed?.[v.idx];
  }

  /** Aufdecken; bei Netz-/Serverfehlern selbst mit Backoff wiederholen (sonst Forfeit nach Frist). */
  function sendReveal(r, pending) {
    const id = matchId;
    apiFn('reveal', { code, token, move: pending.move, nonce: pending.nonce })
      .then(() => poke())
      .catch((err) => {
        if (disposed || id !== matchId) return;
        if (revealAttempt === 0) emit('error', { message: err.message });
        if (!err?.retryable) { revealedRound = -1; return; } // nächste Server-Version entscheidet
        revealAttempt += 1;
        timers.clearTimeout(revealTimer);
        revealTimer = timers.setTimeout(() => {
          if (revealNeeded(id, r)) sendReveal(r, pending);
        }, backoffDelay(revealAttempt));
      });
  }

  /** Laufende Frist: Gegner deckt auf ('reveal') bzw. Zug abgeben (mir: 'commit', Gegner: 'oppCommit'). */
  function deadlineInfo(cur, v) {
    const left = (t) => Math.max(0, t - state.now);
    if (cur.lockedAt) {
      return cur.revealed?.[v.idx] && !cur.revealed?.[v.opp] && cur.deadline ? { seconds: left(cur.deadline), who: 'reveal' } : null;
    }
    if (!cur.commitDeadline) return null;
    const mine = cur.committed?.[v.idx];
    const theirs = cur.committed?.[v.opp];
    if (theirs && !mine) return { seconds: left(cur.commitDeadline), who: 'commit' };
    if (mine && !theirs) return { seconds: left(cur.commitDeadline), who: 'oppCommit' };
    return null;
  }

  function emitDeadline(info) {
    const key = info ? `${info.who}:${info.seconds}` : null;
    if (key === lastDeadline) return;
    lastDeadline = key;
    emit('deadline', info ?? { seconds: null, who: null });
  }

  function processEnd(v) {
    if (!overEmitted) {
      overEmitted = true;
      const { winner } = v.match;
      emit('matchOver', {
        winner: winner === v.idx ? 'me' : winner === null ? null : 'opp',
        score: [v.match.score[v.idx], v.match.score[v.opp]],
        reason: v.match.end,
        // Statistik genau einmal: zählt der Controller, merkt er sich die ID (markRecorded)
        replay: session.wasRecorded(code, matchRecordId(matchId)),
        recordId: matchRecordId(matchId),
        oppName: playerName(v.oppId),
        series: series(v),
      });
      emitDeadline(null);
    }
    if (kind !== 'duel') return;
    const rematch = state.rematch ?? [];
    const info = { me: rematch.includes(me), opp: rematch.includes(v.oppId), oppLeft: !v.oppPlayer || v.oppPlayer.left };
    const key = JSON.stringify(info);
    if (key !== lastRematch) {
      lastRematch = key;
      emit('rematchStatus', info);
    }
  }

  function update(next) {
    if (disposed || !next) return;
    state = next;
    const id = targetId();
    if (id && id !== matchId && state.matches?.[id]) {
      if (!beginMatch(id)) return;
    }
    const v = view();
    if (v) {
      processHistory(v);
      if (v.match.winner !== null || v.match.end !== null) processEnd(v);
      else processRunningRound(v);
      refreshPresence();
    }
    processReactions();
  }

  const call = async (action, params = {}) => {
    const res = await apiFn(action, { code, token, ...params });
    poke();
    return res;
  };

  return {
    info: Object.freeze({
      kind: 'online',
      statsMode: kind === 'duel' ? 'duel' : 'tournament',
      variant: initialState.variant,
      bestOf: initialState.bestOf,
      features: Object.freeze({ status: true, reactions: true, commitBadge: true, insight: false, claim: true }),
    }),

    get matchId() { return matchId; },

    start(handler) {
      emit = (type, payload = {}) => { if (!disposed) handler(type, payload); };
      update(state);
    },

    update,

    /** Online-Status aus jeder Poll-Antwort ({ id: bool }). */
    updateOnline(map) {
      if (disposed) return;
      online = { ...map };
      refreshPresence();
    },

    async submitMove(move) {
      const v = view();
      if (!v) throw new Error('Gerade läuft kein Match.');
      const round = roundCount(v.match);
      const id = matchId;
      const nonce = makeNonce();
      const hash = await commitHash(move, nonce);
      const previous = pendingFor(round, null); // z. B. nach Netzfehler evtl. doch gespeichert
      session.setPending(code, { matchId: id, round, move, nonce, hash });
      localSubmitRound = round;
      try {
        await call('commit', { hash });
      } catch (err) {
        const same = id === matchId;
        if (err?.retryable) {
          // Status 0/5xx: Server hat den Commit evtl. gespeichert → Pending behalten, Zustand prüfen
          poke();
          if (same && submittedRound >= round) return; // Server zeigt den Zug schon → abgegeben
        } else if (err?.status === HTTP.CONFLICT && same && previous && hashMatchesServer(previous.hash)) {
          // „Schon gewählt“: der frühere Zug passt zum Server-Commit → er bleibt aufdeckbar
          session.setPending(code, previous);
        } else {
          session.clearPending(code);
        }
        if (same && localSubmitRound === round) localSubmitRound = -1;
        throw err;
      }
    },

    /** Match ist in der Statistik gezählt (recordId aus matchOver) → nach Reload nicht erneut. */
    markRecorded(recordId) {
      session.markRecorded(code, recordId);
    },

    rematch() {
      return call('rematch');
    },

    sendReaction(emoji) {
      call('react', { emoji }).catch((err) => {
        if (err?.status !== HTTP.TOO_MANY) emit('error', { message: err.message });
      });
    },

    claim() {
      return call('claim');
    },

    dispose() {
      disposed = true;
      timers.clearTimeout(revealTimer);
    },
  };
}
