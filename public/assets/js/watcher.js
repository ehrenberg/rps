// Hintergrund-Wächter für „Meine Spiele“ (DOM-frei; API, Timer, Sichtbarkeit injizierbar).
// Fragt alle offenen Räume außer dem gerade angezeigten per Sammel-Action `watch` ab, vergleicht die
// Kurzfassungen und meldet neue Ereignisse („Ben ist da“, „Dein Match beginnt“ …) genau einmal.
// Vertrag: docs/SCHNITTSTELLEN.md („watcher.js“).
import { api } from './net.js';

/** Abfrage-Intervall (ms): sichtbarer bzw. versteckter Tab. */
export const WATCH_MS = Object.freeze({ visible: 4000, hidden: 15_000 });
export const WATCH_BACKOFF_MAX_MS = 60_000;
/** Höchstzahl Räume pro Anfrage (Server-Limit); bei mehr Räumen wird rotiert. */
export const WATCH_MAX_ROOMS = 10;
/** Pro Abfrage wird je Raum nur das wichtigste Ereignis gemeldet (die anderen gelten als erledigt). */
export const EVENT_PRIORITY = Object.freeze(['joined', 'match', 'rematch', 'move', 'finished']);

/** Wartezeit nach n Fehlern in Folge: 4 s, 8 s, 16 s … höchstens 60 s. */
export function watchBackoff(failures, base = WATCH_MS.visible) {
  return Math.min(WATCH_BACKOFF_MAX_MS, base * 2 ** Math.max(0, failures - 1));
}

/**
 * Ereignisse zwischen zwei Kurzfassungen eines Raums, nach Priorität sortiert, ohne schon gemeldete.
 * Ohne vorherige Kurzfassung gibt es nichts zu vergleichen (erste Abfrage = Ausgangslage).
 * @returns {{ kind:string, key:string, text:string, title:string }[]}
 *   text: ganzer Satz (Toast, Benachrichtigung), title: kurz (Tab-Titel)
 */
export function detectEvents(prev, next, { notified = [] } = {}) {
  if (!prev || !next || next.unchanged || !next.status) return [];
  const opp = next.opponent ?? null;
  const out = [];
  const add = (kind, key, text, title) => out.push({ kind, key, text, title });

  if (next.type === 'duel' && next.status === 'running' && opp && (prev.status === 'lobby' || !prev.opponent)) {
    add('joined', 'joined', `${opp} ist da – euer Duell startet!`, `${opp} ist da!`);
  }
  if (next.type === 'tournament' && !next.spectator && next.myMatch && next.myMatch !== prev.myMatch) {
    add('match', `match:${next.myMatch}`, opp ? `Dein Turnier-Match gegen ${opp} beginnt!` : 'Dein Turnier-Match beginnt!', 'Dein Match beginnt!');
  }
  if (next.rematchWanted && !prev.rematchWanted) {
    add('rematch', `rematch:${next.myMatch ?? ''}`, `${opp ?? 'Dein Gegner'} will eine Revanche!`, 'Revanche?');
  }
  if (next.needsMove && !prev.needsMove) {
    add('move', `move:${next.myMatch ?? ''}`, opp ? `Du bist am Zug gegen ${opp}!` : 'Du bist am Zug!', 'Du bist dran!');
  }
  if (next.type === 'tournament' && next.status === 'finished' && prev.status !== 'finished') {
    add('finished', `finished:${next.version ?? ''}`,
      next.champion ? `Turnier vorbei – ${next.champion} gewinnt!` : 'Das Turnier ist vorbei.', 'Turnier vorbei!');
  }
  const done = new Set(notified);
  return out.filter((e) => !done.has(e.key))
    .sort((a, b) => EVENT_PRIORITY.indexOf(a.kind) - EVENT_PRIORITY.indexOf(b.kind));
}

/**
 * @param {{ store, apiFn?, timers?, isHidden?:()=>boolean, events?:EventTarget|null, now?:()=>number,
 *           onEvent?:(ev:{code, kind, key, text, title})=>void, onGone?:(code:string, reason:string)=>void }} o
 *   events: Quelle von „visibilitychange“ (document) – beim Sichtbarwerden wird sofort abgefragt.
 */
export function createWatcher({
  store, apiFn = api, timers = globalThis,
  isHidden = () => globalThis.document?.visibilityState === 'hidden',
  events = globalThis.document ?? null, now = () => Date.now(),
  onEvent = () => {}, onGone = () => {},
}) {
  let active = null;
  let running = false;
  let timer = null;
  let inFlight = false;
  let again = false;
  let failures = 0;
  let unsubscribe = null;
  const checked = new Map(); // code → Zeitpunkt der letzten Abfrage (für die Rotation)

  const candidates = () => store.list().filter((e) => e.code !== active);

  function schedule(ms) {
    timers.clearTimeout(timer);
    timer = null;
    if (running && candidates().length > 0) timer = timers.setTimeout(tick, ms);
  }

  /** Nach Änderungen im Speicher: aufwachen, falls gerade nichts geplant ist. */
  function wake() {
    if (running && timer === null && !inFlight) schedule(failures ? watchBackoff(failures) : 0);
  }

  function poke() {
    if (!running) return;
    if (inFlight) again = true;
    else schedule(0);
  }

  function handle(res, sent) {
    const rooms = res && typeof res.rooms === 'object' && res.rooms ? res.rooms : {};
    const t = now();
    for (const { code, token } of sent) {
      const r = rooms[code];
      if (!r || typeof r !== 'object') continue;
      checked.set(code, t);
      if (r.gone) {
        // Nur löschen, wenn es noch derselbe Platz ist (nicht inzwischen neu beigetreten)
        const cur = store.get(code);
        if (cur && cur.token === token) {
          store.remove(code);
          onGone(code, r.reason ?? 'notFound');
        }
        continue;
      }
      if (r.unchanged || code === active) continue; // aktiver Raum: der Raum-Screen hält ihn aktuell
      let fresh = [];
      store.update(code, (e) => {
        if (e.token !== token) return undefined;
        fresh = detectEvents(e.summary, r, { notified: e.notified });
        const top = fresh[0];
        return {
          ...e,
          summary: r,
          type: r.type ?? e.type,
          variant: r.variant ?? e.variant,
          bestOf: r.bestOf ?? e.bestOf,
          opponent: r.opponent ?? e.opponent,
          notified: [...e.notified, ...fresh.map((x) => x.key)],
          alerts: top ? [...e.alerts, { kind: top.kind, text: top.text, at: t }] : e.alerts,
        };
      });
      if (fresh[0]) {
        try { onEvent({ code, ...fresh[0] }); } catch (err) { console.error(err); }
      }
    }
  }

  async function tick() {
    timer = null;
    if (!running) return;
    if (inFlight) { again = true; return; }
    const rooms = candidates()
      .sort((a, b) => (checked.get(a.code) ?? 0) - (checked.get(b.code) ?? 0))
      .slice(0, WATCH_MAX_ROOMS);
    if (rooms.length === 0) return; // still, bis wieder ein Raum dazukommt (wake)
    inFlight = true;
    const sent = rooms.map((e) => ({ code: e.code, token: e.token }));
    try {
      const params = rooms.map((e) => {
        const since = e.summary?.version;
        return Number.isFinite(since) ? { code: e.code, token: e.token, since } : { code: e.code, token: e.token };
      });
      const res = await apiFn('watch', { rooms: params });
      if (!running) return;
      failures = 0;
      handle(res, sent);
    } catch {
      if (!running) return;
      failures += 1;
    } finally {
      inFlight = false;
    }
    if (!running) return;
    if (again) { again = false; schedule(0); return; }
    schedule(failures ? watchBackoff(failures, interval()) : interval());
  }

  const interval = () => (isHidden() ? WATCH_MS.hidden : WATCH_MS.visible);
  const onVisibility = () => { if (!isHidden()) poke(); };

  return {
    get running() { return running; },
    get active() { return active; },
    get failures() { return failures; },
    start() {
      if (running) return;
      running = true;
      unsubscribe = store.subscribe(wake);
      events?.addEventListener?.('visibilitychange', onVisibility);
      schedule(0);
    },
    stop() {
      running = false;
      unsubscribe?.();
      unsubscribe = null;
      events?.removeEventListener?.('visibilitychange', onVisibility);
      timers.clearTimeout(timer);
      timer = null;
    },
    /** Gerade angezeigter Raum (pollt selbst) – wird ausgelassen. null = kein Raum. */
    setActive(code) {
      if (code === active) return;
      active = code ?? null;
      if (active === null) wake();
    },
    /** Sofort abfragen (z. B. beim Öffnen von „Meine Spiele“). */
    poke,
  };
}
