// Turnierbaum-Logik (DOM-frei): aus dem Server-Zustand eine darstellbare Struktur machen.

export const MATCH_STATUS = Object.freeze({ PENDING: 'pending', LIVE: 'live', DONE: 'done', BYE: 'bye' });

/** Rundentitel von hinten gezählt: Finale, Halbfinale, Viertelfinale, sonst „Runde n“. */
const TITLES_FROM_END = Object.freeze(['Finale', 'Halbfinale', 'Viertelfinale', 'Achtelfinale']);

export function roundTitle(index, total) {
  return TITLES_FROM_END[total - index - 1] ?? `Runde ${index + 1}`;
}

export function matchStatus(m) {
  if (!m) return MATCH_STATUS.PENDING;
  if (m.end === 'bye') return MATCH_STATUS.BYE;
  if (m.winner !== null && m.winner !== undefined) return MATCH_STATUS.DONE;
  if (m.end) return MATCH_STATUS.DONE;
  if (m.p?.[0] && m.p?.[1]) return MATCH_STATUS.LIVE;
  return MATCH_STATUS.PENDING;
}

/**
 * @returns {{ rounds: Array<{ index, title, matches: Array<{ id, label, status, mine,
 *   slots: Array<{ id, name, score, won, me, left, placeholder }> }> }>, champion: {id,name}|null }}
 */
export function buildBracket(state, me) {
  const bracket = state.bracket ?? [];
  const players = new Map((state.players ?? []).map((p) => [p.id, p]));
  const labels = new Map();
  bracket.flat().forEach((id, i) => labels.set(id, `Spiel ${i + 1}`));

  const rounds = bracket.map((ids, index) => ({
    index,
    title: roundTitle(index, bracket.length),
    matches: ids.map((id) => {
      const m = state.matches?.[id] ?? { p: [null, null], score: [0, 0], winner: null, end: null };
      const status = matchStatus(m);
      return {
        id,
        label: labels.get(id),
        status,
        mine: Boolean(me) && (m.p ?? []).includes(me),
        slots: [0, 1].map((i) => {
          const pid = m.p?.[i] ?? null;
          const player = pid ? players.get(pid) : null;
          let placeholder = null;
          if (!pid) {
            if (status === MATCH_STATUS.BYE) placeholder = 'Freilos';
            else if (m.from?.[i]) placeholder = `Sieger ${labels.get(m.from[i]) ?? ''}`.trim();
            else placeholder = 'offen';
          }
          return {
            id: pid,
            name: player?.name ?? (pid ? '?' : null),
            score: pid && status !== MATCH_STATUS.BYE ? m.score?.[i] ?? 0 : null,
            won: m.winner === i,
            me: Boolean(pid) && pid === me,
            left: Boolean(player?.left),
            placeholder,
          };
        }),
      };
    }),
  }));

  const championPlayer = state.champion ? players.get(state.champion) : null;
  return {
    rounds,
    champion: state.champion ? { id: state.champion, name: championPlayer?.name ?? '?' } : null,
  };
}

/** Kennung eines Turniers (neues Turnier im selben Raum = neue Match-IDs), z. B. für „schon gezählt“. */
export function tournamentKey(state) {
  return `t:${(state.bracket ?? []).flat().join(',')}`;
}

/** ID meines laufenden Matches im aufbereiteten Baum (buildBracket) oder null. */
export function myLiveMatchId(built) {
  for (const round of built.rounds) {
    const m = round.matches.find((x) => x.mine && x.status === MATCH_STATUS.LIVE);
    if (m) return m.id;
  }
  return null;
}

/** Zum eigenen Match scrollen nur beim ersten Rendern (prev undefined) oder wenn es wechselt. */
export function shouldScrollToMatch(prev, next) {
  return Boolean(next) && next !== prev;
}

/** Meine Rolle im Turnier: 'spectator' | 'playing' | 'waiting' | 'out' | 'champion'. */
export function tournamentRole(state, me) {
  if (state.champion && state.champion === me) return 'champion';
  const mine = (state.bracket ?? []).flat()
    .map((id) => state.matches?.[id])
    .filter((m) => m && (m.p ?? []).includes(me));
  if (mine.length === 0) return 'spectator';
  const lost = mine.some((m) => {
    const idx = m.p.indexOf(me);
    return m.winner !== null && m.winner !== undefined ? m.winner !== idx : Boolean(m.end);
  });
  if (lost) return 'out';
  if (state.myMatch) return 'playing';
  return 'waiting';
}
