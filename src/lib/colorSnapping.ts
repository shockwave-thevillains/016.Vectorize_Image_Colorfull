/**
 * Advanced Color Snapping & Anti-Aliasing Elimination Engine
 * Solves:
 * 1. Muddy / shifted colors (e.g. green facet turning into cyan or disappearing).
 * 2. Intermediate anti-aliasing bleed pixels (brown, dark red, light lavender) polluting the design palette.
 * 3. Halos / thin fringes around shapes from premature white removal.
 * 4. Micro-paths explosion from edge staircase pixels.
 * 5. Straight lines becoming wavy or jagged (Polygon vs Spline modes).
 */

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
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (reference[idx] || !edgeMask[idx]) continue;
      const p = idx * 4;
      if (data[p + 3] < 30) continue;
      const or = original[p], og = original[p + 1], ob = original[p + 2];
      cr.length = cg.length = cb.length = ct.length = 0;
      let tr = 0, tg = 0, tb = 0, tn = 0;
      const r = radius;
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const q = yy * width + xx;
          const j = q * 4;
          if (data[j + 3] < 30) {
            if (Math.abs(dx) <= 2 && Math.abs(dy) <= 2) {
              tr += original[j]; tg += original[j + 1]; tb += original[j + 2]; tn++;
            }
            continue;
          }
          if (!reference[q]) continue;
          let dup = false;
          for (let k = 0; k < cr.length; k++) {
            if (cr[k] === data[j] && cg[k] === data[j + 1] && cb[k] === data[j + 2]) { dup = true; break; }
          }
          if (!dup && cr.length < 12) { cr.push(data[j]); cg.push(data[j + 1]); cb.push(data[j + 2]); ct.push(0); }
        }
      }
      if (tn > 0) { cr.push(tr / tn); cg.push(tg / tn); cb.push(tb / tn); ct.push(1); }
      const n = cr.length;
      if (n === 0) continue;

      // residu & pilihan terbaik dari semua pasangan (dan warna tunggal)
      let bestRes = Infinity, bestK = -1;
      let nearOpaque = Infinity, nearOpaqueK = -1;
      for (let i = 0; i < n; i++) {
        const d = Math.hypot(or - cr[i], og - cg[i], ob - cb[i]);
        if (d < bestRes) { bestRes = d; bestK = i; }
        if (ct[i] === 0 && d < nearOpaque) { nearOpaque = d; nearOpaqueK = i; }
        for (let j = i + 1; j < n; j++) {
          const ux = cr[j] - cr[i], uy = cg[j] - cg[i], uz = cb[j] - cb[i];
          const L2 = ux * ux + uy * uy + uz * uz;
          if (L2 < 1) continue;
          let t = ((or - cr[i]) * ux + (og - cg[i]) * uy + (ob - cb[i]) * uz) / L2;
          if (t < 0 || t > 1) continue; // di luar segmen → sudah tercakup warna tunggal
          const res = Math.hypot(or - (cr[i] + t * ux), og - (cg[i] + t * uy), ob - (cb[i] + t * uz));
          if (res < bestRes) { bestRes = res; bestK = t < 0.5 ? i : j; }
        }
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
        const d = Math.hypot(original[p] - sr / n, original[p + 1] - sg / n, original[p + 2] - sb / n);
        if (d <= maxDist) clear.push(p);
      }
    }
    if (clear.length === 0) break;
    for (const p of clear) data[p + 3] = 0;
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
