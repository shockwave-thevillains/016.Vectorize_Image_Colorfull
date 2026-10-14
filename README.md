# 014 · Vectorize Image — Magenta Background

Batch converter gambar raster ke vektor multi-warna (**SVG + EPS**) untuk microstock. Background magenta
`#FF00FF` (atau putih) otomatis dibuat transparan. Output diskalakan ke ≥ 15 MP.

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
   ssh-keygen -t ed25519 -C "deploy-014" -f deploy_014 -N ""
   ```
   Hasilnya `deploy_014` (private) dan `deploy_014.pub` (public).
3. **Repo tujuan (akun lain)** → Settings → **Deploy keys** → *Add deploy key* → tempel isi
   `deploy_014.pub` → centang **Allow write access** → Add.
4. **Repo ini (014)** → Settings → **Secrets and variables → Actions**:
   - tab **Secrets** → *New repository secret* → nama `PAGES_DEPLOY_KEY`, isi seluruh `deploy_014`
     (termasuk baris `-----BEGIN…` dan `-----END…`).
   - tab **Variables** → *New repository variable* → nama `PAGES_REPO`, isi `<akun-lain>/<nama-repo>`.
   - (opsional) variable `PAGES_BRANCH` bila tidak ingin memakai branch default `gh-pages`.
5. **Repo ini (014)** → Actions → **Deploy to GitHub Pages** → *Run workflow*. Branch `gh-pages`
   otomatis terbentuk di repo tujuan.
6. **Repo tujuan** → Settings → **Pages** → Source: **Deploy from a branch** → `gh-pages` / `/ (root)` → Save.
7. Hapus file `deploy_014` dari komputer setelah tersimpan di secret.
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
Browser (main thread)                       Web Worker
─────────────────────                       ──────────
load gambar → upscale (opsional)
→ color snapping → hapus background
→ kirim piksel RGBA (transfer, zero-copy) ──▶ vtracer WASM → SVG mentah
◀────────────────────────────────────────────
bake transform → buang path background
→ skala ke ≥15 MP → buat EPS → ZIP
```

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
