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

  const out = new Uint8ClampedArray(data);
  const cand: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (reference[idx] || !edgeMask[idx]) continue;
      const p = idx * 4;
      if (data[p + 3] < 30) continue;
      const or = original[p], og = original[p + 1], ob = original[p + 2];
      // Latar transparan di dekatnya (area gradien yang dilubangi, atau background yang dihapus):
      // warna aslinya jadi kandidat "transparan". Bila piksel tepi lebih mirip latar daripada warna
      // objek, ia dibuat transparan → batas huruf jatuh tepat di tengah anti-aliasing, tanpa bingkai.
      // Radius 2 px agar selalu tertutup fillMask gradien (dilatasi 2 px) di bawahnya.
      let tr = 0, tg = 0, tb = 0, tn = 0;
      for (let dy = -2; dy <= 2; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const j = (yy * width + xx) * 4;
          if (data[j + 3] >= 30) continue;
          tr += original[j]; tg += original[j + 1]; tb += original[j + 2]; tn++;
        }
      }
      const dT = tn > 0 ? colorDistanceSq(or, og, ob, tr / tn, tg / tn, tb / tn) : Infinity;
      let decided = false;
      for (let pass = 0; pass < 2; pass++) {
        const r = pass === 0 ? radius : radius * 2;
        cand.length = 0;
        for (let dy = -r; dy <= r; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= height) continue;
          for (let dx = -r; dx <= r; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= width) continue;
            const q = yy * width + xx;
            if (!reference[q]) continue;
            const j = q * 4;
            const packed = (data[j] << 16) | (data[j + 1] << 8) | data[j + 2];
            if (!cand.includes(packed)) cand.push(packed);
          }
        }
        if (cand.length === 0) continue;
        let best = cand[0];
        let bestD = Infinity;
        for (const c of cand) {
          const d = colorDistanceSq(or, og, ob, (c >> 16) & 255, (c >> 8) & 255, c & 255);
          if (d < bestD) {
            bestD = d;
            best = c;
          }
        }
        decided = true;
        if (dT < bestD) {
          out[p + 3] = 0;
        } else {
          out[p] = (best >> 16) & 255;
          out[p + 1] = (best >> 8) & 255;
          out[p + 2] = best & 255;
        }
        break;
      }
      if (!decided && dT < colorDistanceSq(or, og, ob, data[p], data[p + 1], data[p + 2])) {
        out[p + 3] = 0;
      }
    }
  }
  data.set(out);
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
