/**
 * High-Precision Lanczos / Bicubic Upscaler
 * Performs 2-pass separable Catmull-Rom Bicubic convolution resampling
 * with precomputed weight tables to eliminate nearest-neighbor pixel staircases.
 */

// Catmull-Rom bicubic spline kernel (B=0, C=0.5)
function bicubicWeight(x: number): number {
  const ax = Math.abs(x);
  if (ax < 1) {
    return 1.5 * ax * ax * ax - 2.5 * ax * ax + 1.0;
  } else if (ax < 2) {
    return -0.5 * ax * ax * ax + 2.5 * ax * ax - 4.0 * ax + 2.0;
  }
  return 0;
}

/**
 * Upscales ImageData smoothly by scaleFactor using bicubic interpolation.
 * Produces continuous anti-aliased transitions along diagonal edges.
 */
export function bicubicUpscale(
  srcData: ImageData,
  scaleFactor = 4
): ImageData {
  if (scaleFactor <= 1) return srcData;

  const sw = srcData.width;
  const sh = srcData.height;
  const src = srcData.data;

  const dw = Math.round(sw * scaleFactor);
  const dh = Math.round(sh * scaleFactor);

  // 1. Precompute horizontal weights table (dw taps)
  const xTableXm1 = new Int32Array(dw);
  const xTableXp0 = new Int32Array(dw);
  const xTableXp1 = new Int32Array(dw);
  const xTableXp2 = new Int32Array(dw);
  const xTableW_1 = new Float32Array(dw);
  const xTableW0 = new Float32Array(dw);
  const xTableW1 = new Float32Array(dw);
  const xTableW2 = new Float32Array(dw);

  for (let x = 0; x < dw; x++) {
    const srcX = (x + 0.5) / scaleFactor - 0.5;
    const x0 = Math.floor(srcX);
    const fx = srcX - x0;

    const w_1 = bicubicWeight(fx + 1);
    const w0 = bicubicWeight(fx);
    const w1 = bicubicWeight(fx - 1);
    const w2 = bicubicWeight(fx - 2);
    const wSum = w_1 + w0 + w1 + w2 || 1;

    xTableXm1[x] = Math.max(0, x0 - 1) * 4;
    xTableXp0[x] = Math.max(0, Math.min(sw - 1, x0)) * 4;
    xTableXp1[x] = Math.min(sw - 1, x0 + 1) * 4;
    xTableXp2[x] = Math.min(sw - 1, x0 + 2) * 4;

    xTableW_1[x] = w_1 / wSum;
    xTableW0[x] = w0 / wSum;
    xTableW1[x] = w1 / wSum;
    xTableW2[x] = w2 / wSum;
  }

  // Pass 1: Horizontal scale (sw x sh -> dw x sh)
  const mid = new Uint8ClampedArray(dw * sh * 4);
  for (let y = 0; y < sh; y++) {
    const srcRow = y * sw * 4;
    const midRow = y * dw * 4;
    for (let x = 0; x < dw; x++) {
      const xm1 = srcRow + xTableXm1[x];
      const xp0 = srcRow + xTableXp0[x];
      const xp1 = srcRow + xTableXp1[x];
      const xp2 = srcRow + xTableXp2[x];

      const w_1 = xTableW_1[x];
      const w0 = xTableW0[x];
      const w1 = xTableW1[x];
      const w2 = xTableW2[x];

      const mIdx = midRow + (x << 2);
      mid[mIdx] = src[xm1] * w_1 + src[xp0] * w0 + src[xp1] * w1 + src[xp2] * w2;
      mid[mIdx + 1] = src[xm1 + 1] * w_1 + src[xp0 + 1] * w0 + src[xp1 + 1] * w1 + src[xp2 + 1] * w2;
      mid[mIdx + 2] = src[xm1 + 2] * w_1 + src[xp0 + 2] * w0 + src[xp1 + 2] * w1 + src[xp2 + 2] * w2;
      mid[mIdx + 3] = src[xm1 + 3] * w_1 + src[xp0 + 3] * w0 + src[xp1 + 3] * w1 + src[xp2 + 3] * w2;
    }
  }

  // 2. Precompute vertical weights table (dh taps)
  const yTableYm1 = new Int32Array(dh);
  const yTableYp0 = new Int32Array(dh);
  const yTableYp1 = new Int32Array(dh);
  const yTableYp2 = new Int32Array(dh);
  const yTableW_1 = new Float32Array(dh);
  const yTableW0 = new Float32Array(dh);
  const yTableW1 = new Float32Array(dh);
  const yTableW2 = new Float32Array(dh);

  const dw4 = dw * 4;
  for (let y = 0; y < dh; y++) {
    const srcY = (y + 0.5) / scaleFactor - 0.5;
    const y0 = Math.floor(srcY);
    const fy = srcY - y0;

    const w_1 = bicubicWeight(fy + 1);
    const w0 = bicubicWeight(fy);
    const w1 = bicubicWeight(fy - 1);
    const w2 = bicubicWeight(fy - 2);
    const wSum = w_1 + w0 + w1 + w2 || 1;

    yTableYm1[y] = Math.max(0, y0 - 1) * dw4;
    yTableYp0[y] = Math.max(0, Math.min(sh - 1, y0)) * dw4;
    yTableYp1[y] = Math.min(sh - 1, y0 + 1) * dw4;
    yTableYp2[y] = Math.min(sh - 1, y0 + 2) * dw4;

    yTableW_1[y] = w_1 / wSum;
    yTableW0[y] = w0 / wSum;
    yTableW1[y] = w1 / wSum;
    yTableW2[y] = w2 / wSum;
  }

  // Pass 2: Vertical scale (dw x sh -> dw x dh)
  const dst = new Uint8ClampedArray(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const ym1 = yTableYm1[y];
    const yp0 = yTableYp0[y];
    const yp1 = yTableYp1[y];
    const yp2 = yTableYp2[y];

    const w_1 = yTableW_1[y];
    const w0 = yTableW0[y];
    const w1 = yTableW1[y];
    const w2 = yTableW2[y];

    const dstRow = y * dw4;
    for (let x = 0; x < dw; x++) {
      const col = x << 2;
      const dIdx = dstRow + col;
      const m0 = ym1 + col;
      const m1 = yp0 + col;
      const m2 = yp1 + col;
      const m3 = yp2 + col;

      dst[dIdx] = mid[m0] * w_1 + mid[m1] * w0 + mid[m2] * w1 + mid[m3] * w2;
      dst[dIdx + 1] = mid[m0 + 1] * w_1 + mid[m1 + 1] * w0 + mid[m2 + 1] * w1 + mid[m3 + 1] * w2;
      dst[dIdx + 2] = mid[m0 + 2] * w_1 + mid[m1 + 2] * w0 + mid[m2 + 2] * w1 + mid[m3 + 2] * w2;
      dst[dIdx + 3] = mid[m0 + 3] * w_1 + mid[m1 + 3] * w0 + mid[m2 + 3] * w1 + mid[m3 + 3] * w2;
    }
  }

  return new ImageData(dst, dw, dh);
}
