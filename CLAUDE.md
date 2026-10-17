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
  `seeThrough`: area tertutup yang sebenarnya background tembus (putih di antara ban truk, tertutup garis
  jalan) default dihapus — luas ≥ 0.5% dan 15–85% tepinya penghalang tipis (≤ 2% sisi gambar) dengan
  background di baliknya; celah kecil pada penghalang yang sama dan area di balik penghalang tipis dari
  area tembus ikut. Huruf putih di pita merah (kecil) / cincin putih (penghalang tebal) tetap.
  `attachTintedWhite`: putih tak murni (di bawah toleransi) ikut dianggap putih bila TIPIS (tak punya
  bagian dalam > 3 px sumber dari warna objek) dan warnanya = campuran putih + warna tepinya (porsi putih
  ≥ 55%) — garis miring "%" putih di lencana merah, bintang kilau; bidang pastel tetap dipertahankan.
  Dipakai pipeline (resolusi kerja) dan `WhiteRegionPicker` (resolusi asli) — harus tetap satu sumber.
- `src/lib/gradientDetect.ts` — segmentasi + fit linear (arah dari bidang & dari kelengkungan) /
  radial-elips, profil multi-stop (RDP). Area diterima → `mask` dilubangi dari lapisan datar,
  `fillMask` (lubang detail ditutup + dilatasi 2 px) di-trace vtracer mode `bw`.
  Area yang gagal di-fit dipecah (2-means warna lalu k-plane: piksel → model bidang linear terdekat,
  agar batas jatuh di rusuk) → komponen terhubung → fit ulang (maks 3 tingkat). Area didominasi satu
  warna datar ditolak; area diterima "tumbuh" ke piksel sisa yang cocok; urutan path = luas fillMask.
  Penggabungan tetangga butuh ΔE kecil pada gambar ter-blur DAN asli (dua warna datar mirip ≠ gradien).
  Area hampir-datar yang bertetangga (terpisah garis ≤ 6 px analisis, warna rata-rata ≤ 45) dicoba
  sebagai SATU gradien (pad chip emas yang dipisah garis kontak); diterima hanya bila model juga
  menjelaskan variasi DI DALAM tiap bagian (galat ≤ 0.7× galat rata-rata bagian — ilustrasi datar
  seperti muka kotak/bumper ditolak) dan tanpa lompatan stop tajam. Masker dicek ulang di resolusi
  kerja: piksel > 50 RGB dari prediksi (struktur ≥ 12 px, mis. garis 1 px) tetap di lapisan datar.
  Peringatan "pita warna" hanya untuk area gagal-fit ≥ 0.15% piksel.
  Area BESAR (≥ 8× minArea) yang "didominasi satu warna" (latar kartu gelap 25→46) tetap dicoba: diterima
  hanya sebagai gradien LINEAR yang menjelaskan ≥ 60% variasinya (`MODE_R2`) — radial pada bentuk bulat
  datar (ban) mengaburkan cincin tajam. Tanpa ini latar halus terkuantisasi menjadi 2 warna dengan batas
  bergerigi mengikuti derau JPEG ("seperti sapuan kuas"). Area hampir-datar yang terpotong garis tipis
  dari area gradien (bidang di dalam chevron) ikut gradien itu bila galatnya ≤ `ABSORB_RMSE`.
  `clearFlatMatchingGradients` (setelah snapping): piksel datar di atas gradien GELAP yang cocok/lebih
  gelap sedikit dari gradien PALING ATAS di titik itu dibuat transparan (bercak halo di sela huruf kecil);
  `growTransparentSimilar` juga menyerap halo yang sedikit lebih gelap — keduanya hanya di sebelah gradien
  gelap (garis kontak chip emas harus tetap).
  Di resolusi kerja piksel di bawah path gradien (fillMask) yang ≤ `RECLAIM_T` (40) dari prediksi ikut
  masker (garis 1 px tidak menebal jadi pita ±2 px analisis). Setelah urut tumpukan: piksel yang
  dilubangi gradien A tetapi tertutup path gradien B yang lebih atas (dan bukan masker B) dikembalikan ke
  lapisan datar — kalau tidak, lubang huruf "O" emas di atas latar gradien tampil emas.
- `src/lib/colorSnapping.ts` — palet: warna dianggap berbeda bila ΔE76 ≥ `PALETTE_MIN_DELTA_E` (6);
  `snapEdgesToLocalColors` membatasi piksel anti-aliasing ke warna yang ada di sekitarnya (anti-halo);
  piksel tepi yang lebih mirip latar transparan (area gradien/background) dibuat transparan, dan piksel
  "yakin" hanya dihitung bila warnanya juga ada sebagai warna datar di dekatnya (anti bingkai krem).
  Keputusan piksel tepi = unmixing dua warna acuan (atau warna + latar transparan), ambang 50%; tak
  terjelaskan → garis tepi tipis mirip objek dilebur (RIM_MERGE), selain itu snapping global dipertahankan
  (teks/garis emas tipis); tanpa acuan dekat (goresan 1 px) dicari ±3×radius, warna jauh dipakai hanya
  bila lebih dekat ke warna asli daripada semua acuan dekat. Lalu `growTransparentSimilar` (2 px),
  `mergeThinRims` (halo tipis penajaman JPEG dilebur ke objek tebal bila terjepit objek ↔ latar yang
  berbeda — garis di antara dua bidang sewarna, mis. kontak chip, dipertahankan), `unifyGlyphColors`
  (huruf kecil sekata diseragamkan menurut RONA warna asli: netral → warna palet netral/perak, hangat →
  emas; kata dengan rona huruf berbeda / teks putih dilewati; keping huruf bertetangga yang warnanya
  mirip diuji sebagai satu bentuk ringkas ≤ 20 px sumber; warna kata netral = warna gambar terdekat ke
  warna INTI huruf, piksel ≥ rata-rata komponen, dengan penalti rona), `majorityFilter`
  3×3 (smoothEdges; goresan 1 px kontras dilindungi), lalu `widenThinStrokes`: goresan 1–2 px kontras
  dipertebal jadi 3 px karena vtracer membuang bentuk ≤ 2 px (huruf "I" hilang) — hanya bila warnanya
  juga ada sebagai bidang tebal di dekatnya dan kedua sisinya latar yang sama. Terakhir
  `regularizeBarcodes`: blok banyak tepi mendatar tanpa tepi tegak, tiap baris berpola kolom sama
  (korelasi ≥ 0.85, tinggi ≥ 10 px sumber, ≥ 6 batang) digambar ulang per kolom (Otsu kecerahan asli):
  batang = satu warna (Lab terdekat ke ¼ teratas kecerahan batang, rona ×2), celah = warna/transparan
  terbanyak, batang min 3 px. Huruf miring ("W") tidak lolos uji korelasi.
  Gradasi: `minAreaFraction` 0.0002, `maxRegions` 160 (garis miring "%" dsb. ikut terdeteksi).
  (vtracer:) Palet TETAP diserahkan ke vtracer (tanpa palet vtracer menggabungkan klaster mirip: bingkai kaca teal
  truk tertelan kabin abu). Warna rata-rata klaster yang dipetakan vtracer bisa salah (huruf perak →
  emas), jadi `recolorSvgByVisibility` memecah tiap path menjadi bentuk terpisah (kontur luar + lubang;
  vtracer menggabungkan area sewarna yang berjauhan dalam satu path), merasterisasi dari atas ke bawah,
  dan memberi tiap bentuk warna palet raster terbanyak di piksel yang benar-benar terlihat. Mode magenta
  dikecualikan (path latar magenta harus tetap magenta untuk disaring).
  Default kurva: spline (huruf/angka bulat halus); preset logo/flat tetap polygon.
  `scaleSvg`: koordinat dibulatkan 1 desimal bila hasil ≥ 2000 px (ukuran file −10%, tak terlihat).
  Resolusi kerja maks 3200 px; filter bintik diskalakan dengan faktor upscale (`scaledSpeckle`).
- `src/lib/contourTracer.ts` — tracer bawaan ("Kontur Bersama", `config.tracer` 'contour' | 'vtracer'),
  dijalankan di `vtracer.worker.ts` (`options.engine === 'contour'`); juga dipakai untuk masker gradien.
  Urutan: `cleanIsolated` (piksel tanpa tetangga-4 sewarna → warna tetangga; garis diagonal 1 px di latar
  seragam tetap) → area 8-terhubung, bintik (< speckle²) dilebur ke tetangga WARNA terdekat (lubang
  transparan hanya bila < speckle²/8; goresan memanjang berdiri sendiri — huruf "I" kecil — tetap), area
  sewarna yang bersentuhan disatukan → `dissolveRims`: pita tipis (2·luas/keliling ≤ 1,6×skala) di antara
  dua area opak yang warnanya campuran keduanya / overshoot dekat salah satunya dibagi ke keduanya (halo
  merah tua di huruf merah) → graf batas (simpul = titik temu 3+ area, naik/turun bingkai gambar; rantai
  bingkai = garis lurus persis) → per rantai: titik tengah tepi, haluskan ringan, poligon optimal
  (Selinger/Potrace, ditulis ulang; tol 0,4+0,05×skala), `straighten` (sisi panjang ≥ 8×skala yang riak
  ≤ 0,55×skala+0,4 diluruskan — tepi diagonal bergerigi dari sumber), simpul digeser ke perpotongan garis
  kuadrat-terkecil (≤ 0,75 px), `collapseChamfers` (1–3 sisi pendek di sudut membulat → satu sudut; titik
  awal rantai tertutup diputar ke simpul di antara dua sisi terpanjang dulu) → `fitPrimitives` (PRIMITIF
  GEOMETRIS — permintaan user: hasil harus garis lurus/busur/lingkaran, bukan "seperti dilukis"):
  rantai tertutup dicoba dulu sebagai lingkaran/elips utuh (Kåsa / Halir-Flusser; toleransi
  min(straightTol, 0,08·r+0,4) — bentuk tipis seperti "I" tidak lolos); lainnya per bentang (diputus di
  ujung rantai & belokan ≥ 120°) dengan DP jumlah potongan minimum: garis (`linePrim`, dikunci
  mendatar/tegak bila ≤ 3°; ditolak bila melengkung ke satu sisi — `bowOf`), busur (`arcPrim`, toleransi
  0,65× lebih ketat, lengkung harus menjelaskan bentuk), kurva bebas hanya bila tak ada yang muat (biaya
  1 + 1,2/sisi; tak boleh melintasi simpul ≥ 55° supaya gerigi tetap tajam; dibentuk ala potrace lewat
  titik tengah sisi lalu Schneider). Garis pendek (< 4×skala) mahal. `mergeLineRuns`: deret garis
  berbelok kecil (3–22°) → busur/kurva (oval tidak bersegi). Sudut muncul dari beda arah singgung > 22°
  (perpotongan); sambungan mulus memakai titik singgung (busur di antara dua garis = fillet bila sapuan
  = belokan) dan singgung bersama untuk kurva bebas; patahan sisa > 4° → busurnya jadi kurva bebas.
  Path per warna (urut luas total, terbesar paling bawah, fill nonzero); bentuk bawah memakai versi
  rantai yang digeser ≤ 1 px ke bentuk atas (anti garis rambut). Uji cepat tanpa browser:
  `node --experimental-strip-types` + `traceContoursToSvg` pada RGBA mentah.
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
