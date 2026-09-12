// ============================================================================
// Générateur de QR code minimal, sans dépendance.
// Mode octet, correction d'erreur niveau M, versions 1 à 10 (jusqu'à 213
// caractères) : largement de quoi encoder l'URL de la page invité.
// Sortie : une image SVG autonome, affichable hors ligne.
// ============================================================================

// ---- Corps de Galois GF(256), polynôme primitif 0x11D ----
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function buildTables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

const mul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];

// Polynôme générateur de Reed-Solomon pour `count` mots de correction
function generatorPoly(count) {
  let poly = [1];
  for (let i = 0; i < count; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= mul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function ecCodewords(data, count) {
  const gen = generatorPoly(count);
  const res = new Array(count).fill(0);
  for (const byte of data) {
    const factor = byte ^ res[0];
    res.shift();
    res.push(0);
    for (let i = 0; i < count; i++) res[i] ^= mul(gen[i + 1], factor);
  }
  return res;
}

// ---- Tables des versions, niveau M ----
// [mots de données, mots de correction par bloc, [nb blocs, mots par bloc], ...]
const VERSIONS = {
  1:  { data: 16,  ec: 10, blocks: [[1, 16]] },
  2:  { data: 28,  ec: 16, blocks: [[1, 28]] },
  3:  { data: 44,  ec: 26, blocks: [[1, 44]] },
  4:  { data: 64,  ec: 18, blocks: [[2, 32]] },
  5:  { data: 86,  ec: 24, blocks: [[2, 43]] },
  6:  { data: 108, ec: 16, blocks: [[4, 27]] },
  7:  { data: 124, ec: 18, blocks: [[4, 31]] },
  8:  { data: 154, ec: 22, blocks: [[2, 38], [2, 39]] },
  9:  { data: 182, ec: 22, blocks: [[3, 36], [2, 37]] },
  10: { data: 216, ec: 26, blocks: [[4, 43], [1, 44]] }
};

const ALIGNMENT = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
};

function chooseVersion(byteLength) {
  for (let v = 1; v <= 10; v++) {
    const countBits = v < 10 ? 8 : 16;
    const capacity = Math.floor((VERSIONS[v].data * 8 - 4 - countBits) / 8);
    if (byteLength <= capacity) return v;
  }
  throw new Error('Texte trop long pour un QR code de version 10');
}

// ---- Flux binaire ----
function encodeData(bytes, version) {
  const bits = [];
  const push = (value, length) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };

  push(0b0100, 4);                              // mode octet
  push(bytes.length, version < 10 ? 8 : 16);    // nombre de caractères
  for (const b of bytes) push(b, 8);

  const total = VERSIONS[version].data * 8;
  push(0, Math.min(4, total - bits.length));    // terminateur
  while (bits.length % 8) bits.push(0);

  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    codewords.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
  }
  const padding = [0xec, 0x11];
  while (codewords.length < VERSIONS[version].data) {
    codewords.push(padding[(codewords.length - bits.length / 8) % 2]);
  }
  return codewords;
}

// Découpage en blocs puis entrelacement, comme l'exige la norme
function interleave(codewords, version) {
  const { ec, blocks } = VERSIONS[version];
  const dataBlocks = [];
  const ecBlocks = [];

  let offset = 0;
  for (const [count, size] of blocks) {
    for (let i = 0; i < count; i++) {
      const block = codewords.slice(offset, offset + size);
      offset += size;
      dataBlocks.push(block);
      ecBlocks.push(ecCodewords(block, ec));
    }
  }

  const result = [];
  const maxData = Math.max(...dataBlocks.map(b => b.length));
  for (let i = 0; i < maxData; i++) {
    for (const block of dataBlocks) if (i < block.length) result.push(block[i]);
  }
  for (let i = 0; i < ec; i++) {
    for (const block of ecBlocks) result.push(block[i]);
  }
  return result;
}

// ---- Construction de la matrice ----
function buildMatrix(version) {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(null));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));

  const set = (r, c, value) => {
    if (r < 0 || c < 0 || r >= size || c >= size) return;
    modules[r][c] = value;
    reserved[r][c] = true;
  };

  // Motifs de détection de position (les trois grands carrés) + séparateurs
  const finder = (row, col) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const inside = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        const dark = inside && (r === 0 || r === 6 || c === 0 || c === 6 ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4));
        set(row + r, col + c, dark ? 1 : 0);
      }
    }
  };
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);

  // Motifs d'alignement
  const centers = ALIGNMENT[version];
  for (const r of centers) {
    for (const c of centers) {
      const corner = (r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8);
      if (corner) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          set(r + dr, c + dc, dark ? 1 : 0);
        }
      }
    }
  }

  // Motifs de synchronisation
  for (let i = 8; i < size - 8; i++) {
    const dark = i % 2 === 0 ? 1 : 0;
    set(6, i, dark);
    set(i, 6, dark);
  }

  // Module toujours noir
  set(size - 8, 8, 1);

  // Emplacements réservés à l'information de format
  for (let i = 0; i < 9; i++) {
    if (modules[8][i] === null) { modules[8][i] = 0; reserved[8][i] = true; }
    if (modules[i][8] === null) { modules[i][8] = 0; reserved[i][8] = true; }
  }
  for (let i = 0; i < 8; i++) {
    if (modules[8][size - 1 - i] === null) { modules[8][size - 1 - i] = 0; reserved[8][size - 1 - i] = true; }
    if (modules[size - 1 - i][8] === null) { modules[size - 1 - i][8] = 0; reserved[size - 1 - i][8] = true; }
  }

  // Information de version (à partir de la version 7)
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const r = Math.floor(i / 3);
      const c = i % 3;
      set(size - 11 + c, r, 0);
      set(r, size - 11 + c, 0);
    }
  }

  return { modules, reserved, size };
}

// Parcours en zigzag depuis le coin bas droit
function placeData(matrix, codewords) {
  const { modules, reserved, size } = matrix;
  const bits = [];
  for (const cw of codewords) for (let i = 7; i >= 0; i--) bits.push((cw >> i) & 1);

  let index = 0;
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;               // la colonne de synchronisation est sautée
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (const c of [col, col - 1]) {
        if (reserved[row][c]) continue;
        modules[row][c] = index < bits.length ? bits[index++] : 0;
      }
    }
    upward = !upward;
  }
}

// ---- Masques ----
const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
];

function formatBits(mask) {
  // Niveau M = 00, puis correction BCH(15,5) et masquage final
  let value = (0b00 << 3) | mask;
  let rest = value << 10;
  for (let i = 14; i >= 10; i--) {
    if ((rest >> i) & 1) rest ^= 0x537 << (i - 10);
  }
  return ((value << 10) | rest) ^ 0x5412;
}

function versionBits(version) {
  let rest = version << 12;
  for (let i = 17; i >= 12; i--) {
    if ((rest >> i) & 1) rest ^= 0x1f25 << (i - 12);
  }
  return (version << 12) | rest;
}

function applyFormatAndVersion(modules, size, version, mask) {
  const format = formatBits(mask);
  // Les 15 bits se posent du plus significatif au moins significatif
  const bit = i => (format >> (14 - i)) & 1;

  for (let i = 0; i <= 5; i++) modules[8][i] = bit(i);
  modules[8][7] = bit(6);
  modules[8][8] = bit(7);
  modules[7][8] = bit(8);
  for (let i = 9; i <= 14; i++) modules[14 - i][8] = bit(i);

  for (let i = 0; i <= 7; i++) modules[size - 1 - i][8] = bit(i);
  for (let i = 8; i <= 14; i++) modules[8][size - 15 + i] = bit(i);

  modules[size - 8][8] = 1;   // module toujours noir, il prime sur le format

  if (version >= 7) {
    const info = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const value = (info >> i) & 1;
      const r = Math.floor(i / 3);
      const c = i % 3;
      modules[size - 11 + c][r] = value;
      modules[r][size - 11 + c] = value;
    }
  }
}

// Pénalités de la norme : on retient le masque le moins pénalisé
function penalty(modules, size) {
  let score = 0;

  const runScore = line => {
    let total = 0, run = 1;
    for (let i = 1; i < size; i++) {
      if (line[i] === line[i - 1]) {
        run++;
      } else {
        if (run >= 5) total += run - 2;
        run = 1;
      }
    }
    if (run >= 5) total += run - 2;
    return total;
  };

  for (let r = 0; r < size; r++) score += runScore(modules[r]);
  for (let c = 0; c < size; c++) score += runScore(modules.map(row => row[c]));

  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = modules[r][c];
      if (v === modules[r][c + 1] && v === modules[r + 1][c] && v === modules[r + 1][c + 1]) score += 3;
    }
  }

  const pattern1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const pattern2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const matches = (line, start, pattern) => pattern.every((v, i) => line[start + i] === v);
  for (let r = 0; r < size; r++) {
    const row = modules[r];
    const col = modules.map(line => line[r]);
    for (let i = 0; i + 11 <= size; i++) {
      if (matches(row, i, pattern1) || matches(row, i, pattern2)) score += 40;
      if (matches(col, i, pattern1) || matches(col, i, pattern2)) score += 40;
    }
  }

  let dark = 0;
  for (const row of modules) for (const v of row) dark += v;
  const ratio = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(ratio - 50) / 5) * 10;

  return score;
}

// ---- API ----
function qrMatrix(text) {
  const bytes = Array.from(Buffer.from(String(text), 'utf8'));
  const version = chooseVersion(bytes.length);
  const codewords = interleave(encodeData(bytes, version), version);

  const base = buildMatrix(version);
  placeData(base, codewords);

  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const modules = base.modules.map(row => row.slice());
    for (let r = 0; r < base.size; r++) {
      for (let c = 0; c < base.size; c++) {
        if (!base.reserved[r][c] && MASKS[mask](r, c)) modules[r][c] ^= 1;
      }
    }
    applyFormatAndVersion(modules, base.size, version, mask);
    const score = penalty(modules, base.size);
    if (!best || score < best.score) best = { score, modules, mask };
  }

  return { modules: best.modules, size: base.size, version, mask: best.mask };
}

// SVG autonome : un seul chemin noir sur fond blanc, marge de 4 modules
function qrSvg(text, pixels) {
  const { modules, size } = qrMatrix(text);
  const quiet = 4;
  const total = size + quiet * 2;

  let path = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules[r][c]) path += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    }
  }

  const side = pixels || 240;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}" `
    + `viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">`
    + `<rect width="${total}" height="${total}" fill="#fff"/>`
    + `<path d="${path}" fill="#000"/></svg>`;
}

module.exports = { qrSvg, qrMatrix };
