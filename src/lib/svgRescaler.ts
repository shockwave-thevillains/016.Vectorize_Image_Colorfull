import svgpath from 'svgpath';
import { convertSvgToEps } from './epsConverter';
import { scaleGradientTransforms } from './gradientSvg';
import { OutputResolutionPreset, VectorizeConfig } from '../types';

export interface ScaledResolution {
  width: number;
  height: number;
  scale: number;
  megaPixels: number;
  isNative: boolean;
  label: string;
}

export const MIN_OUTPUT_MEGAPIXELS = 15;

/**
 * Calculates target pixel dimensions for an aspect ratio to achieve at least `megaPixels` MP (minimum 15 MP).
 */
export function calculateTargetDimensions(
  origWidth: number,
  origHeight: number,
  megaPixels: number
): { width: number; height: number; scale: number; megaPixels: number } {
  const w0 = Math.max(1, origWidth || 1000);
  const h0 = Math.max(1, origHeight || 1000);
  const effectiveMP = Math.max(MIN_OUTPUT_MEGAPIXELS, megaPixels);

  const R = w0 / h0;
  const targetTotalPixels = Math.round(effectiveMP * 1000000);

  let W = Math.ceil(Math.sqrt(targetTotalPixels * R));
  let H = Math.ceil(W / R);

  // Guarantee strictly at least targetTotalPixels
  while (W * H < targetTotalPixels) {
    W += 1;
    H = Math.ceil(W / R);
  }

  const scale = W / w0;
  const actualMP = Number(((W * H) / 1000000).toFixed(2));

  return {
    width: W,
    height: H,
    scale,
    megaPixels: actualMP,
  };
}

/**
 * Resolves the target resolution details based on the user's config and source dimensions.
 */
export function getOutputDimensionsForConfig(
  origWidth: number,
  origHeight: number,
  config?: Partial<VectorizeConfig>
): ScaledResolution {
  const w0 = Math.max(1, origWidth || 1000);
  const h0 = Math.max(1, origHeight || 1000);
  const preset = config?.outputResolutionPreset || '15mp';

  if (preset === 'native') {
    const nativeMP = Number(((w0 * h0) / 1000000).toFixed(2));
    return {
      width: w0,
      height: h0,
      scale: 1,
      megaPixels: nativeMP,
      isNative: true,
      label: `Ukuran Asli (${w0} × ${h0} px • ${nativeMP} MP)`,
    };
  }

  let requestedMP = MIN_OUTPUT_MEGAPIXELS;
  if (preset === '20mp') requestedMP = 20;
  else if (preset === '25mp') requestedMP = 25;
  else if (preset === '30mp') requestedMP = 30;
  else if (preset === 'custom') {
    requestedMP = Math.max(MIN_OUTPUT_MEGAPIXELS, config?.outputMegaPixels || MIN_OUTPUT_MEGAPIXELS);
  } else {
    // default 15mp
    requestedMP = Math.max(MIN_OUTPUT_MEGAPIXELS, config?.outputMegaPixels || MIN_OUTPUT_MEGAPIXELS);
  }

  const dims = calculateTargetDimensions(w0, h0, requestedMP);
  return {
    ...dims,
    isNative: false,
    label: `${dims.megaPixels} MP (${dims.width.toLocaleString('id-ID')} × ${dims.height.toLocaleString('id-ID')} px)`,
  };
}

/**
 * Scales an SVG string to target dimensions, scaling all paths using svgpath
 * and updating the viewBox and width/height attributes.
 */
export function scaleSvg(svgString: string, targetWidth: number, targetHeight: number): string {
  if (!svgString || !svgString.includes('<svg')) return svgString;

  const vbMatch = svgString.match(/viewBox=["']\s*([\d.-]+)[\s,]+([\d.-]+)[\s,]+([\d.-]+)[\s,]+([\d.-]+)\s*["']/i);
  let origW = targetWidth;
  let origH = targetHeight;

  if (vbMatch) {
    origW = parseFloat(vbMatch[3]);
    origH = parseFloat(vbMatch[4]);
  } else {
    const wm = svgString.match(/width=["']([\d.]+)(?:px)?["']/i);
    const hm = svgString.match(/height=["']([\d.]+)(?:px)?["']/i);
    if (wm) origW = parseFloat(wm[1]);
    if (hm) origH = parseFloat(hm[1]);
  }

  if (isNaN(origW) || origW <= 0) origW = 600;
  if (isNaN(origH) || origH <= 0) origH = 400;

  const sx = targetWidth / origW;
  const sy = targetHeight / origH;

  // If already at target dimensions, ensure responsive attributes and return
  if (Math.abs(sx - 1) < 0.001 && Math.abs(sy - 1) < 0.001) {
    let clean = svgString;
    if (!clean.includes('viewBox')) {
      clean = clean.replace('<svg ', `<svg viewBox="0 0 ${targetWidth} ${targetHeight}" `);
    }
    return clean;
  }

  const avgScale = (sx + sy) / 2;

  // Scale every <path> element in the SVG
  let resultSvg = svgString.replace(/<path\b([^>]*?)(\/?>|>[\s\S]*?<\/path>)/gi, (fullTag, attrs) => {
    const dMatch = attrs.match(/\bd=["']([^"']+)["']/i);
    if (!dMatch) return fullTag;
    const rawD = dMatch[1];
    const newD = svgpath(rawD).scale(sx, sy).abs().round(2).toString();
    let cleanAttrs = attrs.replace(/\bd=["'][^"']+["']/gi, () => `d="${newD}"`);

    // Proportionally scale stroke-width if present
    const swMatch = attrs.match(/\bstroke-width=["']([\d.]+)["']/i);
    if (swMatch) {
      const origSw = parseFloat(swMatch[1]);
      if (!isNaN(origSw)) {
        const newSw = (origSw * avgScale).toFixed(2);
        cleanAttrs = cleanAttrs.replace(/\bstroke-width=["'][\d.]+["']/gi, () => `stroke-width="${newSw}"`);
      }
    }

    cleanAttrs = cleanAttrs.replace(/\/+$/, '').trim();
    return `<path ${cleanAttrs}/>`;
  });

  // Gradien (gradientTransform) ikut diskalakan bersama path
  resultSvg = scaleGradientTransforms(resultSvg, sx, sy);

  // Update viewBox
  if (resultSvg.includes('viewBox=')) {
    resultSvg = resultSvg.replace(/viewBox=["'][^"']+["']/i, `viewBox="0 0 ${targetWidth} ${targetHeight}"`);
  } else {
    resultSvg = resultSvg.replace('<svg ', `<svg viewBox="0 0 ${targetWidth} ${targetHeight}" `);
  }

  // Update or set width and height
  if (resultSvg.match(/<svg\b[^>]*\bwidth=["'][^"']+["']/i)) {
    resultSvg = resultSvg.replace(/\bwidth=["'][^"']+["']/i, `width="${targetWidth}"`);
  } else {
    resultSvg = resultSvg.replace('<svg ', `<svg width="${targetWidth}" `);
  }

  if (resultSvg.match(/<svg\b[^>]*\bheight=["'][^"']+["']/i)) {
    resultSvg = resultSvg.replace(/\bheight=["'][^"']+["']/i, `height="${targetHeight}"`);
  } else {
    resultSvg = resultSvg.replace('<svg ', `<svg height="${targetHeight}" `);
  }

  return resultSvg;
}

/**
 * Scales both SVG and EPS to the desired target MegaPixels (minimum 15 MP).
 */
export function scaleVectorToMegaPixels(
  svgString: string,
  targetMP: number,
  title = 'vector_output'
): {
  svgString: string;
  epsString: string;
  width: number;
  height: number;
  megaPixels: number;
} {
  const vbMatch = svgString.match(/viewBox=["']\s*([\d.-]+)[\s,]+([\d.-]+)[\s,]+([\d.-]+)[\s,]+([\d.-]+)\s*["']/i);
  let origW = 1000;
  let origH = 1000;

  if (vbMatch) {
    origW = parseFloat(vbMatch[3]) || 1000;
    origH = parseFloat(vbMatch[4]) || 1000;
  }

  const { width, height, megaPixels } = calculateTargetDimensions(origW, origH, targetMP);
  const scaledSvg = scaleSvg(svgString, width, height);

  const epsTitle = `${title.replace(/\.[^/.]+$/, '')}.eps`;
  const scaledEps = convertSvgToEps(scaledSvg, epsTitle, false);

  return {
    svgString: scaledSvg,
    epsString: scaledEps,
    width,
    height,
    megaPixels,
  };
}

/**
 * Renders an SVG string to a high-resolution PNG Blob at the specified width and height.
 */
export async function renderSvgToPngBlob(
  svgString: string,
  width: number,
  height: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const img = new Image();

      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(url);
          reject(new Error('Canvas 2D context not available'));
          return;
        }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(url);

        canvas.toBlob((pngBlob) => {
          if (pngBlob) {
            resolve(pngBlob);
          } else {
            reject(new Error('Failed to generate PNG blob'));
          }
        }, 'image/png');
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load SVG into Image for PNG export'));
      };

      img.src = url;
    } catch (err) {
      reject(err);
    }
  });
}
