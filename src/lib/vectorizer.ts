// @ts-ignore
import ImageTracerModule from 'imagetracerjs';
import { convertSvgToEps, parseColor } from './epsConverter';
import {
  ColorSwatch,
  PresetDefinition,
  VectorizeConfig,
  VectorResult,
} from '../types';
import {
  extractDominantPalette,
  applyColorSnapping,
  buildEdgeGradientMask,
  snapEdgesToLocalColors,
  majorityFilter,
  growTransparentSimilar,
  optimizeAndMergeSvg,
  hexToRgb,
} from './colorSnapping';
import { bicubicUpscale } from './resampler';
import { bakeTransformsWithSvgPath } from './svgTransformBaker';
import { calculateTargetDimensions, scaleSvg } from './svgRescaler';
import { buildVtracerOptions } from './vtracerOptions';
import { vectorizeRgbaInWorker } from './vtracerClient';
import { applyWhiteBackgroundRemoval } from './whiteRegions';
import {
  detectGradientRegions,
  punchGradientRegions,
  regionMaskToRgba,
  GradientRegion,
} from './gradientDetect';
import { injectGradients, gradientStopColors } from './gradientSvg';
import svgpath from 'svgpath';

function getImageTracer() {
  if (typeof window !== 'undefined' && (window as any).ImageTracer) {
    return (window as any).ImageTracer;
  }
  const mod: any = ImageTracerModule;
  if (mod && typeof mod.imagedataToSVG === 'function') {
    return mod;
  }
  if (mod && mod.default && typeof mod.default.imagedataToSVG === 'function') {
    return mod.default;
  }
  return mod;
}

export const PRESETS: PresetDefinition[] = [
  {
    id: 'full_color',
    name: 'Multi-Color HD (Kurva Halus)',
    description: 'Vektor multi-warna dengan kurva spline halus (huruf & angka bulat rapi), sudut tetap tajam.',
    iconName: 'Shapes',
    badge: 'Rekomendasi Utama',
    config: {
      preset: 'full_color',
      engine: 'vtracer',
      upscale: 4,
      maxColors: 24,
      colorPrecision: 8,
      colorSnapping: true,
      snappedColorCount: 16,
      curveStyle: 'spline',
      mode: 'spline',
      hierarchical: 'stacked',
      filterSpeckle: 12,
      cornerThreshold: 60,
      lengthThreshold: 4,
      rdpTolerance: 1.0,
      snapVertices: true,
      bgMode: 'magenta',
      removeBackground: true,
      magentaTolerance: 14,
      defringeMagenta: true,
      makeWhiteTransparent: false,
      keepInnerWhite: false,
      whiteTolerance: 242,
      whiteRemovalMode: 'floodfill',
      optimizeOutput: true,
    },
  },
  {
    id: 'color_logo',
    name: 'Logo & Poligon Tajam',
    description: 'Bentuk geometris lurus tegas, sudut tajam, garis presisi tanpa gerigi, dan palet terkunci.',
    iconName: 'Shapes',
    badge: 'Geometris',
    config: {
      preset: 'color_logo',
      engine: 'vtracer',
      upscale: 4,
      maxColors: 12,
      colorPrecision: 8,
      colorSnapping: true,
      snappedColorCount: 8,
      curveStyle: 'polygon',
      mode: 'polygon',
      hierarchical: 'stacked',
      filterSpeckle: 12,
      cornerThreshold: 25,
      lengthThreshold: 12,
      rdpTolerance: 1.0,
      snapVertices: true,
      bgMode: 'magenta',
      removeBackground: true,
      magentaTolerance: 14,
      defringeMagenta: true,
      makeWhiteTransparent: false,
      keepInnerWhite: false,
      whiteTolerance: 245,
      whiteRemovalMode: 'floodfill',
      optimizeOutput: true,
    },
  },
  {
    id: 'illustration',
    name: 'Ilustrasi & Digital Art',
    description: 'Sangat cocok untuk gambar digital, karakter, & stiker multi-warna tanpa background.',
    iconName: 'Palette',
    badge: 'Karakter / Stiker',
    config: {
      preset: 'illustration',
      engine: 'vtracer',
      upscale: 4,
      maxColors: 24,
      colorPrecision: 8,
      colorSnapping: true,
      snappedColorCount: 14,
      curveStyle: 'spline',
      mode: 'spline',
      hierarchical: 'stacked',
      filterSpeckle: 10,
      cornerThreshold: 60,
      lengthThreshold: 4,
      rdpTolerance: 1.0,
      snapVertices: true,
      bgMode: 'magenta',
      removeBackground: true,
      magentaTolerance: 14,
      defringeMagenta: true,
      makeWhiteTransparent: false,
      keepInnerWhite: false,
      whiteTolerance: 240,
      whiteRemovalMode: 'floodfill',
      optimizeOutput: true,
    },
  },
  {
    id: 'flat_vector',
    name: 'Flat Graphic / Solid',
    description: 'Blok warna solid minimalis (8–12 warna), sangat bersih untuk sablon & cutting vinyl.',
    iconName: 'Layers',
    badge: 'Cetak / Cutting',
    config: {
      preset: 'flat_vector',
      engine: 'vtracer',
      upscale: 2,
      maxColors: 10,
      colorPrecision: 7,
      colorSnapping: true,
      snappedColorCount: 8,
      curveStyle: 'polygon',
      mode: 'polygon',
      hierarchical: 'stacked',
      filterSpeckle: 12,
      cornerThreshold: 60,
      bgMode: 'magenta',
      removeBackground: true,
      magentaTolerance: 14,
      defringeMagenta: true,
      makeWhiteTransparent: false,
      keepInnerWhite: false,
      whiteTolerance: 245,
      whiteRemovalMode: 'floodfill',
      optimizeOutput: true,
    },
  },
  {
    id: 'photo_deep',
    name: 'Foto & Realistic (Detail)',
    description: 'Kedalaman palet 24-32 warna untuk gradasi foto potret & objek nyata.',
    iconName: 'Camera',
    badge: 'Foto Detail',
    config: {
      preset: 'photo_deep',
      engine: 'vtracer',
      upscale: 2,
      maxColors: 32,
      colorPrecision: 8,
      colorSnapping: true,
      snappedColorCount: 24,
      curveStyle: 'spline',
      mode: 'spline',
      hierarchical: 'stacked',
      filterSpeckle: 8,
      cornerThreshold: 75,
      bgMode: 'magenta',
      removeBackground: false,
      magentaTolerance: 14,
      defringeMagenta: true,
      makeWhiteTransparent: false,
      keepInnerWhite: false,
      whiteTolerance: 242,
      whiteRemovalMode: 'floodfill',
      optimizeOutput: true,
    },
  },
  {
    id: 'posterized',
    name: 'Pop Art / Poster Retro',
    description: 'Gaya visual poster pop-art retro dengan warna kontras ekspresif.',
    iconName: 'Sparkles',
    config: {
      preset: 'posterized',
      engine: 'vtracer',
      upscale: 1,
      maxColors: 8,
      colorPrecision: 6,
      colorSnapping: true,
      snappedColorCount: 6,
      curveStyle: 'polygon',
      mode: 'polygon',
      hierarchical: 'stacked',
      filterSpeckle: 14,
      cornerThreshold: 65,
      bgMode: 'magenta',
      removeBackground: true,
      magentaTolerance: 14,
      defringeMagenta: true,
      makeWhiteTransparent: false,
      keepInnerWhite: false,
      whiteTolerance: 242,
      whiteRemovalMode: 'floodfill',
      optimizeOutput: true,
    },
  },
  {
    id: 'monochrome',
    name: 'Monochrome (Hitam Putih)',
    description: 'Tracing 1-bit siluet hitam putih bersih untuk cap, grafir laser, stensil.',
    iconName: 'Contrast',
    badge: 'Hitam Putih',
    config: {
      preset: 'monochrome',
      engine: 'vtracer',
      upscale: 2,
      maxColors: 2,
      colorPrecision: 6,
      colorSnapping: true,
      snappedColorCount: 2,
      curveStyle: 'polygon',
      mode: 'polygon',
      hierarchical: 'stacked',
      filterSpeckle: 12,
      cornerThreshold: 50,
      bgMode: 'white',
      removeBackground: true,
      magentaTolerance: 14,
      defringeMagenta: false,
      makeWhiteTransparent: true,
      keepInnerWhite: false,
      whiteTolerance: 230,
      whiteRemovalMode: 'global',
      optimizeOutput: true,
    },
  },
];

/** Kunci pengaturan background yang TIDAK boleh ditimpa saat memilih preset. */
const BACKGROUND_KEYS: Array<keyof VectorizeConfig> = [
  'bgMode',
  'removeBackground',
  'magentaTolerance',
  'defringeMagenta',
  'makeWhiteTransparent',
  'keepInnerWhite',
  'whiteTolerance',
  'whiteRemovalMode',
  'whiteRegionOverrides',
  'removeShadow',
  'shadowMinLight',
  'defringeWhite',
];

/** Terapkan preset tanpa mengubah pilihan background / area putih / bayangan pengguna. */
export function applyPreset(config: VectorizeConfig, preset: PresetDefinition): VectorizeConfig {
  const next: Partial<VectorizeConfig> = { ...preset.config };
  for (const k of BACKGROUND_KEYS) delete next[k];
  return { ...config, ...next, preset: preset.id };
}

export const DEFAULT_CONFIG: VectorizeConfig = {
  engine: 'vtracer',
  preset: 'full_color',
  upscale: 4,
  outputResolutionPreset: '15mp',
  outputMegaPixels: 15,
  maxColors: 24,
  colorPrecision: 8,
  colorSnapping: true,
  snappedColorCount: 24,
  curveStyle: 'spline',
  mode: 'spline',
  hierarchical: 'stacked',
  filterSpeckle: 12,
  cornerThreshold: 60,
  lengthThreshold: 4,
  rdpTolerance: 1.0,
  snapVertices: true,
  // Background: Putih #FFFFFF default (Magenta tetap tersedia sebagai opsi)
  bgMode: 'white',
  removeBackground: true,
  magentaTolerance: 14,
  defringeMagenta: true,
  makeWhiteTransparent: true,
  keepInnerWhite: true,
  whiteTolerance: 242,
  whiteRemovalMode: 'floodfill',
  defringeWhite: true,
  whiteRegionOverrides: [],
  // Bayangan lembut: default dipertahankan
  removeShadow: false,
  shadowMinLight: 170,
  // Gradasi warna → gradient vektor asli (cadangan: pita warna)
  detectGradients: true,
  gradientTolerance: 8,
  epsGradientMode: 'shading',
  pathPrecision: 2,
  optimizeOutput: true,
};

function componentToHex(c: number): string {
  const hex = Math.round(c).toString(16);
  return hex.length === 1 ? '0' + hex : hex;
}

export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + componentToHex(r) + componentToHex(g) + componentToHex(b);
}

/**
 * Calculates normalized Euclidean distance in RGB to pure Magenta (255, 0, 255)
 * Returns a percentage from 0% to 100%.
 * Pure Magenta = 0%
 * Red (#FF0000) = 57.7%
 * White (#FFFFFF) = 57.7%
 * Blue (#0000FF) = 57.7%
 * Black (#000000) = 81.6%
 */
export function getMagentaDistancePercent(r: number, g: number, b: number): number {
  const dr = r - 255;
  const dg = g - 0;
  const db = b - 255;
  return (Math.sqrt(dr * dr + dg * dg + db * db) / 441.67295593) * 100;
}

/**
 * Intelligent Background Transparency Processor
 * Supports:
 * 1. Magenta #FF00FF (Default):
 *    - Removes magenta within color distance tolerance (default ±14%).
 *    - Defringes boundary pixels to eliminate pink/magenta halos.
 *    - White details inside icons/shapes are 100% preserved!
 * 2. Putih #FFFFFF (Fallback):
 *    - Flood-fills white from the 4 outer borders.
 *    - Inner white (keepInnerWhite) is preserved by default.
 */
export type WhiteRegionStats = { removed: number; kept: number; overridden: number };

export function applyBackgroundTransparency(
  imageData: ImageData,
  config: VectorizeConfig,
  upscale = 1
): WhiteRegionStats | undefined {
  const { width, height, data } = imageData;
  const totalPixels = width * height;

  const bgMode = config.bgMode || 'white';
  const isRemovalActive = config.removeBackground !== false;

  if (!isRemovalActive && (!config.transparentColors || config.transparentColors.length === 0)) {
    return undefined;
  }

  // Protect locked palette colors from removal (Requirement 4)
  const isPixelProtected = (r: number, g: number, b: number): boolean => {
    if (!config.lockedPalette || config.lockedPalette.length === 0) return false;
    for (const hex of config.lockedPalette) {
      const l = hexToRgb(hex);
      const dr = r - l.r;
      const dg = g - l.g;
      const db = b - l.b;
      const dist = (Math.sqrt(dr * dr + dg * dg + db * db) / 441.67295593) * 100;
      if (dist <= 12) return true;
    }
    return false;
  };

  const isPixelMatchCustom = (idx: number): boolean => {
    if (!config.transparentColors || config.transparentColors.length === 0) return false;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const hex = rgbToHex(r, g, b).toUpperCase();
    for (const targetHex of config.transparentColors) {
      if (targetHex.toUpperCase() === hex) return true;
    }
    return false;
  };

  // ==========================================
  // MODE MAGENTA (#FF00FF) - DEFAULT
  // ==========================================
  if (bgMode === 'magenta') {
    const tolPercent = config.magentaTolerance ?? 14;

    // Pass 1: Mark all magenta pixels within tolerance as transparent
    for (let i = 0; i < totalPixels; i++) {
      const idx = i * 4;
      if (data[idx + 3] < 20) continue;

      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      if (isPixelProtected(r, g, b)) {
        continue; // Protected locked color (e.g. Red #FF0000)
      }

      const dist = getMagentaDistancePercent(r, g, b);
      if (dist <= tolPercent || isPixelMatchCustom(idx)) {
        data[idx + 3] = 0; // Make transparent
      }
    }

    // Pass 2: Defringe edges to eliminate pink / magenta halo (Requirement 2)
    if (config.defringeMagenta !== false) {
      const boundaryIndices: number[] = [];
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 4;
          if (data[idx + 3] < 30) continue;

          // Check if adjacent to transparent pixel
          const isAdjacentToTransparent =
            (x > 0 && data[((y * width + (x - 1)) * 4) + 3] < 30) ||
            (x < width - 1 && data[((y * width + (x + 1)) * 4) + 3] < 30) ||
            (y > 0 && data[(((y - 1) * width + x) * 4) + 3] < 30) ||
            (y < height - 1 && data[(((y + 1) * width + x) * 4) + 3] < 30);

          if (isAdjacentToTransparent) {
            boundaryIndices.push(idx);
          }
        }
      }

      for (const idx of boundaryIndices) {
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        if (isPixelProtected(r, g, b)) continue;

        const dist = getMagentaDistancePercent(r, g, b);

        // Trim boundary pixel if it is mostly magenta anti-aliasing blend
        if (dist <= tolPercent + 8) {
          data[idx + 3] = 0;
          continue;
        }

        // Decontaminate boundary pixel if it has magenta color bleed
        const isMagentaTinted = (r > g + 25) && (b > g + 25) && dist < 42;
        if (isMagentaTinted) {
          const px = (idx / 4) % width;
          const py = Math.floor((idx / 4) / width);

          let sumR = 0, sumG = 0, sumB = 0, count = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = px + dx;
              const ny = py + dy;
              if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                const nIdx = (ny * width + nx) * 4;
                if (data[nIdx + 3] > 150) {
                  const nr = data[nIdx];
                  const ng = data[nIdx + 1];
                  const nb = data[nIdx + 2];
                  if (getMagentaDistancePercent(nr, ng, nb) > 35) {
                    sumR += nr;
                    sumG += ng;
                    sumB += nb;
                    count++;
                  }
                }
              }
            }
          }

          if (count > 0) {
            const avgR = Math.round(sumR / count);
            const avgG = Math.round(sumG / count);
            const avgB = Math.round(sumB / count);
            data[idx] = Math.round(r * 0.25 + avgR * 0.75);
            data[idx + 1] = Math.round(g * 0.25 + avgG * 0.75);
            data[idx + 2] = Math.round(b * 0.25 + avgB * 0.75);
          }
        }
      }
    }

    return undefined;
  }

  // ==========================================
  // MODE PUTIH (#FFFFFF) — area putih per klik + bayangan + defringe
  // ==========================================
  let stats: WhiteRegionStats | undefined;
  if (isRemovalActive) {
    const { map } = applyWhiteBackgroundRemoval(imageData, config, upscale);
    stats = { removed: 0, kept: 0, overridden: 0 };
    for (const r of map.regions) {
      if (r.removed) stats.removed++;
      else stats.kept++;
      if (r.overridden) stats.overridden++;
    }
  }
  if (config.transparentColors && config.transparentColors.length > 0) {
    for (let i = 0; i < totalPixels; i++) {
      if (isPixelMatchCustom(i * 4)) data[i * 4 + 3] = 0;
    }
  }
  return stats;
}

// Backward-compatible alias
export const applyWhiteTransparency = applyBackgroundTransparency;

/**
 * Loads an image onto offscreen canvas, applies upscale & white transparency pre-processing.
 */
export function loadImageToCanvas(
  src: string,
  config: VectorizeConfig,
  withGradients = false
): Promise<{
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  imageData: ImageData;
  rawColorCount: number;
  mergedColorCount: number;
  effectiveScale: number;
  snappedPalette?: string[];
  gradientRegions: GradientRegion[];
  gradientFallbackCount: number;
  whiteStats?: WhiteRegionStats;
}> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      const origW = img.naturalWidth || img.width;
      const origH = img.naturalHeight || img.height;

      const baseCanvas = document.createElement('canvas');
      baseCanvas.width = origW;
      baseCanvas.height = origH;
      const baseCtx = baseCanvas.getContext('2d', { willReadFrequently: true });
      if (!baseCtx) {
        reject(new Error('Failed to get 2D canvas context'));
        return;
      }
      baseCtx.drawImage(img, 0, 0, origW, origH);
      const rawNativeData = baseCtx.getImageData(0, 0, origW, origH);

      // Resolusi kerja 3200 px: cukup untuk teks/angka kecil pada gambar ~1400 px (upscale ±2,3×).
      const MAX_WORKING_DIM = config.maxDimension || 3200;
      const maxSourceDim = Math.max(origW, origH);
      let effectiveScale = 1;
      let workingImageData: ImageData;

      if (maxSourceDim < MAX_WORKING_DIM / 1.15) {
        const requestedScale = config.upscale || 4;
        effectiveScale = Math.min(requestedScale, MAX_WORKING_DIM / maxSourceDim);
        if (effectiveScale < 1.15) effectiveScale = 1;
      } else if (maxSourceDim > MAX_WORKING_DIM) {
        effectiveScale = MAX_WORKING_DIM / maxSourceDim;
      } else {
        effectiveScale = 1;
      }

      if (effectiveScale > 1) {
        workingImageData = bicubicUpscale(rawNativeData, effectiveScale);
      } else if (effectiveScale < 1) {
        const dw = Math.round(origW * effectiveScale);
        const dh = Math.round(origH * effectiveScale);
        const downCanvas = document.createElement('canvas');
        downCanvas.width = dw;
        downCanvas.height = dh;
        const downCtx = downCanvas.getContext('2d', { willReadFrequently: true });
        if (downCtx) {
          downCtx.imageSmoothingEnabled = true;
          downCtx.imageSmoothingQuality = 'high';
          downCtx.drawImage(img, 0, 0, dw, dh);
          workingImageData = downCtx.getImageData(0, 0, dw, dh);
        } else {
          workingImageData = rawNativeData;
        }
      } else {
        workingImageData = rawNativeData;
      }

      const w = workingImageData.width;
      const h = workingImageData.height;
      let rawColorCount = config.snappedColorCount || config.maxColors || 12;
      let mergedColorCount = rawColorCount;
      let snappedPalette: string[] | undefined = undefined;

      // 1. Background transparan DULU (pada piksel asli, sebelum snapping) supaya deteksi
      //    gradasi dan palet tidak tercemar warna latar.
      const isBgRemovalActive = config.removeBackground !== false;
      let whiteStats: WhiteRegionStats | undefined;
      if (isBgRemovalActive || (config.transparentColors && config.transparentColors.length > 0)) {
        whiteStats = applyBackgroundTransparency(workingImageData, config, effectiveScale);
      }

      // 2. Gradasi → gradient vektor asli. Area yang cocok dilubangi dari lapisan datar.
      let gradientRegions: GradientRegion[] = [];
      let gradientFallbackCount = 0;
      if (withGradients && config.detectGradients !== false) {
        const det = detectGradientRegions(workingImageData, { maxRmse: config.gradientTolerance ?? 8 });
        gradientRegions = det.regions;
        gradientFallbackCount = det.fallbackCount;
        punchGradientRegions(workingImageData, gradientRegions);
      }

      // 3. Color snapping (area gradien sudah transparan → tidak ikut menentukan palet).
      if (config.colorSnapping !== false) {
        const targetK = config.snappedColorCount || config.maxColors || 12;
        const dominantPalette = extractDominantPalette(
          workingImageData,
          targetK,
          config.lockedPalette || []
        );
        const preSnap = new Uint8ClampedArray(workingImageData.data);
        const edgeMask = buildEdgeGradientMask(workingImageData, 24);
        applyColorSnapping(workingImageData, dominantPalette);
        snapEdgesToLocalColors(
          workingImageData,
          preSnap,
          edgeMask,
          Math.max(2, Math.min(5, Math.round(effectiveScale * 1.5)))
        );
        growTransparentSimilar(workingImageData, preSnap, 2, 30);
        if (config.smoothEdges !== false) majorityFilter(workingImageData, 2);
        rawColorCount = dominantPalette.rawColorCount;
        mergedColorCount = dominantPalette.mergedColorCount;
        snappedPalette = dominantPalette.map((c) => c.hex);
      }

      if (snappedPalette && isBgRemovalActive && (config.bgMode ?? 'white') === 'magenta') {
        snappedPalette = snappedPalette.filter((hex) => {
          const rgb = hexToRgb(hex);
          return getMagentaDistancePercent(rgb.r, rgb.g, rgb.b) > (config.magentaTolerance ?? 14);
        });
      }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        reject(new Error('Failed to get 2D canvas context'));
        return;
      }
      ctx.putImageData(workingImageData, 0, 0);

      resolve({
        canvas,
        ctx,
        width: w,
        height: h,
        imageData: workingImageData,
        rawColorCount,
        mergedColorCount,
        effectiveScale,
        snappedPalette,
        gradientRegions,
        gradientFallbackCount,
        whiteStats,
      });
    };
    img.onerror = () => reject(new Error('Failed to load image for vectorization'));
    img.src = src;
  });
}

/**
 * Extracts unique colors used in an SVG and counts occurrences
 */
export function extractColorsFromSvg(svgString: string): ColorSwatch[] {
  const colorMap = new Map<string, ColorSwatch>();
  const fillRegex = /fill=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;

  while ((match = fillRegex.exec(svgString)) !== null) {
    const fill = match[1].trim();
    if (fill === 'none' || fill === 'transparent') continue;

    if (fill.startsWith('#')) {
      let hex = fill.toUpperCase();
      if (hex.length === 4) {
        hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
      }
      if (hex.length === 7) {
        const r = parseInt(hex.substring(1, 3), 16);
        const g = parseInt(hex.substring(3, 5), 16);
        const b = parseInt(hex.substring(5, 7), 16);
        const isWhite = r > 240 && g > 240 && b > 240;

        const existing = colorMap.get(hex);
        if (existing) {
          existing.count = (existing.count || 1) + 1;
        } else {
          colorMap.set(hex, {
            hex,
            r,
            g,
            b,
            a: 1,
            rgbStr: `rgb(${r}, ${g}, ${b})`,
            count: 1,
            isWhite,
          });
        }
      }
      continue;
    }

    const rgbMatch = fill.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/i);
    if (rgbMatch) {
      const r = parseInt(rgbMatch[1], 10);
      const g = parseInt(rgbMatch[2], 10);
      const b = parseInt(rgbMatch[3], 10);
      const a = rgbMatch[4] !== undefined ? parseFloat(rgbMatch[4]) : 1;
      const hex = rgbToHex(r, g, b).toUpperCase();
      const isWhite = r > 240 && g > 240 && b > 240;

      const existing = colorMap.get(hex);
      if (existing) {
        existing.count = (existing.count || 1) + 1;
      } else {
        colorMap.set(hex, {
          hex,
          r,
          g,
          b,
          a,
          rgbStr: `rgb(${r}, ${g}, ${b})`,
          count: 1,
          isWhite,
        });
      }
    }
  }

  return Array.from(colorMap.values()).sort((a, b) => (b.count || 0) - (a.count || 0));
}

/**
 * Filter out remaining white paths from SVG if makeWhiteTransparent is enabled
 */
export function filterWhitePathsInSvg(svgString: string, tolerance = 242): string {
  return svgString.replace(/<path\b([^>]*)\/?>/gi, (fullMatch, attrs) => {
    let fill = '';
    const fillMatch = attrs.match(/\bfill=["']([^"']+)["']/i);
    if (fillMatch) {
      fill = fillMatch[1].trim();
    } else {
      const styleMatch = attrs.match(/\bstyle=["']([^"']+)["']/i);
      if (styleMatch) {
        const styleFill = styleMatch[1].match(/\bfill:\s*([^;]+)/i);
        if (styleFill) fill = styleFill[1].trim();
      }
    }
    if (!fill) return fullMatch;

    const lower = fill.toLowerCase();
    if (lower === 'white' || lower === '#ffffff' || lower === '#fff') {
      return '';
    }

    if (fill.startsWith('#')) {
      let hex = fill.slice(1);
      if (hex.length === 3) hex = hex.split('').map((c: string) => c + c).join('');
      if (hex.length >= 6) {
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        if (r >= tolerance && g >= tolerance && b >= tolerance) {
          return '';
        }
      }
    } else if (fill.startsWith('rgb')) {
      const m = fill.match(/\d+/g);
      if (m && m.length >= 3) {
        const r = parseInt(m[0], 10);
        const g = parseInt(m[1], 10);
        const b = parseInt(m[2], 10);
        if (r >= tolerance && g >= tolerance && b >= tolerance) {
          return '';
        }
      }
    }

    return fullMatch;
  });
}

/**
 * Filter out remaining magenta paths from SVG if magenta background removal is enabled
 */
export function filterMagentaPathsInSvg(svgString: string, tolPercent = 14): string {
  return svgString.replace(/<path\b([^>]*)\/?>/gi, (fullMatch, attrs) => {
    let fill = '';
    const fillMatch = attrs.match(/\bfill=["']([^"']+)["']/i);
    if (fillMatch) {
      fill = fillMatch[1].trim();
    } else {
      const styleMatch = attrs.match(/\bstyle=["']([^"']+)["']/i);
      if (styleMatch) {
        const styleFill = styleMatch[1].match(/\bfill:\s*([^;]+)/i);
        if (styleFill) fill = styleFill[1].trim();
      }
    }
    if (!fill || fill === 'none') return fullMatch;

    const color = parseColor(fill);
    if (color) {
      const r = Math.round(color.r * 255);
      const g = Math.round(color.g * 255);
      const b = Math.round(color.b * 255);
      if (getMagentaDistancePercent(r, g, b) <= tolPercent) {
        return '';
      }
    }

    return fullMatch;
  });
}

function sleep(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Post-processing that used to run in the Express endpoint (server.ts),
 * moved 1:1 to the browser: bake transforms, drop background-colored paths,
 * and normalize the root <svg> attributes.
 */
function postProcessVtracerSvg(rawSvg: string, w: number, h: number, config: VectorizeConfig): string {
  if (!rawSvg || !rawSvg.includes('<svg')) {
    throw new Error('Gagal menghasilkan kurva vektor SVG dari gambar.');
  }

  let svg = bakeTransformsWithSvgPath(rawSvg);

  const isMagentaMode = (config.bgMode ?? 'white') === 'magenta';
  const isBgRemoval = config.removeBackground !== false;

  // Mode Putih: penghapusan sudah dilakukan per area di raster (termasuk pilihan putih dalam),
  // jadi path putih yang tersisa memang dipertahankan dan TIDAK boleh disaring di sini.
  if (isMagentaMode && isBgRemoval) {
    svg = filterMagentaPathsInSvg(svg, config.magentaTolerance ?? 14);
  }

  if (!svg.includes('viewBox')) {
    svg = svg.replace('<svg ', `<svg viewBox="0 0 ${w} ${h}" `);
  }
  if (!svg.includes('preserveAspectRatio')) {
    svg = svg.replace('<svg ', '<svg preserveAspectRatio="xMidYMid meet" ');
  }

  svg = svg.replace(/<svg\s+([^>]+)>/i, (match) => {
    let clean = match;
    clean = clean.replace(/\bwidth=["'][^"']+["']/gi, 'width="100%"');
    clean = clean.replace(/\bheight=["'][^"']+["']/gi, 'height="100%"');
    if (!clean.includes('width=')) clean = clean.replace('<svg', '<svg width="100%"');
    if (!clean.includes('height=')) clean = clean.replace('<svg', '<svg height="100%"');
    return clean;
  });

  return svg;
}

/**
 * High quality vectorization with @visioncortex/vtracer (Rust → WebAssembly),
 * running entirely in the browser inside a Web Worker. No server, no upload.
 */
async function vectorizeWithVtracer(
  imageSrc: string,
  config: VectorizeConfig,
  fileName = 'vector_output',
  onProgress?: (pct: number) => void
): Promise<VectorResult> {
  const startTime = performance.now();
  onProgress?.(15);
  await sleep(10);

  const {
    width,
    height,
    imageData,
    rawColorCount,
    mergedColorCount,
    effectiveScale,
    snappedPalette,
    gradientRegions,
    gradientFallbackCount,
    whiteStats,
  } = await loadImageToCanvas(imageSrc, config, true);
  onProgress?.(40);

  // Filter bintik dinyatakan untuk upscale 4×; pada upscale lebih kecil diperkecil sebanding
  // supaya detail kecil (baut velg, garis pintu) tidak ikut terbuang.
  const speckle = scaledSpeckle(config, effectiveScale);
  const vtracerOptions = buildVtracerOptions({ ...config, filterSpeckle: speckle, mergedColorCount, snappedPalette });
  // Lapisan warna datar + setiap masker gradien di-trace paralel di pool worker.
  // Buffer piksel dipindahkan (zero-copy) ke worker; imageData tidak dipakai lagi setelah ini.
  const flatJob = vectorizeRgbaInWorker(imageData.data, width, height, vtracerOptions);
  const gradientJobs = gradientRegions.map((r) => traceGradientRegion(r, { ...config, filterSpeckle: speckle }));
  const [{ svg: rawSvg }, gradientDs] = await Promise.all([flatJob, Promise.all(gradientJobs)]);
  onProgress?.(80);

  let finalSvg = bakeTransformsWithSvgPath(postProcessVtracerSvg(rawSvg, width || 600, height || 600, config));

  const gradientItems = gradientRegions
    .map((r, i) => ({ spec: r.spec, d: gradientDs[i] }))
    .filter((it) => it.d.length > 0);
  const idPrefix = `vg${Math.random().toString(36).slice(2, 6)}_`;
  finalSvg = injectGradients(finalSvg, gradientItems, idPrefix);

  const outputPreset = config.outputResolutionPreset || '15mp';
  let outW = width || 600;
  let outH = height || 600;
  let outMP = Number(((outW * outH) / 1000000).toFixed(2));

  if (outputPreset !== 'native') {
    let targetMP = 15;
    if (outputPreset === '20mp') targetMP = 20;
    else if (outputPreset === '25mp') targetMP = 25;
    else if (outputPreset === '30mp') targetMP = 30;
    else targetMP = Math.max(15, config.outputMegaPixels || 15);

    const dims = calculateTargetDimensions(outW, outH, targetMP);
    finalSvg = scaleSvg(finalSvg, dims.width, dims.height);
    outW = dims.width;
    outH = dims.height;
    outMP = dims.megaPixels;
  }

  const finalEps = buildEpsForConfig(finalSvg, fileName, config);

  const palette = extractColorsFromSvg(finalSvg);
  const pathMatches = finalSvg.match(/<path\b/gi);
  const pathCount = pathMatches ? pathMatches.length : 0;
  const svgBytes = new Blob([finalSvg]).size;
  const epsBytes = new Blob([finalEps]).size;

  let qualityScore: 'optimal' | 'good' | 'warning' = 'optimal';
  let qualityMessage = 'Kualitas sangat rapi dan ukuran berkas optimal.';
  if (pathCount > 80 || svgBytes > 150000) {
    qualityScore = 'warning';
    qualityMessage = `Jumlah path agak tinggi (${pathCount} path, ${(svgBytes/1024).toFixed(0)} KB). Disarankan aktifkan Color Snapping atau naikkan Filter Bintik.`;
  } else if (pathCount > 35) {
    qualityScore = 'good';
    qualityMessage = 'Kualitas baik dan detail lengkap.';
  }

  const warnings: string[] = [];
  if (gradientFallbackCount > 0 && config.detectGradients !== false) {
    warnings.push(
      `${gradientFallbackCount} area bergradasi terlalu rumit untuk gradient linear/radial — dipecah menjadi pita warna. Naikkan "Toleransi gradasi" bila ingin dipaksa menjadi gradient.`
    );
  }

  onProgress?.(100);

  return {
    svgString: finalSvg,
    epsString: finalEps,
    width: outW,
    height: outH,
    outputMegaPixels: outMP,
    outputResolutionPreset: outputPreset,
    colorCount: palette.length + gradientStopColors(finalSvg).length || config.maxColors,
    pathCount,
    palette,
    svgSize: svgBytes,
    epsSize: epsBytes,
    processingTimeMs: Math.round(performance.now() - startTime),
    engineUsed: '@visioncortex/vtracer (Rust/WASM, browser worker)',
    engineVersion: 'v1.0.0-alpha.4',
    activeMode: config.curveStyle || config.mode || 'polygon',
    rawColorCount,
    mergedColorCount,
    actualUpscaleFactor: effectiveScale,
    warnings,
    hasTransparency: config.removeBackground !== false,
    colorSnappingUsed: Boolean(config.colorSnapping !== false),
    gradientCount: gradientItems.length,
    gradientFallbackCount,
    whiteRegions: whiteStats,
    qualityScore,
    qualityMessage,
  };
}

export function scaledSpeckle(config: VectorizeConfig, effectiveScale: number): number {
  const base = config.filterSpeckle ?? 12;
  return Math.max(2, Math.round(base * Math.min(1, effectiveScale / 4)));
}

/**
 * Trace masker satu area gradien (vtracer mode hitam-putih) → atribut `d` dalam koordinat kerja.
 * String kosong bila tracing gagal (area tetap tampil dengan warna rata-rata lapisan datar).
 */
async function traceGradientRegion(r: GradientRegion, config: VectorizeConfig): Promise<string> {
  try {
    const { rgba, width, height, pad } = regionMaskToRgba(r);
    const isPolygon = (config.curveStyle || config.mode || 'polygon') === 'polygon';
    const { svg } = await vectorizeRgbaInWorker(rgba, width, height, {
      clustering: 'bw',
      mode: isPolygon ? 'polygon' : 'spline',
      filterSpeckle: Math.min(config.filterSpeckle ?? 8, 8),
      cornerThreshold: config.cornerThreshold ?? (isPolygon ? 28 : 55),
      lengthThreshold: config.lengthThreshold ?? (isPolygon ? 10 : 4),
      pathPrecision: 2,
    });
    const baked = bakeTransformsWithSvgPath(svg);
    const ds: string[] = [];
    const re = /<path\b[^>]*\bd=["']([^"']+)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(baked)) !== null) {
      ds.push(svgpath(m[1]).translate(r.x0 - pad, r.y0 - pad).abs().round(2).toString());
    }
    return ds.join(' ');
  } catch (err) {
    console.warn('Gagal trace area gradien:', err);
    return '';
  }
}

/** EPS dari SVG akhir sesuai pengaturan (mode gradien EPS, background magenta). */
export function buildEpsForConfig(svg: string, fileName: string, config: VectorizeConfig): string {
  const epsTitle = `${fileName.replace(/\.[^/.]+$/, '')}.eps`;
  const isMagentaMode = (config.bgMode ?? 'white') === 'magenta';
  const skipMagenta = Boolean(isMagentaMode && config.removeBackground !== false);
  return convertSvgToEps(
    svg,
    epsTitle,
    false,
    skipMagenta,
    config.magentaTolerance ?? 14,
    config.epsGradientMode ?? 'shading'
  );
}

/**
 * Client-side vectorization fallback using ImageTracer.js
 */
async function vectorizeWithClient(
  imageSrc: string,
  config: VectorizeConfig,
  fileName = 'vector_output',
  onProgress?: (pct: number) => void
): Promise<VectorResult> {
  const startTime = performance.now();
  onProgress?.(20);
  await sleep(10);

  const { width, height, imageData, rawColorCount, mergedColorCount, effectiveScale } = await loadImageToCanvas(imageSrc, config);
  onProgress?.(50);
  await sleep(10);

  const tracer = getImageTracer();
  if (!tracer || typeof tracer.imagedataToSVG !== 'function') {
    throw new Error('ImageTracer engine not found or invalid');
  }

  const tracerOptions = {
    corsenabled: false,
    ltres: 0.15,
    qtres: 0.15,
    pathomit: config.filterSpeckle ?? 1,
    rightangleenhance: Boolean(config.preset === 'color_logo' || config.preset === 'monochrome'),
    colorsampling: 2,
    numberofcolors: Math.max(2, Math.min(64, config.maxColors || 32)),
    mincolorratio: 0,
    colorquantcycles: 2,
    layering: 0,
    strokewidth: 0,
    linefilter: false,
    scale: 1,
    roundcoords: 2,
    viewbox: true,
    desc: false,
    lcpr: 0,
    qcpr: 0,
    blurradius: 0,
    blurdelta: 10,
  };

  let rawSvg: string = tracer.imagedataToSVG(imageData, tracerOptions);
  onProgress?.(80);
  await sleep(10);

  const isMagentaMode = (config.bgMode ?? 'white') === 'magenta';
  const isBgRemoval = config.removeBackground !== false;

  if (isMagentaMode && isBgRemoval) {
    rawSvg = filterMagentaPathsInSvg(rawSvg, config.magentaTolerance ?? 14);
  }

  if (!rawSvg.includes('viewBox')) {
    rawSvg = rawSvg.replace('<svg ', `<svg viewBox="0 0 ${width} ${height}" `);
  }
  if (!rawSvg.includes('preserveAspectRatio')) {
    rawSvg = rawSvg.replace('<svg ', '<svg preserveAspectRatio="xMidYMid meet" ');
  }

  rawSvg = rawSvg.replace(/<svg\s+([^>]+)>/i, (match) => {
    let clean = match;
    clean = clean.replace(/\bwidth=["'][^"']+["']/gi, 'width="100%"');
    clean = clean.replace(/\bheight=["'][^"']+["']/gi, 'height="100%"');
    return clean;
  });

  rawSvg = bakeTransformsWithSvgPath(rawSvg);

  const outputPreset = config.outputResolutionPreset || '15mp';
  let outW = width;
  let outH = height;
  let outMP = Number(((outW * outH) / 1000000).toFixed(2));

  if (outputPreset !== 'native') {
    let targetMP = 15;
    if (outputPreset === '20mp') targetMP = 20;
    else if (outputPreset === '25mp') targetMP = 25;
    else if (outputPreset === '30mp') targetMP = 30;
    else if (outputPreset === 'custom') targetMP = Math.max(15, config.outputMegaPixels || 15);
    else targetMP = Math.max(15, config.outputMegaPixels || 15);

    const dims = calculateTargetDimensions(outW, outH, targetMP);
    rawSvg = scaleSvg(rawSvg, dims.width, dims.height);
    outW = dims.width;
    outH = dims.height;
    outMP = dims.megaPixels;
  }

  const palette = extractColorsFromSvg(rawSvg);
  const pathMatches = rawSvg.match(/<path\b/gi);
  const pathCount = pathMatches ? pathMatches.length : 0;
  const epsString = buildEpsForConfig(rawSvg, fileName, config);

  onProgress?.(100);
  const endTime = performance.now();
  const svgBytes = new Blob([rawSvg]).size;
  const epsBytes = new Blob([epsString]).size;

  let qualityScore: 'optimal' | 'good' | 'warning' = 'optimal';
  let qualityMessage = 'Kualitas sangat rapi dan ukuran berkas optimal.';
  if (pathCount > 80 || svgBytes > 150000) {
    qualityScore = 'warning';
    qualityMessage = `Jumlah path agak tinggi (${pathCount} path, ${(svgBytes/1024).toFixed(0)} KB). Disarankan aktifkan Color Snapping atau naikkan Filter Bintik.`;
  } else if (pathCount > 35) {
    qualityScore = 'good';
    qualityMessage = 'Kualitas baik dan detail lengkap.';
  }

  return {
    svgString: rawSvg,
    epsString,
    width: outW,
    height: outH,
    outputMegaPixels: outMP,
    outputResolutionPreset: outputPreset,
    colorCount: palette.length || config.maxColors,
    pathCount,
    palette,
    svgSize: svgBytes,
    epsSize: epsBytes,
    processingTimeMs: Math.round(endTime - startTime),
    engineUsed: 'imagetracerjs (browser client)',
    hasTransparency: Boolean(config.removeBackground !== false || config.makeWhiteTransparent),
    colorSnappingUsed: Boolean(config.colorSnapping !== false),
    rawColorCount,
    mergedColorCount,
    actualUpscaleFactor: effectiveScale,
    qualityScore,
    qualityMessage,
  };
}

/**
 * Main entry point for vectorizing images
 */
export async function vectorizeImage(
  imageSrc: string,
  config: VectorizeConfig,
  fileName = 'vector_output',
  onProgress?: (pct: number) => void
): Promise<VectorResult> {
  if (config.engine === 'imagetracer') {
    return vectorizeWithClient(imageSrc, config, fileName, onProgress);
  }

  try {
    return await vectorizeWithVtracer(imageSrc, config, fileName, onProgress);
  } catch (vtracerErr: any) {
    // Fallback TIDAK diam-diam: hasil ditandai supaya batch campuran
    // vtracer + ImageTracer (kualitas berbeda) terlihat di antrean.
    console.warn('vtracer error, falling back to ImageTracer:', vtracerErr);
    const result = await vectorizeWithClient(imageSrc, config, fileName, onProgress);
    return {
      ...result,
      usedFallback: true,
      warnings: [
        `vtracer gagal (${vtracerErr?.message || 'unknown error'}). Gambar ini diproses dengan ImageTracer (kualitas berbeda) — proses ulang sebelum submit.`,
        ...(result.warnings || []),
      ],
    };
  }
}

export function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
