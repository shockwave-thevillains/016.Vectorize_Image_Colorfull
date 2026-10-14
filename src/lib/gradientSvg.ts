/**
 * Serialisasi gradien ke SVG, parsing kembali (untuk EPS), dan penskalaan.
 *
 * Semua gradien ditulis dalam bentuk kanonik:
 *   <linearGradient gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1" y2="0" gradientTransform="matrix(...)">
 *   <radialGradient gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="matrix(...)">
 * sehingga penskalaan/transformasi cukup mengalikan matriksnya, dan konversi EPS cukup memakai
 * `concat` + shading satuan.
 */
import type { GradientSpec, GradientStop, Rgb } from './gradientDetect';

export interface ParsedGradient {
  id: string;
  type: 'linear' | 'radial';
  matrix: [number, number, number, number, number, number];
  stops: GradientStop[];
}

const hex2 = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
export const rgbHex = (c: Rgb) => `#${hex2(c[0])}${hex2(c[1])}${hex2(c[2])}`.toUpperCase();
const num = (v: number) => Number(v.toFixed(3)).toString();

export function gradientElementXml(id: string, spec: GradientSpec): string {
  const m = spec.matrix.map(num).join(' ');
  const stops = spec.stops
    .map((s) => `<stop offset="${num(s.offset)}" stop-color="${rgbHex(s.color)}"/>`)
    .join('');
  if (spec.type === 'linear') {
    return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1" y2="0" gradientTransform="matrix(${m})">${stops}</linearGradient>`;
  }
  return `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="matrix(${m})">${stops}</radialGradient>`;
}

/**
 * Sisipkan gradien ke SVG: definisi di <defs> lalu path gradien PALING BAWAH (tepat setelah tag
 * <svg>), urut dari area terbesar. Lapisan warna datar (yang sudah berlubang di area gradien)
 * berada di atasnya, sehingga teks/detail di atas gradien tetap utuh.
 */
export function injectGradients(
  svg: string,
  items: Array<{ spec: GradientSpec; d: string }>,
  idPrefix: string
): string {
  if (items.length === 0) return svg;
  const defs: string[] = [];
  const paths: string[] = [];
  items.forEach((it, i) => {
    const id = `${idPrefix}${i + 1}`;
    defs.push(gradientElementXml(id, it.spec));
    paths.push(`<path d="${it.d}" fill="url(#${id})" fill-rule="evenodd"/>`);
  });
  return svg.replace(
    /<svg\b[^>]*>/i,
    (open) => `${open}\n<defs>${defs.join('')}</defs>\n${paths.join('\n')}`
  );
}

function parseMatrix(attr: string | undefined): ParsedGradient['matrix'] {
  if (!attr) return [1, 0, 0, 1, 0, 0];
  const m = attr.match(/matrix\(\s*([^)]+)\)/i);
  if (!m) return [1, 0, 0, 1, 0, 0];
  const v = m[1].split(/[\s,]+/).map(parseFloat);
  if (v.length < 6 || v.some((x) => !isFinite(x))) return [1, 0, 0, 1, 0, 0];
  return [v[0], v[1], v[2], v[3], v[4], v[5]];
}

function parseHexColor(s: string): Rgb | null {
  let h = s.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Baca gradien kanonik yang ditulis `gradientElementXml` (dipakai konverter EPS). */
export function parseSvgGradients(svg: string): Map<string, ParsedGradient> {
  const out = new Map<string, ParsedGradient>();
  const re = /<(linearGradient|radialGradient)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg)) !== null) {
    const attrs = m[2];
    const id = attrs.match(/\bid=["']([^"']+)["']/i)?.[1];
    if (!id) continue;
    const matrix = parseMatrix(attrs.match(/\bgradientTransform=["']([^"']+)["']/i)?.[1]);
    const stops: GradientStop[] = [];
    const stopRe = /<stop\b([^>]*)\/?>/gi;
    let s: RegExpExecArray | null;
    while ((s = stopRe.exec(m[3])) !== null) {
      const off = parseFloat(s[1].match(/\boffset=["']([^"']+)["']/i)?.[1] || '0');
      const col = parseHexColor(s[1].match(/\bstop-color=["']([^"']+)["']/i)?.[1] || '');
      if (col) stops.push({ offset: Math.max(0, Math.min(1, isFinite(off) ? off : 0)), color: col });
    }
    if (stops.length === 0) continue;
    out.set(id, { id, type: m[1].toLowerCase() === 'lineargradient' ? 'linear' : 'radial', matrix, stops });
  }
  return out;
}

/** Skala seluruh gradientTransform dengan (sx, sy) — dipanggil bersama penskalaan path. */
export function scaleGradientTransforms(svg: string, sx: number, sy: number): string {
  return svg.replace(/\bgradientTransform=["']\s*matrix\(([^)]+)\)\s*["']/gi, (full, inner) => {
    const v = String(inner).split(/[\s,]+/).map(parseFloat);
    if (v.length < 6 || v.some((x) => !isFinite(x))) return full;
    const s = [v[0] * sx, v[1] * sy, v[2] * sx, v[3] * sy, v[4] * sx, v[5] * sy].map(num).join(' ');
    return `gradientTransform="matrix(${s})"`;
  });
}

/** Warna stop (untuk palet / statistik). */
export function gradientStopColors(svg: string): string[] {
  const set = new Set<string>();
  for (const g of parseSvgGradients(svg).values()) for (const s of g.stops) set.add(rgbHex(s.color));
  return [...set];
}
