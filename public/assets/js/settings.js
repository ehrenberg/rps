// Lokale Einstellungen (DOM-frei, Speicher injizierbar für Tests).
// Schlüssel laut docs/SCHNITTSTELLEN.md; alle mit Präfix 'rps.'.

import { BEST_OF, isValidVariant } from './rules.js';
import { AI_LEVELS } from './ai.js';

export const KEYS = Object.freeze({
  name: 'rps.name',
  reducedFx: 'rps.reducedFx',
  cpuSetup: 'rps.cpuSetup.v1',
  insight: 'rps.insight',
});

export const NAME_MAX_LENGTH = 20;
export const DEFAULT_CPU_SETUP = Object.freeze({ level: 1, variant: 'classic', bestOf: 3 });

const FLAG_ON = '1';
const FLAG_OFF = '0';
// Steuerzeichen (C0, DEL, C1) sowie Zeilen-/Absatztrenner; Leerraum wird vorher zu ' '
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

/** Name säubern: Steuerzeichen raus, Leerraum zusammenfassen, max. 20 Zeichen (Codepoints). */
export function sanitizeName(raw) {
  const cleaned = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .replace(CONTROL_CHARS, '')
    .trim();
  return Array.from(cleaned).slice(0, NAME_MAX_LENGTH).join('').trim();
}

/** Ungültige/fehlende Felder durch Standardwerte ersetzen. */
export function normalizeCpuSetup(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const level = Number(src.level);
  const bestOf = Number(src.bestOf);
  return {
    level: AI_LEVELS.some((l) => l.level === level) ? level : DEFAULT_CPU_SETUP.level,
    variant: isValidVariant(src.variant) ? src.variant : DEFAULT_CPU_SETUP.variant,
    bestOf: BEST_OF.includes(bestOf) ? bestOf : DEFAULT_CPU_SETUP.bestOf,
  };
}

/** localStorage, das in privaten Fenstern/ohne Speicher nicht wirft. */
export function safeStorage(backend = globalThis.localStorage) {
  return {
    getItem(key) {
      try { return backend?.getItem(key) ?? null; } catch { return null; }
    },
    setItem(key, value) {
      try { backend?.setItem(key, value); } catch { /* Speicher voll/gesperrt: ignorieren */ }
    },
    removeItem(key) {
      try { backend?.removeItem(key); } catch { /* ignorieren */ }
    },
  };
}

export function createSettings(storage = safeStorage()) {
  const readFlag = (key) => storage.getItem(key) === FLAG_ON;
  const writeFlag = (key, on) => storage.setItem(key, on ? FLAG_ON : FLAG_OFF);

  return {
    getName() {
      return sanitizeName(storage.getItem(KEYS.name));
    },
    /** Speichert den gesäuberten Namen und gibt ihn zurück (leer = löschen). */
    setName(raw) {
      const name = sanitizeName(raw);
      if (name) storage.setItem(KEYS.name, name);
      else storage.removeItem(KEYS.name);
      return name;
    },
    getReducedFx: () => readFlag(KEYS.reducedFx),
    setReducedFx: (on) => writeFlag(KEYS.reducedFx, Boolean(on)),
    getInsight: () => readFlag(KEYS.insight),
    setInsight: (on) => writeFlag(KEYS.insight, Boolean(on)),
    getCpuSetup() {
      let parsed = null;
      try { parsed = JSON.parse(storage.getItem(KEYS.cpuSetup) ?? 'null'); } catch { parsed = null; }
      return normalizeCpuSetup(parsed);
    },
    setCpuSetup(setup) {
      const normalized = normalizeCpuSetup(setup);
      storage.setItem(KEYS.cpuSetup, JSON.stringify(normalized));
      return normalized;
    },
  };
}
