/**
 * SVG to Encapsulated PostScript (EPS Level 3) Converter
 * Converts vector SVG curves into Adobe Illustrator / CorelDraw / Inkscape compatible EPS files.
 * Accurately supports multi-color fills, bezier curves, and transparent backgrounds.
 */

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

/**
 * Converts an SVG string into a standalone Encapsulated PostScript (.eps) string
 */
export function convertSvgToEps(
  svgString: string,
  title = 'vector_output.eps',
  skipWhite = false,
  skipMagenta = false,
  magentaTolerance = 14
): string {
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
%%LanguageLevel: 2
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
