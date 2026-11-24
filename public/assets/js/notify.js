// Benachrichtigungen außerhalb der Seite: System-Benachrichtigung (Notification API, ohne Service Worker)
// und blinkender Tab-Titel. DOM-frei bis auf document.title; alles injizierbar für Tests.
// Vertrag: docs/SCHNITTSTELLEN.md („notify.js“).
import { safeStorage } from './settings.js';

export const NOTIFY_KEY = 'rps.notify';          // '1' = Nutzer möchte System-Benachrichtigungen
export const NOTIFY_HINT_KEY = 'rps.notifyHint'; // '1' = Hinweis in der Lobby wurde beantwortet
export const NOTIFY_ICON = 'assets/img/icon-192.png';
export const TITLE_BLINK_MS = 1000;

/**
 * @param {{ NotificationImpl?, storage?, isHidden?:()=>boolean, focus?:()=>void, onOpen?:(code:string)=>void }} o
 *   onOpen: Klick auf die Benachrichtigung → Raum öffnen
 */
export function createNotifier({
  NotificationImpl = globalThis.Notification,
  storage = safeStorage(),
  isHidden = () => globalThis.document?.visibilityState === 'hidden',
  focus = () => globalThis.focus?.(),
  onOpen = () => {},
} = {}) {
  const supported = typeof NotificationImpl === 'function';
  const permission = () => {
    if (!supported) return 'unsupported';
    try { return NotificationImpl.permission ?? 'default'; } catch { return 'denied'; }
  };
  const wanted = () => storage.getItem(NOTIFY_KEY) === '1';

  const notifier = {
    supported,
    permission,
    /** Schalter in den Einstellungen: gewünscht UND vom Browser erlaubt. */
    isEnabled: () => wanted() && permission() === 'granted',
    /**
     * Einschalten – nur aus einem Klick heraus aufrufen (fragt ggf. den Browser).
     * @returns {Promise<'granted'|'denied'|'default'|'unsupported'>}
     */
    async enable() {
      storage.setItem(NOTIFY_HINT_KEY, '1');
      if (!supported) return 'unsupported';
      let result = permission();
      if (result === 'default') {
        try {
          const answer = await NotificationImpl.requestPermission();
          result = typeof answer === 'string' ? answer : permission(); // sehr alte Safari: kein Promise
        } catch { result = 'denied'; }
      }
      storage.setItem(NOTIFY_KEY, result === 'granted' ? '1' : '0');
      return result;
    },
    disable() { storage.setItem(NOTIFY_KEY, '0'); },
    /** Dezenten Hinweis anbieten? Nur wenn möglich, noch nicht entschieden und nicht beantwortet. */
    shouldOfferHint() {
      return supported && permission() === 'default' && storage.getItem(NOTIFY_HINT_KEY) !== '1' && !wanted();
    },
    dismissHint() { storage.setItem(NOTIFY_HINT_KEY, '1'); },
    /**
     * Benachrichtigung zeigen – nur bei verstecktem Tab und erteilter Erlaubnis, sonst still.
     * @returns {object|null} die Notification oder null
     */
    send({ title, body, code, tag = code ? `rps-${code}` : 'rps' }) {
      if (!notifier.isEnabled() || !isHidden()) return null;
      try {
        const n = new NotificationImpl(title, { body, tag, icon: NOTIFY_ICON, lang: 'de' });
        n.onclick = () => {
          try { focus(); } catch { /* ignorieren */ }
          if (code) onOpen(code);
          try { n.close?.(); } catch { /* ignorieren */ }
        };
        return n;
      } catch {
        return null; // z. B. Android-Chrome: nur mit Service Worker erlaubt → still
      }
    },
  };
  return notifier;
}

/**
 * Tab-Titel wechselt im Sekundentakt zwischen normal und „(n) Ben ist da!“, solange der Tab versteckt ist.
 * @param {{ doc?, timers?, intervalMs? }} [o]
 */
export function createTitleBlinker({ doc = globalThis.document, timers = globalThis, intervalMs = TITLE_BLINK_MS } = {}) {
  let base = null;
  let alertTitle = null;
  let count = 0;
  let timer = null;
  let showing = false;

  const hidden = () => doc?.visibilityState === 'hidden' || doc?.hidden === true;

  function stop() {
    if (timer !== null) timers.clearInterval(timer);
    timer = null;
    if (base !== null && doc) doc.title = base;
    base = null;
    alertTitle = null;
    count = 0;
    showing = false;
  }

  function tick() {
    if (!hidden()) { stop(); return; }
    // Titel hat sich zwischendurch geändert (anderer Screen) → das ist der neue Normal-Titel
    if (doc.title !== alertTitle && doc.title !== base) base = doc.title;
    showing = !showing;
    doc.title = showing ? alertTitle : base;
  }

  const onVisibility = () => { if (!hidden()) stop(); };
  doc?.addEventListener?.('visibilitychange', onVisibility);

  return {
    get active() { return timer !== null; },
    get count() { return count; },
    /** Neues Ereignis; bei sichtbarem Tab passiert nichts. → true, wenn geblinkt wird */
    alert(text) {
      if (!doc || !hidden()) return false;
      count += 1;
      if (timer === null) {
        base = doc.title;
        timer = timers.setInterval(tick, intervalMs);
      }
      alertTitle = `(${count}) ${text}`;
      showing = true;
      doc.title = alertTitle;
      return true;
    },
    stop,
    dispose() {
      stop();
      doc?.removeEventListener?.('visibilitychange', onVisibility);
    },
  };
}
