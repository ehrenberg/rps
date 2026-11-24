// Gemeinsame Test-Hilfen (nur Dev, nicht in public/).

/** Deterministischer Zufall (mulberry32) in [0,1). */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Minimaler localStorage-Ersatz. */
export function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
    get length() {
      return map.size;
    },
  };
}

/** Storage, dessen Zugriffe immer werfen (z. B. gesperrter Speicher). */
export const throwingStorage = {
  getItem() {
    throw new Error('gesperrt');
  },
  setItem() {
    throw new Error('gesperrt');
  },
  removeItem() {
    throw new Error('gesperrt');
  },
};
