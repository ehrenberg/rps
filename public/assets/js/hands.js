// STUB – wird vom Grafik-Agenten ersetzt. Vertrag: docs/SCHNITTSTELLEN.md
const EMOJI = { fist: '✊', rock: '✊', paper: '✋', scissors: '✌️', lizard: '🦎', spock: '🖖' };
export function createHand({ side }) {
  const el = document.createElement('div');
  el.className = `hand hand--${side}`;
  el.style.fontSize = '6rem';
  el.textContent = EMOJI.fist;
  return {
    el,
    setMove(move) { el.textContent = EMOJI[move] ?? '?'; },
    shake(beats = 3, beatMs = 500) { return new Promise((r) => setTimeout(r, beats * beatMs)); },
    setState() {},
  };
}
export function handIcon(move) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  t.setAttribute('x', '50'); t.setAttribute('y', '70'); t.setAttribute('font-size', '60'); t.setAttribute('text-anchor', 'middle');
  t.textContent = EMOJI[move] ?? '?';
  svg.append(t);
  return svg;
}
