import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  qrMatrix, qrSvg, qrPath, sizeOf, formatWord, versionWord, rsRemainder, gfMul, penaltyScore,
  MIN_VERSION, MAX_VERSION,
} from '../../public/assets/js/qr.js';

const URL = 'https://rps.bastianswelt.de/#k7f3qa';
const ECCS = ['L', 'M', 'Q', 'H'];
const versionOf = (m) => (m.length - 17) / 4;

/** Liest die 15 Format-Bits (Kopie 1 bzw. 2) aus der Matrix, Bit i = Wert i. */
function readFormat(m, copy) {
  const size = m.length;
  const cells = [];
  if (copy === 1) {
    for (let i = 0; i <= 5; i++) cells.push([8, i]);
    cells.push([8, 7], [8, 8], [7, 8]);
    for (let i = 9; i < 15; i++) cells.push([14 - i, 8]);
  } else {
    for (let i = 0; i < 8; i++) cells.push([size - 1 - i, 8]);
    for (let i = 8; i < 15; i++) cells.push([8, size - 15 + i]);
  }
  return cells.reduce((w, [x, y], i) => w | ((m[y][x] ? 1 : 0) << i), 0);
}

/** Text, der bei ECC M genau Version v braucht (Byte-Modus). */
const M_CAPACITY = [0, 14, 26, 42, 62, 84, 106, 122, 152, 180, 213];
const textForVersion = (v) => 'q'.repeat(M_CAPACITY[v]);

describe('Galois-Feld und Reed-Solomon', () => {
  test('gfMul: neutrales Element, Null, bekannte Produkte', () => {
    for (let a = 0; a < 256; a++) {
      assert.equal(gfMul(a, 1), a);
      assert.equal(gfMul(a, 0), 0);
    }
    assert.equal(gfMul(2, 0x80), 0x1d); // x·x^7 = x^8 ≡ 0x1d
    assert.equal(gfMul(3, 7), 9);
  });

  test('rsRemainder: bekanntes Beispiel (Version 1-M, „HELLO WORLD“ alphanumerisch)', () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    assert.deepEqual(rsRemainder(data, 10), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  });

  test('rsRemainder: leere Daten → Nullen', () => {
    assert.deepEqual(rsRemainder([], 7), [0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('Format- und Versionsinformation', () => {
  test('formatWord: bekannte Werte aus der Norm', () => {
    assert.equal(formatWord(0b01, 0), 0b111011111000100); // L, Maske 0
    assert.equal(formatWord(0b00, 0), 0b101010000010010); // M, Maske 0
    assert.equal(formatWord(0b11, 0), 0b011010101011111); // Q, Maske 0
    assert.equal(formatWord(0b10, 0), 0b001011010001001); // H, Maske 0
    assert.equal(formatWord(0b00, 5), 0b100000011001110); // M, Maske 5
  });

  test('versionWord: bekannte Werte', () => {
    assert.equal(versionWord(7), 0x07c94);
    assert.equal(versionWord(10), 0x0a4d3);
  });

  test('beide Format-Kopien in der Matrix stimmen überein und codieren die ECC-Stufe', () => {
    const levelBits = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 };
    for (const ecc of ECCS) {
      for (let mask = 0; mask < 8; mask++) {
        const m = qrMatrix(URL, { ecc, mask });
        const word = readFormat(m, 1);
        assert.equal(word, readFormat(m, 2), `${ecc}/${mask}`);
        assert.equal(word, formatWord(levelBits[ecc], mask), `${ecc}/${mask}`);
      }
    }
  });

  test('Versionsinformation ab Version 7 in beiden Blöcken', () => {
    const m = qrMatrix(textForVersion(7), { ecc: 'M' });
    assert.equal(versionOf(m), 7);
    const size = m.length;
    let a = 0;
    let b = 0;
    for (let i = 0; i < 18; i++) {
      const p = size - 11 + (i % 3);
      const q = Math.floor(i / 3);
      a |= (m[q][p] ? 1 : 0) << i;
      b |= (m[p][q] ? 1 : 0) << i;
    }
    assert.equal(a, versionWord(7));
    assert.equal(b, versionWord(7));
  });
});

describe('qrMatrix: Struktur', () => {
  const m = qrMatrix(URL);

  test('quadratisch, boolean, passende Größe', () => {
    assert.equal(m.length, sizeOf(versionOf(m)));
    for (const row of m) {
      assert.equal(row.length, m.length);
      for (const c of row) assert.equal(typeof c, 'boolean');
    }
  });

  test('Finder Patterns in drei Ecken mit hellem Separator', () => {
    const size = m.length;
    for (const [ox, oy] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
      for (let y = 0; y < 7; y++) {
        for (let x = 0; x < 7; x++) {
          const ring = Math.max(Math.abs(x - 3), Math.abs(y - 3));
          assert.equal(m[oy + y][ox + x], ring !== 2, `Finder ${ox},${oy} @${x},${y}`);
        }
      }
    }
    for (let i = 0; i < 8; i++) {
      assert.equal(m[7][i], false);
      assert.equal(m[i][7], false);
      assert.equal(m[7][size - 1 - i], false);
      assert.equal(m[size - 8][i], false);
    }
  });

  test('Timing Patterns abwechselnd, dunkles Modul gesetzt', () => {
    const size = m.length;
    for (let i = 8; i < size - 8; i++) {
      assert.equal(m[6][i], i % 2 === 0);
      assert.equal(m[i][6], i % 2 === 0);
    }
    assert.equal(m[size - 8][8], true);
  });

  test('Alignment Pattern ab Version 2', () => {
    const m3 = qrMatrix(textForVersion(3));
    assert.equal(versionOf(m3), 3);
    const c = 22;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        assert.equal(m3[c + dy][c + dx], Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  });

  test('wählt die kleinste passende Version, höhere ECC braucht mehr Platz', () => {
    assert.equal(versionOf(qrMatrix('A', { ecc: 'L' })), 1);
    for (let v = MIN_VERSION; v <= MAX_VERSION; v++) {
      assert.equal(versionOf(qrMatrix(textForVersion(v))), v, `Version ${v}`);
      if (v < MAX_VERSION) assert.equal(versionOf(qrMatrix(`${textForVersion(v)}q`)), v + 1);
    }
    const sizes = ECCS.map((ecc) => qrMatrix(URL, { ecc }).length);
    assert.deepEqual([...sizes].sort((a, b) => a - b), sizes);
  });

  test('deterministisch; ohne Maske wird die beste nach Penalty gewählt', () => {
    assert.deepEqual(qrMatrix(URL), qrMatrix(URL));
    const auto = penaltyScore(qrMatrix(URL));
    for (let mask = 0; mask < 8; mask++) assert.ok(auto <= penaltyScore(qrMatrix(URL, { mask })));
  });

  test('UTF-8 und leerer Text', () => {
    assert.ok(qrMatrix('Grüße ✂️').length >= 21);
    assert.equal(qrMatrix('').length, 21);
    assert.equal(qrMatrix(12345).length, 21); // wird zu String
  });

  test('Fehler: zu lang, unbekannte ECC, ungültige Maske', () => {
    assert.throws(() => qrMatrix('x'.repeat(300)), /zu lang/);
    assert.throws(() => qrMatrix(URL, { ecc: 'X' }), /Fehlerkorrektur/);
    assert.throws(() => qrMatrix(URL, { ecc: 'toString' }), /Fehlerkorrektur/);
    assert.throws(() => qrMatrix(URL, { mask: 8 }), /Maske/);
    assert.throws(() => qrMatrix(URL, { mask: 1.5 }), /Maske/);
  });
});

describe('penaltyScore', () => {
  test('bekannte Kleinstfälle', () => {
    // 5er-Reihe hell: je Zeile und Spalte 3, 2×2-Blöcke 16 × 3, Balance 0 % → 10 × 10
    const light = Array.from({ length: 5 }, () => new Array(5).fill(false));
    assert.equal(penaltyScore(light), 5 * 3 * 2 + 16 * 3 + 100);
    // Schachbrett: keine Reihen, keine Blöcke, ausgeglichen (13/25 = 52 %)
    const checker = Array.from({ length: 5 }, (_, y) => Array.from({ length: 5 }, (_, x) => (x + y) % 2 === 0));
    assert.equal(penaltyScore(checker), 0);
  });

  test('finder-ähnliches Muster kostet 40 (beide Richtungen, auch senkrecht)', () => {
    // 1 0 1 1 1 0 1 0 0 0 0: keine 5er-Läufe, keine Blöcke, 45 % dunkel → nur Finder-Strafe
    const row = [true, false, true, true, true, false, true, false, false, false, false];
    assert.equal(penaltyScore([row]), 40);
    assert.equal(penaltyScore([[...row].reverse()]), 40);
    // als Spalte (1 breit): Zeilen haben Länge 1 → gleiche Wertung
    assert.equal(penaltyScore(row.map((c) => [c])), 40);
  });
});

describe('qrPath und qrSvg', () => {
  test('qrPath fasst Reihen zusammen und verschiebt um den Rand', () => {
    assert.equal(qrPath([[true, true, false, true]], 0), 'M0 0h2v1h-2zM3 0h1v1h-1z');
    assert.equal(qrPath([[false], [true]], 4), 'M4 5h1v1h-1z');
    assert.equal(qrPath([[false]]), '');
  });

  test('qrSvg ohne DOM wirft verständlich', () => {
    assert.throws(() => qrSvg(URL), /DOM/);
  });

  test('qrSvg mit Mini-DOM: viewBox, Hintergrund, ein Pfad mit currentColor', () => {
    const make = (tag) => ({
      tag, attrs: {}, children: [],
      setAttribute(k, v) { this.attrs[k] = v; },
      append(...c) { this.children.push(...c); },
    });
    globalThis.document = { createElementNS: (ns, tag) => (assert.equal(ns, 'http://www.w3.org/2000/svg'), make(tag)) };
    try {
      const svg = qrSvg(URL, { ecc: 'Q', margin: 2 });
      const size = qrMatrix(URL, { ecc: 'Q' }).length + 4;
      assert.equal(svg.tag, 'svg');
      assert.equal(svg.attrs.viewBox, `0 0 ${size} ${size}`);
      assert.equal(svg.attrs['shape-rendering'], 'crispEdges');
      const [bg, path] = svg.children;
      assert.equal(bg.tag, 'rect');
      assert.equal(bg.attrs.fill, '#fff');
      assert.equal(path.tag, 'path');
      assert.equal(path.attrs.fill, 'currentColor');
      assert.equal(path.attrs.d, qrPath(qrMatrix(URL, { ecc: 'Q' }), 2));
      assert.equal(qrSvg(URL).attrs.viewBox.split(' ')[2], String(qrMatrix(URL).length + 8)); // Standardrand 4
      assert.equal(qrSvg(URL, { margin: -3 }).attrs.viewBox.split(' ')[2], String(qrMatrix(URL).length));
    } finally {
      delete globalThis.document;
    }
  });
});

// --- Echte Dekodierung (nur wenn zbarimg + ImageMagick vorhanden) ------------

function hasTool(cmd, args) {
  try {
    execFileSync(cmd, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const canDecode = hasTool('zbarimg', ['--version']) && hasTool('magick', ['-version']);

function toPbm(m, margin = 4, scale = 4) {
  const n = (m.length + 2 * margin) * scale;
  const rows = [];
  for (let y = 0; y < n; y++) {
    const row = [];
    for (let x = 0; x < n; x++) row.push(m[Math.floor(y / scale) - margin]?.[Math.floor(x / scale) - margin] ? 1 : 0);
    rows.push(row.join(''));
  }
  return `P1\n${n} ${n}\n${rows.join('\n')}\n`;
}

function decode(matrix, dir) {
  const pbm = join(dir, 'qr.pbm');
  const png = join(dir, 'qr.png');
  writeFileSync(pbm, toPbm(matrix));
  execFileSync('magick', [pbm, png]);
  return execFileSync('zbarimg', ['-q', '--raw', '-Sbinary', png]).toString('utf8').replace(/\n$/, '');
}

describe('Dekodierung mit zbarimg', { skip: !canDecode && 'zbarimg/ImageMagick nicht installiert' }, () => {
  test('Einladungslink in allen ECC-Stufen und allen Masken', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rps-qr-'));
    try {
      for (const ecc of ECCS) for (let mask = 0; mask < 8; mask++) assert.equal(decode(qrMatrix(URL, { ecc, mask }), dir), URL);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('alle Versionen 1–10 und UTF-8', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rps-qr-'));
    try {
      for (let v = MIN_VERSION; v <= MAX_VERSION; v++) {
        const text = textForVersion(v);
        assert.equal(decode(qrMatrix(text), dir), text, `Version ${v}`);
      }
      const utf = 'Grüße aus Köln – Schere ✂️, Stein 🪨, Papier 📄';
      for (const ecc of ECCS) assert.equal(decode(qrMatrix(utf, { ecc }), dir), utf);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
