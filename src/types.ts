export type VectorPresetId =
  | 'full_color'
  | 'color_logo'
  | 'illustration'
  | 'flat_vector'
  | 'photo_deep'
  | 'posterized'
  | 'monochrome';

export type VectorEngine = 'vtracer' | 'imagetracer';

export type WhiteRemovalMode = 'floodfill' | 'global';

export type BackgroundRemovalColor = 'magenta' | 'white';

/** Titik klik pengguna (koordinat ternormalisasi 0..1) yang membalik keputusan satu area putih. */
export interface WhiteRegionOverride {
  x: number;
  y: number;
  action: 'remove' | 'keep';
}

export type EpsGradientMode = 'shading' | 'bands';

export type OutputResolutionPreset = 'native' | '15mp' | '20mp' | '25mp' | '30mp' | 'custom';

export interface VectorizeConfig {
  engine: VectorEngine;
  preset: VectorPresetId;
  upscale?: 1 | 2 | 4;
  maxColors: number;
  colorPrecision: number;
  // Ukuran Output Vektor (Minimal 15 MP untuk standar Microstock / Freepik / Adobe Stock)
  outputResolutionPreset?: OutputResolutionPreset;
  outputMegaPixels?: number; // Target Megapixels (minimal 15 MP jika diaktifkan, e.g. 15, 20, 25, 30)
  // Kode Penamaan Berkas (Batch Prefix & Numbering)
  fileCode?: string; // Misal "011" -> output "011_1_nama_awal", "011_2_nama_awal"
  startNumber?: number; // Angka awal urutan (default 1)
  // Color Snapping (Anti-Aliasing Removal)
  colorSnapping: boolean; // Aktifkan K-Means Color Snapping sebelum tracing
  snappedColorCount: number; // Jumlah warna palet target (e.g. 6, 8, 12, 16, 24)
  lockedPalette?: string[]; // Warna yang dikunci user secara manual
  // Background Transparency Options (Magenta #FF00FF default, Putih #FFFFFF cadangan)
  bgMode?: BackgroundRemovalColor; // 'magenta' (default) | 'white'
  removeBackground?: boolean; // default true
  magentaTolerance?: number; // Toleransi warna dalam persen: default 14 (±13-15%)
  defringeMagenta?: boolean; // Defringe tepi untuk menghilangkan sisa halo magenta (default true)
  makeWhiteTransparent: boolean; // backward compatibility
  keepInnerWhite: boolean; // Opsi: Warna putih di bagian tengah/dalam tidak dibikin transparan (otomatis AKTIF saat bgMode === 'white')
  whiteTolerance: number; // 180 to 255 (default 242)
  whiteRemovalMode: WhiteRemovalMode;
  transparentColors?: string[]; // Optional specific hex colors to treat as transparent
  // Area putih per klik (mode Putih): override per area, disimpan per gambar
  whiteRegionOverrides?: WhiteRegionOverride[];
  defringeWhite?: boolean; // Bersihkan halo putih di tepi objek (default true)
  // Bayangan lembut abu-abu di bawah objek
  removeShadow?: boolean; // default false = bayangan dipertahankan
  shadowMinLight?: number; // Kecerahan minimum piksel bayangan yang ikut dihapus (0..255, default 170)
  // Gradasi warna → gradient vektor asli
  detectGradients?: boolean; // default true
  gradientTolerance?: number; // RMSE maksimum (0..255) agar model gradien diterima, default 9
  epsGradientMode?: EpsGradientMode; // 'shading' (Level 3, default) | 'bands' (pita warna, Level 2)
  // Curve fitting & tracing geometry
  curveStyle: 'spline' | 'polygon'; // "Organik" (spline) vs "Geometris" (polygon)
  mode: 'spline' | 'polygon';
  hierarchical: 'stacked' | 'cutout';
  filterSpeckle: number; // Speckle noise suppression in pixels (default 8-16)
  cornerThreshold: number; // Sharp corner preservation threshold in degrees (lower = sharper corners, e.g. 25-35)
  lengthThreshold?: number; // Minimum segment length in px (higher = longer straight lines, e.g. 8-14)
  rdpTolerance?: number; // Ramer-Douglas-Peucker polygon simplification tolerance in px (default 1.0)
  snapVertices?: boolean; // Snap adjacent vertices to eliminate seams/gaps between facets (default true)
  layerDifference?: number;
  pathPrecision?: number;
  maxDimension?: number;
  optimizeOutput: boolean;
}

export interface ColorSwatch {
  hex: string;
  r: number;
  g: number;
  b: number;
  a: number;
  rgbStr: string;
  count?: number;
  isWhite?: boolean;
  isTransparent?: boolean;
  isLocked?: boolean;
}

export interface VectorResult {
  svgString: string;
  epsString: string;
  width: number;
  height: number;
  outputMegaPixels?: number;
  outputResolutionPreset?: OutputResolutionPreset;
  colorCount: number;
  pathCount: number;
  palette: ColorSwatch[];
  svgSize: number;
  epsSize: number;
  processingTimeMs: number;
  engineUsed: string;
  engineVersion?: string;
  hasTransparency: boolean;
  colorSnappingUsed?: boolean;
  activeMode?: 'polygon' | 'spline';
  rawColorCount?: number;
  mergedColorCount?: number;
  actualUpscaleFactor?: number;
  warnings?: string[];
  /** Jumlah area yang menjadi gradient vektor asli */
  gradientCount?: number;
  /** Jumlah area bergradasi yang tidak cocok model → dipecah menjadi pita warna */
  gradientFallbackCount?: number;
  /** Statistik area putih (mode Putih) */
  whiteRegions?: { removed: number; kept: number; overridden: number };
  /** true bila vtracer gagal dan gambar diproses ImageTracer (fallback) */
  usedFallback?: boolean;
  qualityScore: 'optimal' | 'good' | 'warning';
  qualityMessage?: string;
}

export interface ImageQueueItem {
  id: string;
  file?: File;
  name: string;
  previewUrl: string;
  originalSize: number;
  width: number;
  height: number;
  status: 'idle' | 'processing' | 'completed' | 'error';
  progress: number;
  error?: string;
  config: VectorizeConfig;
  result?: VectorResult;
  actualUpscaleFactor?: number;
}

export interface PresetDefinition {
  id: VectorPresetId;
  name: string;
  description: string;
  iconName: string;
  badge?: string;
  config: Partial<VectorizeConfig>;
}
