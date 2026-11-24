// Eigener QR-Code-Generator (ISO/IEC 18004), selbst geschrieben, ohne Fremdcode.
// Byte-Modus (UTF-8), Versionen 1–10, Fehlerkorrektur L/M/Q/H, alle 8 Masken mit Penalty-Bewertung.
// Vertrag: docs/SCHNITTSTELLEN.md. qrMatrix läuft ohne DOM (auch in Node).

export const MIN_VERSION = 1;
export const MAX_VERSION = 10;

const ECC_LEVELS = Object.freeze({
  // formatBits: 2-Bit-Kennung im Formatwort; Tabellen je Version 1..10 (Index 0 ungenutzt)
  L: { formatBits: 0b01, ecPerBlock: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18], blocks: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4] },
  M: { formatBits: 0b00, ecPerBlock: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26], blocks: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5] },
  Q: { formatBits: 0b11, ecPerBlock: [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24], blocks: [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8] },
  H: { formatBits: 0b10, ecPerBlock: [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28], blocks: [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8] },
});

/** Mittelpunkte der Alignment Patterns je Version. */
const ALIGNMENT_POSITIONS = [
  [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];

const MODE_BYTE = 0b0100;
const MODE_BITS = 4;
const PAD_BYTES = [0xec, 0x11];
const TERMINATOR_BITS = 4;
const FINDER_SIZE = 7;
const TIMING_LINE = 6;
const FORMAT_MASK = 0x5412;
const FORMAT_GENERATOR = 0x537; // BCH(15,5)
const VERSION_GENERATOR = 0x1f25; // BCH(18,6)
const MIN_VERSION_INFO = 7;
const MASK_COUNT = 8;
const PENALTY = Object.freeze({ run: 3, block: 3, finder: 40, balance: 10 });
const RUN_MIN = 5;

// --- Grundgrößen -------------------------------------------------------------

export const sizeOf = (version) => version * 4 + 17;

const charCountBits = (version) => (version <= 9 ? 8 : 16);

/** Anzahl Module für Daten+ECC (ohne Funktionsmuster), in Bit. */
function rawDataModules(version) {
  const size = sizeOf(version);
  const finders = 3 * 8 * 8; // Finder inkl. Separator
  const timing = 2 * (size - 16);
  const format = 31; // 2 × 15 Format-Bits + dunkles Modul
  const align = ALIGNMENT_POSITIONS[version].length;
  const alignCount = align ? align * align - 3 : 0;
  const alignOnTiming = align ? 2 * (align - 2) * 5 : 0; // Überlappung mit Timing-Linien
  const versionInfo = version >= MIN_VERSION_INFO ? 36 : 0;
  return size * size - finders - timing - format - alignCount * 25 + alignOnTiming - versionInfo;
}

const totalCodewords = (version) => Math.floor(rawDataModules(version) / 8);

function dataCodewords(version, ecc) {
  const { ecPerBlock, blocks } = ECC_LEVELS[ecc];
  return totalCodewords(version) - ecPerBlock[version] * blocks[version];
}

// --- Reed-Solomon über GF(256), Polynom x^8+x^4+x^3+x^2+1 --------------------

const GF_POLY = 0x11d;
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= GF_POLY;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

export function gfMul(a, b) {
  return a && b ? EXP[LOG[a] + LOG[b]] : 0;
}

/** Generatorpolynom (Koeffizienten ohne führende 1, höchste Potenz zuerst). */
function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly.slice(1);
}

/** ECC-Codewörter = Rest von data·x^degree geteilt durch das Generatorpolynom. */
export function rsRemainder(data, degree) {
  const gen = rsGenerator(degree);
  const rem = new Array(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem.shift();
    rem.push(0);
    for (let i = 0; i < degree; i++) rem[i] ^= gfMul(gen[i], factor);
  }
  return rem;
}

// --- Daten codieren ----------------------------------------------------------

function utf8(text) {
  return Array.from(new TextEncoder().encode(String(text)));
}

function chooseVersion(byteLength, ecc) {
  for (let v = MIN_VERSION; v <= MAX_VERSION; v++) {
    const needed = MODE_BITS + charCountBits(v) + byteLength * 8;
    if (needed <= dataCodewords(v, ecc) * 8) return v;
  }
  throw new Error('Text ist zu lang für einen QR-Code.');
}

/** Bitstrom → Datencodewörter (inkl. Terminator und Füllbytes). */
function encodeData(bytes, version, ecc) {
  const bits = [];
  const push = (value, length) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(MODE_BYTE, MODE_BITS);
  push(bytes.length, charCountBits(version));
  for (const b of bytes) push(b, 8);

  const capacity = dataCodewords(version, ecc) * 8;
  push(0, Math.min(TERMINATOR_BITS, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);

  const words = [];
  for (let i = 0; i < bits.length; i += 8) words.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let i = 0; words.length < capacity / 8; i++) words.push(PAD_BYTES[i % 2]);
  return words;
}

/** Aufteilen in Blöcke, ECC je Block, dann verschränken. */
function addErrorCorrection(data, version, ecc) {
  const { ecPerBlock, blocks } = ECC_LEVELS[ecc];
  const ecLen = ecPerBlock[version];
  const numBlocks = blocks[version];
  const shortLen = Math.floor(data.length / numBlocks);
  const numLong = data.length % numBlocks; // lange Blöcke kommen zuletzt
  const dataBlocks = [];
  let pos = 0;
  for (let b = 0; b < numBlocks; b++) {
    const len = shortLen + (b >= numBlocks - numLong ? 1 : 0);
    dataBlocks.push(data.slice(pos, pos + len));
    pos += len;
  }
  const ecBlocks = dataBlocks.map((block) => rsRemainder(block, ecLen));

  const out = [];
  for (let i = 0; i <= shortLen; i++) for (const block of dataBlocks) if (i < block.length) out.push(block[i]);
  for (let i = 0; i < ecLen; i++) for (const block of ecBlocks) out.push(block[i]);
  return out;
}

// --- Matrix aufbauen ---------------------------------------------------------

function createGrid(size) {
  return {
    size,
    dark: Array.from({ length: size }, () => new Array(size).fill(false)),
    reserved: Array.from({ length: size }, () => new Array(size).fill(false)),
  };
}

function setFunction(grid, x, y, isDark) {
  if (x < 0 || y < 0 || x >= grid.size || y >= grid.size) return;
  grid.dark[y][x] = isDark;
  grid.reserved[y][x] = true;
}

/** Finder Pattern (7×7) mit Separator; (cx, cy) = Mittelpunkt. */
function drawFinder(grid, cx, cy) {
  const r = (FINDER_SIZE + 1) / 2; // 4 = bis einschließlich Separator
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      setFunction(grid, cx + dx, cy + dy, dist !== 2 && dist !== r);
    }
  }
}

function drawAlignment(grid, cx, cy) {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) setFunction(grid, cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
}

function drawFunctionPatterns(grid, version) {
  const { size } = grid;
  for (let i = 0; i < size; i++) {
    setFunction(grid, TIMING_LINE, i, i % 2 === 0);
    setFunction(grid, i, TIMING_LINE, i % 2 === 0);
  }
  const c = (FINDER_SIZE - 1) / 2;
  drawFinder(grid, c, c);
  drawFinder(grid, size - 1 - c, c);
  drawFinder(grid, c, size - 1 - c);

  const pos = ALIGNMENT_POSITIONS[version];
  const last = pos.length - 1;
  pos.forEach((y, i) =>
    pos.forEach((x, j) => {
      const onFinder = (i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0);
      if (!onFinder) drawAlignment(grid, x, y);
    }),
  );

  drawFormatBits(grid, 0, 0); // reservieren, echte Bits nach Maskenwahl
  drawVersionBits(grid, version);
}

/** BCH-Rest: value·x^(deg) mod generator. */
function bchRemainder(value, generator, degree) {
  let rem = value << degree;
  for (let bit = 31 - Math.clz32(rem); bit >= degree; bit--) {
    if ((rem >>> bit) & 1) rem ^= generator << (bit - degree);
  }
  return rem;
}

export function formatWord(formatBits, mask) {
  const data = (formatBits << 3) | mask;
  return ((data << 10) | bchRemainder(data, FORMAT_GENERATOR, 10)) ^ FORMAT_MASK;
}

export function versionWord(version) {
  return (version << 12) | bchRemainder(version, VERSION_GENERATOR, 12);
}

/** Formatinformation (beide Kopien) + dunkles Modul. Bit i = (word >> i) & 1. */
function drawFormatBits(grid, formatBits, mask) {
  const { size } = grid;
  const word = formatWord(formatBits, mask);
  const bit = (i) => ((word >>> i) & 1) === 1;
  // Kopie 1 um den linken oberen Finder
  for (let i = 0; i <= 5; i++) setFunction(grid, 8, i, bit(i));
  setFunction(grid, 8, 7, bit(6));
  setFunction(grid, 8, 8, bit(7));
  setFunction(grid, 7, 8, bit(8));
  for (let i = 9; i < 15; i++) setFunction(grid, 14 - i, 8, bit(i));
  // Kopie 2 an den anderen Findern
  for (let i = 0; i < 8; i++) setFunction(grid, size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) setFunction(grid, 8, size - 15 + i, bit(i));
  setFunction(grid, 8, size - 8, true);
}

function drawVersionBits(grid, version) {
  if (version < MIN_VERSION_INFO) return;
  const word = versionWord(version);
  for (let i = 0; i < 18; i++) {
    const isDark = ((word >>> i) & 1) === 1;
    const a = grid.size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    setFunction(grid, a, b, isDark);
    setFunction(grid, b, a, isDark);
  }
}

/** Codewörter im Zickzack (von rechts unten, Spaltenpaare) eintragen. */
function placeCodewords(grid, codewords) {
  const { size } = grid;
  const totalBits = codewords.length * 8;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === TIMING_LINE) right = TIMING_LINE - 1;
    const upward = ((right + 1) & 2) === 0;
    for (let step = 0; step < size; step++) {
      const y = upward ? size - 1 - step : step;
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        if (grid.reserved[y][x]) continue;
        if (i < totalBits) grid.dark[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
        i++;
      }
    }
  }
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function applyMask(grid, mask) {
  const fn = MASKS[mask];
  for (let y = 0; y < grid.size; y++) {
    for (let x = 0; x < grid.size; x++) if (!grid.reserved[y][x] && fn(x, y)) grid.dark[y][x] = !grid.dark[y][x];
  }
}

// --- Penalty-Bewertung ---------------------------------------------------------

const FINDER_LIKE = [
  [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0],
  [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1],
];

function linePenalty(line) {
  let score = 0;
  let run = 1;
  for (let i = 1; i <= line.length; i++) {
    if (i < line.length && line[i] === line[i - 1]) {
      run++;
      continue;
    }
    if (run >= RUN_MIN) score += PENALTY.run + (run - RUN_MIN);
    run = 1;
  }
  for (let i = 0; i + FINDER_LIKE[0].length <= line.length; i++) {
    for (const pattern of FINDER_LIKE) {
      if (pattern.every((b, k) => line[i + k] === (b === 1))) score += PENALTY.finder;
    }
  }
  return score;
}

/** Strafpunkte nach Norm (Läufe, 2×2-Blöcke, Finder-ähnliche Muster, Hell/Dunkel-Balance). */
export function penaltyScore(matrix) {
  const height = matrix.length;
  const width = height ? matrix[0].length : 0;
  let score = 0;
  for (const row of matrix) score += linePenalty(row);
  for (let x = 0; x < width; x++) score += linePenalty(matrix.map((row) => row[x]));
  let dark = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (matrix[y][x]) dark++;
      if (y + 1 < height && x + 1 < width) {
        const c = matrix[y][x];
        if (c === matrix[y][x + 1] && c === matrix[y + 1][x] && c === matrix[y + 1][x + 1]) score += PENALTY.block;
      }
    }
  }
  const percent = (dark * 100) / (width * height || 1);
  score += PENALTY.balance * Math.floor(Math.abs(percent - 50) / 5);
  return score;
}

// --- Öffentliche API -----------------------------------------------------------

/**
 * Baut den QR-Code als Matrix [Zeile][Spalte], true = dunkles Modul.
 * Optionen: ecc 'L'|'M'|'Q'|'H' (Standard 'M'), mask 0..7 erzwingen (sonst beste nach Penalty).
 */
export function qrMatrix(text, { ecc = 'M', mask } = {}) {
  if (!Object.hasOwn(ECC_LEVELS, ecc)) throw new Error(`Unbekannte Fehlerkorrektur: ${ecc}`);
  if (mask !== undefined && !(Number.isInteger(mask) && mask >= 0 && mask < MASK_COUNT)) {
    throw new Error(`Ungültige Maske: ${mask}`);
  }
  const bytes = utf8(text);
  const version = chooseVersion(bytes.length, ecc);
  const codewords = addErrorCorrection(encodeData(bytes, version, ecc), version, ecc);

  const base = createGrid(sizeOf(version));
  drawFunctionPatterns(base, version);
  placeCodewords(base, codewords);

  const candidates = mask === undefined ? [...Array(MASK_COUNT).keys()] : [mask];
  let best = null;
  for (const m of candidates) {
    const grid = { size: base.size, dark: base.dark.map((r) => r.slice()), reserved: base.reserved };
    applyMask(grid, m);
    drawFormatBits(grid, ECC_LEVELS[ecc].formatBits, m);
    const score = penaltyScore(grid.dark);
    if (!best || score < best.score) best = { score, matrix: grid.dark };
  }
  return best.matrix;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** SVG-Pfad: dunkle Module zeilenweise zu Rechtecken zusammengefasst. */
export function qrPath(matrix, margin = 0) {
  const parts = [];
  matrix.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (!row[x]) continue;
      let end = x;
      while (end + 1 < row.length && row[end + 1]) end++;
      parts.push(`M${x + margin} ${y + margin}h${end - x + 1}v1h-${end - x + 1}z`);
      x = end;
    }
  });
  return parts.join('');
}

/** QR-Code als SVG (ein <path> für alle dunklen Module, Farbe über currentColor). */
export function qrSvg(text, { ecc = 'M', margin = 4 } = {}) {
  if (typeof document === 'undefined') throw new Error('qrSvg braucht ein DOM (document).');
  const matrix = qrMatrix(text, { ecc });
  const m = Math.max(0, Math.floor(margin));
  const total = matrix.length + 2 * m;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${total} ${total}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'QR-Code');
  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('width', String(total));
  bg.setAttribute('height', String(total));
  bg.setAttribute('fill', '#fff');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', qrPath(matrix, m));
  path.setAttribute('fill', 'currentColor');
  svg.append(bg, path);
  return svg;
}
