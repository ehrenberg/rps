// Kleine DOM-freie Helfer gegen Doppelanfragen und zu schnelles Senden.

/**
 * Führt fn höchstens einmal gleichzeitig aus. Während eine Anfrage läuft, gibt der Aufruf null
 * zurück (ignoriert), sonst das Promise von fn. `run.busy` zeigt den Zustand; onChange(busy) meldet
 * Wechsel (z. B. Button sperren).
 * @template T
 * @param {(...args:any[]) => Promise<T>|T} fn
 * @param {{ onChange?: (busy:boolean) => void }} [o]
 */
export function singleFlight(fn, { onChange = () => {} } = {}) {
  let busy = false;
  const set = (value) => { busy = value; onChange(value); };
  const run = (...args) => {
    if (busy) return null;
    set(true);
    let result;
    try {
      result = Promise.resolve(fn(...args));
    } catch (err) {
      result = Promise.reject(err);
    }
    return result.finally(() => set(false));
  };
  Object.defineProperty(run, 'busy', { get: () => busy });
  return run;
}

/**
 * Sperre für ms Millisekunden nach jeder erlaubten Aktion (z. B. 1 Reaktion pro Sekunde).
 * take() → true, wenn die Aktion jetzt erlaubt ist (startet die Sperre).
 */
export function createCooldown(ms, { timers = globalThis, onChange = () => {} } = {}) {
  let active = false;
  return {
    get active() { return active; },
    take() {
      if (active) return false;
      active = true;
      onChange(true);
      timers.setTimeout(() => { active = false; onChange(false); }, ms);
      return true;
    },
  };
}
