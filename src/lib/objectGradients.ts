/**
 * Satu objek = satu isian. Setelah color snapping, objek bergradasi (huruf emas, lencana) sering
 * tersusun dari beberapa potongan: sebagian area gradien, sebagian bercak warna datar tempat deteksi
 * gradien gagal — hasilnya tampak "seperti dilukis". Di sini objek dipisahkan menurut TEPI KUAT di
 * gambar asli (tepi lembut di dalam objek tidak memisahkan), lalu warna asli seluruh objek dicocokkan
 * dengan satu gradien linear multi-stop. Bila cocok, semua potongannya diganti satu area gradien; bila
 * warnanya nyaris rata, satu warna datar. Objek yang terbelah garis bevel samar digabung bila satu
 * gradien tetap menjelaskan gabungannya. Objek yang potongan gradiennya juga melebar ke luar objek
 * (pad chip yang berbagi satu gradien) tidak disentuh.
 */
import type { GradientRegion, GradientSpec, GradientStop, Rgb } from './gradientDetect';

type Pixels = { data: Uint8ClampedArray | Uint8Array; width: number; height: number };

export interface ObjectGradientOptions {
  /** Faktor upscale gambar kerja. */
  scale: number;
  /** Galat rata-rata maksimum (0..255) acuan; objek diterima sampai 1,5× nilai ini. */
  maxRmse?: number;
}

/** Langkah warna maksimum antar piksel bertetangga (gambar asli ter-blur) yang masih "satu objek". */
const STEP_T = 12;
/** Rentang warna profil di bawah ini → objek dianggap satu warna datar. */
const FLAT_RANGE = 14;

interface Model {
  stops: GradientStop[];
  mx: number;
  my: number;
  dx: number;
  dy: number;
  tmin: number;
  L: number;
  rmse: number;
  range: number;
}

function evalStops(stops: GradientStop[], t: number, out: number[]) {
  if (t <= stops[0].offset) {
    for (let k = 0; k < 3; k++) out[k] = stops[0].color[k];
    return;
  }
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i].offset) {
      const a = stops[i - 1], b = stops[i];
      const u = (t - a.offset) / Math.max(1e-9, b.offset - a.offset);
      for (let k = 0; k < 3; k++) out[k] = a.color[k] + u * (b.color[k] - a.color[k]);
      return;
    }
  }
  const l = stops[stops.length - 1];
  for (let k = 0; k < 3; k++) out[k] = l.color[k];
}

function predict(spec: GradientSpec, x: number, y: number): number[] {
  const m = spec.matrix;
  const det = m[0] * m[3] - m[1] * m[2];
  const dx = x - m[4], dy = y - m[5];
  const qx = (m[3] * dx - m[2] * dy) / det, qy = (-m[1] * dx + m[0] * dy) / det;
  const out = [0, 0, 0];
  evalStops(spec.stops, spec.type === 'linear' ? qx : Math.hypot(qx, qy), out);
  return out;
}

/** RDP pada kurva warna (indeks = posisi bin) → indeks bin yang dipertahankan. */
function simplifyProfile(cols: number[][], s: number, e: number, tol: number, out: number[]) {
  let worst = -1, wd = 0;
  for (let i = s + 1; i < e; i++) {
    const u = (i - s) / (e - s);
    let d = 0;
    for (let k = 0; k < 3; k++) d = Math.max(d, Math.abs(cols[i][k] - (cols[s][k] + u * (cols[e][k] - cols[s][k]))));
    if (d > wd) {
      wd = d;
      worst = i;
    }
  }
  if (worst >= 0 && wd > tol) {
    simplifyProfile(cols, s, worst, tol, out);
    simplifyProfile(cols, worst, e, tol, out);
  } else out.push(e);
}

export function unifyObjects(
  img: Pixels,
  original: Uint8ClampedArray | Uint8Array,
  regions: GradientRegion[],
  palette: Rgb[],
  opts: ObjectGradientOptions
): GradientRegion[] {
  const W = img.width, H = img.height, N = W * H;
  const maxRmse = opts.maxRmse ?? 9;
  const minArea = Math.round((12 * opts.scale) ** 2);
  const er = Math.max(1, Math.round(opts.scale)); // lebar pita tepi anti-aliasing
  const opaque = (p: number) => original[p * 4 + 3] >= 128;

  // gambar asli ter-blur 3×3 (hanya piksel opak) untuk uji kesinambungan
  const blur = new Float32Array(N * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (!opaque(p)) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = Math.max(0, y - 1); yy <= Math.min(H - 1, y + 1); yy++) {
        for (let xx = Math.max(0, x - 1); xx <= Math.min(W - 1, x + 1); xx++) {
          const q = yy * W + xx;
          if (!opaque(q)) continue;
          r += original[q * 4];
          g += original[q * 4 + 1];
          b += original[q * 4 + 2];
          n++;
        }
      }
      blur[p * 3] = r / n;
      blur[p * 3 + 1] = g / n;
      blur[p * 3 + 2] = b / n;
    }
  }
  const step = (p: number, q: number) =>
    Math.max(Math.abs(blur[p * 3] - blur[q * 3]), Math.abs(blur[p * 3 + 1] - blur[q * 3 + 1]), Math.abs(blur[p * 3 + 2] - blur[q * 3 + 2]));
  const nb4 = (p: number): number[] => {
    const x = p % W, y = (p - x) / W;
    return [x > 0 ? p - 1 : -1, x + 1 < W ? p + 1 : -1, y > 0 ? p - W : -1, y + 1 < H ? p + W : -1];
  };

  // area gradien mana yang melubangi piksel ini (−1 = lapisan datar)
  const regionAt = new Int16Array(N).fill(-1);
  regions.forEach((r, ri) => {
    for (let Y = 0; Y < r.h; Y++) {
      for (let X = 0; X < r.w; X++) if (r.mask[Y * r.w + X]) regionAt[(r.y0 + Y) * W + r.x0 + X] = ri;
    }
  });
  const nearestPalette = (c: number[]): Rgb => {
    let best: Rgb = palette[0] ?? [Math.round(c[0]), Math.round(c[1]), Math.round(c[2])], bd = Infinity;
    for (const p of palette) {
      const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  };

  /** Satu gradien linear multi-stop atas piksel dalam (`inner`); rentang t dari semua piksel. */
  const fit = (inner: number[], all: number[]): Model | null => {
    if (inner.length < 16) return null;
    let mx = 0, my = 0, ml = 0;
    const lum = (p: number) => 0.3 * original[p * 4] + 0.59 * original[p * 4 + 1] + 0.11 * original[p * 4 + 2];
    for (const p of inner) {
      mx += p % W;
      my += (p / W) | 0;
      ml += lum(p);
    }
    mx /= inner.length;
    my /= inner.length;
    ml /= inner.length;
    let sxx = 0, sxy = 0, syy = 0, sxl = 0, syl = 0;
    for (const p of inner) {
      const ux = (p % W) - mx, uy = ((p / W) | 0) - my, dl = lum(p) - ml;
      sxx += ux * ux;
      sxy += ux * uy;
      syy += uy * uy;
      sxl += ux * dl;
      syl += uy * dl;
    }
    const det = sxx * syy - sxy * sxy;
    let gx = 1, gy = 0;
    if (Math.abs(det) > 1e-9) {
      gx = (sxl * syy - syl * sxy) / det;
      gy = (syl * sxx - sxl * sxy) / det;
    }
    const gl = Math.hypot(gx, gy) || 1;
    const dx = gx / gl, dy = gy / gl;
    const tOf = (p: number) => ((p % W) - mx) * dx + (((p / W) | 0) - my) * dy;
    let tmin = Infinity, tmax = -Infinity;
    for (const p of all) {
      const t = tOf(p);
      if (t < tmin) tmin = t;
      if (t > tmax) tmax = t;
    }
    const L = Math.max(1, tmax - tmin);
    const BINS = 16;
    const sum = Array.from({ length: BINS }, () => [0, 0, 0, 0]);
    for (const p of inner) {
      const b = Math.min(BINS - 1, Math.max(0, Math.floor(((tOf(p) - tmin) / L) * BINS)));
      for (let k = 0; k < 3; k++) sum[b][k] += original[p * 4 + k];
      sum[b][3]++;
    }
    const binT: number[] = [], binC: number[][] = [];
    for (let b = 0; b < BINS; b++) {
      if (sum[b][3] < 4) continue;
      binT.push((b + 0.5) / BINS);
      binC.push([sum[b][0] / sum[b][3], sum[b][1] / sum[b][3], sum[b][2] / sum[b][3]]);
    }
    if (binC.length < 2) return null;
    // Gradien harus halus: lompatan besar antar bin bertetangga = dua bidang warna (lampu oranye-putih)
    // atau pita halo di tepi, bukan gradasi.
    const lo = [255, 255, 255], hi = [0, 0, 0];
    let maxStep = 0;
    for (let i = 0; i < binC.length; i++) {
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], binC[i][k]);
        hi[k] = Math.max(hi[k], binC[i][k]);
        if (i > 0) maxStep = Math.max(maxStep, Math.abs(binC[i][k] - binC[i - 1][k]));
      }
    }
    const span = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
    if (maxStep > Math.max(16, 0.45 * span)) return null;
    const keep: number[] = [0];
    simplifyProfile(binC, 0, binC.length - 1, 4, keep);
    const stops: GradientStop[] = keep.map((i) => ({
      offset: i === 0 ? 0 : i === binC.length - 1 ? 1 : binT[i],
      color: binC[i].map((v) => Math.round(v)) as Rgb,
    }));
    const pr = [0, 0, 0];
    let se = 0;
    const errs: number[] = [];
    for (const p of inner) {
      evalStops(stops, (tOf(p) - tmin) / L, pr);
      const e = Math.hypot(original[p * 4] - pr[0], original[p * 4 + 1] - pr[1], original[p * 4 + 2] - pr[2]);
      se += e * e;
      errs.push(e);
    }
    const rmse = Math.sqrt(se / inner.length);
    errs.sort((a, b) => a - b);
    const p95 = errs[Math.floor(errs.length * 0.95)];
    if (rmse > maxRmse * 1.5 || p95 > maxRmse * 3) return null;
    let range = 0;
    for (const st of stops) for (let k = 0; k < 3; k++) range = Math.max(range, Math.abs(st.color[k] - stops[0].color[k]));
    return { stops, mx, my, dx, dy, tmin, L, rmse, range };
  };

  // 1. Objek: banjir 4-arah selama langkah warna kecil.
  const comp = new Int32Array(N).fill(-1);
  const stack = new Int32Array(N);
  interface Obj {
    pix: number[];
    inner: number[];
    parts: number; // jumlah potongan penyusun (warna datar + area gradien)
    touched: Map<number, number>;
    model: Model | null;
  }
  const objs = new Map<number, Obj>();
  let nextId = 0;
  for (let s = 0; s < N; s++) {
    if (comp[s] >= 0 || !opaque(s)) continue;
    const id = nextId++;
    const pix: number[] = [];
    let sp = 0;
    stack[sp++] = s;
    comp[s] = id;
    while (sp > 0) {
      const p = stack[--sp];
      pix.push(p);
      for (const q of nb4(p)) {
        if (q < 0 || comp[q] >= 0 || !opaque(q) || step(p, q) > STEP_T) continue;
        comp[q] = id;
        stack[sp++] = q;
      }
    }
    if (pix.length < minArea / 4 || pix.length > N * 0.03) continue;
    // Potongan penyusun yang berarti (≥ 8% luas): warna datar berbeda + area gradien. Sisa halo tipis
    // di tepi tidak dihitung — objek satu warna dengan pinggiran halo bukan objek "berbercak".
    const flatCount = new Map<number, number>();
    const touched = new Map<number, number>();
    for (const p of pix) {
      const ri = regionAt[p];
      if (ri >= 0) touched.set(ri, (touched.get(ri) || 0) + 1);
      else if (img.data[p * 4 + 3] >= 128) {
        const key = (img.data[p * 4] << 16) | (img.data[p * 4 + 1] << 8) | img.data[p * 4 + 2];
        flatCount.set(key, (flatCount.get(key) || 0) + 1);
      }
    }
    let parts = 0;
    for (const n of flatCount.values()) if (n >= pix.length * 0.08) parts++;
    for (const n of touched.values()) if (n >= pix.length * 0.08) parts++;
    objs.set(id, { pix, inner: [], parts, touched, model: null });
  }
  // bagian dalam (tanpa pita tepi ±er px) — dasar fit & galat
  for (const [id, o] of objs) {
    for (const p of o.pix) {
      const x = p % W, y = (p - x) / W;
      let ok = x >= er && y >= er && x + er < W && y + er < H;
      for (let d = 1; d <= er && ok; d++) {
        if (comp[p - d] !== id || comp[p + d] !== id || comp[p - d * W] !== id || comp[p + d * W] !== id) ok = false;
      }
      if (ok) o.inner.push(p);
    }
    o.model = fit(o.inner, o.pix);
  }

  // 2. Gabung objek bertetangga (terpisah pita ≤ 2·er+2 px) bila satu gradien menjelaskan gabungannya.
  const parent = new Map<number, number>();
  const find = (a: number): number => {
    let r = a;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  {
    const owner = new Int32Array(N).fill(-1);
    const dist = new Uint8Array(N);
    let front: number[] = [];
    for (const [id, o] of objs) {
      if (!o.model) continue;
      for (const p of o.pix) {
        owner[p] = id;
        front.push(p);
      }
    }
    const contact = new Map<string, number>();
    for (let layer = 1; layer <= 2 * er + 2 && front.length; layer++) {
      const next: number[] = [];
      for (const p of front) {
        for (const q of nb4(p)) {
          if (q < 0 || !opaque(q)) continue;
          if (owner[q] < 0 && (comp[q] < 0 || !objs.get(comp[q])?.model)) {
            owner[q] = owner[p];
            dist[q] = layer;
            next.push(q);
          } else if (owner[q] >= 0 && owner[q] !== owner[p]) {
            const a = Math.min(owner[p], owner[q]), b = Math.max(owner[p], owner[q]);
            const key = `${a},${b}`;
            contact.set(key, (contact.get(key) || 0) + 1);
          }
        }
      }
      front = next;
    }
    const pairs = [...contact.entries()].sort((a, b) => b[1] - a[1]);
    for (const [key, cnt] of pairs) {
      if (cnt < 3 * er) continue;
      const [a0, b0] = key.split(',').map(Number);
      const a = find(a0), b = find(b0);
      if (a === b) continue;
      const A = objs.get(a)!, B = objs.get(b)!;
      if (!A.model || !B.model) continue;
      const m = fit(A.inner.concat(B.inner), A.pix.concat(B.pix));
      if (!m) continue;
      parent.set(b, a);
      parent.set(a, a);
      A.pix = A.pix.concat(B.pix);
      A.inner = A.inner.concat(B.inner);
      for (const [ri, n] of B.touched) A.touched.set(ri, (A.touched.get(ri) || 0) + n);
      A.parts += B.parts;
      A.model = m;
      for (const p of B.pix) comp[p] = a;
      objs.delete(b);
    }
  }

  // 3. Terapkan.
  const removed = new Set<number>();
  const claimed = new Uint8Array(N);
  const added: GradientRegion[] = [];
  const pr = [0, 0, 0];
  for (const [id, o] of objs) {
    const m = o.model;
    if (!m || o.pix.length < minArea || o.parts < 2) continue;
    let mixed = false;
    for (const [ri, n] of o.touched) if (removed.has(ri) || n < regions[ri].area * 0.9) mixed = true;
    if (mixed) continue;
    for (const [ri] of o.touched) removed.add(ri);
    const tOf = (x: number, y: number) => ((x - m.mx) * m.dx + (y - m.my) * m.dy - m.tmin) / m.L;

    // Pita anti-aliasing di tepi (tak ikut banjir karena langkah warnanya besar): piksel yang warnanya
    // lebih dekat ke prediksi objek daripada ke warna di luarnya — atau seluruhnya dikelilingi objek
    // (garis bevel di dalam objek gabungan) — ikut objek.
    {
      const inBand = new Set<number>();
      const band: number[] = [];
      let frontier = o.pix;
      for (let layer = 1; layer <= er + 1; layer++) {
        const nextF: number[] = [];
        for (const p of frontier) {
          for (const q of nb4(p)) {
            if (q < 0 || comp[q] === id || inBand.has(q) || !opaque(q)) continue;
            inBand.add(q);
            band.push(q);
            nextF.push(q);
          }
        }
        frontier = nextF;
      }
      const R = 2 * er + 2;
      const add: number[] = [];
      for (const q of band) {
        const x = q % W, y = (q - x) / W;
        let r = 0, g = 0, b = 0, n = 0;
        for (let yy = Math.max(0, y - R); yy <= Math.min(H - 1, y + R); yy++) {
          for (let xx = Math.max(0, x - R); xx <= Math.min(W - 1, x + R); xx++) {
            const v = yy * W + xx;
            if (comp[v] === id || inBand.has(v) || !opaque(v)) continue;
            r += original[v * 4];
            g += original[v * 4 + 1];
            b += original[v * 4 + 2];
            n++;
          }
        }
        if (n === 0) {
          add.push(q);
          continue;
        }
        evalStops(m.stops, tOf(x, y), pr);
        const c0 = original[q * 4], c1 = original[q * 4 + 1], c2 = original[q * 4 + 2];
        if (Math.hypot(c0 - pr[0], c1 - pr[1], c2 - pr[2]) < Math.hypot(c0 - r / n, c1 - g / n, c2 - b / n)) add.push(q);
      }
      for (const q of add) {
        comp[q] = id;
        o.pix.push(q);
      }
    }
    for (const p of o.pix) claimed[p] = 1;

    if (m.range < FLAT_RANGE) {
      // satu warna datar
      const mean = [0, 0, 0];
      for (const p of o.inner) for (let k = 0; k < 3; k++) mean[k] += original[p * 4 + k];
      const c = nearestPalette(mean.map((v) => v / o.inner.length));
      for (const p of o.pix) {
        img.data[p * 4] = c[0];
        img.data[p * 4 + 1] = c[1];
        img.data[p * 4 + 2] = c[2];
        img.data[p * 4 + 3] = 255;
      }
      continue;
    }

    // satu area gradien
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (const p of o.pix) {
      const x = p % W, y = (p / W) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    x0 = Math.max(0, x0 - 2);
    y0 = Math.max(0, y0 - 2);
    x1 = Math.min(W - 1, x1 + 2);
    y1 = Math.min(H - 1, y1 + 2);
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const mask = new Uint8Array(w * h);
    for (const p of o.pix) {
      mask[(((p / W) | 0) - y0) * w + (p % W) - x0] = 1;
      img.data[p * 4 + 3] = 0;
    }
    // fillMask: masker + dilatasi 2 px ke piksel lapisan datar (tertutup lapisan datar di atasnya);
    // gradien lain di sekitarnya sudah menutup bagian bawah objek
    let fill = new Uint8Array(mask);
    for (let it = 0; it < 2; it++) {
      const next = new Uint8Array(fill);
      for (let Y = 0; Y < h; Y++) {
        for (let X = 0; X < w; X++) {
          const k = Y * w + X;
          const q = (y0 + Y) * W + x0 + X;
          if (fill[k] || !opaque(q) || (regionAt[q] >= 0 && !removed.has(regionAt[q]))) continue;
          if ((X > 0 && fill[k - 1]) || (X + 1 < w && fill[k + 1]) || (Y > 0 && fill[k - w]) || (Y + 1 < h && fill[k + w])) next[k] = 1;
        }
      }
      fill = next;
    }
    const px0 = m.mx + m.tmin * m.dx, py0 = m.my + m.tmin * m.dy;
    const mean = [0, 0, 0];
    for (const p of o.inner) for (let k = 0; k < 3; k++) mean[k] += original[p * 4 + k];
    added.push({
      spec: {
        type: 'linear',
        matrix: [m.L * m.dx, m.L * m.dy, -m.L * m.dy, m.L * m.dx, px0 + 0.5, py0 + 0.5],
        stops: m.stops,
        rmse: m.rmse,
      },
      mask,
      fillMask: fill,
      x0,
      y0,
      w,
      h,
      meanColor: mean.map((v) => Math.round(v / o.inner.length)) as Rgb,
      area: o.pix.length,
      fillArea: fill.reduce((a, v) => a + v, 0),
    });
  }
  if (removed.size === 0 && added.length === 0) return regions;

  // sisa area gradien yang dihapus (≤ 10% di luar objek) → kembali ke lapisan datar
  for (const ri of removed) {
    const r = regions[ri];
    for (let Y = 0; Y < r.h; Y++) {
      for (let X = 0; X < r.w; X++) {
        if (!r.mask[Y * r.w + X]) continue;
        const p = (r.y0 + Y) * W + r.x0 + X;
        if (claimed[p]) continue;
        const c = nearestPalette(predict(r.spec, r.x0 + X + 0.5, r.y0 + Y + 0.5));
        img.data[p * 4] = c[0];
        img.data[p * 4 + 1] = c[1];
        img.data[p * 4 + 2] = c[2];
        img.data[p * 4 + 3] = 255;
      }
    }
  }

  const out = regions.filter((_, i) => !removed.has(i)).concat(added);
  // Tumpukan + pengaman: piksel yang dilubangi area A tetapi tertutup path area lain yang lebih atas
  // (dan bukan masker area itu) dikembalikan ke lapisan datar dengan warna prediksi area A.
  out.sort((a, b) => b.fillArea - a.fillArea);
  const top = new Int16Array(N).fill(-1);
  out.forEach((r, ri) => {
    for (let Y = 0; Y < r.h; Y++) {
      for (let X = 0; X < r.w; X++) if (r.fillMask[Y * r.w + X]) top[(r.y0 + Y) * W + r.x0 + X] = ri;
    }
  });
  out.forEach((r, ri) => {
    for (let Y = 0; Y < r.h; Y++) {
      for (let X = 0; X < r.w; X++) {
        const k = Y * r.w + X;
        if (!r.mask[k]) continue;
        const p = (r.y0 + Y) * W + r.x0 + X;
        const t = top[p];
        if (t <= ri) continue;
        const o = out[t];
        if (o.mask[(r.y0 + Y - o.y0) * o.w + (r.x0 + X - o.x0)]) continue;
        r.mask[k] = 0;
        r.area--;
        const c = nearestPalette(predict(r.spec, r.x0 + X + 0.5, r.y0 + Y + 0.5));
        img.data[p * 4] = c[0];
        img.data[p * 4 + 1] = c[1];
        img.data[p * 4 + 2] = c[2];
        img.data[p * 4 + 3] = 255;
      }
    }
  });
  return out;
}
