# 016 · Vectorize Image Colorful

Batch converter gambar raster ke vektor multi-warna (**SVG + EPS**) untuk microstock — dikembangkan dari
repo 014, dengan tiga kemampuan baru:

1. **Gradasi warna → gradient vektor asli.** Area bergradasi dideteksi otomatis dan ditulis sebagai
   `linearGradient` / `radialGradient` (termasuk radial lonjong dan kilau logam simetris gelap-terang-gelap).
   Bila gradasinya terlalu rumit, area itu otomatis dipecah menjadi **pita warna bertingkat** (cadangan).
2. **Background putih jadi transparan, putih di dalam objek bisa dipilih per area.** Default: putih yang
   menyentuh tepi gambar dihapus, putih di dalam objek dipertahankan. Di preview (tab **Area Putih**)
   setiap area putih bisa **diklik** untuk dihapus ↔ dipertahankan, lalu diproses ulang.
3. **Bayangan lembut** di bawah objek: default dipertahankan, bisa dihapus bersama background.

Mode background **Magenta #FF00FF** dari 014 tetap tersedia sebagai opsi.

**Berjalan 100% di browser.** Tidak ada server, tidak ada upload: gambar tidak pernah meninggalkan
komputer pengguna. Karena itu aplikasi ini bisa di-hosting gratis sebagai situs statis di **GitHub Pages**.

- Mesin vektor: [`@visioncortex/vtracer`](https://github.com/visioncortex/vtracer) (Rust → WebAssembly),
  dijalankan di **Web Worker** supaya UI tetap responsif.
- Frontend: React + Vite + Tailwind.
- Tidak memanggil API eksternal apa pun (tidak ada Gemini, analytics, atau CDN).

---

## 1. Hosting di GitHub Pages

Workflow `.github/workflows/deploy-pages.yml` otomatis build & deploy setiap ada push ke `main`.

**Sekali saja**, aktifkan Pages di repo:

1. Buka **Settings → Pages**.
2. Di **Build and deployment → Source**, pilih **GitHub Actions**.
3. Buka tab **Actions** → workflow **Deploy to GitHub Pages** → **Run workflow** (atau push apa saja ke `main`).

Setelah workflow hijau, situs tersedia di:

```
https://<username>.github.io/<nama-repo>/
```

Build memakai path relatif (`base: './'`), jadi tidak perlu mengubah konfigurasi bila nama repo/username berubah.

### 1b. Hosting di repo akun GitHub lain (kode tetap di repo ini)

Workflow yang sama bisa mengirim hasil build ke repo milik akun lain, sehingga situs tampil di
`https://<akun-lain>.github.io/...` sementara kode sumber tetap di sini. Tanpa konfigurasi di bawah,
workflow men-deploy ke Pages repo ini sendiri (perilaku default).

1. **Di akun lain:** buat repo **public** kosong, mis. `vectorizer`
   (atau `<akun-lain>.github.io` bila ingin alamat tanpa sub-path).
2. **Di komputer sendiri:** buat sepasang deploy key (tanpa passphrase):
   ```bash
   ssh-keygen -t ed25519 -C "deploy-016" -f deploy_016 -N ""
   ```
   Hasilnya `deploy_016` (private) dan `deploy_016.pub` (public).
3. **Repo tujuan (akun lain)** → Settings → **Deploy keys** → *Add deploy key* → tempel isi
   `deploy_016.pub` → centang **Allow write access** → Add.
4. **Repo ini (016)** → Settings → **Secrets and variables → Actions**:
   - tab **Secrets** → *New repository secret* → nama `PAGES_DEPLOY_KEY`, isi seluruh `deploy_016`
     (termasuk baris `-----BEGIN…` dan `-----END…`).
   - tab **Variables** → *New repository variable* → nama `PAGES_REPO`, isi `<akun-lain>/<nama-repo>`.
   - (opsional) variable `PAGES_BRANCH` bila tidak ingin memakai branch default `gh-pages`.
5. **Repo ini (016)** → Actions → **Deploy to GitHub Pages** → *Run workflow*. Branch `gh-pages`
   otomatis terbentuk di repo tujuan.
6. **Repo tujuan** → Settings → **Pages** → Source: **Deploy from a branch** → `gh-pages` / `/ (root)` → Save.
7. Hapus file `deploy_016` dari komputer setelah tersimpan di secret.
8. (Opsional) Matikan Pages lama di repo ini: Settings → Pages → *Unpublish site*.

## 2. Menjalankan di komputer sendiri

### Opsi A — Docker

```bash
docker compose up -d --build
```

Buka **http://localhost:3000**. Hentikan dengan `docker compose down`.
(Image berisi nginx yang menyajikan file statis; tidak ada Node.js di runtime.)

### Opsi B — Node.js

```bash
npm install
npm run dev        # mode pengembangan  → http://localhost:3000
# atau
npm run build && npm run preview   # versi produksi → http://localhost:3000
```

---

## Arsitektur singkat

```
Browser (main thread)                                  Web Worker (vtracer WASM)
─────────────────────                                  ─────────────────────────
load gambar → upscale (opsional)
→ background putih: area putih terhubung (+ klik per area,
  + bayangan opsional) → transparan, defringe halo putih
→ deteksi gradasi (segmentasi + fit linear/radial multi-stop)
    area cocok  → dilubangi dari lapisan datar
    tidak cocok → dibiarkan (jadi pita warna)
→ color snapping
→ lapisan datar (RGBA) ─────────────────────────────▶ SVG warna datar
→ masker tiap area gradien (hitam-putih) ───────────▶ path outline gradien
◀────────────────────────────────────────────────────
susun SVG: <defs> gradien + path gradien (paling bawah) + lapisan datar di atasnya
→ skala ke ≥15 MP (path + gradientTransform) → EPS → ZIP
```

- Path gradien diletakkan **di bawah** lapisan warna datar dan lubang detailnya ditutup, sehingga teks/ikon
  kecil di atas area gradasi tetap utuh dan tidak ada celah di tepi.
- Gradien selalu ditulis dalam bentuk kanonik (`gradientUnits="userSpaceOnUse"` + `gradientTransform="matrix(…)"`),
  sehingga penskalaan cukup mengalikan matriks dan konversi EPS cukup `concat` + shading satuan.
- **EPS**: pilih di pengaturan *Gradasi Warna → Gradien di EPS*:
  - **Gradient Asli** (default) — smooth shading PostScript Level 3 (`shfill`, ShadingType 2/3). Halus dan ringan;
    Illustrator/Inkscape/Ghostscript membacanya sebagai gradien.
  - **Pita Warna** — gradien ditulis sebagai banyak pita warna solid (PostScript Level 2), untuk software atau
    validator lama yang tidak mendukung Level 3. File lebih besar.
  SVG selalu memakai gradient asli.

- Pool berisi 1–3 worker (mengikuti jumlah core CPU); batch memproses **2 gambar bersamaan**, sehingga
  pre-processing gambar berikutnya berjalan sambil vtracer bekerja.
- Bila vtracer gagal (mis. browser sangat lama tanpa WebAssembly), gambar diproses dengan ImageTracer
  sebagai cadangan dan diberi **badge merah "Fallback ImageTracer — proses ulang"** serta toast di akhir batch.

### Tentang `src/vendor/vtracer/`

Paket npm `@visioncortex/vtracer` dibuat untuk Node.js (memuat `.wasm` lewat `fs`). Skrip
`scripts/vendor-vtracer.mjs` mengganti **hanya** pemuat itu dengan pemuat `fetch` untuk browser; file
`.wasm`-nya sama persis. Hasilnya byte-for-byte sama dengan versi Node (sudah diverifikasi).

Setelah meng-upgrade `@visioncortex/vtracer`, jalankan ulang:

```bash
npm run vendor:vtracer
```

---

## Catatan pemakaian

- **Toleransi gradasi** (4–20, default 8): makin tinggi, makin banyak area yang dijadikan gradient (lebih halus),
  tapi detail yang warnanya mirip bisa ikut tergabung. Makin rendah, makin ketat — sisanya jadi pita warna.
  Antrean menampilkan badge "N gradien · M pita" per gambar.
- **Area putih**: buka preview → tab **Area Putih** → klik area → *Terapkan & Vektorisasi Ulang*.
  Pilihan disimpan per gambar (sebagai titik klik), tidak tertimpa saat pengaturan global diubah.
- **Hapus bayangan lembut**: menghapus abu-abu netral yang menempel ke background. Slider kecerahan
  mengatur seberapa gelap bayangan yang ikut terhapus; hati-hati dengan bagian abu-abu objek yang menempel latar.

- **Upscale** (`1x / 2x / 4x` di UI): default 4x memperbesar gambar 1024 px ke 2400 px sebelum tracing —
  tepi lebih halus, tapi ~4–6× lebih berat. Uji A/B di zoom 200% sebelum memilih.
- **Badge merah "Fallback ImageTracer"** = gambar itu tidak diproses vtracer. Proses ulang sebelum submit.
- Biarkan tab browser tetap di depan selama batch berjalan (Chrome memperlambat tab latar belakang).
- Semua pemrosesan memakai CPU & RAM komputer pengguna. Batch besar (100+ gambar) di laptop lama bisa
  terasa berat; proses bertahap bila perlu.

## Riwayat perubahan dari versi AI Studio

| Perubahan | Dampak |
|---|---|
| vtracer dipindah dari server Express ke Web Worker di browser | Bisa di-hosting statis (GitHub Pages); tanpa upload sama sekali. |
| Batch 2 gambar bersamaan + pool worker | ~2,3× lebih cepat dibanding versi server pada uji 31 gambar (1,1 s vs 2,5 s per gambar). |
| Fallback ke ImageTracer ditandai jelas | Tidak ada lagi batch campuran vtracer/ImageTracer yang tak terdeteksi. |
| Dependensi server (express, tsx, dotenv, @google/genai) & `esbuild` usang dihapus | `npm install` biasa langsung berhasil (sebelumnya gagal `ERESOLVE`). |
