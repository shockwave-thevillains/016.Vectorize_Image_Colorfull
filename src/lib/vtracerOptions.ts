import { VectorizeConfig } from '../types';

/**
 * Builds vtracer options from the app config.
 * (Moved 1:1 from the former Express endpoint in server.ts so output is unchanged.)
 */
export function buildVtracerOptions(
  cfg: VectorizeConfig & {
    mergedColorCount?: number;
    snappedPalette?: string[];
  }
): Record<string, unknown> {
  const isMonochrome = cfg.preset === 'monochrome';
  const isPoster = cfg.preset === 'posterized';

  const selectedMode = cfg.curveStyle || cfg.mode || 'polygon';
  const isPolygon = selectedMode === 'polygon';

  const effectiveColorCount = cfg.mergedColorCount || cfg.snappedColorCount || cfg.maxColors || 12;

  const options: Record<string, unknown> = {
    preset: isMonochrome ? 'bw' : isPoster ? 'poster' : 'photo',
    clustering: isMonochrome ? 'bw' : 'color-cluster',
    hierarchical: 'stacked',
    mode: selectedMode,
    colorPrecision: cfg.colorPrecision ?? 8,
    filterSpeckle: cfg.filterSpeckle ?? 12,
    cornerThreshold: cfg.cornerThreshold ?? (isPolygon ? 28 : 55),
    lengthThreshold: cfg.lengthThreshold ?? (isPolygon ? 10 : 4),
    pathPrecision: cfg.pathPrecision ?? 2,
    maxColors: Math.max(2, Math.min(64, effectiveColorCount)),
    // Warna sudah dirapikan oleh color snapping; bawaan vtracer (16) menggabungkan lagi nuansa
    // yang mirip (mis. ban hitam #25282D dengan fender #2D3A41) sehingga detail gelap hilang.
    layerDifference: cfg.layerDifference ?? 2,
  };

  if (cfg.lockedPalette && Array.isArray(cfg.lockedPalette) && cfg.lockedPalette.length > 0) {
    options.palette = cfg.lockedPalette;
  } else if (cfg.snappedPalette && Array.isArray(cfg.snappedPalette) && cfg.snappedPalette.length > 0) {
    // Palet WAJIB diserahkan: tanpa palet vtracer menggabungkan klaster mirip (bingkai kaca teal
    // tertelan badan kabin abu). Warna rata-rata klaster yang dipetakan vtracer (jarak RGB, mis.
    // huruf perak → emas) dikoreksi oleh recolorSvgByVisibility setelah tracing.
    options.palette = cfg.snappedPalette;
  }

  return options;
}
