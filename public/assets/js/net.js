// API-Client, Polling und Raum-Sitzung (DOM-frei; fetch, Timer und Speicher injizierbar).
// Vertrag: docs/SCHNITTSTELLEN.md („net.js“, „Server-API“, „Online-Adapter“).

export const API_URL = 'api.php';

/** Poll-Intervalle (ms) laut ARCHITEKTUR „Polling“. */
export const POLL_MS = Object.freeze({ match: 1000, idle: 1000, end: 5000, hidden: 3000 });
export const BACKOFF_MAX_MS = 10_000;
export const RECONNECT_TEXT = 'Verbindung wird wiederhergestellt …';
const NETWORK_ERROR_TEXT = 'Keine Verbindung zum Server.';
const TIMEOUT_TEXT = 'Zeitüberschreitung – der Server antwortet nicht.';
/** Ohne Antwort nach dieser Zeit wird ein Request abgebrochen (sonst blockiert er den Poller). */
export const API_TIMEOUT_MS = 8000;

/** HTTP-Statuscodes, auf die der Client reagiert. 0 = Netzwerkfehler/Timeout. */
export const HTTP = Object.freeze({
  NETWORK: 0, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, TOO_MANY: 429, SERVER_ERROR: 500,
});
/** Statuscodes, bei denen weiteres Pollen sinnlos ist (Token unbekannt, Raum weg). */
export const FATAL_STATUS = Object.freeze([HTTP.FORBIDDEN, HTTP.NOT_FOUND]);

export class ApiError extends Error {
  /** @param {string} message deutscher, anzeigbarer Text  @param {number} status HTTP-Status (0 = Netzwerk) */
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }

  /** Netzwerk- oder Serverfehler → später erneut versuchen. */
  get retryable() {
    return this.status === HTTP.NETWORK || this.status >= HTTP.SERVER_ERROR;
  }
}

/** Fehler beim Verarbeiten eines Zustands (onState hat geworfen) – kein Netzwerkproblem. */
export class StateHandlerError extends Error {
  constructor(cause) {
    super('Die Anzeige konnte nicht aktualisiert werden – neuer Versuch …', { cause });
    this.name = 'StateHandlerError';
  }
}

/** POST api.php mit JSON; wirft ApiError mit deutschem Text (auch bei Timeout). */
export async function api(action, params = {}, { fetchImpl = globalThis.fetch, url = API_URL, timeoutMs = API_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  let res;
  let data = null;
  try {
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...params }),
        cache: 'no-store',
        signal: controller.signal,
      });
    } catch {
      throw new ApiError(timedOut ? TIMEOUT_TEXT : NETWORK_ERROR_TEXT, HTTP.NETWORK);
    }
    try { data = await res.json(); } catch {
      if (timedOut) throw new ApiError(TIMEOUT_TEXT, HTTP.NETWORK);
      data = null;
    }
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    throw new ApiError(data?.error ?? `Serverfehler (${res.status}).`, res.status);
  }
  if (!data || typeof data !== 'object') throw new ApiError('Ungültige Antwort vom Server.', res.status);
  return data;
}

/** Wartezeit nach n aufeinanderfolgenden Fehlern: 1 s, 2 s, 4 s, 8 s, 10 s … */
export function backoffDelay(failures, base = POLL_MS.match) {
  return Math.min(BACKOFF_MAX_MS, base * 2 ** Math.max(0, failures - 1));
}

/** Intervall je Modus; im Hintergrund-Tab mindestens POLL_MS.hidden. */
export function pollInterval(mode, hidden) {
  const ms = POLL_MS[mode] ?? POLL_MS.match;
  return hidden ? Math.max(ms, POLL_MS.hidden) : ms;
}

/**
 * Pollt `state` mit since=version.
 * onState(state) bei neuer Version, onOnline(online) bei jeder Antwort ({id: bool}),
 * onError(err, { failures, fatal }) bei Fehlern, onConnection(ok) wenn sich die Erreichbarkeit ändert.
 */
export function createPoller({
  code, token, onState, onOnline = () => {}, onError = () => {}, onConnection = () => {},
  apiFn = api,
  timers = globalThis,
  isHidden = () => globalThis.document?.visibilityState === 'hidden',
}) {
  let mode = 'match';
  let version = null;
  let timer = null;
  let running = false;
  let inFlight = false;
  let again = false;
  let failures = 0;
  let stateFailures = 0; // onState hat geworfen (Backoff, damit kein Fehler-Sturm entsteht)
  let connected = true;

  const schedule = (ms) => {
    timers.clearTimeout(timer);
    if (running) timer = timers.setTimeout(tick, ms);
  };

  const setConnected = (ok) => {
    if (ok === connected) return;
    connected = ok;
    onConnection(ok);
  };

  async function tick() {
    if (!running) return;
    if (inFlight) { again = true; return; }
    inFlight = true;
    timers.clearTimeout(timer);
    try {
      const params = { code, token };
      if (version !== null) params.since = version;
      const res = await apiFn('state', params);
      if (!running) return;
      failures = 0;
      setConnected(true);
      if (!res.unchanged) {
        // Version erst nach erfolgreicher Verarbeitung übernehmen: wirft onState, kommt der
        // Zustand beim nächsten Poll erneut (sonst bliebe die Anzeige auf altem Stand stehen).
        try {
          onState(res);
          version = res.version;
          stateFailures = 0;
        } catch (err) {
          stateFailures += 1;
          console.error(err);
          onError(new StateHandlerError(err), { failures: stateFailures, fatal: false });
        }
      }
      const online = res.unchanged
        ? res.online
        : Object.fromEntries((res.players ?? []).map((p) => [p.id, Boolean(p.online)]));
      if (online) onOnline(online);
    } catch (err) {
      if (!running) return;
      failures += 1;
      const fatal = err instanceof ApiError && FATAL_STATUS.includes(err.status);
      if (err instanceof ApiError && err.retryable) setConnected(false);
      onError(err, { failures, fatal });
      if (fatal) { running = false; return; }
    } finally {
      inFlight = false;
    }
    if (!running) return;
    if (again) { again = false; schedule(0); return; }
    const errors = Math.max(failures, stateFailures);
    schedule(errors ? backoffDelay(errors) : pollInterval(mode, isHidden()));
  }

  return {
    get version() { return version; },
    get mode() { return mode; },
    start() {
      if (running) return;
      running = true;
      tick();
    },
    stop() {
      running = false;
      timers.clearTimeout(timer);
    },
    /** Sofort neu laden (z. B. nach eigener Aktion oder wenn der Tab sichtbar wird). */
    poke() {
      if (!running) return;
      if (inFlight) again = true;
      else schedule(0);
    },
    setMode(next) {
      if (!Object.hasOwn(POLL_MS, next) || next === 'hidden') throw new Error(`Unbekannter Modus: ${next}`);
      mode = next;
    },
  };
}

// ─── Raum-Sitzung (sessionStorage: neuer Tab = neuer Spieler, Reload behält den Platz) ───

export const SESSION_KEYS = Object.freeze({
  token: (code) => `rps.token.${code}`,
  me: (code) => `rps.me.${code}`,
  pending: (code) => `rps.pending.${code}`,
  recorded: (code) => `rps.recorded.${code}`,
});

function safe(storage) {
  return {
    get(k) { try { return storage?.getItem(k) ?? null; } catch { return null; } },
    set(k, v) { try { storage?.setItem(k, v); } catch { /* ignorieren */ } },
    del(k) { try { storage?.removeItem(k); } catch { /* ignorieren */ } },
  };
}

export function createRoomSession(storage = globalThis.sessionStorage) {
  const s = safe(storage);
  const readJson = (k) => { try { return JSON.parse(s.get(k) ?? 'null'); } catch { return null; } };
  return {
    /** { token, me } oder null */
    get(code) {
      const token = s.get(SESSION_KEYS.token(code));
      const me = s.get(SESSION_KEYS.me(code));
      return token && me ? { token, me } : null;
    },
    set(code, { token, me }) {
      s.set(SESSION_KEYS.token(code), token);
      s.set(SESSION_KEYS.me(code), me);
    },
    clear(code) {
      for (const key of Object.values(SESSION_KEYS)) s.del(key(code));
    },
    /** Eigener verdeckter Zug der laufenden Runde, damit nach Reload noch aufgedeckt werden kann. */
    getPending(code) { return readJson(SESSION_KEYS.pending(code)); },
    setPending(code, pending) { s.set(SESSION_KEYS.pending(code), JSON.stringify(pending)); },
    clearPending(code) { s.del(SESSION_KEYS.pending(code)); },
    /** Bereits in der Statistik gezählte Match-/Turnier-IDs (kein Doppelzählen nach Reload). */
    wasRecorded(code, id) { return (readJson(SESSION_KEYS.recorded(code)) ?? []).includes(id); },
    markRecorded(code, id) {
      const list = readJson(SESSION_KEYS.recorded(code)) ?? [];
      if (!list.includes(id)) s.set(SESSION_KEYS.recorded(code), JSON.stringify([...list, id]));
    },
  };
}
