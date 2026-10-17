/**
 * Advanced Color Snapping & Anti-Aliasing Elimination Engine
 * Solves:
 * 1. Muddy / shifted colors (e.g. green facet turning into cyan or disappearing).
 * 2. Intermediate anti-aliasing bleed pixels (brown, dark red, light lavender) polluting the design palette.
 * 3. Halos / thin fringes around shapes from premature white removal.
 * 4. Micro-paths explosion from edge staircase pixels.
 * 5. Straight lines becoming wavy or jagged (Polygon vs Spline modes).
 */

import svgpath from 'svgpath';
import { bakeTransformsWithSvgPath } from './svgTransformBaker';

export interface RGBColor {
  r: number;
  g: number;
  b: number;
  hex: string;
}

export function componentToHex(c: number): string {
  const hex = Math.max(0, Math.min(255, Math.round(c))).toString(16);
  return hex.length === 1 ? '0' + hex : hex;
}

export function rgbToHex(r: number, g: number, b: number): string {
  return ('#' + componentToHex(r) + componentToHex(g) + componentToHex(b)).toUpperCase();
}

export function hexToRgb(hexStr: string): RGBColor {
  let hex = hexStr.replace('#', '').trim();
  if (hex.length === 3) {
    hex = hex.split('').map((c) => c + c).join('');
  }
  const r = parseInt(hex.substring(0, 2), 16) || 0;
  const g = parseInt(hex.substring(2, 4), 16) || 0;
  const b = parseInt(hex.substring(4, 6), 16) || 0;
  return { r, g, b, hex: '#' + hex.toUpperCase() };
}

/**
 * Converts sRGB (0..255) to CIELAB [L*, a*, b*]
 */
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  let rL = r / 255;
  let gL = g / 255;
  let bL = b / 255;

  rL = rL > 0.04045 ? Math.pow((rL + 0.055) / 1.055, 2.4) : rL / 12.92;
  gL = gL > 0.04045 ? Math.pow((gL + 0.055) / 1.055, 2.4) : gL / 12.92;
  bL = bL > 0.04045 ? Math.pow((bL + 0.055) / 1.055, 2.4) : bL / 12.92;

  const x = (rL * 0.4124 + gL * 0.3576 + bL * 0.1805) / 0.95047;
  const y = (rL * 0.2126 + gL * 0.7152 + bL * 0.0722) / 1.00000;
  const z = (rL * 0.0193 + gL * 0.1192 + bL * 0.9505) / 1.08883;

  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);

  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/**
 * Standard CIELAB ΔE76 color difference
 */
export function deltaE76(
  r1: number,
  g1: number,
  b1: number,
  r2: number,
  g2: number,
  b2: number
): number {
  const lab1 = rgbToLab(r1, g1, b1);
  const lab2 = rgbToLab(r2, g2, b2);
  const dL = lab1[0] - lab2[0];
  const da = lab1[1] - lab2[1];
  const db = lab1[2] - lab2[2];
  return Math.sqrt(dL * dL + da * da + db * db);
}

/**
 * Standard Perceptual "Redmean" Color Distance
 */
export function colorDistanceSq(
  r1: number,
  g1: number,
  b1: number,
  r2: number,
  g2: number,
  b2: number
): number {
  const rmean = (r1 + r2) / 2;
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return (
    ((512 + rmean) * dr * dr) / 256 +
    4 * dg * dg +
    ((767 - rmean) * db * db) / 256
  );
}

/**
 * Generates an edge-mask using spatial gradient (Sobel-like 4-connectivity).
 * Pixels on color boundaries (anti-aliasing transitions) have high gradients and are excluded
 * during palette extraction so they do NOT contaminate the design palette with transition artifacts.
 */
export function buildEdgeGradientMask(imageData: ImageData, threshold = 24): Uint8Array {
  const { width, height, data } = imageData;
  const mask = new Uint8Array(width * height);

  for (let y = 1; y < height - 1; y++) {
    const rowOffset = y * width;
    for (let x = 1; x < width - 1; x++) {
      const idx = rowOffset + x;
      const pIdx = idx * 4;

      // Skip already transparent pixels
      if (data[pIdx + 3] < 30) {
        mask[idx] = 1; // treat transparent borders as edges
        continue;
      }

      const leftIdx = (idx - 1) * 4;
      const rightIdx = (idx + 1) * 4;
      const upIdx = (idx - width) * 4;
      const downIdx = (idx + width) * 4;

      const gx =
        Math.abs(data[rightIdx] - data[leftIdx]) +
        Math.abs(data[rightIdx + 1] - data[leftIdx + 1]) +
        Math.abs(data[rightIdx + 2] - data[leftIdx + 2]);

      const gy =
        Math.abs(data[downIdx] - data[upIdx]) +
        Math.abs(data[downIdx + 1] - data[upIdx + 1]) +
        Math.abs(data[downIdx + 2] - data[upIdx + 2]);

      if (gx + gy > threshold) {
        mask[idx] = 1; // Mark as edge / anti-aliasing pixel
      }
    }
  }

  return mask;
}

/** Selisih warna minimum (ΔE76) agar dua warna palet dianggap berbeda. */
export const PALETTE_MIN_DELTA_E = 6;

export interface ExtractedPalette extends Array<RGBColor> {
  rawColorCount: number;
  mergedColorCount: number;
}

/**
 * Extracts true design palette by:
 * 1. Building a 3D RGB color histogram exclusively from homogeneous/flat areas (ignoring anti-aliasing edge pixels).
 * 2. Identifying true distinct color peaks (including small facets like green, orange, teal, etc.).
 * 3. Incorporating user locked colors.
 * 4. Running constrained K-means to refine cluster centers without drifting into blend colors.
 */
export function extractDominantPalette(
  imageData: ImageData,
  targetK: number,
  lockedColorsHex: string[] = []
): ExtractedPalette {
  const { width, height, data } = imageData;
  const edgeMask = buildEdgeGradientMask(imageData, 24);

  // 1. Build a quantized 3D color histogram (32x32x32 bins, 5 bits per channel)
  const BITS = 5;
  const SHIFT = 8 - BITS; // 3
  const BINS = 1 << BITS; // 32
  const hist = new Int32Array(BINS * BINS * BINS);
  const binSumR = new Float64Array(BINS * BINS * BINS);
  const binSumG = new Float64Array(BINS * BINS * BINS);
  const binSumB = new Float64Array(BINS * BINS * BINS);

  let flatPixelCount = 0;
  let totalNonTransparent = 0;

  // First pass: flat pixels ONLY
  for (let i = 0; i < width * height; i++) {
    const p = i * 4;
    if (data[p + 3] < 30) continue;
    totalNonTransparent++;

    // Only count pixels with low spatial gradient (not in anti-aliasing blend zone)
    if (edgeMask[i] === 1) continue;

    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];

    const ri = r >> SHIFT;
    const gi = g >> SHIFT;
    const bi = b >> SHIFT;
    const binIdx = (ri << (BITS * 2)) | (gi << BITS) | bi;

    hist[binIdx]++;
    binSumR[binIdx] += r;
    binSumG[binIdx] += g;
    binSumB[binIdx] += b;
    flatPixelCount++;
  }

  // Fallback: If image is tiny or highly detailed and flat pixels are scarce, include all pixels with reduced weight
  if (flatPixelCount < 100) {
    for (let i = 0; i < width * height; i++) {
      const p = i * 4;
      if (data[p + 3] < 30) continue;
      const r = data[p];
      const g = data[p + 1];
      const b = data[p + 2];

      const ri = r >> SHIFT;
      const gi = g >> SHIFT;
      const bi = b >> SHIFT;
      const binIdx = (ri << (BITS * 2)) | (gi << BITS) | bi;

      hist[binIdx]++;
      binSumR[binIdx] += r;
      binSumG[binIdx] += g;
      binSumB[binIdx] += b;
      flatPixelCount++;
    }
  }

  // 2. Extract bin candidates sorted by frequency
  interface BinCandidate {
    r: number;
    g: number;
    b: number;
    count: number;
  }
  const candidates: BinCandidate[] = [];

  for (let i = 0; i < hist.length; i++) {
    if (hist[i] > 0) {
      candidates.push({
        r: Math.round(binSumR[i] / hist[i]),
        g: Math.round(binSumG[i] / hist[i]),
        b: Math.round(binSumB[i] / hist[i]),
        count: hist[i],
      });
    }
  }

  candidates.sort((a, b) => b.count - a.count);

  // 3. Initialize cluster centers with User-Locked Colors first
  const centers: Array<[number, number, number]> = [];
  for (const hex of lockedColorsHex) {
    const c = hexToRgb(hex);
    centers.push([c.r, c.g, c.b]);
  }

  // 4. Select candidate peaks representing real distinct colors in the image
  const kLimit = Math.max(2, Math.min(32, targetK));
  // Ambang rendah: warna kecil tapi penting (garis putus-putus, angka kecil) tetap masuk palet.
  const minPixelCount = Math.max(8, Math.floor(flatPixelCount * 0.00012));

  for (const cand of candidates) {
    if (centers.length >= kLimit) break;
    if (cand.count < minPixelCount && centers.length >= 2) break;

    let minDE = Infinity;
    for (const [cr, cg, cb] of centers) {
      const dE = deltaE76(cand.r, cand.g, cand.b, cr, cg, cb);
      if (dE < minDE) minDE = dE;
    }

    // ΔE 6 (bukan 10): nuansa gelap yang mirip (hitam, abu bodi, abu velg) tetap jadi warna terpisah.
    if (minDE >= PALETTE_MIN_DELTA_E) {
      centers.push([cand.r, cand.g, cand.b]);
    }
  }

  // 5. Gather flat pixels for K-Means refinement
  const samplePixels: Array<[number, number, number]> = [];
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 10000)));

  for (let i = 0; i < width * height; i += step) {
    if (edgeMask[i] === 1) continue;
    const p = i * 4;
    if (data[p + 3] < 30) continue;
    samplePixels.push([data[p], data[p + 1], data[p + 2]]);
  }

  if (samplePixels.length < 50) {
    for (let i = 0; i < width * height; i += step * 2) {
      const p = i * 4;
      if (data[p + 3] >= 30) {
        samplePixels.push([data[p], data[p + 1], data[p + 2]]);
      }
    }
  }

  // 6. Run K-Means iterations (8-10 iterations)
  const maxIters = 10;
  const numCenters = centers.length;

  for (let iter = 0; iter < maxIters; iter++) {
    const sums = Array.from({ length: numCenters }, () => [0, 0, 0, 0]);

    for (let i = 0; i < samplePixels.length; i++) {
      const [pr, pg, pb] = samplePixels[i];
      let bestCenterIdx = 0;
      let bestDist = Infinity;

      for (let c = 0; c < numCenters; c++) {
        const d = colorDistanceSq(pr, pg, pb, centers[c][0], centers[c][1], centers[c][2]);
        if (d < bestDist) {
          bestDist = d;
          bestCenterIdx = c;
        }
      }

      sums[bestCenterIdx][0] += pr;
      sums[bestCenterIdx][1] += pg;
      sums[bestCenterIdx][2] += pb;
      sums[bestCenterIdx][3]++;
    }

    let maxShift = 0;
    for (let c = 0; c < numCenters; c++) {
      if (c < lockedColorsHex.length) continue;
      if (sums[c][3] > 0) {
        const newR = Math.round(sums[c][0] / sums[c][3]);
        const newG = Math.round(sums[c][1] / sums[c][3]);
        const newB = Math.round(sums[c][2] / sums[c][3]);
        const shift = Math.abs(centers[c][0] - newR) + Math.abs(centers[c][1] - newG) + Math.abs(centers[c][2] - newB);
        if (shift > maxShift) maxShift = shift;
        centers[c][0] = newR;
        centers[c][1] = newG;
        centers[c][2] = newB;
      }
    }

    if (maxShift < 2) break;
  }

  const rawColors: RGBColor[] = [];
  for (const [r, g, b] of centers) {
    rawColors.push({
      r,
      g,
      b,
      hex: rgbToHex(r, g, b),
    });
  }

  // Merge clusters that have Delta E < PALETTE_MIN_DELTA_E
  let clusters: RGBColor[] = [...rawColors];
  let changed = true;
  let mergePasses = 0;

  while (changed && mergePasses < 10) {
    changed = false;
    mergePasses++;
    const nextClusters: RGBColor[] = [];
    const used = new Uint8Array(clusters.length);

    for (let i = 0; i < clusters.length; i++) {
      if (used[i]) continue;
      const c = clusters[i];
      let bestMergeIdx = -1;
      let minDE = Infinity;

      for (let j = i + 1; j < clusters.length; j++) {
        if (used[j]) continue;
        const other = clusters[j];
        const dE = deltaE76(c.r, c.g, c.b, other.r, other.g, other.b);
        if (dE < PALETTE_MIN_DELTA_E && dE < minDE) {
          minDE = dE;
          bestMergeIdx = j;
        }
      }

      if (bestMergeIdx !== -1) {
        used[bestMergeIdx] = 1;
        changed = true;
        const other = clusters[bestMergeIdx];
        const isCLocked = lockedColorsHex.includes(c.hex);
        const isOtherLocked = lockedColorsHex.includes(other.hex);

        if (isCLocked && !isOtherLocked) {
          nextClusters.push({ ...c });
        } else if (!isCLocked && isOtherLocked) {
          nextClusters.push({ ...other });
        } else {
          const mergedR = Math.round((c.r + other.r) / 2);
          const mergedG = Math.round((c.g + other.g) / 2);
          const mergedB = Math.round((c.b + other.b) / 2);
          nextClusters.push({
            r: mergedR,
            g: mergedG,
            b: mergedB,
            hex: rgbToHex(mergedR, mergedG, mergedB),
          });
        }
      } else {
        nextClusters.push({ ...c });
      }
    }

    clusters = nextClusters;
  }

  const resultPalette = clusters as ExtractedPalette;
  resultPalette.rawColorCount = rawColors.length;
  resultPalette.mergedColorCount = clusters.length;
  return resultPalette;
}

/**
 * Snaps EVERY pixel in the image to its nearest palette color.
 */
export function applyColorSnapping(
  imageData: ImageData,
  palette: RGBColor[]
): { snappedImageData: ImageData; paletteUsed: RGBColor[] } {
  const { data } = imageData;
  const numColors = palette.length;
  if (numColors === 0) {
    return { snappedImageData: imageData, paletteUsed: [] };
  }

  const pr = new Uint8Array(numColors);
  const pg = new Uint8Array(numColors);
  const pb = new Uint8Array(numColors);

  for (let c = 0; c < numColors; c++) {
    pr[c] = palette[c].r;
    pg[c] = palette[c].g;
    pb[c] = palette[c].b;
  }

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 30) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    let bestIdx = 0;
    let bestDist = Infinity;

    for (let c = 0; c < numColors; c++) {
      const dr = r - pr[c];
      const dg = g - pg[c];
      const db = b - pb[c];
      const rmean = (r + pr[c]) >> 1;
      const d = (((512 + rmean) * dr * dr) >> 8) + 4 * dg * dg + (((767 - rmean) * db * db) >> 8);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = c;
        if (d === 0) break;
      }
    }

    data[i] = pr[bestIdx];
    data[i + 1] = pg[bestIdx];
    data[i + 2] = pb[bestIdx];
  }

  return { snappedImageData: imageData, paletteUsed: palette };
}

/**
 * Snapping tepi yang sadar tetangga: piksel anti-aliasing (tepi) hanya boleh memakai warna palet yang
 * benar-benar ada di sekitarnya (piksel datar dalam radius `radius`). Mencegah "halo" warna asing,
 * mis. garis krem di sekeliling teks putih di atas merah, dan menjaga ketebalan huruf/angka kecil.
 * `original` = data RGBA SEBELUM snapping, `edgeMask` = hasil buildEdgeGradientMask pada data asli.
 */
export function snapEdgesToLocalColors(
  imageData: ImageData,
  original: Uint8ClampedArray,
  edgeMask: Uint8Array,
  radius: number
): void {
  const { width, height, data } = imageData;
  const total = width * height;
  // Piksel tepi "yakin": warna aslinya sudah sangat dekat dengan warna palet hasil snapping biasa
  // (mis. inti huruf putih yang tipis). Dipertahankan, dan ikut menjadi acuan tetangga — supaya
  // garis/huruf tipis tidak terkikis.
  const CONFIDENT_DIST_SQ = 2500;
  // …tetapi hanya bila warna itu juga benar-benar ada sebagai warna datar di sekitarnya (sel grid
  // ±radius*4). Tanpa syarat ini, campuran putih-oranye di tepi huruf yang kebetulan mirip warna lain
  // di palet (mis. krem isolasi kardus) ikut "yakin" dan menjadi garis tepi krem.
  const colorIndex = new Map<number, number>();
  for (let idx = 0; idx < total; idx++) {
    const p = idx * 4;
    if (data[p + 3] < 30) continue;
    const packed = (data[p] << 16) | (data[p + 1] << 8) | data[p + 2];
    if (!colorIndex.has(packed) && colorIndex.size < 64) colorIndex.set(packed, colorIndex.size);
  }
  const cell = Math.max(4, radius * 4);
  const gw = Math.ceil(width / cell), gh = Math.ceil(height / cell);
  const presLo = new Uint32Array(gw * gh), presHi = new Uint32Array(gw * gh);
  for (let idx = 0; idx < total; idx++) {
    if (edgeMask[idx]) continue;
    const p = idx * 4;
    if (data[p + 3] < 30) continue;
    const ci = colorIndex.get((data[p] << 16) | (data[p + 1] << 8) | data[p + 2]);
    if (ci === undefined) continue;
    const g = Math.floor((idx / width) / cell) * gw + Math.floor((idx % width) / cell);
    if (ci < 32) presLo[g] |= 1 << ci;
    else presHi[g] |= 1 << (ci - 32);
  }
  const presentNearby = (x: number, y: number, ci: number): boolean => {
    const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
    for (let dy = -1; dy <= 1; dy++) {
      const yy = gy + dy;
      if (yy < 0 || yy >= gh) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = gx + dx;
        if (xx < 0 || xx >= gw) continue;
        const g = yy * gw + xx;
        if (ci < 32 ? presLo[g] & (1 << ci) : presHi[g] & (1 << (ci - 32))) return true;
      }
    }
    return false;
  };
  const reference = new Uint8Array(total);
  for (let idx = 0; idx < total; idx++) {
    const p = idx * 4;
    if (data[p + 3] < 30) continue;
    if (!edgeMask[idx]) {
      reference[idx] = 1;
      continue;
    }
    const d = colorDistanceSq(original[p], original[p + 1], original[p + 2], data[p], data[p + 1], data[p + 2]);
    if (d >= CONFIDENT_DIST_SQ) continue;
    const ci = colorIndex.get((data[p] << 16) | (data[p + 1] << 8) | data[p + 2]);
    if (ci !== undefined && presentNearby(idx % width, (idx / width) | 0, ci)) reference[idx] = 1;
  }

  // Keputusan tiap piksel tepi: anggap warnanya campuran DUA warna acuan di sekitarnya (atau satu
  // warna + latar transparan). Bila campuran itu menjelaskan warnanya, pilih ujung yang porsinya
  // ≥ 50% → batas jatuh tepat di tengah anti-aliasing (tepi huruf halus, tanpa bingkai warna lain).
  // Bila tidak bisa dijelaskan (mis. garis/teks tipis yang tak punya piksel inti datar), warna hasil
  // snapping global dipertahankan supaya detail tipis tidak hilang.
  const MIX_RESIDUAL = 30; // RGB euclid
  const RIM_MERGE = 70;
  const out = new Uint8ClampedArray(data);
  const cr: number[] = [], cg: number[] = [], cb: number[] = [], ct: number[] = []; // ct: 1 = transparan
  // Kumpulkan warna acuan (opak, unik) dalam kotak ±r di sekitar (x, y).
  const collectRefs = (x: number, y: number, r: number, max: number) => {
    for (let dy = -r; dy <= r; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= height) continue;
      for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= width) continue;
        const q = yy * width + xx;
        const j = q * 4;
        if (data[j + 3] < 30 || !reference[q]) continue;
        let dup = false;
        for (let k = 0; k < cr.length; k++) {
          if (ct[k] === 0 && cr[k] === data[j] && cg[k] === data[j + 1] && cb[k] === data[j + 2]) { dup = true; break; }
        }
        if (!dup && cr.length < max) { cr.push(data[j]); cg.push(data[j + 1]); cb.push(data[j + 2]); ct.push(0); }
      }
    }
  };
  // residu & pilihan terbaik dari semua pasangan (dan warna tunggal)
  let bestRes = Infinity, bestK = -1, nearOpaque = Infinity, nearOpaqueK = -1;
  const fit = (or: number, og: number, ob: number) => {
    bestRes = Infinity; bestK = -1; nearOpaque = Infinity; nearOpaqueK = -1;
    const n = cr.length;
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(or - cr[i], og - cg[i], ob - cb[i]);
      if (d < bestRes) { bestRes = d; bestK = i; }
      if (ct[i] === 0 && d < nearOpaque) { nearOpaque = d; nearOpaqueK = i; }
      for (let j = i + 1; j < n; j++) {
        const ux = cr[j] - cr[i], uy = cg[j] - cg[i], uz = cb[j] - cb[i];
        const L2 = ux * ux + uy * uy + uz * uz;
        if (L2 < 1) continue;
        const t = ((or - cr[i]) * ux + (og - cg[i]) * uy + (ob - cb[i]) * uz) / L2;
        if (t < 0 || t > 1) continue; // di luar segmen → sudah tercakup warna tunggal
        const res = Math.hypot(or - (cr[i] + t * ux), og - (cg[i] + t * uy), ob - (cb[i] + t * uz));
        if (res < bestRes) { bestRes = res; bestK = t < 0.5 ? i : j; }
      }
    }
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (reference[idx] || !edgeMask[idx]) continue;
      const p = idx * 4;
      if (data[p + 3] < 30) continue;
      const or = original[p], og = original[p + 1], ob = original[p + 2];
      cr.length = cg.length = cb.length = ct.length = 0;
      let tr = 0, tg = 0, tb = 0, tn = 0;
      for (let dy = -2; dy <= 2; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const j = (yy * width + xx) * 4;
          if (data[j + 3] < 30) { tr += original[j]; tg += original[j + 1]; tb += original[j + 2]; tn++; }
        }
      }
      collectRefs(x, y, radius, 12);
      if (tn > 0) { cr.push(tr / tn); cg.push(tg / tn); cb.push(tb / tn); ct.push(1); }
      if (cr.length === 0) continue;
      fit(or, og, ob);
      if (bestRes > MIX_RESIDUAL && nearOpaque > RIM_MERGE) {
        // Goresan teks sangat tipis (mis. huruf "I" 1 px pada teks kecil) tidak punya piksel inti
        // yang "yakin" di dekatnya → cari warna acuan lebih jauh (huruf tetangga) dan coba lagi.
        // Warna jauh hanya dipakai bila lebih dekat ke warna asli piksel daripada semua warna acuan
        // dekat (goresan terang di atas latar gelap → warna huruf tetangga), bukan sekadar ujung
        // campuran (mis. latar hitam di luar chip untuk garis kontak chip yang sedikit lebih gelap).
        const nearDist = nearOpaque;
        collectRefs(x, y, radius * 3, 16);
        fit(or, og, ob);
        if (bestK < 0 || bestRes > MIX_RESIDUAL || ct[bestK] === 1 ||
            Math.hypot(or - cr[bestK], og - cg[bestK], ob - cb[bestK]) >= nearDist) continue;
      }
      if (bestRes > MIX_RESIDUAL) {
        // Garis tepi tipis yang sedikit lebih gelap/terang dari objek di sebelahnya (efek penajaman
        // gambar sumber) → lebur ke warna objek itu. Warna yang jauh berbeda dari semua tetangga
        // (teks/garis tipis) → pertahankan snapping global.
        if (nearOpaque > RIM_MERGE) continue;
        bestK = nearOpaqueK;
      }
      if (ct[bestK] === 1) {
        out[p + 3] = 0;
      } else {
        out[p] = cr[bestK];
        out[p + 1] = cg[bestK];
        out[p + 2] = cb[bestK];
      }
    }
  }
  data.set(out);
}

/**
 * Perluas area transparan (lubang gradien / background yang dihapus) ke piksel opak di tepinya yang
 * warna ASLINYA hampir sama dengan warna asli area transparan di sebelahnya. Membersihkan serpihan
 * warna datar yang tertinggal di pinggir huruf bergradasi. Maks. `steps` piksel — tetap di dalam
 * fillMask gradien (dilatasi 2 px) sehingga tidak membuat lubang.
 */
export function growTransparentSimilar(
  imageData: ImageData,
  original: Uint8ClampedArray,
  steps = 2,
  maxDist = 30
): void {
  const { width, height, data } = imageData;
  for (let it = 0; it < steps; it++) {
    const clear: number[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = (y * width + x) * 4;
        if (data[p + 3] < 30) continue;
        let sr = 0, sg = 0, sb = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= width || (dx === 0 && dy === 0)) continue;
            const j = (yy * width + xx) * 4;
            if (data[j + 3] >= 30) continue;
            sr += original[j]; sg += original[j + 1]; sb += original[j + 2]; n++;
          }
        }
        if (n < 2) continue;
        const mr = sr / n, mg = sg / n, mb = sb / n;
        const d = Math.hypot(original[p] - mr, original[p + 1] - mg, original[p + 2] - mb);
        // Halo gelap hasil penajaman JPEG di tepi objek: sedikit LEBIH GELAP dari latar transparan
        // GELAP (gradien latar) di sebelahnya → ikut transparan agar tidak menjadi garis/bercak gelap.
        // Di sebelah gradien terang (pad chip emas) garis gelap adalah detail → dipertahankan.
        const darker = mr + mg + mb < 300 && original[p] + original[p + 1] + original[p + 2] < mr + mg + mb;
        if (d <= maxDist || (darker && d <= maxDist * 1.6)) clear.push(p);
      }
    }
    if (clear.length === 0) break;
    for (const p of clear) data[p + 3] = 0;
  }
}

/**
 * Lebur bentuk yang sangat TIPIS (tebal ≤ 2·thinPx piksel) ke tetangga yang berbagi batas terpanjang,
 * bila warnanya mirip (RGB ≤ maxDist). Menghapus garis tepi/bayangan tipis hasil penajaman gambar
 * sumber (cincin merah tua di huruf, putus-putus hitam di tepi bentuk), tanpa menyentuh teks/garis
 * tipis yang kontras dengan latarnya.
 */
export function mergeThinRims(imageData: ImageData, thinPx: number, maxDist = 70): void {
  const { width: w, height: h, data } = imageData;
  const total = w * h;
  const key = new Int32Array(total);
  for (let i = 0; i < total; i++) {
    const j = i * 4;
    key[i] = data[j + 3] < 30 ? -1 : (data[j] << 16) | (data[j + 1] << 8) | data[j + 2];
  }
  // jarak chamfer (3/4) ke batas warna lain
  const INF = 1 << 29;
  const dist = new Int32Array(total);
  for (let i = 0; i < total; i++) {
    const x = i % w, y = (i / w) | 0, k = key[i];
    const border =
      (x > 0 && key[i - 1] !== k) || (x + 1 < w && key[i + 1] !== k) ||
      (y > 0 && key[i - w] !== k) || (y + 1 < h && key[i + w] !== k);
    dist[i] = border ? 3 : INF;
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, k = key[i];
      let d = dist[i];
      if (x > 0 && key[i - 1] === k) d = Math.min(d, dist[i - 1] + 3);
      if (y > 0) {
        if (key[i - w] === k) d = Math.min(d, dist[i - w] + 3);
        if (x > 0 && key[i - w - 1] === k) d = Math.min(d, dist[i - w - 1] + 4);
        if (x + 1 < w && key[i - w + 1] === k) d = Math.min(d, dist[i - w + 1] + 4);
      }
      dist[i] = d;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x, k = key[i];
      let d = dist[i];
      if (x + 1 < w && key[i + 1] === k) d = Math.min(d, dist[i + 1] + 3);
      if (y + 1 < h) {
        if (key[i + w] === k) d = Math.min(d, dist[i + w] + 3);
        if (x + 1 < w && key[i + w + 1] === k) d = Math.min(d, dist[i + w + 1] + 4);
        if (x > 0 && key[i + w - 1] === k) d = Math.min(d, dist[i + w - 1] + 4);
      }
      dist[i] = d;
    }
  }
  const thinLimit = Math.round(thinPx * 3);
  // 1) komponen per warna + ketebalan maksimumnya
  const comp = new Int32Array(total).fill(-1);
  const stack = new Int32Array(total);
  const compMax: number[] = [];
  for (let s0 = 0; s0 < total; s0++) {
    if (comp[s0] !== -1) continue;
    const k = key[s0];
    const id = compMax.length;
    let sp = 0, maxD = 0;
    stack[sp++] = s0;
    comp[s0] = id;
    while (sp > 0) {
      const i = stack[--sp];
      if (dist[i] > maxD) maxD = dist[i];
      const x = i % w, y = (i / w) | 0;
      if (x > 0 && comp[i - 1] === -1 && key[i - 1] === k) { comp[i - 1] = id; stack[sp++] = i - 1; }
      if (x + 1 < w && comp[i + 1] === -1 && key[i + 1] === k) { comp[i + 1] = id; stack[sp++] = i + 1; }
      if (y > 0 && comp[i - w] === -1 && key[i - w] === k) { comp[i - w] = id; stack[sp++] = i - w; }
      if (y + 1 < h && comp[i + w] === -1 && key[i + w] === k) { comp[i + w] = id; stack[sp++] = i + w; }
    }
    compMax.push(maxD);
  }
  // 2) jarak ke "inti" (piksel yang cukup tebal) di dalam warna yang sama: piksel yang jauh dari inti
  //    adalah bagian TIPIS (garis tepi / tonjolan tipis), walaupun tersambung ke bentuk tebal.
  const cd = new Int32Array(total);
  for (let i = 0; i < total; i++) cd[i] = dist[i] > thinLimit ? 0 : INF;
  const relax = (i: number, j: number, c: number) => {
    if (key[j] === key[i] && cd[j] + c < cd[i]) cd[i] = cd[j] + c;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (x > 0) relax(i, i - 1, 3);
    if (y > 0) { relax(i, i - w, 3); if (x > 0) relax(i, i - w - 1, 4); if (x + 1 < w) relax(i, i - w + 1, 4); }
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x;
    if (x + 1 < w) relax(i, i + 1, 3);
    if (y + 1 < h) { relax(i, i + w, 3); if (x + 1 < w) relax(i, i + w + 1, 4); if (x > 0) relax(i, i + w - 1, 4); }
  }
  const isThin = (i: number) => key[i] !== -1 && cd[i] > thinLimit + 3;
  // 3) sub-komponen tipis → lebur bila terjepit dan ada tetangga TEBAL yang warnanya mirip
  const seen = new Uint8Array(total);
  const recolor: Array<[Int32Array, number]> = [];
  for (let s0 = 0; s0 < total; s0++) {
    if (seen[s0] || !isThin(s0)) continue;
    const k = key[s0];
    let sp = 0;
    const members: number[] = [];
    const nb = new Map<number, number>(); // key → batas
    const nbThick = new Map<number, number>(); // key → batas dengan bentuk tebal
    stack[sp++] = s0;
    seen[s0] = 1;
    while (sp > 0) {
      const i = stack[--sp];
      members.push(i);
      const x = i % w, y = (i / w) | 0;
      const ns = [x > 0 ? i - 1 : -1, x + 1 < w ? i + 1 : -1, y > 0 ? i - w : -1, y + 1 < h ? i + w : -1];
      for (const q of ns) {
        if (q < 0) continue;
        if (key[q] === k) {
          if (!seen[q] && isThin(q)) { seen[q] = 1; stack[sp++] = q; }
          continue;
        }
        nb.set(key[q], (nb.get(key[q]) || 0) + 1);
        if (key[q] !== -1 && compMax[comp[q]] > thinLimit) nbThick.set(key[q], (nbThick.get(key[q]) || 0) + 1);
      }
    }
    let totalB = 0;
    for (const c of nb.values()) totalB += c;
    if (nb.size < 2 || totalB === 0) continue;
    let bestK = -1, bestN = 0;
    for (const [nk, cnt] of nbThick) {
      const d = Math.hypot(((k >> 16) & 255) - ((nk >> 16) & 255), ((k >> 8) & 255) - ((nk >> 8) & 255), (k & 255) - (nk & 255));
      if (d <= maxDist && cnt > bestN) { bestN = cnt; bestK = nk; }
    }
    if (bestK === -1 || bestN < totalB * 0.15 || bestN > totalB * 0.9) continue;
    // Halo sejati berada di ANTARA objek dan latar yang berbeda jauh. Garis tipis di antara dua
    // bidang sewarna (mis. garis kontak chip emas di antara pad emas) bukan halo → dipertahankan.
    let otherSide = 0;
    for (const [nk, cnt] of nb) {
      if (nk === bestK) continue;
      const far = nk === -1 ||
        Math.hypot(((bestK >> 16) & 255) - ((nk >> 16) & 255), ((bestK >> 8) & 255) - ((nk >> 8) & 255), (bestK & 255) - (nk & 255)) > maxDist;
      if (far) otherSide += cnt;
    }
    if (otherSide < totalB * 0.1) continue;
    recolor.push([Int32Array.from(members), bestK]);
  }
  for (const [members, nk] of recolor) {
    for (const i of members) {
      const j = i * 4;
      data[j] = (nk >> 16) & 255;
      data[j + 1] = (nk >> 8) & 255;
      data[j + 2] = nk & 255;
    }
  }
}

/**
 * Filter mayoritas (mode 3×3) pada peta warna hasil snapping: piksel diganti warna yang menguasai
 * ≥ 5 dari 9 piksel di sekitarnya. Menghaluskan tangga/gerigi 1 piksel di tepi huruf & bentuk (dan
 * membuang bintik), tanpa mengikis garis selebar ≥ 2 piksel. Transparan dihitung sebagai "warna".
 */
export function majorityFilter(imageData: ImageData, passes = 2): void {
  const { width, height, data } = imageData;
  const keyAt = (j: number) =>
    data[j + 3] < 30 ? -1 : (data[j] << 16) | (data[j + 1] << 8) | data[j + 2];
  const keys = new Int32Array(9);
  const counts = new Int32Array(9);
  const LINE_CONTRAST_SQ = 80 * 80;
  for (let pass = 0; pass < passes; pass++) {
    const out = new Uint8ClampedArray(data);
    let changed = 0;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const p = (y * width + x) * 4;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const k = keyAt(p + (dy * width + dx) * 4);
            let f = -1;
            for (let i = 0; i < n; i++) if (keys[i] === k) { f = i; break; }
            if (f >= 0) counts[f]++;
            else { keys[n] = k; counts[n] = 1; n++; }
          }
        }
        let bi = 0;
        for (let i = 1; i < n; i++) if (counts[i] > counts[bi]) bi = i;
        if (counts[bi] < 5) continue;
        const own = keyAt(p);
        if (keys[bi] === own) continue;
        const k = keys[bi];
        // Goresan 1 px (huruf "I"/garis tipis pada teks kecil) yang kontras dengan sekelilingnya
        // dipertahankan: tetangga berseberangan (U–S, B–T, atau diagonal) berwarna sama = bagian garis,
        // bukan tonjolan/bintik. Garis tepi gelap tipis (kontras rendah) tetap dibersihkan.
        if (own !== -1 && k !== -1) {
          const dr = ((own >> 16) & 255) - ((k >> 16) & 255);
          const dg = ((own >> 8) & 255) - ((k >> 8) & 255);
          const db = (own & 255) - (k & 255);
          if (dr * dr + dg * dg + db * db > LINE_CONTRAST_SQ) {
            const W4 = width * 4;
            if (
              (keyAt(p - W4) === own && keyAt(p + W4) === own) ||
              (keyAt(p - 4) === own && keyAt(p + 4) === own) ||
              (keyAt(p - W4 - 4) === own && keyAt(p + W4 + 4) === own) ||
              (keyAt(p - W4 + 4) === own && keyAt(p + W4 - 4) === own)
            ) continue;
          }
        }
        changed++;
        if (k === -1) { out[p + 3] = 0; continue; }
        // sumber warna: ambil dari tetangga yang ber-key sama (agar alpha ikut benar)
        out[p] = (k >> 16) & 255;
        out[p + 1] = (k >> 8) & 255;
        out[p + 2] = k & 255;
        out[p + 3] = 255;
      }
    }
    data.set(out);
    if (changed === 0) break;
  }
}

/**
 * Post-Processing for SVG output:
 * Retains 1:1 original VTracer stacked order, bakes translate transforms via svgpath,
 * without compound merging or vertex snapping.
 */
export function optimizeAndMergeSvg(svgString: string): string {
  if (!svgString || !svgString.includes('<svg')) return svgString;
  return bakeTransformsWithSvgPath(svgString);
}

/**
 * Satukan warna huruf kecil dalam satu kata. Teks kecil berwarna pucat (mis. emas pucat ber-JPEG)
 * sering berada di antara dua warna palet (emas ↔ perak) sehingga sebagian huruf ter-snap ke perak.
 * Komponen kecil yang kontras dengan sekelilingnya dikelompokkan bila berdekatan (jarak antarhuruf)
 * dan warnanya cukup mirip; dalam tiap kelompok, warna minoritas yang NETRAL (abu/perak, kroma
 * rendah) diganti warna mayoritas kelompok. Warna jenuh yang berbeda (merah ↔ oranye) tidak disentuh.
 */
export function unifyGlyphColors(imageData: ImageData, scale: number, original?: Uint8ClampedArray): void {
  const { width: w, height: h, data } = imageData;
  const total = w * h;
  const key = new Int32Array(total);
  for (let i = 0; i < total; i++) {
    const j = i * 4;
    key[i] = data[j + 3] < 30 ? -1 : (data[j] << 16) | (data[j + 1] << 8) | data[j + 2];
  }
  const rgbDistSq = (a: number, b: number) => {
    const dr = ((a >> 16) & 255) - ((b >> 16) & 255);
    const dg = ((a >> 8) & 255) - ((b >> 8) & 255);
    const db = (a & 255) - (b & 255);
    return dr * dr + dg * dg + db * db;
  };
  const maxArea = Math.round((14 * scale) ** 2); // huruf teks kecil (± 10–14 px sumber), termasuk huruf lebar D/O
  const CONTRAST_SQ = 80 * 80;
  const SIMILAR_SQ = 130 * 130;

  // komponen terhubung (4-arah) per warna; berhenti menghitung bila melebihi maxArea
  const comp = new Int32Array(total).fill(-1);
  const stack = new Int32Array(total);
  const compKey: number[] = [], compArea: number[] = [], compCand: boolean[] = [];
  const borderCount = new Map<number, number>();
  for (let s0 = 0; s0 < total; s0++) {
    if (comp[s0] !== -1 || key[s0] === -1) continue;
    const id = compKey.length;
    const k = key[s0];
    let sp = 0, area = 0;
    stack[sp++] = s0;
    comp[s0] = id;
    borderCount.clear();
    let borderTotal = 0;
    let cx0 = w, cy0 = h, cx1 = -1, cy1 = -1;
    while (sp > 0) {
      const i = stack[--sp];
      area++;
      const x = i % w;
      const yy0 = (i / w) | 0;
      if (x < cx0) cx0 = x;
      if (x > cx1) cx1 = x;
      if (yy0 < cy0) cy0 = yy0;
      if (yy0 > cy1) cy1 = yy0;
      const nbs = [x > 0 ? i - 1 : -1, x + 1 < w ? i + 1 : -1, i >= w ? i - w : -1, i + w < total ? i + w : -1];
      for (const q of nbs) {
        if (q < 0) continue;
        if (key[q] === k) {
          if (comp[q] === -1) { comp[q] = id; stack[sp++] = q; }
        } else {
          borderTotal++;
          borderCount.set(key[q], (borderCount.get(key[q]) ?? 0) + 1);
        }
      }
    }
    // kandidat huruf: kecil dan sebagian besar tepinya berbatasan dengan warna yang kontras
    // (latar + garis halo gelap JPEG dihitung bersama)
    let contrastN = 0;
    for (const [bk, n] of borderCount) if (bk === -1 || rgbDistSq(k, bk) > CONTRAST_SQ) contrastN += n;
    const cand = area <= maxArea && borderTotal > 0 && contrastN >= borderTotal * 0.6 &&
      cx1 - cx0 <= 20 * scale && cy1 - cy0 <= 20 * scale;
    compKey.push(k); compArea.push(area); compCand.push(cand);
  }
  const nComp = compKey.length;
  // Huruf kecil ber-JPEG sering berupa mosaik beberapa warna palet yang mirip (perak, abu kekuningan,
  // emas pucat) — tiap kepingnya bertetangga dengan keping mirip sehingga tidak lolos uji kontras.
  // Gabungkan keping bertetangga yang warnanya mirip menjadi satu "bentuk huruf" lalu uji bentuknya.
  {
    const BLOB_SQ = 70 * 70;
    const bp = new Int32Array(nComp);
    for (let i = 0; i < nComp; i++) bp[i] = i;
    const bfind = (a: number): number => {
      while (bp[a] !== a) { bp[a] = bp[bp[a]]; a = bp[a]; }
      return a;
    };
    for (let i = 0; i < total; i++) {
      const a = comp[i];
      if (a < 0) continue;
      const x = i % w;
      for (const q of [x + 1 < w ? i + 1 : -1, i + w < total ? i + w : -1]) {
        if (q < 0) continue;
        const b = comp[q];
        if (b < 0 || b === a || rgbDistSq(compKey[a], compKey[b]) > BLOB_SQ) continue;
        const ra = bfind(a), rb = bfind(b);
        if (ra !== rb) bp[ra] = rb;
      }
    }
    const bArea = new Int32Array(nComp), bBorder = new Int32Array(nComp), bContrast = new Int32Array(nComp);
    for (let c = 0; c < nComp; c++) bArea[bfind(c)] += compArea[c];
    // kotak batas bentuk: huruf itu ringkas, bukan garis panjang (tepi kotak, garis jalan)
    const bx0 = new Int32Array(nComp).fill(w), by0 = new Int32Array(nComp).fill(h);
    const bx1 = new Int32Array(nComp).fill(-1), by1 = new Int32Array(nComp).fill(-1);
    for (let i = 0; i < total; i++) {
      const a = comp[i];
      if (a < 0) continue;
      const r = bfind(a);
      if (bArea[r] > maxArea) continue;
      const x = i % w, y = (i / w) | 0;
      if (x < bx0[r]) bx0[r] = x;
      if (x > bx1[r]) bx1[r] = x;
      if (y < by0[r]) by0[r] = y;
      if (y > by1[r]) by1[r] = y;
    }
    const maxSide = 20 * scale;
    for (let i = 0; i < total; i++) {
      const a = comp[i];
      if (a < 0) continue;
      const ra = bfind(a);
      if (bArea[ra] > maxArea) continue;
      const x = i % w;
      for (const q of [x > 0 ? i - 1 : -1, x + 1 < w ? i + 1 : -1, i >= w ? i - w : -1, i + w < total ? i + w : -1]) {
        if (q < 0) continue;
        const b = comp[q];
        if (b >= 0 && bfind(b) === ra) continue;
        bBorder[ra]++;
        if (key[q] === -1 || rgbDistSq(key[i], key[q]) > CONTRAST_SQ) bContrast[ra]++;
      }
    }
    for (let c = 0; c < nComp; c++) {
      if (compCand[c]) continue;
      const r = bfind(c);
      if (bArea[r] <= maxArea && bBorder[r] > 0 && bContrast[r] >= bBorder[r] * 0.6 &&
          bx1[r] - bx0[r] <= maxSide && by1[r] - by0[r] <= maxSide) compCand[c] = true;
    }
  }
  const parent = new Int32Array(nComp);
  for (let i = 0; i < nComp; i++) parent[i] = i;
  const find = (a: number): number => {
    while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; }
    return a;
  };
  // kelompokkan komponen kandidat yang berdekatan (≈ jarak antarhuruf) dan warnanya mirip
  const gap = Math.max(4, Math.round(4 * scale));
  for (let i = 0; i < total; i++) {
    const a = comp[i];
    if (a < 0 || !compCand[a]) continue;
    const x = i % w, y = (i / w) | 0;
    // cukup piksel tepi komponen
    if (x > 0 && x + 1 < w && y > 0 && y + 1 < h &&
        comp[i - 1] === a && comp[i + 1] === a && comp[i - w] === a && comp[i + w] === a) continue;
    for (let dy = -gap; dy <= gap; dy += 2) {
      const yy = y + dy;
      if (yy < 0 || yy >= h) continue;
      for (let dx = -gap; dx <= gap; dx += 2) {
        const xx = x + dx;
        if (xx < 0 || xx >= w) continue;
        const b = comp[yy * w + xx];
        if (b < 0 || b === a || !compCand[b]) continue;
        const ra = find(a), rb = find(b);
        if (ra === rb) continue;
        if (rgbDistSq(compKey[a], compKey[b]) > SIMILAR_SQ) continue;
        parent[ra] = rb;
      }
    }
  }
  // Warna kata ditentukan dari RONA warna ASLI hurufnya (bukan luas): teks abu/perak netral → warna
  // palet netral, teks emas pucat (rona hangat) → emas. Kata yang hurufnya memang berbeda rona
  // (merah ↔ oranye) dilewati.
  const src = original ?? data;
  const sumR = new Float64Array(nComp), sumG = new Float64Array(nComp), sumB = new Float64Array(nComp);
  for (let i = 0; i < total; i++) {
    const c = comp[i];
    if (c < 0 || !compCand[c]) continue;
    const j = i * 4;
    sumR[c] += src[j]; sumG[c] += src[j + 1]; sumB[c] += src[j + 2];
  }
  // warna INTI huruf: piksel yang lebih terang/sama dengan rata-rata komponennya (tepi gelap anti-aliasing
  // dan halo JPEG tidak ikut menentukan warna kata)
  const coreR = new Float64Array(nComp), coreG = new Float64Array(nComp), coreB = new Float64Array(nComp);
  const coreN = new Float64Array(nComp);
  for (let i = 0; i < total; i++) {
    const c = comp[i];
    if (c < 0 || !compCand[c]) continue;
    const j = i * 4;
    const meanL = (sumR[c] + sumG[c] + sumB[c]) / compArea[c];
    if (src[j] + src[j + 1] + src[j + 2] < meanL) continue;
    coreR[c] += src[j]; coreG[c] += src[j + 1]; coreB[c] += src[j + 2]; coreN[c]++;
  }
  // vektor rona (r−L, g−L, b−L) dengan L = rata-rata kanal
  const hueVec = (r: number, g: number, b: number): [number, number, number] => {
    const L = (r + g + b) / 3;
    return [r - L, g - L, b - L];
  };
  const groupsOf = new Map<number, number[]>();
  for (let c = 0; c < nComp; c++) {
    if (!compCand[c]) continue;
    const g = find(c);
    const arr = groupsOf.get(g);
    if (arr) arr.push(c); else groupsOf.set(g, [c]);
  }
  // warna-warna yang benar-benar dipakai gambar (luas total ≥ 50 px)
  const keyArea = new Map<number, number>();
  for (let c = 0; c < nComp; c++) keyArea.set(compKey[c], (keyArea.get(compKey[c]) ?? 0) + compArea[c]);
  const imageKeys: number[] = [];
  for (const [k, a] of keyArea) if (a >= 50 && k !== -1) imageKeys.push(k);
  const target = new Int32Array(nComp).fill(-2);
  for (const cs of groupsOf.values()) {
    if (cs.length < 2) continue;
    const keys = new Map<number, number>(); // warna → luas
    let R = 0, G = 0, B = 0, A = 0;
    for (const c of cs) {
      keys.set(compKey[c], (keys.get(compKey[c]) ?? 0) + compArea[c]);
      R += sumR[c]; G += sumG[c]; B += sumB[c]; A += compArea[c];
    }
    if (keys.size < 2) continue;
    // Teks putih (warna dominan hampir putih) dilewati: tepi anti-aliasing berwarna latar (merah muda
    // di lencana merah) tidak boleh menyeret seluruh huruf putih menjadi berwarna.
    let domK = -1, domA = -1;
    for (const [k, a] of keys) if (a > domA) { domA = a; domK = k; }
    if (Math.min((domK >> 16) & 255, (domK >> 8) & 255, domK & 255) >= 225) continue;
    const m = hueVec(R / A, G / A, B / A);
    const mLen = Math.hypot(m[0], m[1], m[2]);
    // rona huruf-huruf harus seragam (serpihan kecil — tepi anti-aliasing kekuningan karena JPEG —
    // tidak dihitung: < 25% luas komponen terbesar kelompok)
    let maxComp = 0;
    for (const c of cs) if (compArea[c] > maxComp) maxComp = compArea[c];
    let spread = 0;
    for (const c of cs) {
      if (compArea[c] < Math.max(20, maxComp * 0.25)) continue;
      const v = hueVec(sumR[c] / compArea[c], sumG[c] / compArea[c], sumB[c] / compArea[c]);
      spread = Math.max(spread, Math.hypot(v[0] - m[0], v[1] - m[1], v[2] - m[2]));
    }
    if (spread > 35) continue;
    const neutral = mLen < 8;
    let best = -1, bestA = -1;
    for (const [k, a] of keys) {
      const v = hueVec((k >> 16) & 255, (k >> 8) & 255, k & 255);
      const vLen = Math.hypot(v[0], v[1], v[2]);
      const ok = neutral
        ? vLen < 15
        : vLen >= 10 && (v[0] * m[0] + v[1] * m[1] + v[2] * m[2]) / (vLen * mLen) > 0.9;
      if (ok && a > bestA) { bestA = a; best = k; }
    }
    if (best === -1) continue;
    if (neutral) {
      // Kata bernada netral (perak/abu): pilih warna gambar yang paling dekat dengan warna ASLI kata
      // sekaligus paling netral — warna abu kekuningan (171,166,154) yang luasnya menang tidak boleh
      // mengalahkan perak hanya karena kebetulan lebih banyak piksel ter-snap ke sana.
      let cr = 0, cg = 0, cb = 0, cn = 0;
      for (const c of cs) { cr += coreR[c]; cg += coreG[c]; cb += coreB[c]; cn += coreN[c]; }
      const mr = cn > 0 ? cr / cn : R / A, mg = cn > 0 ? cg / cn : G / A, mb = cn > 0 ? cb / cn : B / A;
      let bestScore = Infinity, pick = best;
      for (const k of imageKeys) {
        const v = hueVec((k >> 16) & 255, (k >> 8) & 255, k & 255);
        const vLen = Math.hypot(v[0], v[1], v[2]);
        if (vLen >= 15 || rgbDistSq(k, best) > SIMILAR_SQ) continue;
        const score = Math.hypot(((k >> 16) & 255) - mr, ((k >> 8) & 255) - mg, (k & 255) - mb) + 5 * vLen;
        if (score < bestScore) { bestScore = score; pick = k; }
      }
      best = pick;
    }
    for (const c of cs) {
      if (compKey[c] !== best && rgbDistSq(compKey[c], best) <= SIMILAR_SQ) target[c] = best;
    }
  }
  for (let i = 0; i < total; i++) {
    const c = comp[i];
    if (c < 0 || target[c] === -2) continue;
    const t = target[c], j = i * 4;
    data[j] = (t >> 16) & 255;
    data[j + 1] = (t >> 8) & 255;
    data[j + 2] = t & 255;
  }
}

/**
 * Pertebal goresan 1–2 px yang kontras (huruf "I", palang "T" pada teks kecil) menjadi 3 px.
 * vtracer membuang bentuk selebar ≤ 2 px saat penghalusan path, sehingga huruf tipis hilang dari
 * hasil vektor walau ada di raster. Goresan diperlebar 1 px ke sisi yang warna ASLINYA lebih dekat
 * dengan warna goresan (sisi anti-aliasing), hanya bila goresan memanjang (≥ 4 px tegak lurus).
 */
export function widenThinStrokes(imageData: ImageData, original: Uint8ClampedArray, scale = 1): void {
  const { width: w, height: h, data } = imageData;
  const total = w * h;
  const key = new Int32Array(total);
  for (let i = 0; i < total; i++) {
    const j = i * 4;
    key[i] = data[j + 3] < 30 ? -1 : (data[j] << 16) | (data[j + 1] << 8) | data[j + 2];
  }
  // Warna goresan harus juga muncul sebagai bidang TEBAL di dekatnya (huruf tetangga yang lebih tebal).
  // Goresan tipis berwarna "nyasar" (mis. garis kontak chip coklat tua yang ter-snap ke abu gelap)
  // tidak dipertebal → tetap dibuang vtracer seperti sebelumnya.
  const cell = Math.max(8, Math.round(6 * scale));
  const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
  const thickAt = new Map<number, Uint8Array>();
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, k = key[i];
      if (k === -1 || key[i - 1] !== k || key[i + 1] !== k || key[i - w] !== k || key[i + w] !== k ||
          key[i - w - 1] !== k || key[i - w + 1] !== k || key[i + w - 1] !== k || key[i + w + 1] !== k) continue;
      let g = thickAt.get(k);
      if (!g) { g = new Uint8Array(gw * gh); thickAt.set(k, g); }
      g[Math.floor(y / cell) * gw + Math.floor(x / cell)] = 1;
    }
  }
  const thickNearby = (i: number, k: number) => {
    const g = thickAt.get(k);
    if (!g) return false;
    const gx = Math.floor((i % w) / cell), gy = Math.floor(i / w / cell);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = gx + dx, yy = gy + dy;
      if (xx >= 0 && yy >= 0 && xx < gw && yy < gh && g[yy * gw + xx]) return true;
    }
    return false;
  };
  const CONTRAST_SQ = 80 * 80;
  const contrasts = (a: number, b: number) => {
    if (b === -1) return true;
    const dr = ((a >> 16) & 255) - ((b >> 16) & 255);
    const dg = ((a >> 8) & 255) - ((b >> 8) & 255);
    const db = (a & 255) - (b & 255);
    return dr * dr + dg * dg + db * db > CONTRAST_SQ;
  };
  const similar = (a: number, b: number) => {
    if (a === b) return true;
    if (a === -1 || b === -1) return false;
    const dr = ((a >> 16) & 255) - ((b >> 16) & 255);
    const dg = ((a >> 8) & 255) - ((b >> 8) & 255);
    const db = (a & 255) - (b & 255);
    return dr * dr + dg * dg + db * db < 60 * 60;
  };
  const origDistSq = (i: number, k: number) => {
    const j = i * 4;
    const dr = original[j] - ((k >> 16) & 255), dg = original[j + 1] - ((k >> 8) & 255), db = original[j + 2] - (k & 255);
    return dr * dr + dg * dg + db * db;
  };
  const paint = new Int32Array(total).fill(-2);
  // stride=1: pindai baris (goresan tegak); stride=w: pindai kolom (goresan mendatar)
  const scan = (outer: number, inner: number, at: (o: number, i: number) => number, perp: number) => {
    for (let o = 0; o < outer; o++) {
      let a = 0;
      while (a < inner) {
        const k = key[at(o, a)];
        let b = a;
        while (b + 1 < inner && key[at(o, b + 1)] === k) b++;
        if (k !== -1 && b - a <= 1 && a > 0 && b + 1 < inner) {
          const left = at(o, a - 1), right = at(o, b + 1);
          // kedua sisi = latar yang sama/mirip (huruf di atas satu latar), bukan serpihan di antara
          // dua warna berbeda (mis. sisa tepi antara huruf putih dan lingkaran oranye)
          if (contrasts(k, key[left]) && contrasts(k, key[right]) && similar(key[left], key[right])) {
            // panjang goresan tegak lurus (min. 4 px termasuk piksel ini)
            const mid = at(o, a);
            let ext = 1;
            for (let s = 1; s < 4; s++) { const q = mid - s * perp; if (q < 0 || key[q] !== k) break; ext++; }
            for (let s = 1; s < 4 && ext < 4; s++) { const q = mid + s * perp; if (q >= total || key[q] !== k) break; ext++; }
            if (ext >= 4 && thickNearby(mid, k)) {
              const target = origDistSq(left, k) <= origDistSq(right, k) ? left : right;
              paint[target] = k;
            }
          }
        }
        a = b + 1;
      }
    }
  };
  scan(h, w, (y, x) => y * w + x, w);
  scan(w, h, (x, y) => y * w + x, 1);
  for (let i = 0; i < total; i++) {
    const k = paint[i];
    if (k === -2) continue;
    const j = i * 4;
    data[j] = (k >> 16) & 255;
    data[j + 1] = (k >> 8) & 255;
    data[j + 2] = k & 255;
    data[j + 3] = 255;
  }
}

/**
 * Peta indeks palet per piksel (255 = transparan / bukan warna palet), dibuat SEBELUM raster dikirim
 * ke vtracer. Dipakai `recolorSvgFromRaster`.
 */
export function buildPaletteIndexMap(imageData: ImageData, palette: string[]): Uint8Array {
  const { width, height, data } = imageData;
  const idx = new Map<number, number>();
  palette.slice(0, 254).forEach((hex, i) => {
    const c = hexToRgb(hex);
    idx.set((c.r << 16) | (c.g << 8) | c.b, i);
  });
  const out = new Uint8Array(width * height).fill(255);
  for (let i = 0; i < width * height; i++) {
    const j = i * 4;
    if (data[j + 3] < 30) continue;
    const k = idx.get((data[j] << 16) | (data[j + 1] << 8) | data[j + 2]);
    if (k !== undefined) out[i] = k;
  }
  return out;
}

/**
 * Tetapkan ulang warna tiap path hasil vtracer ke warna palet. vtracer meleburkan klaster kecil dan
 * memakai warna RATA-RATA gabungannya (termasuk tetangga/transparan), sehingga mis. huruf perak di
 * atas latar bergradasi bisa keluar keemasan. Setiap path dirasterisasi dari yang PALING ATAS ke
 * bawah; hanya piksel yang benar-benar terlihat (belum tertutup path di atasnya) yang dihitung, dan
 * path diberi warna palet raster yang paling banyak di piksel itu. Bila tidak ada piksel terlihat yang
 * cukup → warna palet terdekat secara perseptual (Lab).
 */
export function recolorSvgByVisibility(
  svg: string,
  palette: string[],
  indexMap: Uint8Array | undefined,
  width: number,
  height: number,
  bbox: (d: string) => [number, number, number, number] | null
): string {
  if (!palette || palette.length === 0) return svg;
  const labs = palette.map((hex) => {
    const c = hexToRgb(hex);
    return { hex: c.hex, lab: rgbToLab(c.r, c.g, c.b) };
  });
  const nearest = (hex: string) => {
    const c = hexToRgb(hex);
    const L = rgbToLab(c.r, c.g, c.b);
    let best = 0, bestD = Infinity;
    for (let i = 0; i < labs.length; i++) {
      const p = labs[i].lab;
      const d = (L[0] - p[0]) ** 2 + (L[1] - p[1]) ** 2 + (L[2] - p[2]) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    return labs[best].hex;
  };
  // seluruh elemen path (self-closing) agar bisa dipecah menjadi beberapa path
  const re = /<path\b([^>]*?)\bd="([^"]+)"([^>]*?)fill="(#[0-9a-fA-F]{6})"([^>]*?)\/>/g;
  const items: Array<{ start: number; end: number; pre: string; d: string; mid: string; hex: string; post: string; groups: string[] }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg)) !== null) {
    items.push({
      start: m.index, end: m.index + m[0].length, pre: m[1], d: m[2], mid: m[3], hex: m[4], post: m[5],
      groups: splitShapes(m[2]),
    });
  }
  const colors: string[][] = items.map((it) => it.groups.map(() => nearest(it.hex)));
  const canvasOk = typeof document !== 'undefined' || typeof OffscreenCanvas !== 'undefined';
  if (indexMap && width > 0 && height > 0 && canvasOk && typeof Path2D !== 'undefined') {
    const covered = new Uint8Array(width * height);
    const counts = new Int32Array(labs.length);
    const mk = (w: number, h: number): HTMLCanvasElement | OffscreenCanvas => {
      if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return c;
    };
    for (let k = items.length - 1; k >= 0; k--) {
      items[k].groups.forEach((gd, gi) => {
        const bb = bbox(gd);
        if (!bb) return;
        const x0 = Math.max(0, Math.floor(bb[0])), y0 = Math.max(0, Math.floor(bb[1]));
        const x1 = Math.min(width, Math.ceil(bb[2])), y1 = Math.min(height, Math.ceil(bb[3]));
        const bw = x1 - x0, bh = y1 - y0;
        if (bw <= 0 || bh <= 0) return;
        const canvas = mk(bw, bh);
        const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
        if (!ctx) return;
        ctx.translate(-x0, -y0);
        ctx.fillStyle = '#000';
        ctx.fill(new Path2D(gd));
        const px = ctx.getImageData(0, 0, bw, bh).data;
        counts.fill(0);
        let n = 0;
        for (let y = 0; y < bh; y++) {
          const row = (y0 + y) * width + x0;
          for (let x = 0; x < bw; x++) {
            if (px[(y * bw + x) * 4 + 3] < 128) continue;
            const g = row + x;
            if (covered[g]) continue;
            covered[g] = 1;
            const ci = indexMap[g];
            if (ci < labs.length) { counts[ci]++; n++; }
          }
        }
        if (n >= 4) {
          let top = 0;
          for (let i = 1; i < labs.length; i++) if (counts[i] > counts[top]) top = i;
          colors[k][gi] = labs[top].hex;
        }
      });
    }
  }
  let out = '';
  let last = 0;
  items.forEach((it, k) => {
    out += svg.slice(last, it.start);
    const cs = colors[k];
    if (cs.every((c) => c === cs[0])) {
      out += `<path${it.pre}d="${it.d}"${it.mid}fill="${cs[0]}"${it.post}/>`;
    } else {
      // bentuk-bentuk terpisah dalam satu path ternyata berbeda warna → path terpisah, urutan sama
      it.groups.forEach((gd, gi) => { out += `<path${it.pre}d="${gd}"${it.mid}fill="${cs[gi]}"${it.post}/>`; });
    }
    last = it.end;
  });
  return out + svg.slice(last);
}

/**
 * Pecah path majemuk vtracer menjadi bentuk-bentuk terpisah: tiap kontur luar beserta lubangnya.
 * vtracer (mode palet) menggabungkan area terpisah yang sewarna ke dalam satu path, padahal warna
 * yang benar bisa berbeda per area. Lubang = kontur berarah berlawanan dengan kontur terbesar,
 * dipasangkan ke kontur luar terkecil yang memuatnya.
 */
function splitShapes(d: string): string[] {
  let subs: string[];
  try {
    subs = svgpath(d).abs().toString().split(/(?=M)/).filter((x: string) => x.trim().length > 0);
  } catch {
    return [d];
  }
  if (subs.length < 2) return [d];
  const info = subs.map((sp) => {
    const pts: number[] = [];
    svgpath(sp).iterate((seg: any[]) => {
      if (seg.length >= 3) pts.push(seg[seg.length - 2], seg[seg.length - 1]);
    });
    let a = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const n = pts.length / 2;
    for (let i = 0; i < n; i++) {
      const xa = pts[i * 2], ya = pts[i * 2 + 1];
      const xb = pts[((i + 1) % n) * 2], yb = pts[((i + 1) % n) * 2 + 1];
      a += xa * yb - xb * ya;
      if (xa < x0) x0 = xa;
      if (xa > x1) x1 = xa;
      if (ya < y0) y0 = ya;
      if (ya > y1) y1 = ya;
    }
    return { a: a / 2, bb: [x0, y0, x1, y1] };
  });
  let big = 0;
  for (let i = 1; i < info.length; i++) if (Math.abs(info[i].a) > Math.abs(info[big].a)) big = i;
  const outerSign = Math.sign(info[big].a) || 1;
  const owner = info.map((_, i) => i);
  for (let i = 0; i < info.length; i++) {
    if (Math.sign(info[i].a) === outerSign) continue;
    let best = -1, bestA = Infinity;
    const hb = info[i].bb;
    for (let j = 0; j < info.length; j++) {
      if (Math.sign(info[j].a) !== outerSign) continue;
      const ob = info[j].bb;
      if (ob[0] <= hb[0] + 0.5 && ob[1] <= hb[1] + 0.5 && ob[2] >= hb[2] - 0.5 && ob[3] >= hb[3] - 0.5 && Math.abs(info[j].a) < bestA) {
        bestA = Math.abs(info[j].a);
        best = j;
      }
    }
    if (best >= 0) owner[i] = best;
  }
  const groups = new Map<number, string[]>();
  subs.forEach((sp, i) => {
    const g = groups.get(owner[i]);
    if (g) g.push(sp); else groups.set(owner[i], [sp]);
  });
  if (groups.size < 2) return [d];
  return [...groups.values()].map((g) => g.join(''));
}

/**
 * Barcode / garis-garis tegak sejajar. Batang 1–3 px sumber dengan tepi buram ter-snap menjadi mosaik
 * beberapa warna (emas, abu, gelap, transparan) sehingga hasil vektor bergerigi dan batang menyatu.
 * Deteksi: blok dengan banyak tepi mendatar tetapi hampir tanpa tepi tegak. Pola batang dibaca per
 * KOLOM dari warna asli (ambang Otsu kecerahan kolom), lalu blok digambar ulang: kolom batang = satu
 * warna batang, kolom celah = warna/transparansi celah terbanyak. Batang dipertebal minimal 3 px agar
 * tidak dibuang vtracer. Teks tidak terkena karena hurufnya punya banyak tepi tegak.
 */
export function regularizeBarcodes(imageData: ImageData, original: Uint8ClampedArray, scale: number): void {
  const { width: w, height: h, data } = imageData;
  const total = w * h;
  const L = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    const j = i * 4;
    L[i] = 0.299 * original[j] + 0.587 * original[j + 1] + 0.114 * original[j + 2];
  }
  const s = Math.max(1, scale);
  const EDGE = 45;
  // integral image dari tepi mendatar (perubahan kiri↔kanan) dan tegak
  const W1 = w + 1;
  const IH = new Int32Array(W1 * (h + 1)), IV = new Int32Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    let rh = 0, rv = 0;
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (x > 0 && x + 1 < w && Math.abs(L[p + 1] - L[p - 1]) > EDGE) rh++;
      if (y > 0 && y + 1 < h && Math.abs(L[p + w] - L[p - w]) > EDGE) rv++;
      IH[(y + 1) * W1 + x + 1] = IH[y * W1 + x + 1] + rh;
      IV[(y + 1) * W1 + x + 1] = IV[y * W1 + x + 1] + rv;
    }
  }
  const box = (I: Int32Array, x0: number, y0: number, x1: number, y1: number) =>
    I[y1 * W1 + x1] - I[y0 * W1 + x1] - I[y1 * W1 + x0] + I[y0 * W1 + x0];
  const hw = Math.round(6 * s), hh = Math.round(4 * s);
  const mark = new Uint8Array(total);
  let anyMark = false;
  for (let y = hh; y < h - hh; y += 2) {
    for (let x = hw; x < w - hw; x += 2) {
      const x0 = x - hw, x1 = x + hw + 1, y0 = y - hh, y1 = y + hh + 1;
      const area = (x1 - x0) * (y1 - y0);
      const ch = box(IH, x0, y0, x1, y1), cv = box(IV, x0, y0, x1, y1);
      if (ch >= area * 0.2 && cv <= ch * 0.12) {
        for (let dy = 0; dy < 2 && y + dy < h; dy++) for (let dx = 0; dx < 2 && x + dx < w; dx++) mark[(y + dy) * w + x + dx] = 1;
        anyMark = true;
      }
    }
  }
  if (!anyMark) return;
  // komponen blok
  const seen = new Uint8Array(total);
  const stack = new Int32Array(total);
  const blocks: Array<[number, number, number, number]> = [];
  for (let s0 = 0; s0 < total; s0++) {
    if (!mark[s0] || seen[s0]) continue;
    let sp = 0, bx0 = w, by0 = h, bx1 = -1, by1 = -1;
    stack[sp++] = s0;
    seen[s0] = 1;
    while (sp > 0) {
      const p = stack[--sp];
      const x = p % w, y = (p / w) | 0;
      if (x < bx0) bx0 = x;
      if (x > bx1) bx1 = x;
      if (y < by0) by0 = y;
      if (y > by1) by1 = y;
      for (const q of [x > 0 ? p - 1 : -1, x + 1 < w ? p + 1 : -1, y > 0 ? p - w : -1, y + 1 < h ? p + w : -1]) {
        if (q >= 0 && mark[q] && !seen[q]) { seen[q] = 1; stack[sp++] = q; }
      }
    }
    if (bx1 - bx0 >= 12 * s && by1 - by0 >= 3 * s) blocks.push([bx0, by0, bx1, by1]);
  }
  const keyOf = (j: number) => (data[j + 3] < 30 ? -1 : (data[j] << 16) | (data[j + 1] << 8) | data[j + 2]);
  let keysCache: number[] | null = null;
  const imageKeys = (): number[] => {
    if (keysCache) return keysCache;
    const cnt = new Map<number, number>();
    for (let i = 0; i < total; i++) {
      const k = keyOf(i * 4);
      if (k !== -1) cnt.set(k, (cnt.get(k) ?? 0) + 1);
    }
    keysCache = [...cnt].filter(([, n]) => n >= 200).map(([k]) => k);
    return keysCache;
  };
  for (const [mx0, my0, mx1, my1] of blocks) {
    // perluas ke lebar/tinggi blok sebenarnya (jendela deteksi memangkas tepi)
    const x0 = Math.max(1, mx0 - hw), x1 = Math.min(w - 2, mx1 + hw);
    const cy0 = my0, cy1 = my1;
    const nx = x1 - x0 + 1;
    const prof = new Float32Array(nx);
    for (let x = 0; x < nx; x++) {
      let sum = 0;
      for (let y = cy0; y <= cy1; y++) sum += L[y * w + x0 + x];
      prof[x] = sum / (cy1 - cy0 + 1);
    }
    let pm = 0;
    for (let x = 0; x < nx; x++) pm += prof[x];
    pm /= nx;
    let pv = 0;
    for (let x = 0; x < nx; x++) pv += (prof[x] - pm) ** 2;
    if (pv <= 0) continue;
    const rowCorr = (y: number) => {
      let rm = 0;
      for (let x = 0; x < nx; x++) rm += L[y * w + x0 + x];
      rm /= nx;
      let cov = 0, rv = 0;
      for (let x = 0; x < nx; x++) {
        const d = L[y * w + x0 + x] - rm;
        cov += d * (prof[x] - pm);
        rv += d * d;
      }
      return rv > 0 ? cov / Math.sqrt(rv * pv) : 0;
    };
    // batang harus benar-benar tegak: setiap baris inti memperlihatkan pola kolom yang sama
    // (goresan miring huruf "W"/"V" tidak lolos)
    let corrSum = 0;
    for (let y = cy0; y <= cy1; y++) corrSum += rowCorr(y);
    if (corrSum / (cy1 - cy0 + 1) < 0.85) continue;
    let y0 = cy0, y1 = cy1;
    while (y0 > 0 && rowCorr(y0 - 1) > 0.75) y0--;
    while (y1 < h - 1 && rowCorr(y1 + 1) > 0.75) y1++;
    if (y1 - y0 < 10 * s) continue; // barcode: batang cukup tinggi (huruf teks kecil lebih pendek)
    // ambang Otsu kecerahan kolom
    let lo = Infinity, hi = -Infinity;
    for (let x = 0; x < nx; x++) { if (prof[x] < lo) lo = prof[x]; if (prof[x] > hi) hi = prof[x]; }
    if (hi - lo < 60) continue;
    let bestT = (lo + hi) / 2, bestVar = -1;
    for (let t = lo + 2; t < hi - 2; t += 2) {
      let n0 = 0, s0 = 0, n1 = 0, s1 = 0;
      for (let x = 0; x < nx; x++) { if (prof[x] < t) { n0++; s0 += prof[x]; } else { n1++; s1 += prof[x]; } }
      if (!n0 || !n1) continue;
      const v = n0 * n1 * (s0 / n0 - s1 / n1) ** 2;
      if (v > bestVar) { bestVar = v; bestT = t; }
    }
    const isBar = new Uint8Array(nx);
    for (let x = 0; x < nx; x++) isBar[x] = prof[x] >= bestT ? 1 : 0;
    // buang kolom celah di ujung blok
    let a = 0, b = nx - 1;
    while (a < nx && !isBar[a]) a++;
    while (b >= 0 && !isBar[b]) b--;
    if (b - a < 10 * s) continue;
    let runs = 0;
    for (let x = a; x <= b; x++) if (isBar[x] && (x === a || !isBar[x - 1])) runs++;
    if (runs < 6) continue;
    // warna batang & celah = warna hasil snapping terbanyak di kolomnya (inti blok)
    const barCount = new Map<number, number>(), gapCount = new Map<number, number>();
    for (let y = y0; y <= y1; y++) {
      for (let x = a; x <= b; x++) {
        const k = keyOf((y * w + x0 + x) * 4);
        const m = isBar[x] ? barCount : gapCount;
        m.set(k, (m.get(k) ?? 0) + 1);
      }
    }
    // warna batang: warna gambar terdekat dengan warna ASLI bagian TERANG batang (seperempat teratas
    // kecerahan; tepi buram & bayangan tidak ikut), dipilih dari semua warna yang dipakai gambar
    const brightVals: number[] = [];
    for (let y = y0; y <= y1; y++) for (let x = a; x <= b; x++) if (isBar[x]) brightVals.push(L[y * w + x0 + x]);
    brightVals.sort((p, q) => p - q);
    const lMed = brightVals.length ? brightVals[Math.floor(brightVals.length * 0.75)] : bestT;
    let mr = 0, mg = 0, mb = 0, mn = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = a; x <= b; x++) {
        const p = y * w + x0 + x;
        if (!isBar[x] || L[p] < lMed) continue;
        mr += original[p * 4]; mg += original[p * 4 + 1]; mb += original[p * 4 + 2]; mn++;
      }
    }
    let barK = -1, bd = Infinity, gapK = -1, gn = -1;
    if (mn > 0) {
      mr /= mn; mg /= mn; mb /= mn;
      const ml = rgbToLab(mr, mg, mb);
      for (const k of imageKeys()) {
        const kl = rgbToLab((k >> 16) & 255, (k >> 8) & 255, k & 255);
        // rona (a*, b*) diberi bobot dua kali: batang emas tetap emas, bukan krem keabuan
        const d = (kl[0] - ml[0]) ** 2 + 4 * ((kl[1] - ml[1]) ** 2 + (kl[2] - ml[2]) ** 2);
        if (d < bd) { bd = d; barK = k; }
      }
    }
    for (const [k, n] of gapCount) if (n > gn) { gn = n; gapK = k; }
    if (barK === -1) continue;
    // batang minimal 3 px
    const minBar = Math.max(3, Math.round(1.2 * s));
    const bar2 = Uint8Array.from(isBar);
    for (let x = a; x <= b; x++) {
      if (!isBar[x] || (x > a && isBar[x - 1])) continue;
      let e = x;
      while (e + 1 <= b && isBar[e + 1]) e++;
      const len = e - x + 1;
      if (len < minBar) {
        const extra = minBar - len;
        const l = Math.max(a, x - (extra >> 1)), r = Math.min(b, l + minBar - 1);
        for (let k = l; k <= r; k++) bar2[k] = 1;
      }
    }
    for (let y = y0; y <= y1; y++) {
      for (let x = a; x <= b; x++) {
        const j = (y * w + x0 + x) * 4;
        const k = bar2[x] ? barK : gapK;
        if (k === -1) { data[j + 3] = 0; continue; }
        data[j] = (k >> 16) & 255;
        data[j + 1] = (k >> 8) & 255;
        data[j + 2] = k & 255;
        data[j + 3] = 255;
      }
    }
  }
}
