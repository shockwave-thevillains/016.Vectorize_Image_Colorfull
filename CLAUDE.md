# CLAUDE.md — 016 Vectorize Image Colorful

Turunan repo 014 (Vectorize Image Magenta Background). Baca `README.md` untuk cara menjalankan & deploy.

## Perintah

```sh
npm run dev     # http://localhost:3000
npm run lint    # tsc --noEmit — wajib lolos
npm run build   # wajib lolos sebelum commit
```

## Peta kode

- `src/lib/vectorizer.ts` — pipeline utama (`vectorizeImage`). Urutan di `loadImageToCanvas`:
  upscale → background transparan → deteksi gradasi (`withGradients`) → color snapping.
  `applyPreset` sengaja TIDAK menimpa pengaturan background/area putih/bayangan.
- `src/lib/whiteRegions.ts` — area putih terhubung, keputusan default + override klik
  (titik ternormalisasi 0..1, bukan ID area), bayangan (`removeShadow`), defringe halo putih.
  Dipakai pipeline (resolusi kerja) dan `WhiteRegionPicker` (resolusi asli) — harus tetap satu sumber.
- `src/lib/gradientDetect.ts` — segmentasi + fit linear (arah dari bidang & dari kelengkungan) /
  radial-elips, profil multi-stop (RDP). Area diterima → `mask` dilubangi dari lapisan datar,
  `fillMask` (lubang detail ditutup + dilatasi 2 px) di-trace vtracer mode `bw`.
  Area yang gagal di-fit dipecah (2-means warna lalu k-plane: piksel → model bidang linear terdekat,
  agar batas jatuh di rusuk) → komponen terhubung → fit ulang (maks 3 tingkat). Area didominasi satu
  warna datar ditolak; area diterima "tumbuh" ke piksel sisa yang cocok; urutan path = luas fillMask.
  Penggabungan tetangga butuh ΔE kecil pada gambar ter-blur DAN asli (dua warna datar mirip ≠ gradien).
- `src/lib/colorSnapping.ts` — palet: warna dianggap berbeda bila ΔE76 ≥ `PALETTE_MIN_DELTA_E` (6);
  `snapEdgesToLocalColors` membatasi piksel anti-aliasing ke warna yang ada di sekitarnya (anti-halo);
  piksel tepi yang lebih mirip latar transparan (area gradien/background) dibuat transparan, dan piksel
  "yakin" hanya dihitung bila warnanya juga ada sebagai warna datar di dekatnya (anti bingkai krem).
  Default kurva: spline (huruf/angka bulat halus); preset logo/flat tetap polygon.
  Resolusi kerja maks 3200 px; filter bintik diskalakan dengan faktor upscale (`scaledSpeckle`).
- `src/lib/vtracerOptions.ts` — `layerDifference: 2` WAJIB: bawaan vtracer (16) menggabungkan nuansa
  gelap yang sudah dipisah palet (ban hitam ↔ fender abu).
- `src/lib/gradientSvg.ts` — `<defs>` gradien kanonik (`userSpaceOnUse` + `gradientTransform=matrix`),
  path gradien disisipkan PALING BAWAH; `scaleGradientTransforms` dipanggil `scaleSvg`.
- `src/lib/epsConverter.ts` — `fill="url(#id)"` → `shfill` Level 3 (`epsGradientMode: 'shading'`) atau
  pita warna Level 2 (`'bands'`). Selalu bangun EPS lewat `buildEpsForConfig`.
- `src/components/WhiteRegionPicker.tsx` — tab "Area Putih" di `VectorPreviewModal`.

## Verifikasi

Tidak ada test runner. Uji manual: jalankan dev server lalu panggil `vectorizeImage` dari halaman via
Playwright (`import('/src/lib/vectorizer.ts')`), render SVG hasilnya, dan render EPS dengan Ghostscript
(`gs -dEPSCrop -sDEVICE=png16m`). Chromium Playwright: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.
