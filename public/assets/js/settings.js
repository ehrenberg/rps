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

/** Höchstlänge in Graphemen (sichtbaren Zeichen); dazu ein hartes Codepoint-Limit gegen Combining-Spam. */
export const NAME_MAX_LENGTH = 20;
export const NAME_MAX_CODEPOINTS = 80;
export const DEFAULT_CPU_SETUP = Object.freeze({ level: 1, variant: 'classic', bestOf: 3 });

const FLAG_ON = '1';
const FLAG_OFF = '0';

// Gleiche Regeln wie rps_strip_invisible() in public/src/validate.php (gemeinsame Fälle: tests/fixtures/names.json).
// PCRE [\s\p{Z}] mit /u umfasst zusätzlich NEL (U+0085) und U+180E – hier ausgeschrieben.
const WHITESPACE = /[\t\n\v\f\r\u0085\u180E\p{Z}]/gu;
const INVISIBLE = /[\u115F\u1160\u3164\uFFA0\u2800\u034F\u17B4\u17B5\u180E]/gu;
const OTHER_EXCEPT_ZWJ = /[^\P{C}\u200D]/gu;  // Steuer-, Format- (u. a. Bidi), private Zeichen außer ZWJ
const LONE_VS = /(^| )[\uFE00-\uFE0F]+/gu;     // Variation Selector ohne Basiszeichen
const EMOJI = '\\u2300-\\u23FF\\u2600-\\u27BF\\u2B00-\\u2BFF\\u{1F000}-\\u{1FAFF}\\uFE0F';
const LONE_ZWJ = new RegExp(`(?<![${EMOJI}])\\u200D|\\u200D(?![${EMOJI}])`, 'gu');
const DANGLING_END = /[\p{M}\u200D]+$/u;  // Fallback-Kürzung endet nie auf ZWJ/Variation Selector/Combining

const segmenter = typeof Intl === 'object' && typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter('de', { granularity: 'grapheme' })
  : null;

/** Zerlegt in Grapheme (Intl.Segmenter); ohne Segmenter (seg = null) in Codepoints. */
export function graphemes(s, seg = segmenter) {
  const str = String(s ?? '');
  return seg ? Array.from(seg.segment(str), (x) => x.segment) : Array.from(str);
}

/**
 * Kürzt grapheme-sicher auf max. 20 Grapheme und 80 Codepoints; das erste Graphem, das nicht mehr
 * passt, fällt samt Rest weg. Ohne Segmenter nach Codepoints, aber nie mit hängendem ZWJ/VS/Combining.
 */
export function truncateName(s, seg = segmenter) {
  const out = [];
  let codepoints = 0;
  for (const g of graphemes(s, seg)) {
    const n = Array.from(g).length;
    if (out.length >= NAME_MAX_LENGTH || codepoints + n > NAME_MAX_CODEPOINTS) break;
    out.push(g);
    codepoints += n;
  }
  const joined = out.join('');
  return seg ? joined : joined.replace(DANGLING_END, '');
}

/** Bereinigt wie der Server (NFC, Leerraum, Unsichtbares, ZWJ nur zwischen Emoji), ohne zu kürzen. */
export function cleanName(raw) {
  return String(raw ?? '')
    .normalize('NFC')
    .replace(WHITESPACE, ' ')
    .replace(INVISIBLE, '')
    .replace(OTHER_EXCEPT_ZWJ, '')
    .replace(LONE_VS, '$1')
    .replace(LONE_ZWJ, '')
    .replace(/ {2,}/g, ' ')
    .replace(/^ +| +$/g, '');
}

/** Name säubern und grapheme-sicher kürzen – das Ergebnis besteht die Serverprüfung unverändert. */
export function sanitizeName(raw, seg = segmenter) {
  return truncateName(cleanName(raw), seg).replace(/ +$/, '');
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
