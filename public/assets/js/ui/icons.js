// Eigene Linien-Icons (24×24, stroke = currentColor).
import { s } from './dom.js';

const PATHS = Object.freeze({
  back: ['M15 5l-7 7 7 7'],
  soundOn: ['M4 9.5h3.5L12 5.5v13l-4.5-4H4z', 'M15.5 9a4 4 0 0 1 0 6', 'M18 6.5a7.5 7.5 0 0 1 0 11'],
  soundOff: ['M4 9.5h3.5L12 5.5v13l-4.5-4H4z', 'M16 9.5l5 5', 'M21 9.5l-5 5'],
  sparkle: ['M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z', 'M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z'],
  calm: ['M3 12c2-3 4-3 6 0s4 3 6 0 4-3 6 0'],
  gear: ['M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z',
    'M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5A7.6 7.6 0 0 0 7 6.5l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 3l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.6 7.6 0 0 0 2.6-1.5l2.4 1 2-3.4z'],
  lock: ['M6.5 10.5h11v9h-11z', 'M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  warn: ['M12 4l9 16H3z', 'M12 10v4.5', 'M12 17.2v.3'],
  cpu: ['M7 7h10v10H7z', 'M10 10h4v4h-4z', 'M9.5 3v4M14.5 3v4M9.5 17v4M14.5 17v4M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4'],
  duel: ['M5 19L17.5 6.5V4.5h2v2L7 19', 'M19 19L6.5 6.5V4.5h-2v2L17 19', 'M3.5 16.5l4 4', 'M20.5 16.5l-4 4'],
  trophy: ['M7 4h10v4a5 5 0 0 1-10 0z', 'M7 6H4v1.5A3.5 3.5 0 0 0 7.5 11M17 6h3v1.5a3.5 3.5 0 0 1-3.5 3.5', 'M12 13v4', 'M8 20.5h8', 'M9.5 17h5v3.5h-5z'],
  chart: ['M4 20h16', 'M7 20v-6', 'M12 20V8', 'M17 20v-9'],
  brain: ['M9 4.5a3 3 0 0 0-3 3 3 3 0 0 0-2 5.2A3 3 0 0 0 6.5 17 3 3 0 0 0 12 18.5v-13A3 3 0 0 0 9 4.5z',
    'M15 4.5a3 3 0 0 1 3 3 3 3 0 0 1 2 5.2 3 3 0 0 1-2.5 4.3A3 3 0 0 1 12 18.5'],
  replay: ['M4.5 12a7.5 7.5 0 1 0 2.2-5.3', 'M4 4.5v4h4'],
  home: ['M4 11l8-6.5 8 6.5', 'M6.5 9.5V19.5h11V9.5'],
  trash: ['M5 7h14', 'M9.5 7V4.5h5V7', 'M7 7l1 12.5h8L17 7'],
  user: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4.5 20.5a7.5 7.5 0 0 1 15 0'],
  link: ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'],
});

/** Icon als SVG; dekorativ (aria-hidden), Beschriftung macht der Button. */
export function icon(name, { size = 24, className = 'icon' } = {}) {
  const paths = PATHS[name];
  if (!paths) throw new Error(`Unbekanntes Icon: ${name}`);
  return s('svg', {
    class: className, viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': 'true',
    fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    focusable: 'false',
  }, paths.map((d) => s('path', { d })));
}
