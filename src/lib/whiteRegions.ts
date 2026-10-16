/**
 * Area putih & background transparan (mode Putih).
 *
 * 1. Semua piksel putih (≥ toleransi) dikelompokkan menjadi AREA terhubung (4-arah).
 *    - Area yang menyentuh tepi gambar  = background luar  → default DIHAPUS.
 *    - Area tertutup di tengah objek   = putih dalam      → default mengikuti `keepInnerWhite`.
 *    - Area tertutup yang sebenarnya background tembus (`seeThrough`, mis. di antara ban truk)
 *      → default DIHAPUS.
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
  /**
   * Area tertutup yang sebenarnya background yang "terlihat tembus" (mis. putih di antara ban truk,
   * tertutup garis jalan tipis di bawahnya) — default dihapus seperti background luar.
   */
  seeThrough: boolean;
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
export function labelWhiteRegions(img: Pixels, tol: number, scale = 1): WhiteRegionMap {
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
      seeThrough: false,
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

  const map = { width, height, labels, regions };
  attachTintedWhite(map, img, tol, scale);
  markSeeThroughRegions(map);
  return map;
}

/**
 * Putih yang tidak murni: goresan/kilau putih tipis di atas warna (garis miring "%" putih di lencana
 * merah, bintang kilau) dan tepi anti-aliasing putih berwarna campuran (mis. 255,215,199) karena JPEG.
 * Komponen piksel terang (di bawah toleransi putih) diterima sebagai putih bila:
 *  - TIPIS: tidak punya bagian dalam yang jauh (> 3 px sumber) dari warna objek di sekitarnya —
 *    bidang pastel (pink muda, krem) punya bagian dalam berwarna sehingga tetap dipertahankan;
 *  - warnanya = campuran putih + warna tepi sekitarnya (porsi putih ≥ 55%, residu kecil).
 * Komponen yang menempel pada area putih digabung ke area itu (keputusan & klik ikut area tersebut);
 * selain itu menjadi area "putih dalam" baru.
 */
function attachTintedWhite(map: WhiteRegionMap, img: Pixels, tol: number, scale: number): void {
  const { width: w, height: h, labels, regions } = map;
  const { data } = img;
  const total = w * h;
  const minC = tol - 45, minAvg = tol - 25;
  const tint = new Uint8Array(total);
  let any = false;
  for (let p = 0; p < total; p++) {
    if (labels[p] !== -1) continue;
    const i = p * 4;
    if (data[i + 3] < ALPHA_EMPTY) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (Math.min(r, g, b) >= minC && r + g + b >= 3 * minAvg) { tint[p] = 1; any = true; }
  }
  if (!any) return;
  // jarak (chamfer 3/4) ke piksel "padat" (bukan putih, bukan terang)
  const INF = 1 << 29;
  const dist = new Int32Array(total);
  for (let p = 0; p < total; p++) dist[p] = labels[p] === -1 && !tint[p] ? 0 : INF;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x;
    let d = dist[p];
    if (d === 0) continue;
    if (x > 0) d = Math.min(d, dist[p - 1] + 3);
    if (y > 0) {
      d = Math.min(d, dist[p - w] + 3);
      if (x > 0) d = Math.min(d, dist[p - w - 1] + 4);
      if (x + 1 < w) d = Math.min(d, dist[p - w + 1] + 4);
    }
    dist[p] = d;
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const p = y * w + x;
    let d = dist[p];
    if (d === 0) continue;
    if (x + 1 < w) d = Math.min(d, dist[p + 1] + 3);
    if (y + 1 < h) {
      d = Math.min(d, dist[p + w] + 3);
      if (x + 1 < w) d = Math.min(d, dist[p + w + 1] + 4);
      if (x > 0) d = Math.min(d, dist[p + w - 1] + 4);
    }
    dist[p] = d;
  }
  const interiorD = Math.round(3 * Math.max(1, scale) * 3); // > 3 px sumber dari warna objek
  const seen = new Uint8Array(total);
  const queue = new Int32Array(total);
  const adj = new Map<number, number>();
  for (let s0 = 0; s0 < total; s0++) {
    if (!tint[s0] || seen[s0]) continue;
    let head = 0, tail = 0;
    queue[tail++] = s0;
    seen[s0] = 1;
    let mr = 0, mg = 0, mb = 0, interior = 0, touches = false;
    let br = 0, bg = 0, bb = 0, bn = 0, bWhite = 0;
    adj.clear();
    while (head < tail) {
      const p = queue[head++];
      const i = p * 4;
      mr += data[i]; mg += data[i + 1]; mb += data[i + 2];
      if (dist[p] > interiorD) interior++;
      const x = p % w, y = (p / w) | 0;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touches = true;
      const nbs = [x > 0 ? p - 1 : -1, x + 1 < w ? p + 1 : -1, y > 0 ? p - w : -1, y + 1 < h ? p + w : -1];
      for (const q of nbs) {
        if (q < 0) continue;
        if (tint[q]) {
          if (!seen[q]) { seen[q] = 1; queue[tail++] = q; }
          continue;
        }
        const l = labels[q];
        if (l !== -1) { bWhite++; adj.set(l, (adj.get(l) ?? 0) + 1); continue; }
        const j = q * 4;
        if (data[j + 3] < ALPHA_EMPTY) continue;
        br += data[j]; bg += data[j + 1]; bb += data[j + 2]; bn++;
      }
    }
    const n = tail;
    if (interior > n * 0.1 || bn < (bn + bWhite) * 0.25 || bn === 0) continue;
    // campuran putih + warna tepi?
    const dr = mr / n - 255, dg = mg / n - 255, db = mb / n - 255;
    const vr = br / bn - 255, vg = bg / bn - 255, vb = bb / bn - 255;
    const vv = vr * vr + vg * vg + vb * vb;
    if (vv < 40 * 40) continue; // tepi sendiri terang → bukan putih di atas warna
    const t = (dr * vr + dg * vg + db * vb) / vv;
    const res = Math.hypot(dr - t * vr, dg - t * vg, db - t * vb);
    if (t < 0 || t > 0.45 || res > 14) continue;
    // terima: gabung ke area putih tetangga terbanyak, atau area baru
    let id = -1, best = 0;
    for (const [l, c] of adj) if (c > best) { best = c; id = l; }
    let info: WhiteRegionInfo;
    if (id >= 0) info = regions[id];
    else {
      id = regions.length;
      info = { id, area: 0, touchesBorder: touches, seeThrough: false, minX: w, minY: h, maxX: 0, maxY: 0, removed: false, overridden: false };
      regions.push(info);
    }
    for (let k = 0; k < n; k++) {
      const p = queue[k];
      labels[p] = id;
      info.area++;
      const x = p % w, y = (p / w) | 0;
      if (x < info.minX) info.minX = x;
      if (x > info.maxX) info.maxX = x;
      if (y < info.minY) info.minY = y;
      if (y > info.maxY) info.maxY = y;
    }
  }
}

/**
 * Tandai area putih tertutup yang sebenarnya background tembus pandang. Cirinya: sebagian tepinya
 * (15–85%) dibatasi penghalang TIPIS (≤ 2% sisi gambar, mis. garis jalan) yang di baliknya langsung
 * background, sisanya dibatasi objek tebal (badan truk, ban), dan areanya besar. Putih milik objek
 * tidak terkena: dikelilingi bagian tebal (cincin putih target, teks putih di kotak merah), seluruhnya
 * oleh garis tipis (balon kata, teks bergaris tepi), atau kecil (huruf putih di pita merah).
 * Putaran berikutnya: celah kecil pada penghalang tipis yang sama (segitiga di antara ban ganda) dan
 * area di balik penghalang tipis dari area tembus (celah sempit antara sasis dan batang diagonal).
 */
function markSeeThroughRegions(map: WhiteRegionMap): void {
  const { width: w, height: h, labels, regions } = map;
  const total = w * h;
  const T = Math.max(4, Math.round(0.02 * Math.max(w, h)));
  const dist = new Int32Array(total);
  const queue = new Int32Array(total);
  const pass = (isSource: (r: WhiteRegionInfo) => boolean, minFrac: number): boolean => {
    dist.fill(1 << 29);
    let qh = 0, qt = 0;
    for (let p = 0; p < total; p++) {
      const l = labels[p];
      if (l >= 0 && isSource(regions[l])) { dist[p] = 0; queue[qt++] = p; }
    }
    if (qt === 0) return false;
    // jarak (jumlah piksel bukan-putih) dari sumber, hanya menembus piksel bukan-putih
    while (qh < qt) {
      const p = queue[qh++];
      const d = dist[p];
      if (d >= T) continue;
      const x = p % w;
      const nbs = [x > 0 ? p - 1 : -1, x + 1 < w ? p + 1 : -1, p >= w ? p - w : -1, p + w < total ? p + w : -1];
      for (const n of nbs) {
        if (n < 0 || labels[n] >= 0 || dist[n] <= d + 1) continue;
        dist[n] = d + 1;
        queue[qt++] = n;
      }
    }
    const boundary = new Int32Array(regions.length);
    const thin = new Int32Array(regions.length);
    for (let p = 0; p < total; p++) {
      const l = labels[p];
      if (l < 0) continue;
      const r = regions[l];
      if (r.touchesBorder || r.seeThrough) continue;
      const x = p % w;
      const nbs = [x > 0 ? p - 1 : -1, x + 1 < w ? p + 1 : -1, p >= w ? p - w : -1, p + w < total ? p + w : -1];
      let isB = false, isT = false;
      for (const n of nbs) {
        if (n < 0 || labels[n] >= 0) continue;
        isB = true;
        if (dist[n] <= T) isT = true;
      }
      if (isB) { boundary[l]++; if (isT) thin[l]++; }
    }
    let found = false;
    const minArea = minFrac * total;
    for (const r of regions) {
      if (r.touchesBorder || r.seeThrough || r.area < minArea || boundary[r.id] === 0) continue;
      const f = thin[r.id] / boundary[r.id];
      if (f >= 0.15 && f <= 0.85) { r.seeThrough = true; found = true; }
    }
    return found;
  };
  const firstIds = new Set<number>();
  if (!pass((r) => r.touchesBorder, 0.005)) return;
  for (const r of regions) if (r.seeThrough) firstIds.add(r.id);
  // Putaran ketiga: celah kecil yang tertutup penghalang tipis YANG SAMA (mis. segitiga putih di antara
  // ban ganda, di atas garis jalan yang sama) ikut ditandai, berapa pun luasnya (≥ 0.01%).
  pass((r) => r.touchesBorder, 1);
  const nbsOf = (p: number) => {
    const x = p % w;
    return [x > 0 ? p - 1 : -1, x + 1 < w ? p + 1 : -1, p >= w ? p - w : -1, p + w < total ? p + w : -1];
  };
  const barrier = new Uint8Array(total);
  let qh = 0, qt = 0;
  for (let p = 0; p < total; p++) {
    if (labels[p] >= 0 || dist[p] > T) continue;
    if (nbsOf(p).some((n) => n >= 0 && labels[n] >= 0 && firstIds.has(labels[n]))) { barrier[p] = 1; queue[qt++] = p; }
  }
  while (qh < qt) {
    const p = queue[qh++];
    for (const n of nbsOf(p)) {
      if (n < 0 || barrier[n] || labels[n] >= 0 || dist[n] > T) continue;
      barrier[n] = 1;
      queue[qt++] = n;
    }
  }
  const boundary = new Int32Array(regions.length);
  const thin = new Int32Array(regions.length);
  const onBarrier = new Int32Array(regions.length);
  for (let p = 0; p < total; p++) {
    const l = labels[p];
    if (l < 0 || regions[l].touchesBorder || regions[l].seeThrough) continue;
    let isB = false, isT = false, isBar = false;
    for (const n of nbsOf(p)) {
      if (n < 0 || labels[n] >= 0) continue;
      isB = true;
      if (dist[n] <= T) isT = true;
      if (barrier[n]) isBar = true;
    }
    if (isB) { boundary[l]++; if (isT) thin[l]++; if (isBar) onBarrier[l]++; }
  }
  for (const r of regions) {
    const b = boundary[r.id];
    if (r.touchesBorder || r.seeThrough || r.area < 0.0001 * total || b === 0) continue;
    const f = thin[r.id] / b;
    if (f >= 0.15 && f <= 0.85 && onBarrier[r.id] >= 0.1 * b) r.seeThrough = true;
  }
  pass((r) => firstIds.has(r.id), 0.0008);
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
    r.removed = r.touchesBorder || r.seeThrough ? true : !keepInnerWhite;
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
  >,
  /** Skala gambar terhadap gambar sumber (pipeline: faktor upscale; preview: 1). */
  scale = 1
): BackgroundMaskResult {
  const tol = config.whiteTolerance ?? 242;
  const map = labelWhiteRegions(img, tol, scale);
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
        // Pakai warna objek di sekitarnya (bukan ekstrapolasi "unmix"), supaya tepi tidak
        // berubah lebih gelap dari objeknya (cincin merah tua di tepi huruf merah).
        toRecolor.push([p, clamp(fr), clamp(fg), clamp(fb)]);
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
  config: VectorizeConfig,
  /** Faktor upscale gambar kerja: pita anti-aliasing ikut melebar, jadi defringe butuh lebih banyak lintasan. */
  upscale = 1
): BackgroundMaskResult {
  const result = computeWhiteBackgroundMask(img, config, upscale);
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
    defringeWhiteEdges(img, result.mask, protect, Math.max(3, Math.round(upscale * 2) + 1));
  }
  return result;
}
