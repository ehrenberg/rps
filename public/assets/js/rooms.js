// Offene Online-Räume („Meine Spiele“) in localStorage (DOM-frei, Speicher/Uhr/Events injizierbar).
// Ein Objekt pro Raumcode unter `rps.rooms.v1`; Einträge verfallen 24 h nach Erstellung (wie auf dem Server).
// Jeder Zugriff liest frisch aus dem Speicher – so bleiben mehrere Tabs konsistent.
// Vertrag: docs/SCHNITTSTELLEN.md („rooms.js“).

export const ROOMS_KEY = 'rps.rooms.v1';
export const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
/** Höchstzahl gemerkter Einträge je Liste (recorded/notified), damit nichts unbegrenzt wächst. */
export const LIST_MAX = 40;
/** Alte sessionStorage-Schlüssel (vor „Meine Spiele“), werden beim Start übernommen. */
export const LEGACY_PREFIX = Object.freeze({
  token: 'rps.token.', me: 'rps.me.', pending: 'rps.pending.', recorded: 'rps.recorded.',
});

const CODE_RE = /^[23456789abcdefghjkmnpqrstuvwxyz]{6}$/;
const TYPES = new Set(['duel', 'tournament']);
const ROLES = new Set(['host', 'player', 'spectator']);

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' && v !== '' ? v : null);
const num = (v) => (Number.isFinite(v) ? v : null);
const strList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(-LIST_MAX) : []);

/** localStorage, das nicht wirft (auch nicht beim Zugriff auf globalThis.localStorage selbst). */
function defaultStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

/** Eintrag prüfen und auf bekannte Felder reduzieren; ungültig → null. */
export function normalizeEntry(code, raw) {
  if (!CODE_RE.test(code) || !isObj(raw)) return null;
  const token = str(raw.token);
  const me = str(raw.me);
  const created = num(raw.created);
  if (!token || !me || created === null) return null;
  const alerts = Array.isArray(raw.alerts)
    ? raw.alerts.filter((a) => isObj(a) && typeof a.kind === 'string' && typeof a.text === 'string')
      .slice(-LIST_MAX).map((a) => ({ kind: a.kind, text: a.text, at: num(a.at) ?? created }))
    : [];
  return {
    code,
    token,
    me,
    type: TYPES.has(raw.type) ? raw.type : null,
    role: ROLES.has(raw.role) ? raw.role : null,
    variant: str(raw.variant),
    bestOf: num(raw.bestOf),
    host: str(raw.host),
    opponent: str(raw.opponent),
    stage: str(raw.stage),
    created,
    opened: num(raw.opened) ?? created,
    pending: isObj(raw.pending) ? raw.pending : null,
    recorded: strList(raw.recorded),
    notified: strList(raw.notified),
    alerts,
    summary: isObj(raw.summary) ? raw.summary : null,
  };
}

/**
 * @param {{ storage?, now?:()=>number, events?:EventTarget|null }} [o]
 *   events: Quelle des „storage“-Ereignisses (window) für Änderungen aus anderen Tabs.
 */
export function createRoomStore({ storage = defaultStorage(), now = () => Date.now(), events = globalThis } = {}) {
  const listeners = new Set();
  let listening = false;

  const isExpired = (e, t = now()) => t - e.created >= ROOM_TTL_MS || e.created - t > ROOM_TTL_MS;

  /** Alle gültigen, nicht abgelaufenen Einträge als { code: entry }. */
  function readAll() {
    let raw = null;
    try { raw = JSON.parse(storage?.getItem(ROOMS_KEY) ?? 'null'); } catch { raw = null; }
    const out = {};
    if (!isObj(raw)) return out;
    const t = now();
    for (const [code, value] of Object.entries(raw)) {
      const e = normalizeEntry(code, value);
      if (e && !isExpired(e, t)) out[code] = e;
    }
    return out;
  }

  /** Schreibt; bei vollem Speicher zuerst Ballast (Summaries, beendete Räume) abwerfen. */
  function writeAll(all) {
    const attempt = (data) => {
      try {
        if (Object.keys(data).length === 0) storage?.removeItem(ROOMS_KEY);
        else storage?.setItem(ROOMS_KEY, JSON.stringify(data));
        return true;
      } catch { return false; }
    };
    let ok = attempt(all);
    if (!ok) {
      const slim = {};
      for (const [code, e] of Object.entries(all)) {
        if (e.summary?.status === 'finished') continue;
        slim[code] = { ...e, recorded: e.recorded.slice(-5), notified: e.notified.slice(-5), alerts: e.alerts.slice(-1) };
      }
      ok = attempt(slim);
    }
    notify();
    return ok;
  }

  function notify() {
    for (const fn of [...listeners]) {
      try { fn(); } catch (err) { console.error(err); }
    }
  }

  const onStorage = (e) => {
    if (e?.key === ROOMS_KEY || e?.key === null) notify();
  };

  /** Read-modify-write für einen Raum; fn(entry|null) → neuer Eintrag | null (löschen) | undefined (nichts). */
  function change(code, fn) {
    const all = readAll();
    const next = fn(all[code] ?? null);
    if (next === undefined) return all[code] ?? null;
    if (next === null) delete all[code];
    else {
      const e = normalizeEntry(code, next);
      if (!e) return all[code] ?? null;
      all[code] = e;
    }
    writeAll(all);
    return all[code] ?? null;
  }

  const store = {
    /** Einträge, neueste zuerst. */
    list() {
      return Object.values(readAll()).sort((a, b) => b.created - a.created);
    },
    get(code) { return readAll()[code] ?? null; },
    /** Legt an (braucht token + me) oder mischt Felder in einen bestehenden Eintrag. */
    put(code, patch) {
      return change(code, (cur) => {
        if (!cur && !(patch?.token && patch?.me)) return undefined;
        const t = now();
        return { created: t, opened: t, ...cur, ...patch };
      });
    },
    /** Eintrag über eine Funktion ändern (fn bekommt den aktuellen Eintrag, null = löschen). */
    update(code, fn) { return change(code, (cur) => (cur ? fn(cur) : undefined)); },
    remove(code) { change(code, (cur) => (cur ? null : undefined)); },
    /** Abgelaufene/kaputte Einträge physisch entfernen. */
    purge() {
      let raw = null;
      try { raw = storage?.getItem(ROOMS_KEY) ?? null; } catch { return; }
      if (raw === null) return;
      const all = readAll();
      if (JSON.stringify(all) !== raw) writeAll(all);
    },
    /** Raum wurde geöffnet: Hinweise gelten als gesehen, „Du bist dran“ darf wieder melden. */
    markOpened(code) {
      return change(code, (cur) => (cur
        ? { ...cur, opened: now(), alerts: [], notified: cur.notified.filter((k) => !k.startsWith('move:')) }
        : undefined));
    },
    /** Anzahl Räume mit offenen Hinweisen (Badge). */
    alertCount() { return store.list().filter((e) => e.alerts.length > 0).length; },
    /** fn() bei jeder Änderung (auch aus anderen Tabs). → Abmelden */
    subscribe(fn) {
      listeners.add(fn);
      if (!listening) { events?.addEventListener?.('storage', onStorage); listening = true; }
      return () => {
        listeners.delete(fn);
        if (listeners.size === 0 && listening) { events?.removeEventListener?.('storage', onStorage); listening = false; }
      };
    },
    /**
     * Alte sessionStorage-Sitzungen (rps.token.<code> …) übernehmen und dort löschen.
     * @returns {string[]} übernommene Codes
     */
    migrate(legacy) {
      const keys = [];
      try {
        for (let i = 0; i < (legacy?.length ?? 0); i++) {
          const k = legacy.key(i);
          if (typeof k === 'string') keys.push(k);
        }
      } catch { return []; }
      const ours = keys.filter((k) => Object.values(LEGACY_PREFIX).some((p) => k.startsWith(p)));
      if (ours.length === 0) return [];
      const get = (k) => { try { return legacy.getItem(k); } catch { return null; } };
      const json = (k) => { try { return JSON.parse(get(k) ?? 'null'); } catch { return null; } };
      const codes = [...new Set(ours.filter((k) => k.startsWith(LEGACY_PREFIX.token)).map((k) => k.slice(LEGACY_PREFIX.token.length)))];
      const all = readAll();
      const moved = [];
      const t = now();
      for (const code of codes) {
        const token = get(LEGACY_PREFIX.token + code);
        const me = get(LEGACY_PREFIX.me + code);
        if (all[code] || !token || !me) continue;
        const e = normalizeEntry(code, {
          token, me, created: t, opened: t,
          pending: json(LEGACY_PREFIX.pending + code), recorded: json(LEGACY_PREFIX.recorded + code),
        });
        if (e) { all[code] = e; moved.push(code); }
      }
      if (moved.length) writeAll(all);
      for (const k of ours) { try { legacy.removeItem(k); } catch { /* ignorieren */ } }
      return moved;
    },
  };
  return store;
}

/**
 * Raum-Sitzung für ui/room.js & Co. (gleiche Schnittstelle wie früher, jetzt über den Raum-Speicher).
 * storage: Speicher (Standard localStorage) oder ein fertiger Store aus createRoomStore().
 */
export function createRoomSession(storage = undefined, opts = {}) {
  const store = storage && typeof storage.put === 'function' && typeof storage.list === 'function'
    ? storage
    : createRoomStore({ ...opts, storage: storage === undefined ? defaultStorage() : storage, events: null });
  return {
    store,
    /** { token, me } oder null */
    get(code) {
      const e = store.get(code);
      return e ? { token: e.token, me: e.me } : null;
    },
    /** Platz merken; weitere Felder (type, role, variant, bestOf, host, summary …) optional. */
    set(code, { token, me, ...meta }) { store.put(code, { token, me, ...meta }); },
    clear(code) { store.remove(code); },
    /** Eigener verdeckter Zug der laufenden Runde, damit nach Reload noch aufgedeckt werden kann. */
    getPending(code) { return store.get(code)?.pending ?? null; },
    setPending(code, pending) { store.update(code, (e) => ({ ...e, pending })); },
    clearPending(code) { store.update(code, (e) => (e.pending ? { ...e, pending: null } : undefined)); },
    /** Bereits in der Statistik gezählte Match-/Turnier-IDs (kein Doppelzählen nach Reload). */
    wasRecorded(code, id) { return store.get(code)?.recorded.includes(id) ?? false; },
    markRecorded(code, id) {
      store.update(code, (e) => (e.recorded.includes(id) ? undefined : { ...e, recorded: [...e.recorded, id] }));
    },
  };
}

// ─── Kurzfassung eines Raums (wie die Server-Action `watch`) ───

const isOver = (m) => m.winner !== null && m.winner !== undefined || Boolean(m.end);

/**
 * Baut aus einem vollen `state` dieselbe Kurzfassung, die `watch` liefert – damit der Wächter nach dem
 * Verlassen des Raum-Screens nichts meldet, was man schon gesehen hat.
 */
export function summaryFromState(state, me) {
  const players = state.players ?? [];
  const nameOf = (id) => players.find((p) => p.id === id)?.name ?? null;
  const self = players.find((p) => p.id === me);
  const active = players.filter((p) => !p.spectator && !p.left);
  const matchId = state.type === 'duel' ? state.current : state.myMatch;
  const m = matchId ? state.matches?.[matchId] : null;
  const myIdx = m?.p ? m.p.indexOf(me) : -1;
  let opponent = null;
  if (state.type === 'duel') opponent = players.find((p) => p.id !== me && !p.spectator)?.name ?? null;
  else if (m && myIdx >= 0) opponent = nameOf(m.p[1 - myIdx]);
  const running = Boolean(m && myIdx >= 0 && !isOver(m) && m.p.every(Boolean));
  const rematch = state.rematch ?? [];
  return {
    version: state.version ?? null,
    type: state.type,
    variant: state.variant,
    bestOf: state.bestOf,
    status: state.status,
    me,
    isHost: state.host === me,
    players: active.length,
    spectator: Boolean(self?.spectator),
    left: Boolean(self?.left),
    opponent,
    myMatch: state.type === 'duel' ? (state.current ?? null) : (state.myMatch ?? null),
    needsMove: running && state.status === 'running' && m.cur?.committed?.[myIdx] === false,
    rematchWanted: state.type === 'duel' && Boolean(m && isOver(m)) && rematch.some((id) => id !== me) && !rematch.includes(me),
    champion: state.champion ? nameOf(state.champion) : null,
  };
}

// ─── Anzeige-Texte für „Meine Spiele“ ───

/** „gerade eben“, „vor 5 Min.“, „vor 3 Std.“ */
export function ageText(ms) {
  const min = Math.floor(Math.max(0, ms) / 60_000);
  if (min < 1) return 'gerade eben';
  if (min < 60) return `vor ${min} Min.`;
  return `vor ${Math.floor(min / 60)} Std.`;
}

/**
 * Status in Worten für eine Karte in „Meine Spiele“.
 * @returns {{ text:string, tone:'wait'|'turn'|'run'|'done', who:string|null }}
 */
export function describeRoom(entry) {
  const s = entry.summary;
  const opp = s?.opponent ?? entry.opponent;
  if (!s || !s.status) return { text: 'Wird geladen …', tone: 'run', who: null };
  if (s.type === 'duel') {
    const who = opp ? `gegen ${opp}` : null;
    if (s.status === 'lobby') return { text: 'Wartet auf Gegner …', tone: 'wait', who: null };
    if (s.status === 'finished') return { text: opp ? `Beendet – ${opp} ist gegangen` : 'Beendet', tone: 'done', who };
    if (s.rematchWanted) return { text: `${opp ?? 'Dein Gegner'} will Revanche`, tone: 'turn', who };
    if (s.needsMove) return { text: 'Läuft – du bist dran!', tone: 'turn', who };
    return { text: 'Läuft', tone: 'run', who };
  }
  const who = `${s.players ?? '?'} Spieler`;
  if (s.status === 'lobby') {
    return { text: s.isHost ? 'Lobby – wartet auf Mitspieler' : 'Lobby – wartet auf den Start', tone: 'wait', who };
  }
  if (s.status === 'finished') {
    return { text: s.champion ? `Beendet – ${s.champion} gewinnt` : 'Turnier beendet', tone: 'done', who };
  }
  if (s.spectator) return { text: 'Turnier läuft – du schaust zu', tone: 'run', who };
  if (s.myMatch && s.needsMove) return { text: `Turnier: du bist dran${opp ? ` gegen ${opp}` : ''}!`, tone: 'turn', who };
  if (s.myMatch) return { text: `Turnier: dein Match${opp ? ` gegen ${opp}` : ''} läuft`, tone: 'run', who };
  return { text: entry.stage ? `Turnier: ${entry.stage}` : 'Turnier läuft', tone: 'run', who };
}
