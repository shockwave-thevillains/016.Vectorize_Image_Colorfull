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
  optimizeAndMergeSvg,
  hexToRgb,
} from './colorSnapping';
import { bicubicUpscale } from './resampler';
import { bakeTransformsWithSvgPath } from './svgTransformBaker';
import { calculateTargetDimensions, scaleSvg } from './svgRescaler';
import { buildVtracerOptions } from './vtracerOptions';
import { vectorizeRgbaInWorker } from './vtracerClient';

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
    name: 'Multi-Color HD (Geometris Presisi)',
    description: 'Vektor multi-warna tajam dengan mode polygon, sudut presisi, dan garis lurus tanpa gerigi.',
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
      curveStyle: 'polygon',
      mode: 'polygon',
      hierarchical: 'stacked',
      filterSpeckle: 12,
      cornerThreshold: 28,
      lengthThreshold: 10,
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
      curveStyle: 'polygon',
      mode: 'polygon',
      hierarchical: 'stacked',
      filterSpeckle: 10,
      cornerThreshold: 30,
      lengthThreshold: 8,
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

export const DEFAULT_CONFIG: VectorizeConfig = {
  engine: 'vtracer',
  preset: 'full_color',
  upscale: 4,
  outputResolutionPreset: '15mp',
  outputMegaPixels: 15,
  maxColors: 24,
  colorPrecision: 8,
  colorSnapping: true,
  snappedColorCount: 12,
  curveStyle: 'polygon',
  mode: 'polygon',
  hierarchical: 'stacked',
  filterSpeckle: 12,
  cornerThreshold: 28,
  lengthThreshold: 10,
  rdpTolerance: 1.0,
  snapVertices: true,
  // Background removal options: Magenta #FF00FF default, Putih #FFFFFF cadangan
  bgMode: 'magenta',
  removeBackground: true,
  magentaTolerance: 14,
  defringeMagenta: true,
  makeWhiteTransparent: false,
  keepInnerWhite: false,
  whiteTolerance: 242,
  whiteRemovalMode: 'floodfill',
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
export function applyBackgroundTransparency(
  imageData: ImageData,
  config: VectorizeConfig
): void {
  const { width, height, data } = imageData;
  const totalPixels = width * height;

  const bgMode = config.bgMode || 'magenta';
  const isRemovalActive = config.removeBackground !== false;

  if (!isRemovalActive && (!config.transparentColors || config.transparentColors.length === 0)) {
    return;
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

    return;
  }

  // ==========================================
  // MODE PUTIH (#FFFFFF) - CADANGAN
  // ==========================================
  const tol = config.whiteTolerance ?? 242;
  const isPixelWhite = (idx: number): boolean => {
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const a = data[idx + 3];
    if (a < 20) return true;
    if (isPixelProtected(r, g, b)) return false;
    return r >= tol && g >= tol && b >= tol;
  };

  if (config.keepInnerWhite === false) {
    for (let i = 0; i < totalPixels; i++) {
      const idx = i * 4;
      if (isPixelWhite(idx) || isPixelMatchCustom(idx)) {
        data[idx + 3] = 0;
      }
    }
    return;
  }

  // Floodfill from outer image border: Only outer white is removed!
  const visited = new Uint8Array(totalPixels);
  const queue = new Int32Array(totalPixels);
  let head = 0;
  let tail = 0;

  for (let x = 0; x < width; x++) {
    const topIdx = x;
    if (isPixelWhite(topIdx * 4)) {
      visited[topIdx] = 1;
      queue[tail++] = topIdx;
    }
    const bottomIdx = (height - 1) * width + x;
    if (isPixelWhite(bottomIdx * 4)) {
      visited[bottomIdx] = 1;
      queue[tail++] = bottomIdx;
    }
  }

  for (let y = 0; y < height; y++) {
    const leftIdx = y * width;
    if (!visited[leftIdx] && isPixelWhite(leftIdx * 4)) {
      visited[leftIdx] = 1;
      queue[tail++] = leftIdx;
    }
    const rightIdx = y * width + (width - 1);
    if (!visited[rightIdx] && isPixelWhite(rightIdx * 4)) {
      visited[rightIdx] = 1;
      queue[tail++] = rightIdx;
    }
  }

  while (head < tail) {
    const curr = queue[head++];
    const cx = curr % width;
    const cy = (curr / width) | 0;

    if (cx + 1 < width) {
      const nIdx = curr + 1;
      if (!visited[nIdx] && isPixelWhite(nIdx * 4)) {
        visited[nIdx] = 1;
        queue[tail++] = nIdx;
      }
    }
    if (cx > 0) {
      const nIdx = curr - 1;
      if (!visited[nIdx] && isPixelWhite(nIdx * 4)) {
        visited[nIdx] = 1;
        queue[tail++] = nIdx;
      }
    }
    if (cy + 1 < height) {
      const nIdx = curr + width;
      if (!visited[nIdx] && isPixelWhite(nIdx * 4)) {
        visited[nIdx] = 1;
        queue[tail++] = nIdx;
      }
    }
    if (cy > 0) {
      const nIdx = curr - width;
      if (!visited[nIdx] && isPixelWhite(nIdx * 4)) {
        visited[nIdx] = 1;
        queue[tail++] = nIdx;
      }
    }
  }

  for (let i = 0; i < totalPixels; i++) {
    if (visited[i] === 1 || isPixelMatchCustom(i * 4)) {
      data[i * 4 + 3] = 0;
    }
  }
}

// Backward-compatible alias
export const applyWhiteTransparency = applyBackgroundTransparency;

/**
 * Loads an image onto offscreen canvas, applies upscale & white transparency pre-processing.
 */
export function loadImageToCanvas(
  src: string,
  config: VectorizeConfig
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

      const MAX_WORKING_DIM = config.maxDimension || 2400;
      const maxSourceDim = Math.max(origW, origH);
      let effectiveScale = 1;
      let workingImageData: ImageData;

      if (maxSourceDim < 1600) {
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

      if (config.colorSnapping !== false) {
        const targetK = config.snappedColorCount || config.maxColors || 12;
        const dominantPalette = extractDominantPalette(
          workingImageData,
          targetK,
          config.lockedPalette || []
        );
        applyColorSnapping(workingImageData, dominantPalette);
        rawColorCount = dominantPalette.rawColorCount;
        mergedColorCount = dominantPalette.mergedColorCount;
        snappedPalette = dominantPalette.map((c) => c.hex);
      }

      const isBgRemovalActive = config.removeBackground !== false;
      if (isBgRemovalActive || (config.transparentColors && config.transparentColors.length > 0)) {
        applyBackgroundTransparency(workingImageData, config);
      }

      if (snappedPalette && isBgRemovalActive) {
        if ((config.bgMode ?? 'magenta') === 'magenta') {
          snappedPalette = snappedPalette.filter((hex) => {
            const rgb = hexToRgb(hex);
            return getMagentaDistancePercent(rgb.r, rgb.g, rgb.b) > (config.magentaTolerance ?? 14);
          });
        } else if (config.bgMode === 'white' && config.keepInnerWhite === false) {
          snappedPalette = snappedPalette.filter((hex) => {
            const h = hex.replace('#', '').toLowerCase();
            return h !== 'ffffff' && h !== 'fff';
          });
        }
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

  const isMagentaMode = (config.bgMode ?? 'magenta') === 'magenta';
  const isWhiteMode = config.bgMode === 'white';
  const isBgRemoval = config.removeBackground !== false;

  if (isMagentaMode && isBgRemoval) {
    svg = filterMagentaPathsInSvg(svg, config.magentaTolerance ?? 14);
  } else if (isWhiteMode && config.keepInnerWhite === false) {
    svg = filterWhitePathsInSvg(svg, config.whiteTolerance ?? 242);
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

  const { width, height, imageData, rawColorCount, mergedColorCount, effectiveScale, snappedPalette } = await loadImageToCanvas(imageSrc, config);
  onProgress?.(40);

  const vtracerOptions = buildVtracerOptions({ ...config, mergedColorCount, snappedPalette });
  // Buffer piksel dipindahkan (zero-copy) ke worker; imageData tidak dipakai lagi setelah ini.
  const { svg: rawSvg } = await vectorizeRgbaInWorker(imageData.data, width, height, vtracerOptions);
  onProgress?.(80);

  const data = {
    svgString: postProcessVtracerSvg(rawSvg, width || 600, height || 600, config),
    width: width || 600,
    height: height || 600,
    processingTimeMs: 0,
    engineUsed: '@visioncortex/vtracer (Rust/WASM, browser worker)',
    engineVersion: 'v1.0.0-alpha.4',
    activeMode: config.curveStyle || config.mode || 'polygon',
    rawColorCount,
    mergedColorCount,
    actualUpscaleFactor: effectiveScale,
    warnings: [] as string[],
  };

  let finalSvg = bakeTransformsWithSvgPath(data.svgString);

  const isMagentaMode = (config.bgMode ?? 'magenta') === 'magenta';
  const isWhiteMode = config.bgMode === 'white';
  const isBgRemoval = config.removeBackground !== false;

  if (isMagentaMode && isBgRemoval) {
    finalSvg = filterMagentaPathsInSvg(finalSvg, config.magentaTolerance ?? 14);
  } else if (isWhiteMode && config.keepInnerWhite === false) {
    finalSvg = filterWhitePathsInSvg(finalSvg, config.whiteTolerance ?? 242);
  }

  const outputPreset = config.outputResolutionPreset || '15mp';
  let outW = data.width || width;
  let outH = data.height || height;
  let outMP = Number(((outW * outH) / 1000000).toFixed(2));

  if (outputPreset !== 'native') {
    let targetMP = 15;
    if (outputPreset === '20mp') targetMP = 20;
    else if (outputPreset === '25mp') targetMP = 25;
    else if (outputPreset === '30mp') targetMP = 30;
    else if (outputPreset === 'custom') targetMP = Math.max(15, config.outputMegaPixels || 15);
    else targetMP = Math.max(15, config.outputMegaPixels || 15);

    const dims = calculateTargetDimensions(outW, outH, targetMP);
    finalSvg = scaleSvg(finalSvg, dims.width, dims.height);
    outW = dims.width;
    outH = dims.height;
    outMP = dims.megaPixels;
  }

  const epsTitle = `${fileName.replace(/\.[^/.]+$/, '')}.eps`;
  const skipWhiteInEps = Boolean(isWhiteMode && config.keepInnerWhite === false);
  const skipMagentaInEps = Boolean(isMagentaMode && isBgRemoval);
  const finalEps = convertSvgToEps(
    finalSvg,
    epsTitle,
    skipWhiteInEps,
    skipMagentaInEps,
    config.magentaTolerance ?? 14
  );

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

  onProgress?.(100);

  return {
    svgString: finalSvg,
    epsString: finalEps,
    width: outW,
    height: outH,
    outputMegaPixels: outMP,
    outputResolutionPreset: outputPreset,
    colorCount: palette.length || config.maxColors,
    pathCount,
    palette,
    svgSize: svgBytes,
    epsSize: epsBytes,
    processingTimeMs: Math.round(performance.now() - startTime),
    engineUsed: data.engineUsed || '@visioncortex/vtracer (Rust/WASM)',
    engineVersion: data.engineVersion || 'v1.0.0-alpha.4',
    activeMode: data.activeMode || config.curveStyle || config.mode || 'polygon',
    rawColorCount: data.rawColorCount ?? rawColorCount,
    mergedColorCount: data.mergedColorCount ?? mergedColorCount,
    actualUpscaleFactor: data.actualUpscaleFactor ?? effectiveScale,
    warnings: data.warnings || [],
    hasTransparency: config.makeWhiteTransparent || finalSvg.includes('fill="none"'),
    colorSnappingUsed: Boolean(config.colorSnapping !== false),
    qualityScore,
    qualityMessage,
  };
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

  const isMagentaMode = (config.bgMode ?? 'magenta') === 'magenta';
  const isWhiteMode = config.bgMode === 'white';
  const isBgRemoval = config.removeBackground !== false;

  if (isMagentaMode && isBgRemoval) {
    rawSvg = filterMagentaPathsInSvg(rawSvg, config.magentaTolerance ?? 14);
  } else if (isWhiteMode && !config.keepInnerWhite && config.whiteRemovalMode === 'global') {
    rawSvg = filterWhitePathsInSvg(rawSvg, config.whiteTolerance);
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
  const epsTitle = `${fileName.replace(/\.[^/.]+$/, '')}.eps`;
  const skipWhiteInEps = Boolean(isWhiteMode && !config.keepInnerWhite);
  const skipMagentaInEps = Boolean(isMagentaMode && isBgRemoval);
  const epsString = convertSvgToEps(
    rawSvg,
    epsTitle,
    skipWhiteInEps,
    skipMagentaInEps,
    config.magentaTolerance ?? 14
  );

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
