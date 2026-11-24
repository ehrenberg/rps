// Lokale Statistik in localStorage (rps.stats.v1). Vertrag: docs/SCHNITTSTELLEN.md
// Struktur siehe docs/ARCHITEKTUR.md. Alle Lesezugriffe sind robust gegen kaputte Daten.

import { MOVES, VARIANTS } from './rules.js';

export const STATS_KEY = 'rps.stats.v1';
export const MATCH_MODES = Object.freeze(['cpu-1', 'cpu-2', 'cpu-3', 'cpu-4', 'duel']);
export const TOURNAMENT_MODE = 'tournament';
const ROUND_RESULTS = Object.freeze(['w', 'l', 'd']);
const MATCH_RESULTS = Object.freeze(['w', 'l']);

/** Unter so vielen Zügen ist eine Aussage zur Vorhersehbarkeit unseriös. */
export const MIN_MOVES_FOR_PREDICTABILITY = 10;
export const NOT_ENOUGH_DATA = 'Noch zu wenig Daten';

/** Schwellen (normalisierte Entropie, absteigend) → Text. */
const PREDICTABILITY_LEVELS = Object.freeze([
  [0.95, 'Unberechenbar'],
  [0.85, 'Schwer zu durchschauen'],
  [0.7, 'Etwas vorhersehbar'],
  [0.5, 'Ziemlich vorhersehbar'],
  [0, 'Sehr vorhersehbar'],
]);

// --- Storage ---------------------------------------------------------------

let storageOverride; // undefined = globalThis.localStorage

/** Für Tests (oder andere Speicher): eigenen Storage setzen; ohne Argument zurück auf localStorage. */
export function setStorage(storage) {
  storageOverride = storage;
}

function currentStorage() {
  if (storageOverride !== undefined) return storageOverride;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readRaw() {
  try {
    const raw = currentStorage()?.getItem(STATS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(stats) {
  try {
    currentStorage()?.setItem(STATS_KEY, JSON.stringify(stats));
  } catch {
    /* Speicher voll/gesperrt – Statistik ist dann nur flüchtig */
  }
}

// --- Struktur & Bereinigung --------------------------------------------------

const today = () => new Date().toISOString().slice(0, 10);
const counter = (keys) => Object.fromEntries(keys.map((k) => [k, 0]));
const matchRecord = () => counter(['w', 'l', 'd']);
const tournamentRecord = () => counter(['played', 'won', 'w', 'l']);

/** Leere Statistik mit allen Feldern. */
export function emptyStats() {
  return {
    games: {
      ...Object.fromEntries(MATCH_MODES.map((m) => [m, matchRecord()])),
      [TOURNAMENT_MODE]: tournamentRecord(),
    },
    rounds: matchRecord(),
    moves: counter(MOVES),
    streak: { current: 0, best: 0 },
    since: today(),
  };
}

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const toCount = (x) => (Number.isFinite(x) && x > 0 ? Math.floor(x) : 0);

/** Übernimmt aus `source` nur die Zähler, die `template` kennt (Defaults für den Rest). */
function mergeCounts(template, source) {
  const out = { ...template };
  if (!isObject(source)) return out;
  for (const key of Object.keys(template)) out[key] = toCount(source[key]);
  return out;
}

/** Bringt beliebige (auch kaputte/alte) Daten in die gültige Struktur. */
export function normalizeStats(raw) {
  const base = emptyStats();
  if (!isObject(raw)) return base;
  const games = isObject(raw.games) ? raw.games : {};
  for (const mode of Object.keys(base.games)) base.games[mode] = mergeCounts(base.games[mode], games[mode]);
  base.rounds = mergeCounts(base.rounds, raw.rounds);
  base.moves = mergeCounts(base.moves, raw.moves);
  base.streak = mergeCounts(base.streak, raw.streak);
  base.streak.best = Math.max(base.streak.best, base.streak.current);
  if (typeof raw.since === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.since)) base.since = raw.since;
  return base;
}

// --- Öffentliche API -------------------------------------------------------

export function loadStats() {
  return normalizeStats(readRaw());
}

/** Lädt, ändert und speichert; gibt die neue Statistik zurück. */
function update(mutate) {
  const stats = loadStats();
  mutate(stats);
  write(stats);
  return stats;
}

/** Rundenergebnis aus eigener Sicht + eigener Zug. Ungültige Werte werden ignoriert. */
export function recordRound({ result, move } = {}) {
  return update((s) => {
    if (ROUND_RESULTS.includes(result)) s.rounds[result]++;
    if (MOVES.includes(move)) s.moves[move]++;
  });
}

/** Matchergebnis je Modus; aktualisiert die Siegesserie (über alle Modi). */
export function recordMatch({ mode, result } = {}) {
  const known = MATCH_MODES.includes(mode) || mode === TOURNAMENT_MODE;
  if (!known || !MATCH_RESULTS.includes(result)) return loadStats();
  return update((s) => {
    s.games[mode][result]++;
    if (result === 'w') {
      s.streak.current++;
      s.streak.best = Math.max(s.streak.best, s.streak.current);
    } else {
      s.streak.current = 0;
    }
  });
}

/** Ein abgeschlossenes Turnier (gewonnen oder nicht). */
export function recordTournament({ won } = {}) {
  return update((s) => {
    s.games[TOURNAMENT_MODE].played++;
    if (won === true) s.games[TOURNAMENT_MODE].won++;
  });
}

/** Setzt alles zurück (neues `since`) und gibt die leere Statistik zurück. */
export function resetStats() {
  const fresh = emptyStats();
  write(fresh);
  return fresh;
}

// --- Auswertung --------------------------------------------------------------

/** Normalisierte Shannon-Entropie (0..1) einer Zählung über `k` mögliche Werte. */
export function normalizedEntropy(counts, k = counts.length) {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total <= 0 || k <= 1) return 0;
  let h = 0;
  for (const c of counts) if (c > 0) h -= (c / total) * Math.log2(c / total);
  return Math.min(1, h / Math.log2(k));
}

export function predictabilityText(entropy, movesPlayed) {
  if (movesPlayed < MIN_MOVES_FOR_PREDICTABILITY) return NOT_ENOUGH_DATA;
  return PREDICTABILITY_LEVELS.find(([min]) => entropy >= min)[1];
}

/**
 * Kennzahlen für die Statistik-Seite.
 * entropy: über die gespielten Züge, normalisiert auf die Zahl möglicher Züge
 * (3 klassisch, 5 sobald Echse/Spock gespielt wurden).
 */
export function summary(stats = loadStats()) {
  const s = normalizeStats(stats);
  const matchModes = [...MATCH_MODES, TOURNAMENT_MODE];
  const wins = matchModes.reduce((a, m) => a + s.games[m].w, 0);
  const losses = matchModes.reduce((a, m) => a + s.games[m].l, 0);
  const draws = MATCH_MODES.reduce((a, m) => a + s.games[m].d, 0);
  const totalGames = wins + losses + draws;

  const counts = MOVES.map((m) => s.moves[m]);
  const movesPlayed = counts.reduce((a, b) => a + b, 0);
  const extendedPlayed = MOVES.some((m) => !VARIANTS.classic.includes(m) && s.moves[m] > 0);
  const possible = (extendedPlayed ? VARIANTS.lizard : VARIANTS.classic).length;
  const entropy = normalizedEntropy(counts, possible);
  const top = Math.max(...counts);

  const totalRounds = s.rounds.w + s.rounds.l + s.rounds.d;
  return {
    favoriteMove: top > 0 ? MOVES[counts.indexOf(top)] : null,
    totalGames,
    winRate: totalGames ? wins / totalGames : 0,
    entropy,
    predictability: predictabilityText(entropy, movesPlayed),
    // Erweiterungen
    totalRounds,
    roundWinRate: totalRounds ? s.rounds.w / totalRounds : 0,
    bestStreak: s.streak.best,
    currentStreak: s.streak.current,
  };
}
