/**
 * Deteksi & fitting gradasi warna → gradient vektor asli (SVG linear/radial gradient, EPS shfill).
 *
 * Alur (dijalankan pada gambar kerja SETELAH background dihapus, SEBELUM color snapping):
 *  1. Gambar diperkecil ke resolusi analisis (≤ ~900 px) supaya cepat.
 *  2. Segmentasi "region growing": piksel bertetangga digabung bila beda warnanya kecil (ΔE Lab),
 *     sehingga gradasi halus menyatu menjadi satu area, sedangkan tepi tajam (anti-aliasing antar
 *     bentuk) memisahkan area.
 *  3. Untuk setiap area yang cukup besar dan warnanya bervariasi:
 *       - fit LINEAR  : arah gradasi dari regresi bidang (warna ≈ a + b·x + c·y)
 *       - fit RADIAL  : pusat & elips dari regresi kuadratik (mendukung bayangan/sorotan lonjong)
 *     Profil warna sepanjang gradasi dibagi ke bin lalu disederhanakan menjadi 2–10 stop.
 *  4. Model diterima bila galat (RMSE) ≤ ambang. Bila tidak cocok, area dibiarkan → pipeline biasa
 *     memecahnya menjadi pita warna bertingkat (cadangan otomatis).
 *  5. Masker area diperbesar kembali ke resolusi kerja (bilinear, halus). Area dilubangi di lapisan
 *     warna datar; path gradien (lubang detail ditutup, sedikit diperlebar) diletakkan DI BAWAHNYA.
 */

export type Rgb = [number, number, number];

export interface GradientStop {
  offset: number; // 0..1
  color: Rgb; // 0..255
}

export interface GradientSpec {
  type: 'linear' | 'radial';
  /**
   * Matriks [a b c d e f] yang memetakan ruang gradien satuan ke koordinat piksel kerja.
   * linear : vektor gradien (0,0)→(1,0)
   * radial : lingkaran satuan berpusat di (0,0)
   */
  matrix: [number, number, number, number, number, number];
  stops: GradientStop[];
  rmse: number;
}

export interface GradientRegion {
  spec: GradientSpec;
  /**
   * Masker biner TEPAT area gradien (resolusi kerja, terpotong ke kotak x0,y0,w,h).
   * Piksel ini dilubangi (transparan) di lapisan warna datar.
   */
  mask: Uint8Array;
  /**
   * Masker untuk path gradien: `mask` + lubang tertutup yang berisi piksel opak (teks/detail di
   * atas gradien) + dilatasi 2 px. Path gradien diletakkan DI BAWAH lapisan datar, sehingga
   * detail tetap tampil di atasnya dan tidak ada celah di tepi.
   */
  fillMask: Uint8Array;
  x0: number;
  y0: number;
  w: number;
  h: number;
  meanColor: Rgb;
  area: number;
}

export interface GradientDetectOptions {
  /** Galat rata-rata maksimum (0..255) agar model gradien diterima. Default 9. */
  maxRmse?: number;
  /** Luas minimum area (fraksi dari piksel tidak transparan). Default 0.0015. */
  minAreaFraction?: number;
  /** Sisi terpanjang resolusi analisis. Default 900. */
  analysisMaxDim?: number;
  /** Jumlah area gradien maksimum per gambar. Default 96. */
  maxRegions?: number;
}

export interface GradientDetectResult {
  regions: GradientRegion[];
  /** Jumlah area bervariasi warna yang tidak cocok dengan model (jatuh ke pita warna) */
  fallbackCount: number;
}

type Pixels = { data: Uint8ClampedArray | Uint8Array; width: number; height: number };

const EDGE_T = 7; // ΔE langkah maksimum (gambar ter-blur) agar piksel bukan "tepi"
const JOIN_T = 3.2; // ΔE maksimum antar tetangga (ter-blur) agar digabung
const RAW_JOIN_T = 4.5; // ΔE maksimum antar tetangga (asli) — dua warna datar yang mirip TIDAK boleh menyatu
const MAX_SPLIT_DEPTH = 3; // area gagal di-fit dipecah paling banyak 3 tingkat (≤ 8 sub-area)
const RAW_EDGE_T = 8; // langkah ΔE asli di atas ini = tepi tajam
const OPAQUE = 128;

// ---------------------------------------------------------------------------
// Utilitas warna
// ---------------------------------------------------------------------------

const SRGB_TO_LIN = (() => {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    t[i] = c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92;
  }
  return t;
})();

function labF(t: number): number {
  return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
}

function toLab(r: number, g: number, b: number, out: Float32Array, o: number): void {
  // r,g,b boleh pecahan (hasil blur) → interpolasi tabel
  const lin = (v: number) => {
    const i = Math.max(0, Math.min(254, Math.floor(v)));
    const f = Math.max(0, Math.min(1, v - i));
    return SRGB_TO_LIN[i] * (1 - f) + SRGB_TO_LIN[i + 1] * f;
  };
  const rl = lin(r), gl = lin(g), bl = lin(b);
  const x = (rl * 0.4124 + gl * 0.3576 + bl * 0.1805) / 0.95047;
  const y = rl * 0.2126 + gl * 0.7152 + bl * 0.0722;
  const z = (rl * 0.0193 + gl * 0.1192 + bl * 0.9505) / 1.08883;
  const fx = labF(x), fy = labF(y), fz = labF(z);
  out[o] = 116 * fy - 16;
  out[o + 1] = 500 * (fx - fy);
  out[o + 2] = 200 * (fy - fz);
}

function dLab(lab: Float32Array, p: number, q: number): number {
  const a = p * 3, b = q * 3;
  const d0 = lab[a] - lab[b], d1 = lab[a + 1] - lab[b + 1], d2 = lab[a + 2] - lab[b + 2];
  return Math.sqrt(d0 * d0 + d1 * d1 + d2 * d2);
}

// ---------------------------------------------------------------------------
// Aljabar kecil
// ---------------------------------------------------------------------------

/** Selesaikan A·x = b (A n×n, baris-mayor) dengan eliminasi Gauss + pivot. null bila singular. */
function solve(A: Float64Array, b: Float64Array, n: number): Float64Array | null {
  const M = new Float64Array(n * (n + 1));
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) M[r * (n + 1) + c] = A[r * n + c];
    M[r * (n + 1) + n] = b[r];
  }
  for (let col = 0; col < n; col++) {
    let piv = col;
    let best = Math.abs(M[col * (n + 1) + col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(M[r * (n + 1) + col]);
      if (v > best) {
        best = v;
        piv = r;
      }
    }
    if (best < 1e-10) return null;
    if (piv !== col) {
      for (let c = 0; c <= n; c++) {
        const t = M[col * (n + 1) + c];
        M[col * (n + 1) + c] = M[piv * (n + 1) + c];
        M[piv * (n + 1) + c] = t;
      }
    }
    const d = M[col * (n + 1) + col];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r * (n + 1) + col] / d;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r * (n + 1) + c] -= f * M[col * (n + 1) + c];
    }
  }
  const x = new Float64Array(n);
  for (let r = 0; r < n; r++) x[r] = M[r * (n + 1) + n] / M[r * (n + 1) + r];
  return x;
}

/** Eigenvektor utama matriks kovarians 3×3 (power iteration). */
function principalAxis(cov: number[]): { v: Rgb; lambda: number } {
  let v: Rgb = [0.577, 0.577, 0.577];
  let lambda = 0;
  for (let it = 0; it < 32; it++) {
    const w: Rgb = [
      cov[0] * v[0] + cov[1] * v[1] + cov[2] * v[2],
      cov[3] * v[0] + cov[4] * v[1] + cov[5] * v[2],
      cov[6] * v[0] + cov[7] * v[1] + cov[8] * v[2],
    ];
    const n = Math.hypot(w[0], w[1], w[2]);
    if (n < 1e-12) break;
    lambda = n;
    v = [w[0] / n, w[1] / n, w[2] / n];
  }
  return { v, lambda };
}

// ---------------------------------------------------------------------------
// Profil & stop
// ---------------------------------------------------------------------------

function evalStops(stops: GradientStop[], t: number, out: Float64Array): void {
  if (t <= stops[0].offset) {
    out[0] = stops[0].color[0];
    out[1] = stops[0].color[1];
    out[2] = stops[0].color[2];
    return;
  }
  const last = stops[stops.length - 1];
  if (t >= last.offset) {
    out[0] = last.color[0];
    out[1] = last.color[1];
    out[2] = last.color[2];
    return;
  }
  for (let i = 1; i < stops.length; i++) {
    const s1 = stops[i];
    if (t <= s1.offset) {
      const s0 = stops[i - 1];
      const span = s1.offset - s0.offset || 1;
      const f = (t - s0.offset) / span;
      out[0] = s0.color[0] + (s1.color[0] - s0.color[0]) * f;
      out[1] = s0.color[1] + (s1.color[1] - s0.color[1]) * f;
      out[2] = s0.color[2] + (s1.color[2] - s0.color[2]) * f;
      return;
    }
  }
}

/** Sederhanakan profil (titik offset → warna) menjadi stop dengan Ramer–Douglas–Peucker. */
function simplifyProfile(offs: number[], cols: Rgb[], tol: number): GradientStop[] {
  const keep = new Uint8Array(offs.length);
  keep[0] = 1;
  keep[offs.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, offs.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1;
    let worstD = tol;
    const span = offs[b] - offs[a] || 1;
    for (let i = a + 1; i < b; i++) {
      const f = (offs[i] - offs[a]) / span;
      let d = 0;
      for (let c = 0; c < 3; c++) {
        const pred = cols[a][c] + (cols[b][c] - cols[a][c]) * f;
        d = Math.max(d, Math.abs(cols[i][c] - pred));
      }
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst !== -1) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  const stops: GradientStop[] = [];
  for (let i = 0; i < offs.length; i++) {
    if (keep[i]) {
      stops.push({
        offset: offs[i],
        color: [Math.round(cols[i][0]), Math.round(cols[i][1]), Math.round(cols[i][2])],
      });
    }
  }
  return stops;
}

interface ModelEval {
  spec: GradientSpec;
  rmse: number;
  badFraction: number;
  edgeLike: boolean;
  span: number;
}

/**
 * Bangun profil warna dari offset per piksel, sederhanakan menjadi stop, lalu hitung galat.
 * `offsets` sudah dinormalisasi ke 0..1.
 */
function evaluateModel(
  type: 'linear' | 'radial',
  matrix: GradientSpec['matrix'],
  offsets: Float64Array,
  px: number[],
  colors: Uint8ClampedArray | Uint8Array,
  extentPx: number
): ModelEval {
  const n = px.length;
  const nb = Math.max(8, Math.min(48, Math.round(extentPx / 2)));
  const sum = new Float64Array(nb * 3);
  const cnt = new Float64Array(nb);
  for (let k = 0; k < n; k++) {
    const t = Math.max(0, Math.min(0.999999, offsets[k]));
    const bi = Math.floor(t * nb);
    const i = px[k] * 4;
    sum[bi * 3] += colors[i];
    sum[bi * 3 + 1] += colors[i + 1];
    sum[bi * 3 + 2] += colors[i + 2];
    cnt[bi]++;
  }

  const offs: number[] = [];
  const cols: Rgb[] = [];
  for (let b = 0; b < nb; b++) {
    if (cnt[b] < 2) continue;
    offs.push((b + 0.5) / nb);
    cols.push([sum[b * 3] / cnt[b], sum[b * 3 + 1] / cnt[b], sum[b * 3 + 2] / cnt[b]]);
  }
  if (offs.length < 2) {
    return { spec: { type, matrix, stops: [], rmse: Infinity }, rmse: Infinity, badFraction: 1, edgeLike: true, span: 0 };
  }

  // Haluskan profil sedikit (meredam noise JPEG) tanpa menggeser ujung.
  if (cols.length >= 8) {
    const sm = cols.map((c) => [...c] as Rgb);
    for (let i = 1; i < cols.length - 1; i++) {
      for (let c = 0; c < 3; c++) sm[i][c] = (cols[i - 1][c] + 2 * cols[i][c] + cols[i + 1][c]) / 4;
    }
    for (let i = 0; i < cols.length; i++) cols[i] = sm[i];
  }

  // Ujung profil ditarik ke 0 dan 1.
  offs[0] = 0;
  offs[offs.length - 1] = 1;

  // Deteksi "tepi tersamar": hampir seluruh perubahan warna terjadi dalam satu langkah bin.
  let total = 0;
  let maxStep = 0;
  for (let i = 1; i < cols.length; i++) {
    const d = Math.hypot(cols[i][0] - cols[i - 1][0], cols[i][1] - cols[i - 1][1], cols[i][2] - cols[i - 1][2]);
    total += d;
    if (d > maxStep) maxStep = d;
  }
  let span = 0;
  for (let i = 1; i < cols.length; i++) {
    span = Math.max(span, Math.hypot(cols[i][0] - cols[0][0], cols[i][1] - cols[0][1], cols[i][2] - cols[0][2]));
  }
  // (juga untuk warna gelap yang selisihnya kecil: dua warna datar mirip bukan gradien)
  const edgeLike = total > 8 && maxStep > 0.45 * total;

  let tol = 3.5;
  let stops = simplifyProfile(offs, cols, tol);
  while (stops.length > 10) {
    tol *= 1.4;
    stops = simplifyProfile(offs, cols, tol);
  }

  const pred = new Float64Array(3);
  let se = 0;
  let bad = 0;
  for (let k = 0; k < n; k++) {
    evalStops(stops, offsets[k], pred);
    const i = px[k] * 4;
    const d0 = colors[i] - pred[0], d1 = colors[i + 1] - pred[1], d2 = colors[i + 2] - pred[2];
    const e2 = (d0 * d0 + d1 * d1 + d2 * d2) / 3;
    se += e2;
    if (e2 > 900) bad++; // > 30 per kanal
  }
  const rmse = Math.sqrt(se / n);
  return { spec: { type, matrix, stops, rmse }, rmse, badFraction: bad / n, edgeLike, span };
}

// ---------------------------------------------------------------------------
// Deteksi utama
// ---------------------------------------------------------------------------

interface Analysis {
  data: Uint8ClampedArray; // RGBA resolusi analisis
  w: number;
  h: number;
  f: number; // faktor: 1 px analisis = f px kerja
}

function downsample(img: Pixels, maxDim: number): Analysis {
  const f = Math.max(1, Math.ceil(Math.max(img.width, img.height) / maxDim));
  if (f === 1) {
    return { data: new Uint8ClampedArray(img.data), w: img.width, h: img.height, f: 1 };
  }
  const w = Math.floor(img.width / f);
  const h = Math.floor(img.height / f);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let dy = 0; dy < f; dy++) {
        const row = (y * f + dy) * img.width;
        for (let dx = 0; dx < f; dx++) {
          const i = (row + x * f + dx) * 4;
          const al = img.data[i + 3];
          r += img.data[i] * al;
          g += img.data[i + 1] * al;
          b += img.data[i + 2] * al;
          a += al;
        }
      }
      const o = (y * w + x) * 4;
      if (a > 0) {
        out[o] = r / a;
        out[o + 1] = g / a;
        out[o + 2] = b / a;
      }
      out[o + 3] = a / (f * f);
    }
  }
  return { data: out, w, h, f };
}

function find(parent: Int32Array, x: number): number {
  while (parent[x] !== x) {
    parent[x] = parent[parent[x]];
    x = parent[x];
  }
  return x;
}

export function detectGradientRegions(img: Pixels, opts: GradientDetectOptions = {}): GradientDetectResult {
  const maxRmse = opts.maxRmse ?? 9;
  const minAreaFraction = opts.minAreaFraction ?? 0.0015;
  const maxRegions = opts.maxRegions ?? 96;
  const A = downsample(img, opts.analysisMaxDim ?? 900);
  const { data, w, h, f } = A;
  const total = w * h;

  // --- 1. Blur ringan [1 2 1] (hanya piksel opak) → Lab ---------------------------
  const opaque = new Uint8Array(total);
  let opaqueCount = 0;
  for (let p = 0; p < total; p++) {
    if (data[p * 4 + 3] >= OPAQUE) {
      opaque[p] = 1;
      opaqueCount++;
    }
  }
  if (opaqueCount < 64) return { regions: [], fallbackCount: 0 };

  const tmp = new Float32Array(total * 3);
  const blur = new Float32Array(total * 3);
  const K = [1, 2, 1];
  for (let pass = 0; pass < 2; pass++) {
    const src = pass === 0 ? null : tmp;
    const dst = pass === 0 ? tmp : blur;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (!opaque[p]) continue;
        let r = 0, g = 0, b = 0, ws = 0;
        for (let k = -1; k <= 1; k++) {
          const xx = pass === 0 ? x + k : x;
          const yy = pass === 0 ? y : y + k;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const q = yy * w + xx;
          if (!opaque[q]) continue;
          const wt = K[k + 1];
          if (src) {
            r += src[q * 3] * wt;
            g += src[q * 3 + 1] * wt;
            b += src[q * 3 + 2] * wt;
          } else {
            r += data[q * 4] * wt;
            g += data[q * 4 + 1] * wt;
            b += data[q * 4 + 2] * wt;
          }
          ws += wt;
        }
        dst[p * 3] = r / ws;
        dst[p * 3 + 1] = g / ws;
        dst[p * 3 + 2] = b / ws;
      }
    }
  }
  const lab = new Float32Array(total * 3);
  const rawLab = new Float32Array(total * 3);
  for (let p = 0; p < total; p++) {
    if (!opaque[p]) continue;
    toLab(blur[p * 3], blur[p * 3 + 1], blur[p * 3 + 2], lab, p * 3);
    toLab(data[p * 4], data[p * 4 + 1], data[p * 4 + 2], rawLab, p * 3);
  }

  // --- 2. Tandai piksel tepi & gabungkan tetangga mirip (union-find) ----------------
  const edge = new Uint8Array(total);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (!opaque[p]) continue;
      let mx = 0;
      let touchesEmpty = false;
      const nbs = [x + 1 < w ? p + 1 : -1, x > 0 ? p - 1 : -1, y + 1 < h ? p + w : -1, y > 0 ? p - w : -1];
      for (const q of nbs) {
        if (q < 0) continue;
        if (!opaque[q]) {
          touchesEmpty = true;
          continue;
        }
        const d = dLab(lab, p, q);
        if (d > mx) mx = d;
        if (dLab(rawLab, p, q) > RAW_EDGE_T) mx = Infinity;
      }
      if (mx > EDGE_T || touchesEmpty) edge[p] = 1;
    }
  }

  const parent = new Int32Array(total);
  for (let p = 0; p < total; p++) parent[p] = p;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (!opaque[p] || edge[p]) continue;
      if (x + 1 < w && opaque[p + 1] && !edge[p + 1] && dLab(lab, p, p + 1) < JOIN_T && dLab(rawLab, p, p + 1) < RAW_JOIN_T) {
        const a = find(parent, p), b = find(parent, p + 1);
        if (a !== b) parent[a] = b;
      }
      if (y + 1 < h && opaque[p + w] && !edge[p + w] && dLab(lab, p, p + w) < JOIN_T && dLab(rawLab, p, p + w) < RAW_JOIN_T) {
        const a = find(parent, p), b = find(parent, p + w);
        if (a !== b) parent[a] = b;
      }
    }
  }

  // --- 3. Statistik per komponen -----------------------------------------------------
  const compSize = new Int32Array(total);
  for (let p = 0; p < total; p++) {
    if (opaque[p] && !edge[p]) compSize[find(parent, p)]++;
  }
  const minArea = Math.max(48, Math.round(minAreaFraction * opaqueCount));
  const candIndex = new Int32Array(total).fill(-1);
  const candRoots: number[] = [];
  for (let p = 0; p < total; p++) {
    if (compSize[p] >= minArea && parent[p] === p) {
      candIndex[p] = candRoots.length;
      candRoots.push(p);
    }
  }
  const members: number[][] = candRoots.map(() => []);
  for (let p = 0; p < total; p++) {
    if (!opaque[p] || edge[p]) continue;
    const ci = candIndex[find(parent, p)];
    if (ci >= 0) members[ci].push(p);
  }

  // --- 4. Fitting per kandidat --------------------------------------------------------
  interface Accepted {
    spec: GradientSpec; // dalam koordinat ANALISIS
    pixels: number[];
    mean: Rgb;
  }
  const accepted: Accepted[] = [];
  let fallbackCount = 0;

  // Antrean area: mulai dari komponen hasil segmentasi (terbesar dulu). Area yang gagal di-fit
  // dipecah menjadi sub-area berdasarkan warna lalu di-fit ulang (maks MAX_SPLIT_DEPTH tingkat),
  // sehingga gradasi rumit (mis. muka-muka balok 3D) menjadi beberapa gradien halus, bukan pita warna.
  const queue: Array<{ px: number[]; depth: number }> = members
    .map((m) => ({ px: m, depth: 0 }))
    .sort((a, b) => b.px.length - a.px.length);
  const stamp = new Int32Array(total);
  let stampId = 0;
  const bfs = new Int32Array(total);

  /** Pecah area menjadi 2 kelompok warna (2-means pada proyeksi sumbu utama), lalu komponen terhubung. */
  const splitRegion = (px: number[], sv: Float64Array, depth: number): boolean => {
    if (depth >= MAX_SPLIT_DEPTH || px.length < minArea * 2) return false;
    let thr = 0;
    for (let it = 0; it < 10; it++) {
      let a = 0, na = 0, b = 0, nb = 0;
      for (let k = 0; k < sv.length; k++) {
        if (sv[k] < thr) { a += sv[k]; na++; } else { b += sv[k]; nb++; }
      }
      if (na === 0 || nb === 0) return false;
      const next = (a / na + b / nb) / 2;
      if (Math.abs(next - thr) < 0.25) break;
      thr = next;
    }
    const idA = ++stampId, idB = ++stampId;
    for (let k = 0; k < px.length; k++) stamp[px[k]] = sv[k] < thr ? idA : idB;
    let pushed = 0;
    for (const start of px) {
      const id = stamp[start];
      if (id !== idA && id !== idB) continue; // sudah dikunjungi
      const visited = ++stampId;
      let head = 0, tail = 0;
      bfs[tail++] = start;
      stamp[start] = visited;
      const comp: number[] = [];
      while (head < tail) {
        const p = bfs[head++];
        comp.push(p);
        const x = p % w, y = (p / w) | 0;
        if (x > 0 && stamp[p - 1] === id) { stamp[p - 1] = visited; bfs[tail++] = p - 1; }
        if (x + 1 < w && stamp[p + 1] === id) { stamp[p + 1] = visited; bfs[tail++] = p + 1; }
        if (y > 0 && stamp[p - w] === id) { stamp[p - w] = visited; bfs[tail++] = p - w; }
        if (y + 1 < h && stamp[p + w] === id) { stamp[p + w] = visited; bfs[tail++] = p + w; }
      }
      if (comp.length >= minArea) {
        queue.push({ px: comp, depth: depth + 1 });
        pushed++;
      }
    }
    return pushed > 0;
  };

  while (queue.length > 0) {
    if (accepted.length >= maxRegions) break;
    const { px, depth } = queue.shift()!;
    const n = px.length;

    // Rata-rata & kovarians RGB
    let mr = 0, mg = 0, mb = 0, cx = 0, cy = 0;
    let minX = w, minY = h, maxX = 0, maxY = 0;
    for (const p of px) {
      const i = p * 4;
      mr += data[i];
      mg += data[i + 1];
      mb += data[i + 2];
      const x = p % w, y = (p / w) | 0;
      cx += x;
      cy += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    mr /= n; mg /= n; mb /= n; cx /= n; cy /= n;
    const cov = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (const p of px) {
      const i = p * 4;
      const d = [data[i] - mr, data[i + 1] - mg, data[i + 2] - mb];
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) cov[a * 3 + b] += d[a] * d[b];
    }
    for (let k = 0; k < 9; k++) cov[k] /= n;
    const { v, lambda } = principalAxis(cov);
    if (Math.sqrt(lambda) < 5) continue; // praktis warna datar → biarkan pipeline biasa

    const S = Math.max(4, Math.max(maxX - minX, maxY - minY) / 2);
    // Nilai skalar per piksel = proyeksi warna ke sumbu utama
    const s = new Float64Array(n);
    const U = new Float64Array(n);
    const V = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      const p = px[k];
      const i = p * 4;
      s[k] = (data[i] - mr) * v[0] + (data[i + 1] - mg) * v[1] + (data[i + 2] - mb) * v[2];
      U[k] = ((p % w) - cx) / S;
      V[k] = (((p / w) | 0) - cy) / S;
    }

    const candidates: ModelEval[] = [];

    /** Kandidat linear sepanjang arah (ux,uy); profil multi-stop menangani gradasi tak monoton. */
    const addLinear = (ux: number, uy: number) => {
      const t = new Float64Array(n);
      for (let k = 0; k < n; k++) {
        const p = px[k];
        t[k] = (p % w) * ux + ((p / w) | 0) * uy;
      }
      const sorted = Float64Array.from(t).sort();
      const tmin = sorted[Math.floor(n * 0.01)];
      const tmax = sorted[Math.min(n - 1, Math.floor(n * 0.99))];
      const L = Math.max(1, tmax - tmin);
      const offs = new Float64Array(n);
      for (let k = 0; k < n; k++) offs[k] = (t[k] - tmin) / L;
      // pusat piksel analisis (x+0.5) → matriks: unit (1,0) = vektor sepanjang L
      const p0x = ux * tmin + 0.5, p0y = uy * tmin + 0.5;
      const matrix: GradientSpec['matrix'] = [ux * L, uy * L, -uy * L, ux * L, p0x, p0y];
      candidates.push(evaluateModel('linear', matrix, offs, px, data, L));
    };

    // ---- Linear: s ≈ a + b·u + c·v --------------------------------------------------
    {
      const AtA = new Float64Array(9);
      const Atb = new Float64Array(3);
      for (let k = 0; k < n; k++) {
        const row = [1, U[k], V[k]];
        for (let a = 0; a < 3; a++) {
          Atb[a] += row[a] * s[k];
          for (let b = 0; b < 3; b++) AtA[a * 3 + b] += row[a] * row[b];
        }
      }
      const sol = solve(AtA, Atb, 3);
      if (sol && Math.hypot(sol[1], sol[2]) > 1e-6) {
        const gl = Math.hypot(sol[1], sol[2]);
        addLinear(sol[1] / gl, sol[2] / gl);
      }
    }

    // ---- Radial (elips): s ≈ a + b·u + c·v + d·u² + e·uv + f·v² ---------------------
    {
      const AtA = new Float64Array(36);
      const Atb = new Float64Array(6);
      for (let k = 0; k < n; k++) {
        const u = U[k], vv = V[k];
        const row = [1, u, vv, u * u, u * vv, vv * vv];
        for (let a = 0; a < 6; a++) {
          Atb[a] += row[a] * s[k];
          for (let b = 0; b < 6; b++) AtA[a * 6 + b] += row[a] * row[b];
        }
      }
      const q = solve(AtA, Atb, 6);
      if (q) {
        const H = [2 * q[3], q[4], q[4], 2 * q[5]];
        const det = H[0] * H[3] - H[1] * H[2];
        // Gradasi simetris (mis. kilau logam gelap-terang-gelap): kemiringan rata-rata ≈ 0, jadi arah
        // linear diambil dari kelengkungan terbesar (eigenvektor Hessian dengan |λ| terbesar).
        {
          const tr = H[0] + H[3];
          const disc = Math.sqrt(Math.max(0, (H[0] - H[3]) * (H[0] - H[3]) / 4 + H[1] * H[1]));
          const la = tr / 2 + disc, lb = tr / 2 - disc;
          const lam = Math.abs(la) >= Math.abs(lb) ? la : lb;
          let ex = H[1], ey = lam - H[0];
          if (Math.hypot(ex, ey) < 1e-9) {
            ex = lam - H[3];
            ey = H[1];
          }
          const el = Math.hypot(ex, ey);
          if (el > 1e-9 && Math.abs(lam) > 1e-6) addLinear(ex / el, ey / el);
        }
        if (det > 1e-9) {
          // pusat ekstremum: H·c = -[b c]
          const u0 = (-q[1] * H[3] + q[2] * H[1]) / det;
          const v0 = (-q[2] * H[0] + q[1] * H[2]) / det;
          if (Math.abs(u0) <= 1.6 && Math.abs(v0) <= 1.6) {
            const sign = H[0] + H[3] > 0 ? 1 : -1;
            const a11 = H[0] * sign, a12 = H[1] * sign, a22 = H[3] * sign;
            // eigen 2×2 simetris
            const tr = a11 + a22;
            const disc = Math.sqrt(Math.max(0, (a11 - a22) * (a11 - a22) / 4 + a12 * a12));
            const l1 = tr / 2 + disc;
            const l2 = tr / 2 - disc;
            if (l2 > 1e-9 && l1 / l2 < 400) {
              const theta = Math.abs(a12) < 1e-12 ? (a11 >= a22 ? 0 : Math.PI / 2) : Math.atan2(l1 - a11, a12);
              const c = Math.cos(theta), sn = Math.sin(theta);
              // jari-jari (satuan u,v) untuk t = 1
              const r1 = 1 / Math.sqrt(l1), r2 = 1 / Math.sqrt(l2);
              const tArr = new Float64Array(n);
              for (let k = 0; k < n; k++) {
                const du = U[k] - u0, dv = V[k] - v0;
                const e1 = (du * c + dv * sn) / r1;
                const e2 = (-du * sn + dv * c) / r2;
                tArr[k] = Math.sqrt(e1 * e1 + e2 * e2);
              }
              const sorted = Float64Array.from(tArr).sort();
              const tmax = Math.max(1e-6, sorted[Math.min(n - 1, Math.floor(n * 0.99))]);
              const offs = new Float64Array(n);
              for (let k = 0; k < n; k++) offs[k] = tArr[k] / tmax;
              // matriks: unit → (u,v) = c0 + R·diag(r1,r2)·tmax → px analisis = (cx,cy) + S·(u,v) + 0.5
              const R1 = r1 * tmax * S, R2 = r2 * tmax * S;
              const matrix: GradientSpec['matrix'] = [
                c * R1,
                sn * R1,
                -sn * R2,
                c * R2,
                cx + S * u0 + 0.5,
                cy + S * v0 + 0.5,
              ];
              candidates.push(evaluateModel('radial', matrix, offs, px, data, Math.max(R1, R2)));
            }
          }
        }
      }
    }

    if (candidates.length === 0) {
      if (!splitRegion(px, s, depth)) fallbackCount++;
      continue;
    }
    const score = (c: ModelEval) => c.rmse + (c.edgeLike ? 1e6 : 0);
    const lins = candidates.filter((c) => c.spec.type === 'linear').sort((a, b) => score(a) - score(b));
    const lin = lins[0];
    const rad = candidates.find((c) => c.spec.type === 'radial');
    let best = lin || rad!;
    if (lin && rad && rad.rmse < lin.rmse * 0.85) best = rad;

    if (best.span < 14) continue; // perubahan warna terlalu kecil → anggap datar
    if (best.edgeLike || best.rmse > maxRmse || best.badFraction > 0.05) {
      if (!splitRegion(px, s, depth)) fallbackCount++;
      continue;
    }
    accepted.push({ spec: best.spec, pixels: px, mean: [mr, mg, mb] });
  }

  if (accepted.length === 0) return { regions: [], fallbackCount };
  // Area terbesar paling bawah (urutan path gradien di SVG).
  accepted.sort((a, b) => b.pixels.length - a.pixels.length);

  // --- 5. Klaim piksel tepi (anti-aliasing) ke area gradien terdekat ------------------
  const gLabel = new Int32Array(total).fill(-1);
  accepted.forEach((a, gi) => {
    for (const p of a.pixels) gLabel[p] = gi;
  });
  const predAt = (gi: number, p: number, out: Float64Array) => {
    const m = accepted[gi].spec.matrix;
    const x = (p % w) + 0.5, y = ((p / w) | 0) + 0.5;
    const det = m[0] * m[3] - m[1] * m[2];
    const dx = x - m[4], dy = y - m[5];
    const qx = (m[3] * dx - m[2] * dy) / det;
    const qy = (-m[1] * dx + m[0] * dy) / det;
    const t = accepted[gi].spec.type === 'linear' ? qx : Math.hypot(qx, qy);
    evalStops(accepted[gi].spec.stops, t, out);
  };
  const pred = new Float64Array(3);
  for (let pass = 0; pass < 2; pass++) {
    const claims: Array<[number, number]> = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (!opaque[p] || gLabel[p] !== -1) continue;
        // Hanya piksel tepi atau bagian komponen yang sangat kecil yang boleh diklaim.
        if (!edge[p] && compSize[find(parent, p)] >= 16) continue;
        const i = p * 4;
        let bestG = -1;
        let bestD = Infinity;
        let otherD = Infinity;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const xx = x + dx, yy = y + dy;
            if ((dx === 0 && dy === 0) || xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            const q = yy * w + xx;
            if (!opaque[q]) continue;
            const gq = gLabel[q];
            if (gq >= 0 && Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
              predAt(gq, p, pred);
              const d = Math.hypot(data[i] - pred[0], data[i + 1] - pred[1], data[i + 2] - pred[2]);
              if (d < bestD) {
                bestD = d;
                bestG = gq;
              }
            } else if (gq < 0 && !edge[q]) {
              const j = q * 4;
              const d = Math.hypot(data[i] - data[j], data[i + 1] - data[j + 1], data[i + 2] - data[j + 2]);
              if (d < otherD) otherD = d;
            }
          }
        }
        // Piksel komponen kecil (mis. teks tipis) hanya diklaim bila warnanya memang mirip gradien.
        const limit = edge[p] ? 90 : 35;
        if (bestG >= 0 && bestD <= otherD && bestD < limit) claims.push([p, bestG]);
      }
    }
    if (claims.length === 0) break;
    for (const [p, g] of claims) gLabel[p] = g;
  }

  // --- 6. Masker → resolusi kerja (bilinear + ambang 0.5, dilatasi 1 px) --------------
  const regions: GradientRegion[] = [];
  accepted.forEach((a, gi) => {
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let p = 0; p < total; p++) {
      if (gLabel[p] !== gi) continue;
      const x = p % w, y = (p / w) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (maxX < 0) return;
    const X0 = Math.max(0, (minX - 1) * f);
    const Y0 = Math.max(0, (minY - 1) * f);
    const X1 = Math.min(img.width, (maxX + 2) * f);
    const Y1 = Math.min(img.height, (maxY + 2) * f);
    const MW = X1 - X0, MH = Y1 - Y0;
    const raw = new Uint8Array(MW * MH);
    const sample = (ax: number, ay: number) =>
      ax >= 0 && ay >= 0 && ax < w && ay < h && gLabel[ay * w + ax] === gi ? 1 : 0;
    for (let Y = 0; Y < MH; Y++) {
      const ay = (Y0 + Y + 0.5) / f - 0.5;
      const y0 = Math.floor(ay), fy = ay - y0;
      for (let X = 0; X < MW; X++) {
        const ax = (X0 + X + 0.5) / f - 0.5;
        const x0 = Math.floor(ax), fx = ax - x0;
        const val =
          sample(x0, y0) * (1 - fx) * (1 - fy) +
          sample(x0 + 1, y0) * fx * (1 - fy) +
          sample(x0, y0 + 1) * (1 - fx) * fy +
          sample(x0 + 1, y0 + 1) * fx * fy;
        raw[Y * MW + X] = val >= 0.5 ? 1 : 0;
      }
    }
    const isOpaque = (X: number, Y: number) => img.data[((Y0 + Y) * img.width + X0 + X) * 4 + 3] >= OPAQUE;
    const mask = new Uint8Array(MW * MH);
    let area = 0;
    for (let Y = 0; Y < MH; Y++) {
      for (let X = 0; X < MW; X++) {
        const k = Y * MW + X;
        if (raw[k] && isOpaque(X, Y)) {
          mask[k] = 1;
          area++;
        }
      }
    }
    if (area < 16) return;

    // fillMask: tutup lubang yang berisi piksel opak (detail di atas gradien), lalu dilatasi 2 px.
    const outside = new Uint8Array(MW * MH);
    const queue = new Int32Array(MW * MH);
    let qh = 0, qt = 0;
    const pushOut = (k: number) => {
      if (!outside[k] && !raw[k]) {
        outside[k] = 1;
        queue[qt++] = k;
      }
    };
    for (let X = 0; X < MW; X++) {
      pushOut(X);
      pushOut((MH - 1) * MW + X);
    }
    for (let Y = 0; Y < MH; Y++) {
      pushOut(Y * MW);
      pushOut(Y * MW + MW - 1);
    }
    while (qh < qt) {
      const k = queue[qh++];
      const X = k % MW, Y = (k / MW) | 0;
      if (X > 0) pushOut(k - 1);
      if (X + 1 < MW) pushOut(k + 1);
      if (Y > 0) pushOut(k - MW);
      if (Y + 1 < MH) pushOut(k + MW);
    }
    let fill = new Uint8Array(MW * MH);
    for (let k = 0; k < MW * MH; k++) {
      if (raw[k] || (!outside[k] && isOpaque(k % MW, (k / MW) | 0))) fill[k] = 1;
    }
    for (let it = 0; it < 2; it++) {
      const next = new Uint8Array(fill);
      for (let Y = 0; Y < MH; Y++) {
        for (let X = 0; X < MW; X++) {
          const k = Y * MW + X;
          if (fill[k] || !isOpaque(X, Y)) continue;
          if ((X > 0 && fill[k - 1]) || (X + 1 < MW && fill[k + 1]) || (Y > 0 && fill[k - MW]) || (Y + 1 < MH && fill[k + MW])) {
            next[k] = 1;
          }
        }
      }
      fill = next;
    }

    // Matriks analisis → kerja: p_kerja = f · p_analisis
    const m = a.spec.matrix;
    const spec: GradientSpec = {
      ...a.spec,
      matrix: [m[0] * f, m[1] * f, m[2] * f, m[3] * f, m[4] * f, m[5] * f],
    };
    regions.push({
      spec,
      mask,
      fillMask: fill,
      x0: X0,
      y0: Y0,
      w: MW,
      h: MH,
      meanColor: [Math.round(a.mean[0]), Math.round(a.mean[1]), Math.round(a.mean[2])],
      area,
    });
  });

  return { regions, fallbackCount };
}

/**
 * Lubangi area gradien di gambar kerja (alpha = 0) supaya lapisan warna datar tidak
 * memboroskan palet / memecah gradasi menjadi banyak pita. Path gradien mengisi lubang ini dari bawah.
 */
export function punchGradientRegions(img: Pixels, regions: GradientRegion[]): void {
  for (const r of regions) {
    for (let Y = 0; Y < r.h; Y++) {
      for (let X = 0; X < r.w; X++) {
        if (r.mask[Y * r.w + X]) img.data[((r.y0 + Y) * img.width + r.x0 + X) * 4 + 3] = 0;
      }
    }
  }
}

/** RGBA hitam-putih (hitam = area) untuk di-trace vtracer mode `bw`, dengan bantalan 2 px. */
export function regionMaskToRgba(r: GradientRegion): { rgba: Uint8ClampedArray; width: number; height: number; pad: number } {
  const pad = 2;
  const W = r.w + pad * 2;
  const H = r.h + pad * 2;
  const rgba = new Uint8ClampedArray(W * H * 4).fill(255);
  for (let Y = 0; Y < r.h; Y++) {
    for (let X = 0; X < r.w; X++) {
      if (!r.fillMask[Y * r.w + X]) continue;
      const i = ((Y + pad) * W + X + pad) * 4;
      rgba[i] = 0;
      rgba[i + 1] = 0;
      rgba[i + 2] = 0;
    }
  }
  return { rgba, width: W, height: H, pad };
}
