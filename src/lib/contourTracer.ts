/**
 * Tracer "kontur bersama" — pengganti vtracer untuk lapisan warna datar.
 *
 * vtracer menelusuri setiap warna sebagai lapisan terpisah, sehingga batas antara dua warna
 * di-fit dua kali (dari dua sisi) dengan kurva yang sedikit berbeda: tepi bergerigi, celah
 * tipis/tumpang tindih, dan tepi terkunci pada kotak piksel. Di sini gambar (sudah di-snap ke
 * palet) dipecah menjadi area, setiap batas antara DUA area diambil sebagai satu rantai
 * (dari titik temu 3+ area ke titik temu berikutnya), rantai itu dihaluskan dan di-fit kurva
 * Bézier SATU kali, lalu path tiap area disusun dari rantai-rantai tersebut. Kedua sisi batas
 * memakai kurva yang identik → tidak ada celah dan tidak ada tepi ganda.
 *
 * Anti garis rambut: dua bentuk yang berbatasan persis tetap menampilkan garis tipis latar di
 * batasnya saat dirender ber-anti-aliasing. Bentuk yang digambar lebih dulu (lebih bawah)
 * karena itu memakai versi rantai yang digeser `overlap` px ke arah bentuk di atasnya — bagian
 * itu tertutup, jadi tepi yang terlihat tetap kurva bersama.
 */

export interface ContourOptions {
  mode?: 'spline' | 'polygon';
  /** Sisi bintik (px kerja): area < filterSpeckle² dilebur ke tetangga dengan batas terpanjang. */
  filterSpeckle?: number;
  /** Ambang sudut ala potrace (bawaan 1): makin kecil makin banyak sudut tajam. */
  alphaMax?: number;
  /** Faktor upscale gambar kerja — menentukan jendela deteksi sudut, penghalusan, dan toleransi. */
  scale?: number;
  /** Toleransi poligon (px kerja). */
  tolerance?: number;
  /** Perluasan bentuk bawah di bawah bentuk atas (px kerja). */
  overlap?: number;
  /** Bagi pita halo campuran dua warna ke kedua tetangganya (bawaan aktif). */
  dissolveRims?: boolean;
}

interface Cmd {
  /** 0 = garis (x,y), 1 = kubik (x1,y1,x2,y2,x,y) */
  t: 0 | 1;
  c: number[];
}

interface CmdPath {
  sx: number;
  sy: number;
  cmds: Cmd[];
}

interface Seg {
  p: number[]; // x0,y0,x1,y1,x2,y2,x3,y3
  line: boolean;
  hardStart: boolean;
  hardEnd: boolean;
}

interface Chain {
  /** Titik kisi (x,y berselang), tertutup → tanpa pengulangan titik awal. */
  v: number[];
  left: number;
  right: number;
  closed: boolean;
  exact?: CmdPath;
  lower?: CmdPath;
}

const DIR_X = [1, 0, -1, 0];
const MIN_CORNER_TURN = (40 * Math.PI) / 180;
const ARC_TOL = 0.65;
const DIR_Y = [0, 1, 0, -1];

// ───────────────────────────── 1. Area ─────────────────────────────

/**
 * Piksel yang tidak punya tetangga-4 sewarna (hanya tersambung diagonal: "kutil" 1 px di tepi, sisa
 * tangga JPEG) diberi warna tetangga-4 terbanyak (seri → warna terdekat). Tanpa ini setiap piksel
 * seperti itu menjadi titik temu tiga area: tepi bertangga dan lubang rambut di setiap titik temu.
 */
function cleanIsolated(col: Int32Array, w: number, h: number, rgb?: number[]) {
  const dist = (a: number, b: number) => {
    if (a === b) return 0;
    if (!rgb || a < 0 || b < 0) return 1e6;
    const x = rgb[a], y = rgb[b];
    const dr = ((x >> 16) & 255) - ((y >> 16) & 255);
    const dg = ((x >> 8) & 255) - ((y >> 8) & 255);
    const db = (x & 255) - (y & 255);
    return dr * dr + dg * dg + db * db;
  };
  const nb = [0, 0, 0, 0];
  for (let pass = 0; pass < 2; pass++) {
    let changed = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        const c = col[p];
        let k = 0;
        if (x > 0) nb[k++] = col[p - 1];
        if (x + 1 < w) nb[k++] = col[p + 1];
        if (y > 0) nb[k++] = col[p - w];
        if (y + 1 < h) nb[k++] = col[p + w];
        let same = false;
        for (let i = 0; i < k; i++) if (nb[i] === c) same = true;
        if (same || k === 0) continue;
        // Bagian garis diagonal 1 px di atas latar seragam (dua tetangga diagonal sewarna, keempat
        // tetangga-4 sama) dipertahankan; kutil di batas dua warna tidak.
        let uniform = k === 4;
        for (let i = 1; i < k && uniform; i++) if (nb[i] !== nb[0]) uniform = false;
        if (uniform) {
          let diag = 0;
          if (x > 0 && y > 0 && col[p - w - 1] === c) diag++;
          if (x + 1 < w && y > 0 && col[p - w + 1] === c) diag++;
          if (x > 0 && y + 1 < h && col[p + w - 1] === c) diag++;
          if (x + 1 < w && y + 1 < h && col[p + w + 1] === c) diag++;
          if (diag >= 2) continue;
        }
        let best = nb[0], bestN = 0, bestD = Infinity;
        for (let i = 0; i < k; i++) {
          let n = 0;
          for (let j = 0; j < k; j++) if (nb[j] === nb[i]) n++;
          const d = dist(c, nb[i]);
          if (n > bestN || (n === bestN && d < bestD)) {
            best = nb[i];
            bestN = n;
            bestD = d;
          }
        }
        col[p] = best;
        changed++;
      }
    }
    if (!changed) break;
  }
}

/**
 * Indeks warna per piksel (−1 = transparan) → label area padat: 0 = transparan/luar gambar,
 * 1..R = area opak (komponen 8-terhubung satu warna, bintik sudah dilebur, area sewarna yang
 * bersentuhan disatukan).
 */
function buildRegions(
  col: Int32Array,
  w: number,
  h: number,
  minArea: number,
  rgb?: number[]
): { label: Int32Array; regionColor: number[]; regionCount: number } {
  const n = w * h;
  const comp = new Int32Array(n).fill(-1);
  const area: number[] = [];
  const compColor: number[] = [];
  const extent: number[] = []; // sisi terpanjang kotak batas
  const stack = new Int32Array(n);
  let count = 0;
  for (let s = 0; s < n; s++) {
    if (comp[s] !== -1) continue;
    const c = col[s];
    const id = count++;
    let sp = 0;
    stack[sp++] = s;
    comp[s] = id;
    let a = 0;
    let x0 = w, x1 = 0, y0 = h, y1 = 0;
    while (sp > 0) {
      const p = stack[--sp];
      a++;
      const x = p % w;
      const y = (p - x) / w;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if ((dx === 0 && dy === 0) || xx < 0 || xx >= w) continue;
          const q = yy * w + xx;
          if (comp[q] === -1 && col[q] === c) {
            comp[q] = id;
            stack[sp++] = q;
          }
        }
      }
    }
    area.push(a);
    compColor.push(c);
    extent.push(Math.max(x1 - x0, y1 - y0) + 1);
  }

  const parent = new Int32Array(count);
  for (let i = 0; i < count; i++) parent[i] = i;
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };

  // Bintik: urut dari yang terkecil, lebur ke tetangga dengan warna paling mirip (seperti klaster
  // hierarkis vtracer — keping huruf "I" bergradasi menyatu dengan kepingnya, bukan ke latar);
  // kontak terpanjang sebagai penentu bila warna sama/tidak diketahui. Lubang transparan
  // (lubang huruf "D" di atas latar gradien) hanya dilebur bila benar-benar kecil.
  const holeMin = Math.max(4, minArea / 8);
  const colorDist = (a: number, b: number) => {
    if (!rgb || a < 0 || b < 0) return a === b ? 0 : 1e6;
    const x = rgb[a], y = rgb[b];
    const dr = ((x >> 16) & 255) - ((y >> 16) & 255);
    const dg = ((x >> 8) & 255) - ((y >> 8) & 255);
    const db = (x & 255) - (y & 255);
    return Math.sqrt(dr * dr + dg * dg + db * db);
  };
  if (minArea > 1 && count > 1) {
    const small: number[] = [];
    for (let i = 0; i < count; i++) if (area[i] < (compColor[i] < 0 ? holeMin : minArea)) small.push(i);
    if (small.length > 0) {
      const slot = new Int32Array(count).fill(-1);
      small.forEach((r, k) => (slot[r] = k));
      const start = new Int32Array(small.length + 1);
      for (let k = 0; k < small.length; k++) start[k + 1] = start[k] + area[small[k]];
      const fill = start.slice(0, small.length);
      const pix = new Int32Array(start[small.length]);
      for (let p = 0; p < n; p++) {
        const k = slot[comp[p]];
        if (k >= 0) pix[fill[k]++] = p;
      }
      const order = small.map((_, k) => k).sort((a, b) => area[small[a]] - area[small[b]]);
      const contact = new Map<number, number>();
      for (const k of order) {
        const r = small[k];
        const root = find(r);
        if (area[root] >= (compColor[root] < 0 ? holeMin : minArea)) continue;
        contact.clear();
        const addContact = (q: number) => {
          if (q !== root) contact.set(q, (contact.get(q) || 0) + 1);
        };
        for (let j = start[k]; j < start[k + 1]; j++) {
          const p = pix[j];
          const x = p % w;
          const y = (p - x) / w;
          if (x > 0) addContact(find(comp[p - 1]));
          if (x < w - 1) addContact(find(comp[p + 1]));
          if (y > 0) addContact(find(comp[p - w]));
          if (y < h - 1) addContact(find(comp[p + w]));
        }
        let best = -1;
        let bestScore = Infinity;
        let total = 0;
        let opaque = 0;
        for (const [q, cnt] of contact) {
          total += cnt;
          if (compColor[q] >= 0) opaque += cnt;
        }
        // Goresan memanjang yang berdiri sendiri di atas transparan (huruf "I" kecil, garis tipis)
        // bukan bintik.
        if (compColor[root] >= 0 && extent[root] >= 2 * Math.sqrt(minArea) && opaque < total * 0.3) continue;
        for (const [q, cnt] of contact) {
          // jarak warna (0..441) dominan; kontak kecil (< 10%) diberi penalti
          const score = colorDist(compColor[root], compColor[q]) + (cnt < total * 0.1 ? 60 : 0) - cnt / total;
          if (score < bestScore) {
            best = q;
            bestScore = score;
          }
        }
        if (best < 0) continue;
        parent[root] = best;
        area[best] += area[root];
        compColor[root] = compColor[best];
      }
    }
  }

  // Warna akhir per komponen = warna akarnya; area sewarna yang kini bersentuhan disatukan
  // (bila tidak, batas di antara keduanya menjadi tepi sewarna yang tampil sebagai garis rambut).
  const rootColor = (i: number) => compColor[find(i)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const a = find(comp[p]);
      if (x < w - 1) {
        const b = find(comp[p + 1]);
        if (a !== b && rootColor(a) === rootColor(b)) parent[b] = a;
      }
      if (y < h - 1) {
        const a2 = find(comp[p]);
        const b = find(comp[p + w]);
        if (a2 !== b && rootColor(a2) === rootColor(b)) parent[b] = a2;
      }
    }
  }

  const dense = new Int32Array(count).fill(-1);
  const regionColor: number[] = [-1];
  const label = new Int32Array(n);
  for (let p = 0; p < n; p++) {
    const r = find(comp[p]);
    let d = dense[r];
    if (d < 0) {
      const c = compColor[r];
      if (c < 0) d = 0;
      else {
        d = regionColor.length;
        regionColor.push(c);
      }
      dense[r] = d;
    }
    label[p] = d;
  }
  return { label, regionColor, regionCount: regionColor.length };
}

/**
 * Pita halo: area tipis (ketebalan ≈ 2·luas/keliling ≤ maxThick) yang terjepit DUA area opak
 * berbeda warna dan warnanya campuran keduanya (merah tua di antara huruf merah dan latar hitam —
 * sisa penajaman/kompresi JPEG), atau sedikit melewati salah satunya (overshoot: garis hitam pekat di
 * antara abu gelap dan putih). Pikselnya dibagi ke kedua tetangga menurut jarak terdekat, jadi
 * batas jatuh di tengah pita = tepi asli. Garis tipis yang BUKAN campuran (kontur hitam desain,
 * garis kontak di antara dua bidang sewarna) tidak tersentuh.
 */
function dissolveRims(label: Int32Array, w: number, h: number, regionColor: number[], rgb: number[], maxThick: number) {
  const R = regionColor.length;
  const area = new Float64Array(R);
  const perim = new Float64Array(R);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const a = label[p];
      area[a]++;
      if (x + 1 < w && label[p + 1] !== a) {
        perim[a]++;
        perim[label[p + 1]]++;
      }
      if (y + 1 < h && label[p + w] !== a) {
        perim[a]++;
        perim[label[p + w]]++;
      }
    }
  }
  const cand = new Uint8Array(R);
  let any = false;
  for (let r = 1; r < R; r++) {
    if (perim[r] > 0 && (2 * area[r]) / perim[r] <= maxThick) {
      cand[r] = 1;
      any = true;
    }
  }
  if (!any) return;
  const contact: Map<number, number>[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const a = label[p];
      const nb = [x + 1 < w ? label[p + 1] : -1, y + 1 < h ? label[p + w] : -1];
      for (const b of nb) {
        if (b < 0 || b === a) continue;
        if (cand[a]) (contact[a] ??= new Map()).set(b, (contact[a].get(b) || 0) + 1);
        if (cand[b]) (contact[b] ??= new Map()).set(a, (contact[b].get(a) || 0) + 1);
      }
    }
  }
  const ch = (c: number, k: number) => (rgb[c] >> (16 - 8 * k)) & 255;
  const pairOf = new Int32Array(R * 2).fill(-1);
  let found = false;
  for (let r = 1; r < R; r++) {
    const m = contact[r];
    if (!cand[r] || !m) continue;
    let total = 0;
    for (const v of m.values()) total += v;
    const top = [...m.entries()].sort((a, b) => b[1] - a[1]);
    if (top.length < 2) continue;
    const [A, ca] = top[0];
    const [B, cb] = top[1];
    if (A === 0 || B === 0 || ca < total * 0.25 || cb < total * 0.25 || ca + cb < total * 0.8) continue;
    const c = regionColor[r], a = regionColor[A], b = regionColor[B];
    let ab2 = 0, t = 0;
    for (let k = 0; k < 3; k++) {
      const d = ch(b, k) - ch(a, k);
      ab2 += d * d;
      t += (ch(c, k) - ch(a, k)) * d;
    }
    if (ab2 < 40 * 40) continue;
    t /= ab2;
    if (t < 0.1 || t > 0.9) {
      // overshoot penajaman: sedikit melewati warna salah satu tetangga (lebih gelap dari yang gelap)
      let dA = 0, dB = 0;
      for (let k = 0; k < 3; k++) {
        dA += (ch(c, k) - ch(a, k)) ** 2;
        dB += (ch(c, k) - ch(b, k)) ** 2;
      }
      if (t < -0.4 || t > 1.4 || Math.min(dA, dB) > 40 * 40) continue;
    }
    let res = 0;
    for (let k = 0; k < 3; k++) {
      const e = ch(c, k) - (ch(a, k) + t * (ch(b, k) - ch(a, k)));
      res += e * e;
    }
    if (Math.sqrt(res) > Math.max(14, 0.25 * Math.sqrt(ab2))) continue;
    pairOf[r * 2] = A;
    pairOf[r * 2 + 1] = B;
    found = true;
  }
  if (!found) return;

  // BFS serentak dari piksel pita yang menyentuh A atau B; label baru = sumber terdekat.
  const n = w * h;
  const queue = new Int32Array(n);
  let qh = 0, qt = 0;
  const assigned = new Int32Array(n).fill(-1);
  for (let p = 0; p < n; p++) {
    const r = label[p];
    if (pairOf[r * 2] < 0) continue;
    const x = p % w;
    const y = (p - x) / w;
    const A = pairOf[r * 2], B = pairOf[r * 2 + 1];
    const nb = [x > 0 ? p - 1 : -1, x + 1 < w ? p + 1 : -1, y > 0 ? p - w : -1, y + 1 < h ? p + w : -1];
    for (const q of nb) {
      if (q >= 0 && (label[q] === A || label[q] === B)) {
        assigned[p] = label[q];
        queue[qt++] = p;
        break;
      }
    }
  }
  while (qh < qt) {
    const p = queue[qh++];
    const r = label[p];
    const x = p % w;
    const y = (p - x) / w;
    const nb = [x > 0 ? p - 1 : -1, x + 1 < w ? p + 1 : -1, y > 0 ? p - w : -1, y + 1 < h ? p + w : -1];
    for (const q of nb) {
      if (q >= 0 && label[q] === r && assigned[q] < 0) {
        assigned[q] = assigned[p];
        queue[qt++] = q;
      }
    }
  }
  for (let p = 0; p < n; p++) if (assigned[p] >= 0) label[p] = assigned[p];
}

// ───────────────────────────── 2. Graf batas ─────────────────────────────

/**
 * Rantai batas pada kisi titik sudut piksel ((w+1)×(h+1)). Titik temu = titik dengan 3–4 tepi
 * batas; rantai berjalan dari titik temu ke titik temu (atau berputar tertutup), dengan label
 * kiri/kanan tetap sepanjang rantai.
 */
function buildChains(label: Int32Array, w: number, h: number): Chain[] {
  const lab = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : label[y * w + x]);
  // Tepi mendatar (x,y)→(x+1,y): y∈[0,h], x∈[0,w). Tepi tegak (x,y)→(x,y+1): y∈[0,h), x∈[0,w].
  const hB = new Uint8Array((h + 1) * w);
  const vB = new Uint8Array(h * (w + 1));
  for (let y = 0; y <= h; y++) for (let x = 0; x < w; x++) if (lab(x, y - 1) !== lab(x, y)) hB[y * w + x] = 1;
  for (let y = 0; y < h; y++) for (let x = 0; x <= w; x++) if (lab(x - 1, y) !== lab(x, y)) vB[y * (w + 1) + x] = 1;
  const hSeen = new Uint8Array(hB.length);
  const vSeen = new Uint8Array(vB.length);

  // Indeks tepi yang keluar dari (x,y) ke arah d; −1 bila di luar kisi.
  const edgeAt = (x: number, y: number, d: number): number => {
    switch (d) {
      case 0: return x < w ? y * w + x : -1;
      case 2: return x > 0 ? y * w + x - 1 : -1;
      case 1: return y < h ? y * (w + 1) + x : -1;
      default: return y > 0 ? (y - 1) * (w + 1) + x : -1;
    }
  };
  const isB = (x: number, y: number, d: number) => {
    const e = edgeAt(x, y, d);
    return e >= 0 && (d & 1 ? vB[e] : hB[e]) === 1;
  };
  const seen = (x: number, y: number, d: number) => {
    const e = edgeAt(x, y, d);
    return (d & 1 ? vSeen[e] : hSeen[e]) === 1;
  };
  const markSeen = (x: number, y: number, d: number) => {
    const e = edgeAt(x, y, d);
    if (d & 1) vSeen[e] = 1;
    else hSeen[e] = 1;
  };
  const degree = (x: number, y: number) => {
    let k = 0;
    for (let d = 0; d < 4; d++) if (isB(x, y, d)) k++;
    return k;
  };
  // Tepi yang berimpit dengan bingkai gambar.
  const onFrame = (x: number, y: number, d: number) =>
    d & 1 ? x === 0 || x === w : y === 0 || y === h;
  // Simpul rantai: titik temu 3–4 tepi, atau tempat batas naik/turun dari bingkai gambar dan sudut
  // bingkai — supaya bagian yang berimpit dengan bingkai menjadi rantai sendiri (digambar lurus persis).
  const isNode = (x: number, y: number) => {
    const k = degree(x, y);
    if (k !== 2) return k > 0;
    let dirs = 0, frame = 0;
    for (let d = 0; d < 4; d++) {
      if (!isB(x, y, d)) continue;
      dirs |= 1 << d;
      if (onFrame(x, y, d)) frame++;
    }
    if (frame === 0) return false;
    if (frame === 1) return true;
    return dirs !== 0b0101 && dirs !== 0b1010; // dua tepi bingkai tak segaris = sudut bingkai
  };
  // Label kiri/kanan tepi yang ditempuh dari (x,y) ke arah d (sumbu y ke bawah).
  const sides = (x: number, y: number, d: number): [number, number] => {
    switch (d) {
      case 0: return [lab(x, y - 1), lab(x, y)];
      case 2: return [lab(x - 1, y), lab(x - 1, y - 1)];
      case 1: return [lab(x, y), lab(x - 1, y)];
      default: return [lab(x - 1, y - 1), lab(x, y - 1)];
    }
  };

  const chains: Chain[] = [];
  const walk = (sx: number, sy: number, d0: number) => {
    const [left, right] = sides(sx, sy, d0);
    const v: number[] = [sx, sy];
    let x = sx;
    let y = sy;
    let d = d0;
    for (;;) {
      markSeen(x, y, d);
      x += DIR_X[d];
      y += DIR_Y[d];
      if (x === sx && y === sy) {
        const node = isNode(x, y);
        chains.push({ v, left, right, closed: !node });
        if (node) v.push(x, y);
        return;
      }
      v.push(x, y);
      if (isNode(x, y)) break;
      const back = (d + 2) & 3;
      let next = -1;
      for (let k = 0; k < 4; k++) if (k !== back && isB(x, y, k)) next = k;
      d = next;
    }
    chains.push({ v, left, right, closed: false });
  };

  for (let y = 0; y <= h; y++) {
    for (let x = 0; x <= w; x++) {
      if (!isNode(x, y)) continue;
      for (let d = 0; d < 4; d++) if (isB(x, y, d) && !seen(x, y, d)) walk(x, y, d);
    }
  }
  for (let y = 0; y <= h; y++) {
    for (let x = 0; x < w; x++) {
      if (hB[y * w + x] && !hSeen[y * w + x]) walk(x, y, 0);
    }
  }
  return chains;
}

// ───────────────────────────── 3. Fitting kurva ─────────────────────────────

interface FitParams {
  spline: boolean;
  /** Toleransi poligon: jarak maks titik batas ke sisi poligon (px kerja). */
  polyTol: number;
  /** Toleransi primitif geometris (garis, busur, lingkaran/elips) dalam px kerja. */
  primTol: number;
  /** Ambang sudut ala potrace (alphamax): makin kecil makin banyak sudut tajam. */
  alphaMax: number;
  smoothIters: number;
  /** Panjang lengan pemilih titik awal rantai tertutup. */
  arm: number;
  /** Sisi poligon terpanjang yang masih dianggap sudut membulat (chamfer). */
  chamfer: number;
  /** Pelurusan sisi panjang: toleransi & panjang minimum (px kerja). */
  straightTol: number;
  straightLen: number;
}

/** Belokan antara dua lengan lurus di kiri-kanan titik i (rantai tertutup). */
function armTurn(p: Float64Array, m: number, i: number, L: number): number {
  const at = (j: number) => ((j % m) + m) % m;
  const a0 = at(i - 1 - L), a1 = at(i - 1), b0 = at(i + 1), b1 = at(i + 1 + L);
  const ax = p[a1 * 2] - p[a0 * 2];
  const ay = p[a1 * 2 + 1] - p[a0 * 2 + 1];
  const bx = p[b1 * 2] - p[b0 * 2];
  const by = p[b1 * 2 + 1] - p[b0 * 2 + 1];
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  if (la < 1e-9 || lb < 1e-9) return 0;
  return Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb))));
}

function smoothRange(p: Float64Array, s: number, e: number, iters: number) {
  // [1 2 1]/4 pada titik dalam; ujung tetap.
  const len = e - s + 1;
  if (len < 3) return;
  const tmp = new Float64Array(len * 2);
  for (let it = 0; it < iters; it++) {
    for (let i = 1; i < len - 1; i++) {
      const a = (s + i - 1) * 2;
      const b = (s + i) * 2;
      const c = (s + i + 1) * 2;
      tmp[i * 2] = (p[a] + 2 * p[b] + p[c]) / 4;
      tmp[i * 2 + 1] = (p[a + 1] + 2 * p[b + 1] + p[c + 1]) / 4;
    }
    for (let i = 1; i < len - 1; i++) {
      p[(s + i) * 2] = tmp[i * 2];
      p[(s + i) * 2 + 1] = tmp[i * 2 + 1];
    }
  }
}

function norm(x: number, y: number): [number, number] {
  const l = Math.hypot(x, y);
  return l < 1e-12 ? [0, 0] : [x / l, y / l];
}

function bez(b: number[], t: number): [number, number] {
  const mt = 1 - t;
  const b0 = mt * mt * mt;
  const b1 = 3 * mt * mt * t;
  const b2 = 3 * mt * t * t;
  const b3 = t * t * t;
  return [b0 * b[0] + b1 * b[2] + b2 * b[4] + b3 * b[6], b0 * b[1] + b1 * b[3] + b2 * b[5] + b3 * b[7]];
}

/** Fitting kubik Schneider (Graphics Gems, 1990) atas q[first..last], galat dalam px. */
function fitCubic(
  q: Float64Array,
  first: number,
  last: number,
  t1: [number, number],
  t2: [number, number],
  tol: number,
  out: { p: number[]; first: number; last: number }[]
) {
  const P = (i: number): [number, number] => [q[i * 2], q[i * 2 + 1]];
  const [x0, y0] = P(first);
  const [x3, y3] = P(last);
  const segLen = Math.hypot(x3 - x0, y3 - y0);
  if (last - first === 1 || segLen < 1e-9) {
    const d = segLen / 3;
    out.push({ p: [x0, y0, x0 + t1[0] * d, y0 + t1[1] * d, x3 + t2[0] * d, y3 + t2[1] * d, x3, y3], first, last });
    return;
  }
  // parameterisasi panjang tali busur
  const n = last - first + 1;
  let u = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const a = (first + i - 1) * 2;
    const b = (first + i) * 2;
    u[i] = u[i - 1] + Math.hypot(q[b] - q[a], q[b + 1] - q[a + 1]);
  }
  const total = u[n - 1];
  for (let i = 1; i < n; i++) u[i] /= total;

  const gen = (uu: Float64Array): number[] => {
    let c00 = 0, c01 = 0, c11 = 0, X0 = 0, X1 = 0;
    for (let i = 0; i < n; i++) {
      const t = uu[i];
      const mt = 1 - t;
      const B0 = mt * mt * mt, B1 = 3 * mt * mt * t, B2 = 3 * mt * t * t, B3 = t * t * t;
      const a0x = t1[0] * B1, a0y = t1[1] * B1;
      const a1x = t2[0] * B2, a1y = t2[1] * B2;
      c00 += a0x * a0x + a0y * a0y;
      c01 += a0x * a1x + a0y * a1y;
      c11 += a1x * a1x + a1y * a1y;
      const [px, py] = P(first + i);
      const tx = px - (x0 * (B0 + B1) + x3 * (B2 + B3));
      const ty = py - (y0 * (B0 + B1) + y3 * (B2 + B3));
      X0 += a0x * tx + a0y * ty;
      X1 += a1x * tx + a1y * ty;
    }
    const det = c00 * c11 - c01 * c01;
    let al = Math.abs(det) > 1e-12 ? (X0 * c11 - X1 * c01) / det : 0;
    let ar = Math.abs(det) > 1e-12 ? (c00 * X1 - c01 * X0) / det : 0;
    const eps = 1e-6 * segLen;
    if (al < eps || ar < eps || al > segLen * 1.2 || ar > segLen * 1.2) {
      al = ar = segLen / 3;
    }
    return [x0, y0, x0 + t1[0] * al, y0 + t1[1] * al, x3 + t2[0] * ar, y3 + t2[1] * ar, x3, y3];
  };
  const maxErr = (b: number[], uu: Float64Array): [number, number] => {
    let m = 0;
    let at = Math.floor((first + last) / 2);
    for (let i = 1; i < n - 1; i++) {
      const [bx, by] = bez(b, uu[i]);
      const [px, py] = P(first + i);
      const d = (bx - px) * (bx - px) + (by - py) * (by - py);
      if (d > m) {
        m = d;
        at = first + i;
      }
    }
    return [Math.sqrt(m), at];
  };

  let b = gen(u);
  let [err, split] = maxErr(b, u);
  if (err <= tol) {
    out.push({ p: b, first, last });
    return;
  }
  if (err < tol * 4) {
    for (let it = 0; it < 4; it++) {
      const u2 = new Float64Array(n);
      for (let i = 0; i < n; i++) u2[i] = newton(b, P(first + i), u[i]);
      u = u2;
      b = gen(u);
      [err, split] = maxErr(b, u);
      if (err <= tol) {
        out.push({ p: b, first, last });
        return;
      }
    }
  }
  if (split <= first) split = first + 1;
  if (split >= last) split = last - 1;
  const [ax, ay] = P(split - 1);
  const [cx, cy] = P(split + 1);
  const tc = norm(ax - cx, ay - cy);
  fitCubic(q, first, split, t1, tc, tol, out);
  fitCubic(q, split, last, [-tc[0], -tc[1]], t2, tol, out);
}

function newton(b: number[], p: [number, number], u: number): number {
  const [qx, qy] = bez(b, u);
  const mt = 1 - u;
  // turunan pertama & kedua
  const d1x = 3 * (mt * mt * (b[2] - b[0]) + 2 * mt * u * (b[4] - b[2]) + u * u * (b[6] - b[4]));
  const d1y = 3 * (mt * mt * (b[3] - b[1]) + 2 * mt * u * (b[5] - b[3]) + u * u * (b[7] - b[5]));
  const d2x = 6 * (mt * (b[4] - 2 * b[2] + b[0]) + u * (b[6] - 2 * b[4] + b[2]));
  const d2y = 6 * (mt * (b[5] - 2 * b[3] + b[1]) + u * (b[7] - 2 * b[5] + b[3]));
  const num = (qx - p[0]) * d1x + (qy - p[1]) * d1y;
  const den = d1x * d1x + d1y * d1y + (qx - p[0]) * d2x + (qy - p[1]) * d2y;
  if (Math.abs(den) < 1e-12) return u;
  const r = u - num / den;
  return r < 0 ? 0 : r > 1 ? 1 : r;
}

/**
 * Poligon optimal (Selinger, "Potrace: a polygon-based tracing algorithm", 2003 — ditulis ulang):
 * jumlah sisi minimum dengan setiap titik batas berjarak ≤ tol dari sisinya; seri diputus dengan
 * jumlah kuadrat jarak terkecil (dihitung O(1) dari jumlah prefiks).
 */
function optimalPolygon(q: Float64Array, n: number, tol: number): number[] {
  const sx = new Float64Array(n + 1), sy = new Float64Array(n + 1);
  const sxx = new Float64Array(n + 1), sxy = new Float64Array(n + 1), syy = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const x = q[i * 2], y = q[i * 2 + 1];
    sx[i + 1] = sx[i] + x;
    sy[i + 1] = sy[i] + y;
    sxx[i + 1] = sxx[i] + x * x;
    sxy[i + 1] = sxy[i] + x * y;
    syy[i + 1] = syy[i] + y * y;
  }
  const penalty = (i: number, j: number) => {
    const x0 = q[i * 2], y0 = q[i * 2 + 1];
    const [nx, ny] = norm(-(q[j * 2 + 1] - y0), q[j * 2] - x0);
    const c = nx * x0 + ny * y0;
    const k = j - i + 1;
    const X = sx[j + 1] - sx[i], Y = sy[j + 1] - sy[i];
    return (
      nx * nx * (sxx[j + 1] - sxx[i]) +
      2 * nx * ny * (sxy[j + 1] - sxy[i]) +
      ny * ny * (syy[j + 1] - syy[i]) -
      2 * c * (nx * X + ny * Y) +
      k * c * c
    );
  };

  // reach[i]: titik terjauh j sehingga sisi i→j sah (kerucut arah yang menyempit).
  const MAX_LEN = 600;
  const reach = new Int32Array(n);
  for (let i = 0; i < n - 1; i++) {
    let lo = -Infinity, hi = Infinity, base = NaN, maxD = 0;
    let r = i + 1;
    for (let j = i + 1; j < n && j - i <= MAX_LEN; j++) {
      const dx = q[j * 2] - q[i * 2], dy = q[j * 2 + 1] - q[i * 2 + 1];
      const d = Math.hypot(dx, dy);
      if (d <= tol) {
        r = j;
        continue;
      }
      const phi = Math.atan2(dy, dx);
      if (Number.isNaN(base)) base = phi;
      let rel = phi - base;
      if (rel > Math.PI) rel -= 2 * Math.PI;
      else if (rel <= -Math.PI) rel += 2 * Math.PI;
      if (rel < lo || rel > hi || d < maxD - tol) break;
      r = j;
      const delta = Math.asin(tol / d);
      if (rel - delta > lo) lo = rel - delta;
      if (rel + delta < hi) hi = rel + delta;
      if (d > maxD) maxD = d;
    }
    reach[i] = r;
  }

  const cnt = new Int32Array(n).fill(0x3fffffff);
  const pen = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  cnt[0] = 0;
  pen[0] = 0;
  for (let i = 0; i < n - 1; i++) {
    if (prev[i] < 0 && i > 0) continue;
    for (let j = i + 1; j <= reach[i]; j++) {
      const c = cnt[i] + 1;
      if (c > cnt[j]) continue;
      const pj = pen[i] + penalty(i, j);
      if (c < cnt[j] || pj < pen[j]) {
        cnt[j] = c;
        pen[j] = pj;
        prev[j] = i;
      }
    }
  }
  const idx: number[] = [];
  for (let j = n - 1; j >= 0; j = prev[j]) {
    idx.push(j);
    if (j === 0) break;
  }
  return idx.reverse();
}

/**
 * Sisi panjang yang sedikit bergelombang (riak JPEG di tepi lurus) diluruskan: simpul dibuang bila
 * semua titik di antara kedua tetangganya masih ≤ tol dari garis penggantinya DAN garis itu panjang.
 * Detail kecil tidak terpengaruh karena rentangnya pendek.
 */
function straighten(q: Float64Array, idx: number[], tol: number, minLen: number): number[] {
  const out = idx.slice();
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 1; i < out.length - 1; i++) {
      const a = out[i - 1], b = out[i + 1];
      const ax = q[a * 2], ay = q[a * 2 + 1], bx = q[b * 2], by = q[b * 2 + 1];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < minLen) continue;
      // hanya riak (belokan kecil), bukan sudut
      const v = out[i];
      const ux = q[v * 2] - ax, uy = q[v * 2 + 1] - ay, wx = bx - q[v * 2], wy = by - q[v * 2 + 1];
      const cosT = (ux * wx + uy * wy) / (Math.hypot(ux, uy) * Math.hypot(wx, wy) || 1);
      if (cosT < Math.cos((30 * Math.PI) / 180)) continue;
      let ok = true;
      for (let k = a + 1; k < b; k++) {
        const d = Math.abs((bx - ax) * (ay - q[k * 2 + 1]) - (ax - q[k * 2]) * (by - ay)) / len;
        if (d > tol) {
          ok = false;
          break;
        }
      }
      if (ok) {
        const seg = q.subarray(a * 2, b * 2 + 2) as Float64Array;
        const [dx, dy] = norm(bx - ax, by - ay);
        if (bowOf(seg, ax, ay, dx, dy) > Math.max(0.3, 0.3 * tol)) ok = false;
      }
      if (ok) {
        out.splice(i, 1);
        changed = true;
      }
    }
  }
  return out;
}

/** Garis kuadrat terkecil (titik berat + arah utama) atas q[a..b]. */
function fitLine(q: Float64Array, a: number, b: number): [number, number, number, number] {
  let mx = 0, my = 0;
  const k = b - a + 1;
  for (let i = a; i <= b; i++) {
    mx += q[i * 2];
    my += q[i * 2 + 1];
  }
  mx /= k;
  my /= k;
  let xx = 0, xy = 0, yy = 0;
  for (let i = a; i <= b; i++) {
    const dx = q[i * 2] - mx, dy = q[i * 2 + 1] - my;
    xx += dx * dx;
    xy += dx * dy;
    yy += dy * dy;
  }
  const ang = 0.5 * Math.atan2(2 * xy, xx - yy);
  return [mx, my, Math.cos(ang), Math.sin(ang)];
}

/** Rantai kisi → segmen kurva (koordinat px kerja). */
function fitChain(ch: Chain, fp: FitParams, w: number, h: number): Seg[] {
  const vn = ch.v.length / 2;
  if (!ch.closed && vn >= 2) {
    // Rantai di bingkai gambar: lurus persis dari ujung ke ujung.
    const x0 = ch.v[0], y0 = ch.v[1], x1 = ch.v[(vn - 1) * 2], y1 = ch.v[(vn - 1) * 2 + 1];
    let frame = true;
    for (let i = 0; i < vn && frame; i++) {
      const x = ch.v[i * 2], y = ch.v[i * 2 + 1];
      frame = (x0 === x1 && (x0 === 0 || x0 === w) && x === x0) || (y0 === y1 && (y0 === 0 || y0 === h) && y === y0);
    }
    if (frame) return [{ p: [x0, y0, 0, 0, 0, 0, x1, y1], line: true, hardStart: true, hardEnd: true }];
  }
  // Titik tengah tiap tepi (menghapus tangga ganda); ujung rantai terbuka = titik temu kisi.
  let m: number;
  let q: Float64Array;
  if (ch.closed) {
    m = vn;
    const raw = new Float64Array(m * 2);
    for (let i = 0; i < vn; i++) {
      const j = (i + 1) % vn;
      raw[i * 2] = (ch.v[i * 2] + ch.v[j * 2]) / 2;
      raw[i * 2 + 1] = (ch.v[i * 2 + 1] + ch.v[j * 2 + 1]) / 2;
    }
    // Mulai di titik paling "bersudut" agar titik paksa poligon jatuh di sudut, lalu tutup.
    let best = 0, bestT = -1;
    for (let i = 0; i < m; i++) {
      const t = armTurn(raw, m, i, fp.arm);
      if (t > bestT) {
        bestT = t;
        best = i;
      }
    }
    q = new Float64Array((m + 1) * 2);
    for (let i = 0; i <= m; i++) {
      const j = (i + best) % m;
      q[i * 2] = raw[j * 2];
      q[i * 2 + 1] = raw[j * 2 + 1];
    }
    m += 1;
  } else {
    m = vn + 1;
    q = new Float64Array(m * 2);
    q[0] = ch.v[0];
    q[1] = ch.v[1];
    for (let i = 0; i < vn - 1; i++) {
      q[(i + 1) * 2] = (ch.v[i * 2] + ch.v[i * 2 + 2]) / 2;
      q[(i + 1) * 2 + 1] = (ch.v[i * 2 + 1] + ch.v[i * 2 + 3]) / 2;
    }
    q[(m - 1) * 2] = ch.v[(vn - 1) * 2];
    q[(m - 1) * 2 + 1] = ch.v[(vn - 1) * 2 + 1];
  }
  smoothRange(q, 0, m - 1, fp.smoothIters);

  const idx = straighten(q, optimalPolygon(q, m, fp.polyTol), fp.straightTol, fp.straightLen);
  let N = idx.length - 1; // jumlah sisi
  // Simpul poligon digeser ke perpotongan garis kuadrat-terkecil kedua sisi yang mengapitnya
  // (ujung sudut sebenarnya); ujung rantai terbuka tetap.
  const lines: [number, number, number, number][] = [];
  for (let s2 = 0; s2 < N; s2++) lines.push(fitLine(q, idx[s2], idx[s2 + 1]));
  const vx: number[] = [], vy: number[] = [];
  for (let s2 = 0; s2 <= N; s2++) {
    vx.push(q[idx[s2] * 2]);
    vy.push(q[idx[s2] * 2 + 1]);
  }
  const cyc = ch.closed;
  const lim = 0.75;
  for (let s2 = cyc ? 0 : 1; s2 < (cyc ? N : N); s2++) {
    const A = lines[(s2 - 1 + N) % N];
    const B = lines[s2];
    if (!A || !B || N < 2) continue;
    const den = A[2] * B[3] - A[3] * B[2];
    const px = vx[s2], py = vy[s2];
    let nx: number, ny: number;
    if (Math.abs(den) < 0.08) {
      // hampir sejajar → proyeksikan ke garis rata-rata
      const t = (px - B[0]) * B[2] + (py - B[1]) * B[3];
      nx = B[0] + t * B[2];
      ny = B[1] + t * B[3];
    } else {
      const t = ((B[0] - A[0]) * B[3] - (B[1] - A[1]) * B[2]) / den;
      nx = A[0] + t * A[2];
      ny = A[1] + t * A[3];
    }
    if (Math.hypot(nx - px, ny - py) <= lim) {
      vx[s2] = nx;
      vy[s2] = ny;
    }
  }
  if (cyc) {
    vx[N] = vx[0];
    vy[N] = vy[0];
  }
  let vq = idx.slice();
  if (cyc && N >= 3) {
    // Titik awal → simpul yang diapit dua sisi terpanjang (bukan di tengah sudut membulat), supaya
    // pemulihan sudut tidak perlu melintasi titik awal.
    let k0 = 0, best = -1;
    for (let i = 0; i < N; i++) {
      const ip = (i - 1 + N) % N;
      const l = Math.min(Math.hypot(vx[i + 1] - vx[i], vy[i + 1] - vy[i]), Math.hypot(vx[ip + 1] - vx[ip], vy[ip + 1] - vy[ip]));
      if (l > best) {
        best = l;
        k0 = i;
      }
    }
    if (k0 > 0) {
      const period = m - 1;
      const rx: number[] = [], ry: number[] = [], rq: number[] = [];
      for (let j = 0; j < N; j++) {
        const o = (k0 + j) % N;
        rx.push(vx[o]);
        ry.push(vy[o]);
        rq.push(vq[o] + (k0 + j >= N ? period : 0));
      }
      rx.push(rx[0]);
      ry.push(ry[0]);
      rq.push(rq[0] + period);
      vx.splice(0, vx.length, ...rx);
      vy.splice(0, vy.length, ...ry);
      vq = rq;
    }
  }
  if (fp.spline) N = collapseChamfers(vx, vy, vq, cyc, fp.chamfer);

  if (!fp.spline || N < 2) {
    const segs: Seg[] = [];
    for (let s2 = 0; s2 < N; s2++) {
      segs.push({ p: [vx[s2], vy[s2], 0, 0, 0, 0, vx[s2 + 1], vy[s2 + 1]], line: true, hardStart: true, hardEnd: true });
    }
    return segs;
  }
  return fitPrimitives(q, m, vx, vy, vq, cyc, fp);
}

/**
 * Sudut yang membulat karena upscale bikubik muncul sebagai sisi pendek (chamfer) di antara dua sisi
 * panjang dengan total belokan 50°–140°. Sisi itu diganti satu simpul di perpotongan kedua sisi
 * panjang, sehingga sudut tajam huruf/bidang kembali tajam. Ujung goresan (dua sisi sejajar) dan
 * lengkungan (banyak sisi pendek berturut-turut) tidak tersentuh. Mengubah vx/vy; hasil = jumlah sisi.
 */
function collapseChamfers(vx: number[], vy: number[], vq: number[], cyclic: boolean, maxLen: number): number {
  let N = vx.length - 1;
  const len = (i: number) => Math.hypot(vx[i + 1] - vx[i], vy[i + 1] - vy[i]);
  for (let s = 0; s < N; s++) {
    for (let r = 1; r <= 3; r++) {
      // deret sisi s..s+r-1 (pendek) di antara sisi a dan b (panjang); tidak melewati titik awal
      const a = s - 1 >= 0 ? s - 1 : cyclic ? N - 1 : -1;
      const b = s + r;
      if (a < 0 || b >= N || N < r + 3) break;
      let run = 0;
      let short = true;
      for (let k = 0; k < r; k++) {
        const l = len(s + k);
        run += l;
        if (l > maxLen) short = false;
      }
      if (!short || run > maxLen * 1.5) break;
      if (len(a) < 2 * run || len(b) < 2 * run) continue;
      const ax = vx[a + 1] - vx[a], ay = vy[a + 1] - vy[a];
      const bx = vx[b + 1] - vx[b], by = vy[b + 1] - vy[b];
      const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
      const turn = Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb))));
      if (turn < (50 * Math.PI) / 180 || turn > (140 * Math.PI) / 180) continue;
      const den = ax * by - ay * bx;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((vx[b] - vx[a]) * by - (vy[b] - vy[a]) * bx) / den;
      const ix = vx[a] + t * ax, iy = vy[a] + t * ay;
      if (Math.hypot(ix - vx[s], iy - vy[s]) > 1.5 * run + 0.5) continue;
      // simpul s..s+r → satu simpul di perpotongan
      vx.splice(s, r + 1, ix);
      vy.splice(s, r + 1, iy);
      vq.splice(s, r + 1, Math.round((vq[s] + vq[s + r]) / 2));
      N = vx.length - 1;
      if (cyclic && s === 0) {
        vx[N] = vx[0];
        vy[N] = vy[0];
      }
      break;
    }
  }
  return N;
}

// ───────────────────────────── 3b. Primitif geometris ─────────────────────────────

type Prim =
  | { t: 'line'; px: number; py: number; dx: number; dy: number }
  | { t: 'arc'; cx: number; cy: number; r: number; sweep: number; res: number }
  | { t: 'bez' };

/**
 * Lengkungan sistematis titik terhadap garis (px): rata-rata simpangan bertanda sepertiga tengah
 * dikurangi rata-rata sepertiga awal & akhir. Tepi lurus beriak ≈ 0; lengkung landai ≈ ¾ tinggi busur.
 */
function bowOf(pts: Float64Array, px: number, py: number, dx: number, dy: number): number {
  const n = pts.length / 2;
  if (n < 6) return 0;
  const t = Math.floor(n / 3);
  let a = 0, b = 0, c = 0;
  for (let i = 0; i < n; i++) {
    const d = (pts[i * 2] - px) * dy - (pts[i * 2 + 1] - py) * dx;
    if (i < t) a += d;
    else if (i >= n - t) c += d;
    else b += d;
  }
  return Math.abs(b / (n - 2 * t) - (a + c) / (2 * t));
}

/** Garis kuadrat-terkecil; garis yang hampir mendatar/tegak dikunci ke sumbu bila masih muat. */
function linePrim(pts: Float64Array, tol: number): Prim | null {
  const n = pts.length / 2;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) {
    mx += pts[i * 2];
    my += pts[i * 2 + 1];
  }
  mx /= n;
  my /= n;
  let xx = 0, xy = 0, yy = 0;
  for (let i = 0; i < n; i++) {
    const dx = pts[i * 2] - mx, dy = pts[i * 2 + 1] - my;
    xx += dx * dx;
    xy += dx * dy;
    yy += dy * dy;
  }
  const ang = 0.5 * Math.atan2(2 * xy, xx - yy);
  const maxDev = (dx: number, dy: number) => {
    let m = 0;
    for (let i = 0; i < n; i++) {
      const d = Math.abs((pts[i * 2] - mx) * dy - (pts[i * 2 + 1] - my) * dx);
      if (d > m) m = d;
    }
    return m;
  };
  let dx = Math.cos(ang), dy = Math.sin(ang);
  if (maxDev(dx, dy) > tol) return null;
  // melengkung ke satu sisi → bukan garis (biar busur yang mengambil)
  if (bowOf(pts, mx, my, dx, dy) > Math.max(0.3, 0.3 * tol)) return null;
  const q = Math.round(ang / (Math.PI / 2)) * (Math.PI / 2);
  if (Math.abs(ang - q) < (3 * Math.PI) / 180) {
    const sx = Math.round(Math.cos(q)), sy = Math.round(Math.sin(q));
    if (maxDev(sx, sy) <= tol) {
      dx = sx;
      dy = sy;
    }
  }
  return { t: 'line', px: mx, py: my, dx, dy };
}

/** Lingkaran (Kåsa + penyempurnaan geometris) atas titik. */
function fitCircle(pts: Float64Array): [number, number, number] | null {
  const n = pts.length / 2;
  if (n < 3) return null;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) {
    mx += pts[i * 2];
    my += pts[i * 2 + 1];
  }
  mx /= n;
  my /= n;
  let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (let i = 0; i < n; i++) {
    const u = pts[i * 2] - mx, v = pts[i * 2 + 1] - my;
    suu += u * u;
    svv += v * v;
    suv += u * v;
    suuu += u * u * u;
    svvv += v * v * v;
    suvv += u * v * v;
    svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-9) return null;
  const b1 = 0.5 * (suuu + suvv), b2 = 0.5 * (svvv + svuu);
  let cx = (b1 * svv - b2 * suv) / det + mx;
  let cy = (suu * b2 - suv * b1) / det + my;
  let r = 0;
  for (let it = 0; it < 6; it++) {
    r = 0;
    for (let i = 0; i < n; i++) r += Math.hypot(pts[i * 2] - cx, pts[i * 2 + 1] - cy);
    r /= n;
    let gx = 0, gy = 0;
    for (let i = 0; i < n; i++) {
      const dx = pts[i * 2] - cx, dy = pts[i * 2 + 1] - cy;
      const d = Math.hypot(dx, dy) || 1;
      gx += ((d - r) * dx) / d;
      gy += ((d - r) * dy) / d;
    }
    cx += gx / n;
    cy += gy / n;
  }
  return Number.isFinite(r) ? [cx, cy, r] : null;
}

function arcPrim(pts: Float64Array, tol: number, ax: number, ay: number, bx: number, by: number): Prim | null {
  const n = pts.length / 2;
  if (n < 6) return null;
  // cukup melengkung? (kalau tidak, garis lebih tepat)
  const cl = Math.hypot(bx - ax, by - ay);
  let sag = 0;
  for (let i = 0; i < n; i++) {
    const d = cl < 1e-9 ? 0 : Math.abs((bx - ax) * (ay - pts[i * 2 + 1]) - (ax - pts[i * 2]) * (by - ay)) / cl;
    if (d > sag) sag = d;
  }
  if (sag < tol * 0.8) return null;
  const c = fitCircle(pts);
  if (!c) return null;
  const [cx, cy, r] = c;
  if (r < 1 || r > 50 * Math.max(cl, 1)) return null;
  let res = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(Math.hypot(pts[i * 2] - cx, pts[i * 2 + 1] - cy) - r);
    if (d > tol) return null;
    if (d > res) res = d;
  }
  // Lengkungan harus menjelaskan bentuknya: galat jauh lebih kecil dari tinggi busur (kalau tidak,
  // itu garis lurus + sudut yang kebetulan muat busur landai).
  const half = Math.min(r, cl / 2);
  const arcSag = r - Math.sqrt(Math.max(0, r * r - half * half));
  if (res > 0.5 * arcSag && arcSag < 2 * tol) return null;
  for (const [x, y] of [[ax, ay], [bx, by]]) if (Math.abs(Math.hypot(x - cx, y - cy) - r) > tol * 1.5) return null;
  // sapuan sudut (harus searah)
  let sweep = 0;
  let prev = Math.atan2(pts[1] - cy, pts[0] - cx);
  let back = 0;
  for (let i = 1; i < n; i++) {
    const a = Math.atan2(pts[i * 2 + 1] - cy, pts[i * 2] - cx);
    let d = a - prev;
    if (d > Math.PI) d -= 2 * Math.PI;
    else if (d < -Math.PI) d += 2 * Math.PI;
    sweep += d;
    if (d * sweep < 0) back += Math.abs(d);
    prev = a;
  }
  if (Math.abs(sweep) > 1.9 * Math.PI || back > 0.35 + Math.abs(sweep) * 0.15) return null;
  return { t: 'arc', cx, cy, r, sweep, res };
}

/**
 * Elips (Halir & Flusser 1998, kuadrat-terkecil langsung) → [cx, cy, a, b, φ] atau null.
 */
function fitEllipse(pts: Float64Array): [number, number, number, number, number] | null {
  const n = pts.length / 2;
  if (n < 8) return null;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) {
    mx += pts[i * 2];
    my += pts[i * 2 + 1];
  }
  mx /= n;
  my /= n;
  let sc = 0;
  for (let i = 0; i < n; i++) sc += Math.hypot(pts[i * 2] - mx, pts[i * 2 + 1] - my);
  sc = sc / n || 1;
  const S1 = [0, 0, 0, 0, 0, 0, 0, 0, 0], S2 = [0, 0, 0, 0, 0, 0, 0, 0, 0], S3 = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const x = (pts[i * 2] - mx) / sc, y = (pts[i * 2 + 1] - my) / sc;
    const d1 = [x * x, x * y, y * y], d2 = [x, y, 1];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        S1[r * 3 + c] += d1[r] * d1[c];
        S2[r * 3 + c] += d1[r] * d2[c];
        S3[r * 3 + c] += d2[r] * d2[c];
      }
    }
  }
  const inv3 = (M: number[]): number[] | null => {
    const [a, b, c, d, e, f, g, h, k] = M;
    const A = e * k - f * h, B = -(d * k - f * g), C = d * h - e * g;
    const det = a * A + b * B + c * C;
    if (Math.abs(det) < 1e-12) return null;
    return [A / det, -(b * k - c * h) / det, (b * f - c * e) / det, B / det, (a * k - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
  };
  const mul = (A: number[], B: number[]) => {
    const R = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) R[r * 3 + c] += A[r * 3 + k] * B[k * 3 + c];
    return R;
  };
  const tr = (A: number[]) => [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]];
  const S3i = inv3(S3);
  if (!S3i) return null;
  const T = mul(S3i, tr(S2)).map((v) => -v);
  const M0 = S1.map((v, i) => v + mul(S2, T)[i]);
  // M = C1⁻¹ · M0, C1⁻¹ = [[0,0,½],[0,−1,0],[½,0,0]]
  const M = [M0[6] / 2, M0[7] / 2, M0[8] / 2, -M0[3], -M0[4], -M0[5], M0[0] / 2, M0[1] / 2, M0[2] / 2];
  // nilai eigen: akar polinomial karakteristik (kubik)
  const [a, b, c, d, e, f, g, h, k] = M;
  const p2 = -(a + e + k);
  const p1 = a * e + a * k + e * k - b * d - c * g - f * h;
  const p0 = -(a * (e * k - f * h) - b * (d * k - f * g) + c * (d * h - e * g));
  const roots: number[] = [];
  {
    // x³ + p2 x² + p1 x + p0 = 0
    const Q = (3 * p1 - p2 * p2) / 9, R = (9 * p2 * p1 - 27 * p0 - 2 * p2 * p2 * p2) / 54;
    const D = Q * Q * Q + R * R;
    if (D <= 0) {
      const th = Math.acos(Math.max(-1, Math.min(1, R / Math.sqrt(-Q * Q * Q || 1e-30))));
      const sq = 2 * Math.sqrt(-Q);
      for (let j = 0; j < 3; j++) roots.push(sq * Math.cos((th + 2 * Math.PI * j) / 3) - p2 / 3);
    } else {
      const sD = Math.sqrt(D);
      roots.push(Math.cbrt(R + sD) + Math.cbrt(R - sD) - p2 / 3);
    }
  }
  let best: number[] | null = null;
  for (const lam of roots) {
    const r0 = [a - lam, b, c], r1 = [d, e - lam, f], r2 = [g, h, k - lam];
    const cands = [
      [r0[1] * r1[2] - r0[2] * r1[1], r0[2] * r1[0] - r0[0] * r1[2], r0[0] * r1[1] - r0[1] * r1[0]],
      [r0[1] * r2[2] - r0[2] * r2[1], r0[2] * r2[0] - r0[0] * r2[2], r0[0] * r2[1] - r0[1] * r2[0]],
      [r1[1] * r2[2] - r1[2] * r2[1], r1[2] * r2[0] - r1[0] * r2[2], r1[0] * r2[1] - r1[1] * r2[0]],
    ];
    let v = cands[0];
    for (const cv of cands) if (Math.hypot(...cv) > Math.hypot(...v)) v = cv;
    if (4 * v[0] * v[2] - v[1] * v[1] > 0) best = v;
  }
  if (!best) return null;
  const a2 = [T[0] * best[0] + T[1] * best[1] + T[2] * best[2], T[3] * best[0] + T[4] * best[1] + T[5] * best[2], T[6] * best[0] + T[7] * best[1] + T[8] * best[2]];
  const [A, B, C] = best;
  const [D2, E2, F2] = a2;
  const den = B * B - 4 * A * C;
  if (den >= 0) return null;
  const ux = (2 * C * D2 - B * E2) / den, uy = (2 * A * E2 - B * D2) / den;
  const F0 = A * ux * ux + B * ux * uy + C * uy * uy + D2 * ux + E2 * uy + F2;
  const phi = 0.5 * Math.atan2(B, A - C);
  const cs = Math.cos(phi), sn = Math.sin(phi);
  const Ap = A * cs * cs + B * cs * sn + C * sn * sn;
  const Cp = A * sn * sn - B * cs * sn + C * cs * cs;
  if (-F0 / Ap <= 0 || -F0 / Cp <= 0) return null;
  const ra = Math.sqrt(-F0 / Ap) * sc, rb = Math.sqrt(-F0 / Cp) * sc;
  return [ux * sc + mx, uy * sc + my, ra, rb, phi];
}

/** Busur (pusat, jari-jari) dari S ke E dengan sapuan mendekati `sweep` → kubik (≤ 90° per kubik). */
function arcSegs(cx: number, cy: number, r: number, sweep: number, S: [number, number], E: [number, number]): number[][] {
  const t0 = Math.atan2(S[1] - cy, S[0] - cx);
  const t1 = Math.atan2(E[1] - cy, E[0] - cx);
  let d = t1 - t0;
  d -= Math.round((d - sweep) / (2 * Math.PI)) * 2 * Math.PI;
  const k = Math.max(1, Math.ceil(Math.abs(d) / (Math.PI / 2) - 1e-6));
  const out: number[][] = [];
  for (let i = 0; i < k; i++) {
    const a = t0 + (d * i) / k, b = t0 + (d * (i + 1)) / k;
    const h = (4 / 3) * Math.tan((b - a) / 4) * r;
    const p0 = [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    const p3 = [cx + r * Math.cos(b), cy + r * Math.sin(b)];
    out.push([p0[0], p0[1], p0[0] - h * Math.sin(a), p0[1] + h * Math.cos(a), p3[0] + h * Math.sin(b), p3[1] - h * Math.cos(b), p3[0], p3[1]]);
  }
  // ujung persis di S/E (pegangan ikut bergeser → arah singgung tetap)
  const f = out[0], l = out[out.length - 1];
  const dsx = S[0] - f[0], dsy = S[1] - f[1];
  f[0] += dsx; f[1] += dsy; f[2] += dsx; f[3] += dsy;
  const dex = E[0] - l[6], dey = E[1] - l[7];
  l[6] += dex; l[7] += dey; l[4] += dex; l[5] += dey;
  return out;
}

/** Elips penuh (4 kubik) mulai dari sudut parametrik titik `start`, arah `dir` (±1). */
function ellipseSegs(cx: number, cy: number, a: number, b: number, phi: number, sx: number, sy: number, dir: number): number[][] {
  const cs = Math.cos(phi), sn = Math.sin(phi);
  const lx = ((sx - cx) * cs + (sy - cy) * sn) / a, ly = (-(sx - cx) * sn + (sy - cy) * cs) / b;
  const t0 = Math.atan2(ly, lx);
  const P = (t: number) => [cx + a * Math.cos(t) * cs - b * Math.sin(t) * sn, cy + a * Math.cos(t) * sn + b * Math.sin(t) * cs];
  const Dv = (t: number) => [-a * Math.sin(t) * cs - b * Math.cos(t) * sn, -a * Math.sin(t) * sn + b * Math.cos(t) * cs];
  const step = (dir * Math.PI) / 2;
  const h = (4 / 3) * Math.tan(step / 4);
  const out: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const ta = t0 + step * i, tb = ta + step;
    const p0 = P(ta), p3 = P(tb), d0 = Dv(ta), d3 = Dv(tb);
    out.push([p0[0], p0[1], p0[0] + h * d0[0], p0[1] + h * d0[1], p3[0] - h * d3[0], p3[1] - h * d3[1], p3[0], p3[1]]);
  }
  return out;
}

/**
 * Deret garis yang bertemu pada belokan kecil (3°–22°) adalah lengkung yang terpotong-potong (oval
 * jadi bersegi) → diganti satu busur, atau kurva mulus bila bukan lingkaran. Garis yang nyaris
 * segaris (< 3°) digabung menjadi satu garis.
 */
function mergeLineRuns(
  all: { prim: Prim; pts: Float64Array; V0: [number, number]; V1: [number, number]; S: [number, number]; E: [number, number]; hs: boolean; he: boolean; iu: number; iv: number }[],
  tol: number
) {
  const dirOf = (P: (typeof all)[number]): [number, number] => norm(P.E[0] - P.S[0], P.E[1] - P.S[1]);
  const angle = (a: (typeof all)[number], b: (typeof all)[number]) => {
    const u = dirOf(a), v = dirOf(b);
    return Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1])));
  };
  const LO = (3 * Math.PI) / 180, HI = (22 * Math.PI) / 180;
  const concat = (run: (typeof all)[number][]) => {
    let n = 0;
    for (const P of run) n += P.pts.length / 2 - 1;
    const out = new Float64Array((n + 1) * 2);
    let k = 0;
    run.forEach((P, i) => {
      const m = P.pts.length / 2;
      for (let j = i === 0 ? 0 : 1; j < m; j++) {
        out[k * 2] = P.pts[j * 2];
        out[k * 2 + 1] = P.pts[j * 2 + 1];
        k++;
      }
    });
    return out;
  };
  for (let i = 0; i < all.length; i++) {
    if (all[i].prim.t !== 'line') continue;
    let j = i;
    let kinked = false;
    while (j + 1 < all.length && all[j + 1].prim.t === 'line') {
      const a = angle(all[j], all[j + 1]);
      if (a > HI) break;
      if (a >= LO) kinked = true;
      j++;
    }
    // seluruh loop tertutup → titik awal = titik akhir; sisakan satu potongan
    if (j - i + 1 === all.length) j--;
    if (j <= i) continue;
    const run = all.slice(i, j + 1);
    const pts = concat(run);
    const first = run[0], last = run[run.length - 1];
    let prim: Prim | null = null;
    if (!kinked) prim = linePrim(pts, tol * 1.5);
    else {
      prim = arcPrim(pts, ARC_TOL * tol * 1.5, first.S[0], first.S[1], last.E[0], last.E[1]);
      if (!prim) prim = { t: 'bez' };
    }
    if (!prim) continue;
    all.splice(i, run.length, { prim, pts, V0: first.V0, V1: last.V1, S: first.S, E: last.E, hs: false, he: false, iu: first.iu, iv: last.iv });
  }
}

/**
 * Kontur → primitif geometris. Setiap bentang (di antara ujung rantai / belokan sangat tajam) dipecah
 * dengan pemrograman dinamis menjadi jumlah potongan minimum berupa garis lurus atau busur lingkaran
 * (kurva bebas hanya bila tak ada yang muat). Sudut tidak ditentukan di depan: dua potongan yang arah
 * singgungnya berbeda bertemu sebagai sudut tajam (perpotongan), yang searah disambung mulus (titik
 * singgung; busur di antara dua garis = fillet). Rantai tertutup dicoba dulu sebagai lingkaran/elips.
 */
function fitPrimitives(q: Float64Array, m: number, vx: number[], vy: number[], vq: number[], cyc: boolean, fp: FitParams): Seg[] {
  const N = vx.length - 1;
  const tol = fp.primTol;
  const period = m - 1; // rantai tertutup: q[m-1] = q[0]
  const gather = (qa: number, qb: number): Float64Array => {
    const out = new Float64Array((qb - qa + 1) * 2);
    for (let i = qa; i <= qb; i++) {
      const j = cyc ? i % period : i;
      out[(i - qa) * 2] = q[j * 2];
      out[(i - qa) * 2 + 1] = q[j * 2 + 1];
    }
    return out;
  };
  const soft = (ps: number[][]): Seg[] => ps.map((p) => ({ p, line: false, hardStart: false, hardEnd: false }));

  // rantai tertutup yang muat lingkaran / elips → bentuk utuh (titik, cincin, lubang huruf)
  if (cyc) {
    const pts = gather(0, period - 1);
    const n = pts.length / 2;
    let area = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += pts[i * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[i * 2 + 1];
    }
    const dir = area >= 0 ? 1 : -1;
    const c = fitCircle(pts);
    if (c && c[2] >= 1.5) {
      // sumber bergerigi → toleransi seperti garis panjang, tapi relatif terhadap ukuran bentuk
      const lim = Math.min(fp.straightTol, 0.08 * c[2] + 0.4);
      let ok = true;
      for (let i = 0; i < n && ok; i++) if (Math.abs(Math.hypot(pts[i * 2] - c[0], pts[i * 2 + 1] - c[1]) - c[2]) > lim) ok = false;
      if (ok) return soft(ellipseSegs(c[0], c[1], c[2], c[2], 0, pts[0], pts[1], dir));
    }
    const el = fitEllipse(pts);
    if (el && Math.min(el[2], el[3]) >= 1.5 && Math.max(el[2], el[3]) / Math.min(el[2], el[3]) < 15) {
      const [cx, cy, a, b, phi] = el;
      const lim = Math.min(fp.straightTol, 0.08 * Math.min(a, b) + 0.4);
      const cs = Math.cos(phi), sn = Math.sin(phi);
      let ok = true;
      for (let i = 0; i < n && ok; i++) {
        const lx = (pts[i * 2] - cx) * cs + (pts[i * 2 + 1] - cy) * sn;
        const ly = -(pts[i * 2] - cx) * sn + (pts[i * 2 + 1] - cy) * cs;
        const kk = Math.hypot(lx / a, ly / b) || 1;
        if (Math.hypot(lx - lx / kk, ly - ly / kk) > lim) ok = false;
      }
      if (ok) return soft(ellipseSegs(cx, cy, a, b, phi, pts[0], pts[1], dir));
    }
  }

  // simpul dengan indeks tak dibungkus (rantai tertutup: i ≥ N = putaran berikutnya)
  const VX = (i: number) => (cyc ? vx[i % N] : vx[i]);
  const VY = (i: number) => (cyc ? vy[i % N] : vy[i]);
  const VQ = (i: number) => (cyc ? vq[i % N] + Math.floor(i / N) * period : vq[i]);
  const QX = (i: number) => q[(cyc ? VQ(i) % period : VQ(i)) * 2];
  const QY = (i: number) => q[(cyc ? VQ(i) % period : VQ(i)) * 2 + 1];

  // Pemutus paksa: ujung rantai terbuka + belokan poligon ≥ 120°.
  const breaks: number[] = [];
  for (let i = cyc ? 0 : 1; i < N; i++) {
    const ip = (i - 1 + N) % N;
    const inx = cyc ? (i + 1) % N : i + 1;
    const ax = vx[i] - vx[ip], ay = vy[i] - vy[ip], bx = vx[inx] - vx[i], by = vy[inx] - vy[i];
    const turn = Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by) || 1))));
    if (turn >= (120 * Math.PI) / 180) breaks.push(i);
  }
  // simpul tajam (≥ 55°): kurva bebas tidak boleh melintasinya (sudut gerigi tetap tajam)
  const sharp: boolean[] = new Array(N + 1).fill(false);
  for (let i = cyc ? 0 : 1; i < N; i++) {
    const ip = (i - 1 + N) % N;
    const inx = cyc ? (i + 1) % N : i + 1;
    const ax = vx[i] - vx[ip], ay = vy[i] - vy[ip], bx = vx[inx] - vx[i], by = vy[inx] - vy[i];
    const turn = Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by) || 1))));
    sharp[i] = turn >= (55 * Math.PI) / 180;
  }
  const isSharp = (i: number) => sharp[cyc ? i % N : i];
  const spans: number[][] = [];
  if (!cyc) {
    const bs = [0, ...breaks, N];
    for (let k = 0; k + 1 < bs.length; k++) {
      const sp: number[] = [];
      for (let i = bs[k]; i <= bs[k + 1]; i++) sp.push(i);
      spans.push(sp);
    }
  } else if (breaks.length === 0) {
    const sp: number[] = [];
    for (let i = 0; i <= N; i++) sp.push(i);
    spans.push(sp);
  } else {
    for (let k = 0; k < breaks.length; k++) {
      const a = breaks[k];
      const b = k + 1 < breaks.length ? breaks[k + 1] : breaks[0] + N;
      const sp: number[] = [];
      for (let i = a; i <= b; i++) sp.push(i);
      spans.push(sp);
    }
  }

  interface Piece {
    prim: Prim;
    pts: Float64Array;
    V0: [number, number]; // simpul poligon di ujung (posisi sudut bila jadi sudut)
    V1: [number, number];
    S: [number, number];
    E: [number, number];
    hs: boolean;
    he: boolean;
    tS?: [number, number]; // arah singgung bersama di sambungan mulus (untuk kurva bebas)
    tE?: [number, number];
    iu: number; // indeks simpul (tak dibungkus) di awal/akhir potongan
    iv: number;
  }
  const all: Piece[] = [];
  for (const sp of spans) {
    const K = sp.length;
    const cost = new Float64Array(K).fill(Infinity);
    const from = new Int32Array(K).fill(-1);
    const prim: (Prim | null)[] = new Array(K).fill(null);
    cost[0] = 0;
    for (let v = 1; v < K; v++) {
      for (let u = Math.max(0, v - 40); u < v; u++) {
        if (!Number.isFinite(cost[u])) continue;
        const qa = VQ(sp[u]), qb = VQ(sp[v]);
        if (qb <= qa || (cyc && qb - qa >= period)) continue; // satu potongan tak boleh memutari seluruh loop
        const pts = gather(qa, qb);
        // garis panjang boleh memakai toleransi pelurusan (riak JPEG), garis pendek tidak
        const chord = Math.hypot(QX(sp[v]) - QX(sp[u]), QY(sp[v]) - QY(sp[u]));
        let pr: Prim | null = linePrim(pts, chord >= fp.straightLen ? Math.max(tol, fp.straightTol * 0.8) : tol);
        // garis sangat pendek biasanya potongan lengkung → lebih mahal daripada kurva
        let c = chord >= fp.straightLen / 2 ? 1 : 2.2;
        if (!pr) {
          // busur: toleransi lebih ketat (lengkung asli hasil upscale halus); galat besar = mahal
          const tolA = chord >= fp.straightLen ? Math.max(ARC_TOL * tol, 0.55 * fp.straightTol) : ARC_TOL * tol;
          pr = arcPrim(pts, tolA, QX(sp[u]), QY(sp[u]), QX(sp[v]), QY(sp[v]));
          if (pr && pr.t === 'arc') c = 1.05 + pr.res / tolA;
        }
        if (!pr && v - u <= 8) {
          let crossesSharp = false;
          for (let k = u + 1; k < v && !crossesSharp; k++) if (isSharp(sp[k])) crossesSharp = true;
          if (!crossesSharp) {
            pr = { t: 'bez' };
            c = 1 + 1.2 * (v - u); // per sisi poligon lebih mahal dari garis panjang
          }
        }
        if (pr && cost[u] + c < cost[v]) {
          cost[v] = cost[u] + c;
          from[v] = u;
          prim[v] = pr;
        }
      }
    }
    const pieces: Piece[] = [];
    for (let v = K - 1; v > 0; v = from[v]) {
      const u = from[v];
      if (u < 0) break;
      pieces.push({
        prim: prim[v]!,
        pts: gather(VQ(sp[u]), VQ(sp[v])),
        V0: [VX(sp[u]), VY(sp[u])],
        V1: [VX(sp[v]), VY(sp[v])],
        S: [QX(sp[u]), QY(sp[u])],
        E: [QX(sp[v]), QY(sp[v])],
        hs: false,
        he: false,
        iu: sp[u],
        iv: sp[v],
      });
    }
    pieces.reverse();
    all.push(...pieces);
  }
  if (all.length === 0) return [];
  mergeLineRuns(all, tol);

  type LineP = Extract<Prim, { t: 'line' }>;
  type ArcP = Extract<Prim, { t: 'arc' }>;
  const projLine = (pr: LineP, x: number, y: number): [number, number] => {
    const t = (x - pr.px) * pr.dx + (y - pr.py) * pr.dy;
    return [pr.px + t * pr.dx, pr.py + t * pr.dy];
  };
  const onCircle = (pr: ArcP, x: number, y: number): [number, number] => {
    const [ux, uy] = norm(x - pr.cx, y - pr.cy);
    return [pr.cx + pr.r * ux, pr.cy + pr.r * uy];
  };
  const lineX = (A: LineP, B: LineP): [number, number] | null => {
    const den = A.dx * B.dy - A.dy * B.dx;
    if (Math.abs(den) < 0.02) return null;
    const t = ((B.px - A.px) * B.dy - (B.py - A.py) * B.dx) / den;
    return [A.px + t * A.dx, A.py + t * A.dy];
  };
  const lineCircleX = (L: LineP, C: ArcP, V: [number, number]): [number, number] | null => {
    const fx = L.px - C.cx, fy = L.py - C.cy;
    const b = fx * L.dx + fy * L.dy;
    const disc = b * b - (fx * fx + fy * fy - C.r * C.r);
    if (disc < 0) return null;
    const sq = Math.sqrt(disc);
    const P1: [number, number] = [L.px + (-b + sq) * L.dx, L.py + (-b + sq) * L.dy];
    const P2: [number, number] = [L.px + (-b - sq) * L.dx, L.py + (-b - sq) * L.dy];
    return Math.hypot(P1[0] - V[0], P1[1] - V[1]) < Math.hypot(P2[0] - V[0], P2[1] - V[1]) ? P1 : P2;
  };
  const near = (P: [number, number] | null, V: [number, number], lim: number) =>
    P && Math.hypot(P[0] - V[0], P[1] - V[1]) <= lim ? P : null;
  // arah singgung potongan di ujung akhir (end) / awal (start), searah tempuh
  const tangent = (P: Piece, atEnd: boolean): [number, number] => {
    const pr = P.prim;
    if (pr.t === 'line') {
      const sx = P.E[0] - P.S[0], sy = P.E[1] - P.S[1];
      const sgn = sx * pr.dx + sy * pr.dy >= 0 ? 1 : -1;
      return [pr.dx * sgn, pr.dy * sgn];
    }
    if (pr.t === 'arc') {
      const X = atEnd ? P.E : P.S;
      const [rx, ry] = norm(X[0] - pr.cx, X[1] - pr.cy);
      return pr.sweep >= 0 ? [-ry, rx] : [ry, -rx];
    }
    const n = P.pts.length / 2;
    const j = Math.min(n - 1, 3);
    return atEnd
      ? norm(P.pts[(n - 1) * 2] - P.pts[(n - 1 - j) * 2], P.pts[(n - 1) * 2 + 1] - P.pts[(n - 1 - j) * 2 + 1])
      : norm(P.pts[j * 2] - P.pts[0], P.pts[j * 2 + 1] - P.pts[1]);
  };

  // fillet: busur di antara dua garis → pusat berjarak r dari kedua garis (singgung persis)
  const fillet = (L1: LineP, A: ArcP, L2: LineP) => {
    const n1 = [-L1.dy, L1.dx], n2 = [-L2.dy, L2.dx];
    const d1 = n1[0] * L1.px + n1[1] * L1.py, d2 = n2[0] * L2.px + n2[1] * L2.py;
    const s1 = Math.sign(n1[0] * A.cx + n1[1] * A.cy - d1) || 1;
    const s2 = Math.sign(n2[0] * A.cx + n2[1] * A.cy - d2) || 1;
    const det = n1[0] * n2[1] - n1[1] * n2[0];
    if (Math.abs(det) < 0.05) return;
    const e1 = d1 + s1 * A.r, e2 = d2 + s2 * A.r;
    const cx = (e1 * n2[1] - n1[1] * e2) / det, cy = (n1[0] * e2 - e1 * n2[0]) / det;
    if (Math.hypot(cx - A.cx, cy - A.cy) <= 2 * tol + 0.3 * A.r) {
      A.cx = cx;
      A.cy = cy;
    }
  };

  const SMOOTH = Math.cos((22 * Math.PI) / 180);
  const KINK = Math.cos((4 * Math.PI) / 180);
  const joint = (P: Piece, Q: Piece) => {
    const a = P.prim, b = Q.prim;
    const t1 = tangent(P, true), t2 = tangent(Q, false);
    const smooth = t1[0] * t2[0] + t1[1] * t2[1] >= SMOOTH;
    const V = P.V1; // simpul poligon (perpotongan sisi) — posisi sudut
    const D = P.E; // titik data
    let J: [number, number] | null = null;
    if (smooth) {
      if (a.t === 'line' && b.t === 'line') J = near(lineX(a, b), D, 3 * tol) ?? projLine(a, D[0], D[1]);
      else if (a.t === 'line' && b.t === 'arc') J = near(projLine(a, b.cx, b.cy), D, 4 * tol) ?? projLine(a, D[0], D[1]);
      else if (a.t === 'arc' && b.t === 'line') J = near(projLine(b, a.cx, a.cy), D, 4 * tol) ?? projLine(b, D[0], D[1]);
      else if (a.t === 'arc' && b.t === 'arc') {
        const A = onCircle(a, D[0], D[1]), B = onCircle(b, D[0], D[1]);
        J = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
      } else if (a.t === 'line') J = projLine(a, D[0], D[1]);
      else if (b.t === 'line') J = projLine(b, D[0], D[1]);
      else J = D;
      P.E = J;
      Q.S = J;
      // Masih patah (> 4°)? Busur di sambungan itu jadi kurva bebas dengan singgung bersama.
      const u1 = tangent(P, true), u2 = tangent(Q, false);
      if (u1[0] * u2[0] + u1[1] * u2[1] < KINK) {
        if (a.t === 'arc') P.prim = { t: 'bez' };
        if (b.t === 'arc') Q.prim = { t: 'bez' };
      }
      // arah singgung bersama → kurva bebas di kedua sisi tersambung tanpa patahan
      const T: [number, number] = a.t === 'line' ? u1 : b.t === 'line' ? u2 : norm(u1[0] + u2[0], u1[1] + u2[1]);
      P.tE = T;
      Q.tS = T;
    } else {
      const lim = tol + 1;
      if (a.t === 'line' && b.t === 'line') J = near(lineX(a, b), V, lim);
      else if (a.t === 'line' && b.t === 'arc') J = near(lineCircleX(a, b, V), V, lim);
      else if (a.t === 'arc' && b.t === 'line') J = near(lineCircleX(b, a, V), V, lim);
      if (!J) J = a.t === 'line' ? projLine(a, V[0], V[1]) : b.t === 'line' ? projLine(b, V[0], V[1]) : V;
      P.he = true;
      Q.hs = true;
    }
    P.E = J;
    Q.S = J;
  };

  // fillet dulu (mengubah pusat busur), lalu sambungan
  const nP = all.length;
  for (let i = 0; i < nP; i++) {
    const pr = all[i].prim;
    if (pr.t !== 'arc') continue;
    const prev = i > 0 ? all[i - 1] : cyc ? all[nP - 1] : null;
    const next = i + 1 < nP ? all[i + 1] : cyc ? all[0] : null;
    if (prev && next && prev !== all[i] && next !== all[i] && prev.prim.t === 'line' && next.prim.t === 'line') {
      // fillet sah hanya bila sapuan busur = belokan antara kedua garis (±25°)
      const a = tangent(prev, true), b = tangent(next, false);
      const turn = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1])));
      if (Math.abs(Math.abs(pr.sweep) - turn) <= (25 * Math.PI) / 180) fillet(prev.prim, pr, next.prim);
    }
  }
  for (let i = 0; i < nP; i++) {
    const last = i === nP - 1;
    if (last && !cyc) break;
    if (last && nP === 1) break;
    joint(all[i], all[(i + 1) % nP]);
  }
  if (!cyc) {
    all[0].hs = true;
    all[nP - 1].he = true;
  } else if (nP === 1) {
    all[0].hs = all[0].he = true;
  }

  const segs: Seg[] = [];
  for (const P of all) {
    const pr = P.prim;
    let ps: number[][];
    if (pr.t === 'line') {
      segs.push({ p: [P.S[0], P.S[1], 0, 0, 0, 0, P.E[0], P.E[1]], line: true, hardStart: P.hs, hardEnd: P.he });
      continue;
    } else if (pr.t === 'arc') {
      ps = arcSegs(pr.cx, pr.cy, pr.r, pr.sweep, P.S, P.E);
    } else {
      // Kurva bebas: lengkung mulus ala potrace lewat titik tengah sisi poligon (meredam riak
      // tepi), disampel, lalu di-fit ulang dengan singgung ujung yang sudah disepakati.
      const samp: number[] = [P.S[0], P.S[1]];
      const add = (b: number[]) => {
        for (let k = 1; k <= 6; k++) {
          const [x, y] = bez(b, k / 6);
          samp.push(x, y);
        }
      };
      const mid = (i: number): [number, number] => [(VX(i) + VX(i + 1)) / 2, (VY(i) + VY(i + 1)) / 2];
      let cx = P.S[0], cy = P.S[1];
      const lineTo = (x: number, y: number) => {
        add([cx, cy, cx, cy, x, y, x, y]);
        cx = x;
        cy = y;
      };
      if (P.iv - P.iu >= 2) {
        const m0 = mid(P.iu);
        lineTo(m0[0], m0[1]);
        for (let i = P.iu + 1; i < P.iv; i++) {
          const [m1x, m1y] = mid(i);
          const vx1 = VX(i), vy1 = VY(i);
          const p0x = VX(i - 1), p0y = VY(i - 1), p2x = VX(i + 1), p2y = VY(i + 1);
          const l1 = Math.abs(p2x - p0x) + Math.abs(p2y - p0y);
          const dd = l1 < 1e-9 ? 0 : Math.abs((vx1 - p0x) * (p2y - p0y) - (vy1 - p0y) * (p2x - p0x)) / l1;
          const al = Math.max(0.55, Math.min(1, dd > 1 ? (1 - 1 / dd) / 0.75 : 0));
          add([cx, cy, cx + al * (vx1 - cx), cy + al * (vy1 - cy), m1x + al * (vx1 - m1x), m1y + al * (vy1 - m1y), m1x, m1y]);
          cx = m1x;
          cy = m1y;
        }
      }
      lineTo(P.E[0], P.E[1]);
      const pts = new Float64Array(samp);
      const n = pts.length / 2;
      const j1 = Math.min(n - 1, 3), j2 = Math.max(0, n - 4);
      const out: { p: number[]; first: number; last: number }[] = [];
      const t1 = P.tS ?? norm(pts[j1 * 2] - pts[0], pts[j1 * 2 + 1] - pts[1]);
      const t2: [number, number] = P.tE ? [-P.tE[0], -P.tE[1]] : norm(pts[j2 * 2] - pts[(n - 1) * 2], pts[j2 * 2 + 1] - pts[(n - 1) * 2 + 1]);
      fitCubic(pts, 0, n - 1, t1, t2, tol, out);
      ps = out.map((o) => o.p);
    }
    ps.forEach((p, j) => segs.push({ p, line: false, hardStart: P.hs && j === 0, hardEnd: P.he && j === ps.length - 1 }));
  }
  return segs;
}

// ───────────────────────────── 4. Path ─────────────────────────────

function exactPath(segs: Seg[]): CmdPath {
  const cmds: Cmd[] = segs.map((s) =>
    s.line ? { t: 0, c: [s.p[6], s.p[7]] } : { t: 1, c: s.p.slice(2) }
  );
  return { sx: segs[0].p[0], sy: segs[0].p[1], cmds };
}

/**
 * Versi rantai untuk bentuk bawah: digeser `d` px ke sisi `sign` (+1 = kanan arah tempuh).
 * Ujung rantai dan sudut tetap di titik aslinya (disambung garis pendek) supaya bentuk bawah
 * tidak pernah menyusut di bawah tepi bersama.
 */
function offsetPath(segs: Seg[], sign: number, d: number): CmdPath {
  const nrm = (tx: number, ty: number): [number, number] => {
    const [x, y] = norm(tx, ty);
    return sign > 0 ? [-y * d, x * d] : [y * d, -x * d];
  };
  const cmds: Cmd[] = [];
  const first = segs[0].p;
  segs.forEach((s, i) => {
    const p = s.p;
    let n0: [number, number];
    let n3: [number, number];
    if (s.line) {
      n0 = n3 = nrm(p[6] - p[0], p[7] - p[1]);
    } else {
      n0 = Math.hypot(p[2] - p[0], p[3] - p[1]) > 1e-6 ? nrm(p[2] - p[0], p[3] - p[1]) : nrm(p[6] - p[0], p[7] - p[1]);
      n3 = Math.hypot(p[6] - p[4], p[7] - p[5]) > 1e-6 ? nrm(p[6] - p[4], p[7] - p[5]) : nrm(p[6] - p[0], p[7] - p[1]);
    }
    if (i === 0 || s.hardStart || segs[i - 1].hardEnd) cmds.push({ t: 0, c: [p[0] + n0[0], p[1] + n0[1]] });
    if (s.line) {
      // garis lurus → kubik dengan pegangan di garis tergeser (tetap lurus)
      cmds.push({ t: 0, c: [p[6] + n3[0], p[7] + n3[1]] });
    } else {
      cmds.push({ t: 1, c: [p[2] + n0[0], p[3] + n0[1], p[4] + n3[0], p[5] + n3[1], p[6] + n3[0], p[7] + n3[1]] });
    }
    if (s.hardEnd || i === segs.length - 1) cmds.push({ t: 0, c: [p[6], p[7]] });
  });
  return { sx: first[0], sy: first[1], cmds };
}

function reversePath(cp: CmdPath): CmdPath {
  const ends: [number, number][] = [[cp.sx, cp.sy]];
  for (const c of cp.cmds) ends.push(c.t === 0 ? [c.c[0], c.c[1]] : [c.c[4], c.c[5]]);
  const cmds: Cmd[] = [];
  for (let i = cp.cmds.length - 1; i >= 0; i--) {
    const c = cp.cmds[i];
    const [px, py] = ends[i];
    cmds.push(c.t === 0 ? { t: 0, c: [px, py] } : { t: 1, c: [c.c[2], c.c[3], c.c[0], c.c[1], px, py] });
  }
  const [ex, ey] = ends[ends.length - 1];
  return { sx: ex, sy: ey, cmds };
}

const fmt = (v: number) => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
};

function appendCmds(parts: string[], cp: CmdPath) {
  for (const c of cp.cmds) {
    if (c.t === 0) parts.push(`L${fmt(c.c[0])} ${fmt(c.c[1])}`);
    else parts.push(`C${fmt(c.c[0])} ${fmt(c.c[1])} ${fmt(c.c[2])} ${fmt(c.c[3])} ${fmt(c.c[4])} ${fmt(c.c[5])}`);
  }
}

// ───────────────────────────── 5. API ─────────────────────────────

function fitParams(o: ContourOptions): FitParams {
  const scale = Math.max(1, o.scale ?? 1);
  return {
    spline: (o.mode ?? 'spline') === 'spline',
    polyTol: o.tolerance ?? 0.4 + 0.05 * scale,
    primTol: 0.2 * scale + 0.35,
    alphaMax: o.alphaMax ?? 0.9,
    smoothIters: Math.max(1, Math.round(scale)),
    arm: Math.max(2, Math.round(scale)),
    chamfer: 1.5 * scale + 1,
    straightTol: 0.55 * scale + 0.4,
    straightLen: 8 * scale,
  };
}

/**
 * Trace peta indeks warna (−1 = transparan) → daftar path per warna (urut dari bawah ke atas).
 */
export function traceIndexed(
  col: Int32Array,
  w: number,
  h: number,
  colorCount: number,
  opts: ContourOptions = {},
  rgb?: number[]
): { color: number; d: string }[] {
  const speckle = Math.max(1, opts.filterSpeckle ?? 4);
  cleanIsolated(col, w, h, rgb);
  const { label, regionColor, regionCount } = buildRegions(col, w, h, speckle * speckle, rgb);
  if (rgb && opts.dissolveRims !== false) {
    dissolveRims(label, w, h, regionColor, rgb, 1.6 * Math.max(1, opts.scale ?? 1));
  }
  const chains = buildChains(label, w, h);
  const fp = fitParams(opts);
  const overlap = opts.overlap ?? 1;

  // Tumpukan: warna dengan luas total terbesar paling bawah.
  const regionArea = new Float64Array(regionCount);
  for (let p = 0; p < label.length; p++) regionArea[label[p]]++;
  const colorArea = new Float64Array(colorCount);
  for (let r = 1; r < regionCount; r++) colorArea[regionColor[r]] += regionArea[r];
  const colorOrder = Array.from({ length: colorCount }, (_, i) => i)
    .filter((c) => colorArea[c] > 0)
    .sort((a, b) => colorArea[b] - colorArea[a]);
  const rank = new Int32Array(colorCount);
  colorOrder.forEach((c, i) => (rank[c] = i));

  // Ketebalan kasar per area (2·luas/keliling) — batas perluasan di bawah bentuk tipis.
  const perim = new Float64Array(regionCount);
  for (const ch of chains) {
    const len = ch.v.length / 2 - (ch.closed ? 0 : 1);
    perim[ch.left] += len;
    perim[ch.right] += len;
  }

  for (const ch of chains) {
    const segs = fitChain(ch, fp, w, h);
    if (segs.length === 0) continue;
    ch.exact = exactPath(segs);
    if (ch.left > 0 && ch.right > 0 && overlap > 0) {
      const lowerIsLeft = rank[regionColor[ch.left]] < rank[regionColor[ch.right]];
      const upper = lowerIsLeft ? ch.right : ch.left;
      const thick = (2 * regionArea[upper]) / Math.max(1, perim[upper]);
      const d = Math.max(0.2, Math.min(overlap, thick * 0.35));
      ch.lower = offsetPath(segs, lowerIsLeft ? 1 : -1, d);
    }
  }

  // Susun loop per area: setiap rantai dipakai dengan area itu di sisi kiri.
  interface Ref {
    path: CmdPath;
    s: number;
    e: number;
  }
  const refsByRegion: Ref[][] = Array.from({ length: regionCount }, () => []);
  const key = (x: number, y: number) => Math.round(y) * (w + 1) + Math.round(x);
  for (const ch of chains) {
    if (!ch.exact) continue;
    const vn = ch.v.length / 2;
    const sKey = key(ch.v[0], ch.v[1]);
    const eKey = ch.closed ? sKey : key(ch.v[(vn - 1) * 2], ch.v[(vn - 1) * 2 + 1]);
    const lowerIsLeft = ch.lower && rank[regionColor[ch.left]] < rank[regionColor[ch.right]];
    if (ch.left > 0) {
      const p = lowerIsLeft ? ch.lower! : ch.exact;
      refsByRegion[ch.left].push({ path: p, s: sKey, e: eKey });
    }
    if (ch.right > 0) {
      const p = ch.lower && !lowerIsLeft ? ch.lower : ch.exact;
      refsByRegion[ch.right].push({ path: reversePath(p), s: eKey, e: sKey });
    }
  }

  const partsByColor: string[][] = Array.from({ length: colorCount }, () => []);
  for (let r = 1; r < regionCount; r++) {
    const refs = refsByRegion[r];
    if (refs.length === 0) continue;
    const used = new Uint8Array(refs.length);
    const byStart = new Map<number, number[]>();
    refs.forEach((rf, i) => {
      const a = byStart.get(rf.s);
      if (a) a.push(i);
      else byStart.set(rf.s, [i]);
    });
    const parts = partsByColor[regionColor[r]];
    for (let i0 = 0; i0 < refs.length; i0++) {
      if (used[i0]) continue;
      let i = i0;
      parts.push(`M${fmt(refs[i].path.sx)} ${fmt(refs[i].path.sy)}`);
      for (let guard = 0; guard <= refs.length; guard++) {
        used[i] = 1;
        appendCmds(parts, refs[i].path);
        if (refs[i].e === refs[i0].s) break;
        const cand = byStart.get(refs[i].e);
        let next = -1;
        if (cand) for (const j of cand) if (!used[j]) { next = j; break; }
        if (next < 0) break;
        i = next;
      }
      parts.push('Z');
    }
  }

  return colorOrder.map((c) => ({ color: c, d: partsByColor[c].join('') })).filter((p) => p.d.length > 0);
}

const hex2 = (v: number) => v.toString(16).padStart(2, '0');

/** RGBA (alfa < 128 = transparan) → SVG; satu path per warna, tanpa transform. */
export function traceContoursToSvg(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number, opts: ContourOptions = {}): string {
  const n = w * h;
  const col = new Int32Array(n);
  const ids = new Map<number, number>();
  const hexes: string[] = [];
  const rgb: number[] = [];
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    if (rgba[i + 3] < 128) {
      col[p] = -1;
      continue;
    }
    const k = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2];
    let id = ids.get(k);
    if (id === undefined) {
      id = hexes.length;
      ids.set(k, id);
      rgb.push(k);
      hexes.push(`#${hex2(rgba[i])}${hex2(rgba[i + 1])}${hex2(rgba[i + 2])}`);
    }
    col[p] = id;
  }
  const paths = traceIndexed(col, w, h, hexes.length, opts, rgb);
  const body = paths.map((p) => `<path d="${p.d}" fill="${hexes[p.color]}"/>`).join('\n');
  return `<svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n${body}\n</svg>`;
}

/** Masker biner (≠0 = isi) → atribut `d` (koordinat masker). */
export function traceMaskToPath(mask: Uint8Array, w: number, h: number, opts: ContourOptions = {}): string {
  const col = new Int32Array(w * h);
  for (let p = 0; p < col.length; p++) col[p] = mask[p] ? 0 : -1;
  const paths = traceIndexed(col, w, h, 1, opts);
  return paths.length > 0 ? paths[0].d : '';
}
