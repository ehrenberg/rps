// STUB – wird ersetzt. Vertrag: docs/SCHNITTSTELLEN.md
const empty = () => ({ games: {}, rounds: { w: 0, l: 0, d: 0 }, moves: {}, streak: { current: 0, best: 0 }, since: new Date().toISOString().slice(0, 10) });
export function loadStats() { return empty(); }
export function recordRound() {}
export function recordMatch() {}
export function recordTournament() {}
export function resetStats() {}
export function summary() { return { favoriteMove: null, totalGames: 0, winRate: 0, entropy: 0, predictability: '–' }; }
