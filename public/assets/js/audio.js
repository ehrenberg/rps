// STUB – wird vom Grafik-Agenten ersetzt. Vertrag: docs/SCHNITTSTELLEN.md
let enabled = localStorage.getItem('rps.sound') !== '0';
export function unlock() {}
export function setEnabled(v) { enabled = Boolean(v); localStorage.setItem('rps.sound', enabled ? '1' : '0'); }
export function isEnabled() { return enabled; }
export function play() {}
