/**
 * SVG to Encapsulated PostScript (EPS Level 3) Converter
 * Converts vector SVG curves into Adobe Illustrator / CorelDraw / Inkscape compatible EPS files.
 * Accurately supports multi-color fills, bezier curves, and transparent backgrounds.
 */

import { parseSvgGradients, ParsedGradient } from './gradientSvg';

/** Cara menulis gradien di EPS: shading PostScript Level 3 asli, atau pita warna solid (Level 2). */
export type EpsGradientMode = 'shading' | 'bands';

interface RGBColor {
  r: number; // 0..1
  g: number; // 0..1
  b: number; // 0..1
  a: number; // 0..1
}

export function parseColor(str?: string | null): RGBColor | null {
  if (!str || str === 'none' || str === 'transparent') {
    return null;
  }
  str = str.trim();

  // rgba? (r, g, b, [a])
  const rgbMatch = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/i);
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1], 10) / 255;
    const g = parseInt(rgbMatch[2], 10) / 255;
    const b = parseInt(rgbMatch[3], 10) / 255;
    const a = rgbMatch[4] !== undefined ? parseFloat(rgbMatch[4]) : 1;
    return { r, g, b, a };
  }

  // #RRGGBB or #RGB
  if (str.startsWith('#')) {
    let hex = str.slice(1);
    if (hex.length === 3) {
      hex = hex.split('').map((c) => c + c).join('');
    }
    if (hex.length >= 6) {
      const r = parseInt(hex.substring(0, 2), 16) / 255;
      const g = parseInt(hex.substring(2, 4), 16) / 255;
      const b = parseInt(hex.substring(4, 6), 16) / 255;
      return { r, g, b, a: 1 };
    }
  }

  // Basic named colors
  const named: Record<string, RGBColor> = {
    black: { r: 0, g: 0, b: 0, a: 1 },
    white: { r: 1, g: 1, b: 1, a: 1 },
    red: { r: 1, g: 0, b: 0, a: 1 },
    green: { r: 0, g: 0.5, b: 0, a: 1 },
    blue: { r: 0, g: 0, b: 1, a: 1 },
    yellow: { r: 1, g: 1, b: 0, a: 1 },
    cyan: { r: 0, g: 1, b: 1, a: 1 },
    magenta: { r: 1, g: 0, b: 1, a: 1 },
    gray: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
    grey: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
  };

  return named[str.toLowerCase()] || null;
}

/**
 * Tokenizes and converts SVG path commands into PostScript path operators
 */
function svgPathToPostScript(d: string): string {
  const commandRegex = /([a-df-z])|([+-]?(?:\d*\.\d+|\d+)(?:[eE][+-]?\d+)?)/gi;
  let match: RegExpExecArray | null;
  const tokens: Array<{ type: 'cmd' | 'num'; val: string }> = [];

  while ((match = commandRegex.exec(d)) !== null) {
    if (match[1]) {
      tokens.push({ type: 'cmd', val: match[1] });
    } else if (match[2]) {
      tokens.push({ type: 'num', val: match[2] });
    }
  }

  let idx = 0;
  let currentX = 0;
  let currentY = 0;
  let startX = 0;
  let startY = 0;
  let lastControlX = 0;
  let lastControlY = 0;
  let lastCmd = '';
  const psLines: string[] = [];

  function nextNum(): number {
    if (idx < tokens.length && tokens[idx].type === 'num') {
      const val = parseFloat(tokens[idx].val);
      idx++;
      return isNaN(val) ? 0 : val;
    }
    return 0;
  }

  function hasNextNum(): boolean {
    return idx < tokens.length && tokens[idx].type === 'num';
  }

  function formatCoord(val: number): string {
    return Number(val.toFixed(3)).toString();
  }

  while (idx < tokens.length) {
    const token = tokens[idx];
    if (token.type !== 'cmd') {
      idx++;
      continue;
    }

    let cmd = token.val;
    idx++;

    while (true) {
      const isRel = cmd === cmd.toLowerCase();
      const upperCmd = cmd.toUpperCase();

      if (upperCmd === 'M') {
        const x = nextNum() + (isRel ? currentX : 0);
        const y = nextNum() + (isRel ? currentY : 0);
        currentX = x;
        currentY = y;
        startX = x;
        startY = y;
        psLines.push(`${formatCoord(x)} ${formatCoord(y)} m`);
        cmd = isRel ? 'l' : 'L';
      } else if (upperCmd === 'L') {
        const x = nextNum() + (isRel ? currentX : 0);
        const y = nextNum() + (isRel ? currentY : 0);
        currentX = x;
        currentY = y;
        psLines.push(`${formatCoord(x)} ${formatCoord(y)} l`);
      } else if (upperCmd === 'H') {
        const x = nextNum() + (isRel ? currentX : 0);
        psLines.push(`${formatCoord(x)} ${formatCoord(currentY)} l`);
        currentX = x;
      } else if (upperCmd === 'V') {
        const y = nextNum() + (isRel ? currentY : 0);
        psLines.push(`${formatCoord(currentX)} ${formatCoord(y)} l`);
        currentY = y;
      } else if (upperCmd === 'C') {
        const x1 = nextNum() + (isRel ? currentX : 0);
        const y1 = nextNum() + (isRel ? currentY : 0);
        const x2 = nextNum() + (isRel ? currentX : 0);
        const y2 = nextNum() + (isRel ? currentY : 0);
        const x = nextNum() + (isRel ? currentX : 0);
        const y = nextNum() + (isRel ? currentY : 0);
        lastControlX = x2;
        lastControlY = y2;
        currentX = x;
        currentY = y;
        psLines.push(
          `${formatCoord(x1)} ${formatCoord(y1)} ${formatCoord(x2)} ${formatCoord(y2)} ${formatCoord(x)} ${formatCoord(y)} c`
        );
      } else if (upperCmd === 'S') {
        let x1 = currentX;
        let y1 = currentY;
        if (lastCmd.toUpperCase() === 'C' || lastCmd.toUpperCase() === 'S') {
          x1 = 2 * currentX - lastControlX;
          y1 = 2 * currentY - lastControlY;
        }
        const x2 = nextNum() + (isRel ? currentX : 0);
        const y2 = nextNum() + (isRel ? currentY : 0);
        const x = nextNum() + (isRel ? currentX : 0);
        const y = nextNum() + (isRel ? currentY : 0);
        lastControlX = x2;
        lastControlY = y2;
        currentX = x;
        currentY = y;
        psLines.push(
          `${formatCoord(x1)} ${formatCoord(y1)} ${formatCoord(x2)} ${formatCoord(y2)} ${formatCoord(x)} ${formatCoord(y)} c`
        );
      } else if (upperCmd === 'Q') {
        const qx = nextNum() + (isRel ? currentX : 0);
        const qy = nextNum() + (isRel ? currentY : 0);
        const x = nextNum() + (isRel ? currentX : 0);
        const y = nextNum() + (isRel ? currentY : 0);
        const cp1x = currentX + (2 / 3) * (qx - currentX);
        const cp1y = currentY + (2 / 3) * (qy - currentY);
        const cp2x = x + (2 / 3) * (qx - x);
        const cp2y = y + (2 / 3) * (qy - y);
        lastControlX = qx;
        lastControlY = qy;
        currentX = x;
        currentY = y;
        psLines.push(
          `${formatCoord(cp1x)} ${formatCoord(cp1y)} ${formatCoord(cp2x)} ${formatCoord(cp2y)} ${formatCoord(x)} ${formatCoord(y)} c`
        );
      } else if (upperCmd === 'Z') {
        currentX = startX;
        currentY = startY;
        psLines.push('h');
        lastCmd = cmd;
        break;
      } else {
        break;
      }
      lastCmd = cmd;
      if (!hasNextNum()) {
        break;
      }
    }
  }

  return psLines.join('\n');
}


// ---------------------------------------------------------------------------
// Gradien → PostScript
// ---------------------------------------------------------------------------

const f4 = (v: number) => Number(v.toFixed(4)).toString();

function normalizedStops(g: ParsedGradient): Array<{ o: number; c: [number, number, number] }> {
  const st = g.stops
    .map((s) => ({ o: s.offset, c: [s.color[0] / 255, s.color[1] / 255, s.color[2] / 255] as [number, number, number] }))
    .sort((a, b) => a.o - b.o);
  if (st[0].o > 0) st.unshift({ o: 0, c: st[0].c });
  if (st[st.length - 1].o < 1) st.push({ o: 1, c: st[st.length - 1].c });
  st[0].o = 0;
  st[st.length - 1].o = 1;
  // offset harus naik tegas untuk /Bounds
  for (let i = 1; i < st.length; i++) {
    if (st[i].o <= st[i - 1].o) st[i].o = Math.min(1, st[i - 1].o + 1e-4);
  }
  return st;
}

function colorAt(st: Array<{ o: number; c: [number, number, number] }>, t: number): [number, number, number] {
  if (t <= 0) return st[0].c;
  if (t >= 1) return st[st.length - 1].c;
  for (let i = 1; i < st.length; i++) {
    if (t <= st[i].o) {
      const a = st[i - 1], b = st[i];
      const k = (t - a.o) / (b.o - a.o || 1);
      return [a.c[0] + (b.c[0] - a.c[0]) * k, a.c[1] + (b.c[1] - a.c[1]) * k, a.c[2] + (b.c[2] - a.c[2]) * k];
    }
  }
  return st[st.length - 1].c;
}

function psFunction(st: Array<{ o: number; c: [number, number, number] }>): string {
  const t2 = (a: [number, number, number], b: [number, number, number]) =>
    `<< /FunctionType 2 /Domain [0 1] /C0 [${a.map(f4).join(' ')}] /C1 [${b.map(f4).join(' ')}] /N 1 >>`;
  if (st.length === 2) return t2(st[0].c, st[1].c);
  const fns: string[] = [];
  const bounds: string[] = [];
  const encode: string[] = [];
  for (let i = 0; i < st.length - 1; i++) {
    fns.push(t2(st[i].c, st[i + 1].c));
    encode.push('0 1');
    if (i > 0) bounds.push(f4(st[i].o));
  }
  return `<< /FunctionType 3 /Domain [0 1] /Functions [${fns.join(' ')}] /Bounds [${bounds.join(' ')}] /Encode [${encode.join(' ')}] >>`;
}

/** Kotak pembatas kasar dari perintah path PostScript (titik akhir + titik kontrol). */
function psPathBBox(ps: string): [number, number, number, number] | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const line of ps.split('\n')) {
    const parts = line.trim().split(/\s+/);
    const nums = parts.slice(0, -1).map(parseFloat);
    for (let i = 0; i + 1 < nums.length; i += 2) {
      const x = nums[i], y = nums[i + 1];
      if (!isFinite(x) || !isFinite(y)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return isFinite(minX) ? [minX, minY, maxX, maxY] : null;
}

/**
 * Isi path (sudah terdefinisi sebagai current path) dengan gradien.
 * Mengembalikan baris-baris PostScript, atau null bila matriks gradien rusak.
 */
function gradientFillPs(
  g: ParsedGradient,
  psPath: string,
  isEvenOdd: boolean,
  mode: EpsGradientMode
): string[] | null {
  const [a, b, c, d, e, f] = g.matrix;
  const det = a * d - b * c;
  if (!isFinite(det) || Math.abs(det) < 1e-9) return null;
  const st = normalizedStops(g);
  const lines: string[] = ['gsave', isEvenOdd ? 'eoclip' : 'clip', 'n', `[${[a, b, c, d, e, f].map(f4).join(' ')}] concat`];

  if (mode === 'shading') {
    const coords = g.type === 'linear' ? '[0 0 1 0]' : '[0 0 0 0 0 1]';
    lines.push(
      `<< /ShadingType ${g.type === 'linear' ? 2 : 3} /ColorSpace /DeviceRGB /Coords ${coords} /Extend [true true] /Function ${psFunction(st)} >> shfill`
    );
  } else {
    // Pita warna solid: batas area dipetakan ke ruang gradien satuan.
    const bb = psPathBBox(psPath) || [0, 0, 1, 1];
    const corners = [
      [bb[0], bb[1]],
      [bb[2], bb[1]],
      [bb[0], bb[3]],
      [bb[2], bb[3]],
    ].map(([x, y]) => {
      const dx = x - e, dy = y - f;
      return [(d * dx - c * dy) / det, (-b * dx + a * dy) / det];
    });
    const us = corners.map((p) => p[0]);
    const vs = corners.map((p) => p[1]);
    const umin = Math.min(...us, 0) - 0.01, umax = Math.max(...us, 1) + 0.01;
    const vmin = Math.min(...vs) - 0.01, vmax = Math.max(...vs) + 0.01;

    let path = 0;
    for (let i = 1; i < st.length; i++) {
      path += Math.hypot(st[i].c[0] - st[i - 1].c[0], st[i].c[1] - st[i - 1].c[1], st[i].c[2] - st[i - 1].c[2]) * 255;
    }
    const N = Math.max(12, Math.min(96, Math.ceil(path / 3)));
    const rgbStr = (col: [number, number, number]) => `${col.map(f4).join(' ')} rgb`;

    if (g.type === 'linear') {
      lines.push(rgbStr(st[0].c), `${f4(umin)} ${f4(vmin)} ${f4(-umin + 0.0001)} ${f4(vmax - vmin)} rectfill`);
      lines.push(rgbStr(st[st.length - 1].c), `1 ${f4(vmin)} ${f4(umax - 1)} ${f4(vmax - vmin)} rectfill`);
      const bw = 1 / N;
      for (let i = 0; i < N; i++) {
        lines.push(rgbStr(colorAt(st, (i + 0.5) * bw)), `${f4(i * bw)} ${f4(vmin)} ${f4(bw * 1.02)} ${f4(vmax - vmin)} rectfill`);
      }
    } else {
      const rmax = Math.max(1, ...corners.map((p) => Math.hypot(p[0], p[1]))) + 0.01;
      lines.push(rgbStr(st[st.length - 1].c), `n 0 0 ${f4(rmax)} 0 360 arc f`);
      for (let i = N - 1; i >= 0; i--) {
        const r = (i + 1) / N;
        lines.push(rgbStr(colorAt(st, (i + 0.5) / N)), `n 0 0 ${f4(r)} 0 360 arc f`);
      }
    }
  }
  lines.push('grestore');
  return lines;
}

/**
 * Converts an SVG string into a standalone Encapsulated PostScript (.eps) string
 */
export function convertSvgToEps(
  svgString: string,
  title = 'vector_output.eps',
  skipWhite = false,
  skipMagenta = false,
  magentaTolerance = 14,
  gradientMode: EpsGradientMode = 'shading'
): string {
  const gradients = parseSvgGradients(svgString);
  let usesShading = false;

  let width = 600;
  let height = 400;

  const viewBoxMatch = svgString.match(
    /viewBox=["']\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*["']/i
  );
  if (viewBoxMatch) {
    width = Math.ceil(parseFloat(viewBoxMatch[3]));
    height = Math.ceil(parseFloat(viewBoxMatch[4]));
  } else {
    const widthMatch = svgString.match(/width=["']([\d.]+)(?:px)?["']/i);
    const heightMatch = svgString.match(/height=["']([\d.]+)(?:px)?["']/i);
    if (widthMatch) width = Math.ceil(parseFloat(widthMatch[1]));
    if (heightMatch) height = Math.ceil(parseFloat(heightMatch[1]));
  }

  if (isNaN(width) || width <= 0) width = 600;
  if (isNaN(height) || height <= 0) height = 400;

  const pathRegex = /<path\b([^>]*)\/?>/gi;
  let pathMatch: RegExpExecArray | null;
  const bodyParts: string[] = [];

  while ((pathMatch = pathRegex.exec(svgString)) !== null) {
    const attrsStr = pathMatch[1];
    const dMatch = attrsStr.match(/\bd=["']([^"']+)["']/i);
    if (!dMatch) continue;
    const d = dMatch[1];

    const fillMatch = attrsStr.match(/\bfill=["']([^"']+)["']/i);
    const fillVal = fillMatch ? fillMatch[1] : null;

    const strokeMatch = attrsStr.match(/\bstroke=["']([^"']+)["']/i);
    const strokeVal = strokeMatch ? strokeMatch[1] : null;

    const swMatch = attrsStr.match(/\bstroke-width=["']([^"']+)["']/i);
    const strokeWidth = swMatch ? parseFloat(swMatch[1]) : 1;

    const fillRuleMatch = attrsStr.match(/\bfill-rule=["']([^"']+)["']/i);
    const isEvenOdd = fillRuleMatch ? fillRuleMatch[1].toLowerCase() === 'evenodd' : false;

    // Isi gradien: fill="url(#id)"
    const urlMatch = fillVal ? fillVal.match(/^url\(\s*#([^)\s]+)\s*\)$/i) : null;
    if (urlMatch) {
      const g = gradients.get(urlMatch[1]);
      if (!g) continue;
      const psPath = svgPathToPostScript(d);
      if (!psPath.trim()) continue;
      const gLines = gradientFillPs(g, psPath, isEvenOdd, gradientMode);
      bodyParts.push('n');
      bodyParts.push(psPath);
      if (gLines) {
        bodyParts.push(...gLines);
        if (gradientMode === 'shading') usesShading = true;
      } else {
        // matriks rusak → warna tengah gradien
        const mid = g.stops[Math.floor(g.stops.length / 2)].color;
        bodyParts.push(`${(mid[0] / 255).toFixed(4)} ${(mid[1] / 255).toFixed(4)} ${(mid[2] / 255).toFixed(4)} rgb`);
        bodyParts.push(isEvenOdd ? 'f*' : 'f');
      }
      continue;
    }

    const fillColor = parseColor(fillVal);
    const strokeColor = parseColor(strokeVal);

    if (!fillColor && !strokeColor) {
      continue;
    }

    // Skip transparent fill
    if (fillColor && fillColor.a === 0) {
      continue;
    }

    // Skip white fills if skipWhite is enabled (all white made transparent)
    if (skipWhite && fillColor && fillColor.r >= 0.95 && fillColor.g >= 0.95 && fillColor.b >= 0.95 && !strokeColor) {
      continue;
    }

    // Skip magenta fills if skipMagenta is enabled (magenta made transparent)
    if (skipMagenta && fillColor && !strokeColor) {
      const dr = (fillColor.r * 255) - 255;
      const dg = (fillColor.g * 255) - 0;
      const db = (fillColor.b * 255) - 255;
      const distPercent = (Math.sqrt(dr * dr + dg * dg + db * db) / 441.67295593) * 100;
      if (distPercent <= magentaTolerance) {
        continue;
      }
    }

    const psPath = svgPathToPostScript(d);
    if (!psPath.trim()) continue;

    bodyParts.push('n');
    bodyParts.push(psPath);

    if (fillColor) {
      const r = fillColor.r.toFixed(4);
      const g = fillColor.g.toFixed(4);
      const b = fillColor.b.toFixed(4);
      const fillCmd = isEvenOdd ? 'f*' : 'f';

      if (strokeColor) {
        bodyParts.push('gsave');
        bodyParts.push(`${r} ${g} ${b} rgb`);
        bodyParts.push(fillCmd);
        bodyParts.push('grestore');
      } else {
        bodyParts.push(`${r} ${g} ${b} rgb`);
        bodyParts.push(fillCmd);
      }
    }

    if (strokeColor) {
      const sr = strokeColor.r.toFixed(4);
      const sg = strokeColor.g.toFixed(4);
      const sb = strokeColor.b.toFixed(4);
      bodyParts.push(`${Number(strokeWidth.toFixed(2))} w`);
      bodyParts.push(`${sr} ${sg} ${sb} rgb`);
      bodyParts.push('s');
    }
  }

  const currentDate = new Date().toUTCString();
  const header = `%!PS-Adobe-3.0 EPSF-3.0
%%Creator: Vectorize Multi-Color Studio
%%Title: ${title}
%%CreationDate: ${currentDate}
%%BoundingBox: 0 0 ${width} ${height}
%%PageBoundingBox: 0 0 ${width} ${height}
%%HiResBoundingBox: 0.0000 0.0000 ${width}.0000 ${height}.0000
%%DocumentData: Clean7Bit
%%LanguageLevel: ${usesShading ? 3 : 2}
%%Pages: 1
%%EndComments
%%PageMedia: custom
statusdict /setpageparams known {
  ${width} ${height} 0 1 statusdict begin setpageparams end
} if
<< /PageSize [${width} ${height}] /ImagingBBox null >> setpagedevice
%%BeginProlog
/q { gsave } bind def
/Q { grestore } bind def
/n { newpath } bind def
/m { moveto } bind def
/l { lineto } bind def
/c { curveto } bind def
/h { closepath } bind def
/f { fill } bind def
/f* { eofill } bind def
/s { stroke } bind def
/rgb { setrgbcolor } bind def
/w { setlinewidth } bind def
%%EndProlog
%%Page: 1 1
0 ${height} translate
1 -1 scale
`;

  const footer = `
showpage
%%Trailer
%%EOF
`;

  return header + bodyParts.join('\n') + footer;
}
