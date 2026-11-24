// Hash-Routing (DOM-frei): wandelt location.hash in eine Route und zurück.
// '#/' Start, '#/cpu', '#/play', '#/stats', '#/settings', '#/duel', '#/tournament', '#/games' (Meine Spiele),
// '#k7f3qa' = Online-Raum (6 Zeichen aus dem Raumcode-Alphabet).

export const ROOM_CODE_RE = /^[23456789abcdefghjkmnpqrstuvwxyz]{6}$/;

/** Routenname → Pfad hinter '#'. */
export const ROUTES = Object.freeze({
  home: '/',
  cpu: '/cpu',
  play: '/play',
  stats: '/stats',
  settings: '/settings',
  duel: '/duel',
  tournament: '/tournament',
  games: '/games',
});

const PATH_TO_NAME = new Map(Object.entries(ROUTES).map(([name, path]) => [path, name]));

export function isRoomCode(value) {
  return typeof value === 'string' && ROOM_CODE_RE.test(value);
}

/**
 * '#/cpu' → { name: 'cpu', params: {} }, '#k7f3qa' → { name: 'room', params: { code } }.
 * Unbekannte Pfade → { name: 'notFound', params: { path } }.
 */
export function parseHash(hash) {
  let path = String(hash ?? '').replace(/^#/, '');
  if (path === '') path = ROUTES.home;
  if (isRoomCode(path)) return { name: 'room', params: { code: path } };
  const normalized = path.length > 1 ? path.replace(/\/+$/, '') : path;
  const name = PATH_TO_NAME.get(normalized);
  if (name) return { name, params: {} };
  return { name: 'notFound', params: { path } };
}

/** Umkehrung von parseHash: hrefFor('cpu') → '#/cpu', hrefFor('room', {code}) → '#k7f3qa'. */
export function hrefFor(name, params = {}) {
  if (name === 'room') {
    if (!isRoomCode(params.code)) throw new Error(`Ungültiger Raumcode: ${params.code}`);
    return `#${params.code}`;
  }
  const path = ROUTES[name];
  if (!path) throw new Error(`Unbekannte Route: ${name}`);
  return `#${path}`;
}
