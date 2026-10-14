/**
 * Area putih & background transparan (mode Putih).
 *
 * 1. Semua piksel putih (≥ toleransi) dikelompokkan menjadi AREA terhubung (4-arah).
 *    - Area yang menyentuh tepi gambar  = background luar  → default DIHAPUS.
 *    - Area tertutup di tengah objek   = putih dalam      → default mengikuti `keepInnerWhite`.
 * 2. Pengguna bisa mengklik area di preview untuk membalik keputusan per area. Pilihan disimpan sebagai
 *    titik ternormalisasi (0..1) — bukan ID area — sehingga tetap valid di resolusi mana pun
 *    (preview memakai resolusi asli, pipeline memakai resolusi kerja hasil upscale).
 * 3. Opsional: bayangan lembut abu-abu yang menempel ke background ikut dihapus.
 * 4. Defringe: sisa halo putih di tepi objek (anti-aliasing) dibuang / didekontaminasi.
 */
import { VectorizeConfig, WhiteRegionOverride } from '../types';

export interface WhiteRegionInfo {
  id: number;
  area: number;
  touchesBorder: boolean;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Keputusan akhir setelah default + override pengguna */
  removed: boolean;
  /** true bila keputusan berasal dari klik pengguna */
  overridden: boolean;
}

export interface WhiteRegionMap {
  width: number;
  height: number;
  /** Label area per piksel (-1 = bukan putih) */
  labels: Int32Array;
  regions: WhiteRegionInfo[];
}

export interface BackgroundMaskResult {
  map: WhiteRegionMap;
  /** 1 = piksel dibuat transparan */
  mask: Uint8Array;
  /** 1 = piksel bayangan yang ikut dihapus */
  shadowMask: Uint8Array | null;
}

type Pixels = { data: Uint8ClampedArray | Uint8Array; width: number; height: number };

const ALPHA_EMPTY = 20;

/** Toleransi putih: komponen R, G, B semuanya ≥ tol (default 242). */
export function isWhitePixel(data: Pixels['data'], idx: number, tol: number): boolean {
  if (data[idx + 3] < ALPHA_EMPTY) return true;
  return data[idx] >= tol && data[idx + 1] >= tol && data[idx + 2] >= tol;
}

/** Kelompokkan piksel putih menjadi area terhubung (BFS 4-arah). */
export function labelWhiteRegions(img: Pixels, tol: number): WhiteRegionMap {
  const { data, width, height } = img;
  const total = width * height;
  const labels = new Int32Array(total).fill(-1);
  const queue = new Int32Array(total);
  const regions: WhiteRegionInfo[] = [];

  for (let start = 0; start < total; start++) {
    if (labels[start] !== -1 || !isWhitePixel(data, start * 4, tol)) continue;
    const id = regions.length;
    const info: WhiteRegionInfo = {
      id,
      area: 0,
      touchesBorder: false,
      minX: width,
      minY: height,
      maxX: 0,
      maxY: 0,
      removed: false,
      overridden: false,
    };
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    labels[start] = id;
    while (head < tail) {
      const p = queue[head++];
      const x = p % width;
      const y = (p / width) | 0;
      info.area++;
      if (x < info.minX) info.minX = x;
      if (x > info.maxX) info.maxX = x;
      if (y < info.minY) info.minY = y;
      if (y > info.maxY) info.maxY = y;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) info.touchesBorder = true;

      if (x + 1 < width && labels[p + 1] === -1 && isWhitePixel(data, (p + 1) * 4, tol)) {
        labels[p + 1] = id;
        queue[tail++] = p + 1;
      }
      if (x > 0 && labels[p - 1] === -1 && isWhitePixel(data, (p - 1) * 4, tol)) {
        labels[p - 1] = id;
        queue[tail++] = p - 1;
      }
      if (y + 1 < height && labels[p + width] === -1 && isWhitePixel(data, (p + width) * 4, tol)) {
        labels[p + width] = id;
        queue[tail++] = p + width;
      }
      if (y > 0 && labels[p - width] === -1 && isWhitePixel(data, (p - width) * 4, tol)) {
        labels[p - width] = id;
        queue[tail++] = p - width;
      }
    }
    regions.push(info);
  }

  return { width, height, labels, regions };
}

/**
 * Cari label area pada titik ternormalisasi (0..1). Bila titik jatuh tepat di tepi
 * (bukan putih), cari piksel putih terdekat dalam radius kecil.
 */
export function regionAtPoint(map: WhiteRegionMap, nx: number, ny: number, radius = 3): number {
  const { width, height, labels } = map;
  const cx = Math.min(width - 1, Math.max(0, Math.floor(nx * width)));
  const cy = Math.min(height - 1, Math.max(0, Math.floor(ny * height)));
  const direct = labels[cy * width + cx];
  if (direct !== -1) return direct;
  let best = -1;
  let bestD = Infinity;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const l = labels[y * width + x];
      const d = dx * dx + dy * dy;
      if (l !== -1 && d < bestD) {
        bestD = d;
        best = l;
      }
    }
  }
  return best;
}

/** Terapkan aturan default + override pengguna ke setiap area. */
export function decideWhiteRemoval(
  map: WhiteRegionMap,
  keepInnerWhite: boolean,
  overrides: WhiteRegionOverride[] = []
): void {
  for (const r of map.regions) {
    r.removed = r.touchesBorder ? true : !keepInnerWhite;
    r.overridden = false;
  }
  for (const o of overrides) {
    const id = regionAtPoint(map, o.x, o.y);
    if (id < 0) continue;
    const r = map.regions[id];
    r.removed = o.action === 'remove';
    r.overridden = true;
  }
}

/**
 * Bayangan lembut: piksel abu-abu netral (kroma rendah) yang cukup terang dan TERHUBUNG ke
 * background yang dihapus ikut dibuat transparan. `minLight` = kecerahan minimum (0..255).
 */
function extendIntoShadow(
  img: Pixels,
  mask: Uint8Array,
  keptWhite: Uint8Array,
  minLight: number,
  maxChroma = 22
): Uint8Array {
  const { data, width, height } = img;
  const total = width * height;
  const shadow = new Uint8Array(total);
  const queue = new Int32Array(total);
  let tail = 0;

  const isShadowLike = (p: number) => {
    if (mask[p] || keptWhite[p]) return false;
    const i = p * 4;
    if (data[i + 3] < ALPHA_EMPTY) return false;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    return mx - mn <= maxChroma && (r + g + b) / 3 >= minLight;
  };

  for (let p = 0; p < total; p++) {
    if (!mask[p]) continue;
    const x = p % width;
    const y = (p / width) | 0;
    const nbs = [
      x + 1 < width ? p + 1 : -1,
      x > 0 ? p - 1 : -1,
      y + 1 < height ? p + width : -1,
      y > 0 ? p - width : -1,
    ];
    for (const q of nbs) {
      if (q >= 0 && !shadow[q] && isShadowLike(q)) {
        shadow[q] = 1;
        queue[tail++] = q;
      }
    }
  }

  let head = 0;
  while (head < tail) {
    const p = queue[head++];
    const x = p % width;
    const y = (p / width) | 0;
    if (x + 1 < width && !shadow[p + 1] && isShadowLike(p + 1)) {
      shadow[p + 1] = 1;
      queue[tail++] = p + 1;
    }
    if (x > 0 && !shadow[p - 1] && isShadowLike(p - 1)) {
      shadow[p - 1] = 1;
      queue[tail++] = p - 1;
    }
    if (y + 1 < height && !shadow[p + width] && isShadowLike(p + width)) {
      shadow[p + width] = 1;
      queue[tail++] = p + width;
    }
    if (y > 0 && !shadow[p - width] && isShadowLike(p - width)) {
      shadow[p - width] = 1;
      queue[tail++] = p - width;
    }
  }
  return shadow;
}

/**
 * Hitung masker background (mode Putih) lengkap: area putih + override + bayangan.
 * Dipakai oleh pipeline (resolusi kerja) DAN pemilih area di preview (resolusi asli),
 * sehingga yang dilihat pengguna sama dengan yang diproses.
 */
export function computeWhiteBackgroundMask(
  img: Pixels,
  config: Pick<
    VectorizeConfig,
    'whiteTolerance' | 'keepInnerWhite' | 'whiteRegionOverrides' | 'removeShadow' | 'shadowMinLight'
  >
): BackgroundMaskResult {
  const tol = config.whiteTolerance ?? 242;
  const map = labelWhiteRegions(img, tol);
  decideWhiteRemoval(map, config.keepInnerWhite !== false, config.whiteRegionOverrides || []);

  const total = img.width * img.height;
  const mask = new Uint8Array(total);
  const keptWhite = new Uint8Array(total);
  for (let p = 0; p < total; p++) {
    const l = map.labels[p];
    if (l === -1) continue;
    if (map.regions[l].removed) mask[p] = 1;
    else keptWhite[p] = 1;
  }

  let shadowMask: Uint8Array | null = null;
  if (config.removeShadow) {
    shadowMask = extendIntoShadow(img, mask, keptWhite, config.shadowMinLight ?? 170);
    for (let p = 0; p < total; p++) if (shadowMask[p]) mask[p] = 1;
  }

  return { map, mask, shadowMask };
}

/**
 * Defringe tepi: piksel di batas background yang merupakan campuran warna objek + putih
 * (anti-aliasing) di-"unmix". Bila porsi objeknya < 50% → transparan; bila tidak → warnanya
 * dikembalikan ke warna objek sehingga tidak muncul garis/halo putih tipis di hasil vektor.
 */
export function defringeWhiteEdges(
  img: Pixels,
  mask: Uint8Array,
  protect: Uint8Array | null = null,
  passes = 3
): void {
  const { data, width, height } = img;
  const total = width * height;

  for (let pass = 0; pass < passes; pass++) {
    const toClear: number[] = [];
    const toRecolor: Array<[number, number, number, number]> = [];

    for (let p = 0; p < total; p++) {
      if (mask[p] || (protect && protect[p])) continue;
      const i = p * 4;
      if (data[i + 3] < ALPHA_EMPTY) continue;
      const x = p % width;
      const y = (p / width) | 0;
      const nearBg =
        (x + 1 < width && mask[p + 1]) ||
        (x > 0 && mask[p - 1]) ||
        (y + 1 < height && mask[p + width]) ||
        (y > 0 && mask[p - width]);
      if (!nearBg) continue;

      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const dWhite = Math.hypot(255 - r, 255 - g, 255 - b);
      if (dWhite < 6) {
        toClear.push(p);
        continue;
      }

      // Warna objek = rata-rata tetangga (radius 3) yang "lebih jauh dari putih" daripada piksel ini.
      let sr = 0, sg = 0, sb = 0, n = 0;
      for (let dy = -3; dy <= 3; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -3; dx <= 3; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width || (dx === 0 && dy === 0)) continue;
          const q = yy * width + xx;
          if (mask[q]) continue;
          const j = q * 4;
          if (data[j + 3] < ALPHA_EMPTY) continue;
          const dq = Math.hypot(255 - data[j], 255 - data[j + 1], 255 - data[j + 2]);
          if (dq > dWhite * 1.15 + 4) {
            sr += data[j];
            sg += data[j + 1];
            sb += data[j + 2];
            n++;
          }
        }
      }
      if (n === 0) continue; // piksel ini sudah warna "inti" — biarkan

      const fr = sr / n, fg = sg / n, fb = sb / n;
      const wr = 255 - fr, wg = 255 - fg, wb = 255 - fb;
      const denom = wr * wr + wg * wg + wb * wb;
      if (denom < 400) continue; // objek sendiri hampir putih — jangan diubah
      const alpha = ((255 - r) * wr + (255 - g) * wg + (255 - b) * wb) / denom;
      if (alpha < 0.5) {
        toClear.push(p);
      } else if (alpha < 0.97) {
        const a = Math.min(1, alpha);
        const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
        toRecolor.push([
          p,
          clamp(255 - (255 - r) / a),
          clamp(255 - (255 - g) / a),
          clamp(255 - (255 - b) / a),
        ]);
      }
    }

    if (toClear.length === 0 && toRecolor.length === 0) break;
    for (const p of toClear) {
      mask[p] = 1;
      data[p * 4 + 3] = 0;
    }
    for (const [p, r, g, b] of toRecolor) {
      const i = p * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
    }
  }
}

/** Jalankan seluruh proses background putih di tempat (alpha = 0 untuk piksel yang dihapus). */
export function applyWhiteBackgroundRemoval(
  img: Pixels,
  config: VectorizeConfig
): BackgroundMaskResult {
  const result = computeWhiteBackgroundMask(img, config);
  const { data } = img;
  const total = img.width * img.height;
  for (let p = 0; p < total; p++) {
    if (result.mask[p]) data[p * 4 + 3] = 0;
  }
  if (config.defringeWhite !== false) {
    // Putih dalam yang dipertahankan tidak boleh ikut "dibersihkan" oleh defringe.
    const protect = new Uint8Array(total);
    for (let p = 0; p < total; p++) {
      const l = result.map.labels[p];
      if (l !== -1 && !result.map.regions[l].removed) protect[p] = 1;
    }
    defringeWhiteEdges(img, result.mask, protect);
  }
  return result;
}
